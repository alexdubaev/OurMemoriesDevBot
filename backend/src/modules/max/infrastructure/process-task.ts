import type { MaxSource } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { BackendRuntime } from '../../../runtime'
import { TerminalTaskError } from '../../../outbox'
import { createInviteStartResolver, createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createSourceMemoryPublisher } from '../../memories'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import { createMaxImageProcessor } from './process-image'
import { createMaxVideoProcessor } from './process-video'
import { createMaxVoiceProcessor } from './process-voice'
import type { MaxDownloadedMedia, MaxVideoStream } from './media-download'
import { resolveMaxTarget, chooseMaxTarget, expireMaxTarget } from './source-target'
import { parseChoicePayload, savedFamilyText } from '../../../bot-family-target'

type PayloadCrypto = {
  decrypt<T>(payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): T
}

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const unsupportedMediaText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const welcomeText = 'Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.'
const inviteGuidanceText = 'Приглашение получено. Откройте приложение memoLy, чтобы присоединиться.'
const invalidInviteText = 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.'

export function createMaxTaskProcessor(options: {
  runtime: BackendRuntime
  crypto: PayloadCrypto
  resolveInviteStart?: (rawToken: string) => Promise<'active' | 'invalid'>
  api?: MaxApiPort
  media?: ReturnType<typeof import('../../media').createMediaService>
  download?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
  videoDownload?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxVideoStream>
}): (payload: unknown, signal?: AbortSignal) => Promise<'done' | 'skipped'> {
  const { prisma } = options.runtime
  const resolveInviteStart = options.resolveInviteStart ?? createInviteStartResolver(prisma)
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)
  const imageProcessor = options.api && options.media && options.download
    ? createMaxImageProcessor({ runtime: options.runtime, api: options.api, media: options.media, download: options.download, videoDownload: options.videoDownload })
    : null
  const videoProcessor = options.api ? createMaxVideoProcessor({ runtime: options.runtime, api: options.api }) : null
  const voiceProcessor = options.api && options.media && options.download
    ? createMaxVoiceProcessor({ runtime: options.runtime, api: options.api, media: options.media, download: options.download })
    : null

  return async (payload, signal) => {
    const inboxId = taskPayload(payload)
    const inbox = await prisma.maxInbox.findUnique({ where: { id: inboxId }, include: { source: true } })
    if (!inbox) return 'skipped'
    if (inbox.status === 'processed' || inbox.processedAt) {
      await retryTerminalSourceCleanup(prisma, options.media, inbox.source)
      return 'skipped'
    }

    const event = options.crypto.decrypt<MaxInboundEvent>({
      ciphertext: inbox.encryptedPayload,
      iv: inbox.encryptionIv,
      authTag: inbox.encryptionAuthTag,
    })

    if (event.kind === 'bot_started') {
      const token = inviteTokenFromPayload(event.payload)
      const responseText = token
        ? (await resolveInviteStart(token)) === 'active' ? inviteGuidanceText : invalidInviteText
        : welcomeText
      return await terminalInbox(prisma, inbox.id, 'welcome', event.userId, responseText) ? 'done' : 'skipped'
    }
    if (event.kind === 'family_choice') {
      const parsed = parseChoicePayload(event.payload)
      const result = parsed ? await chooseMaxTarget(prisma, parsed.sourceId, parsed.index, event.userId) : 'denied'
      await options.api?.answerCallback?.(event.callbackId, result === 'chosen' ? 'Семья выбрана. Сохраняем…' :
        result === 'already_chosen' ? 'Семья для этого сообщения уже выбрана.' :
        result === 'expired' ? 'Время выбора истекло. Отправьте материал заново.' : 'Этот выбор недоступен.')
      await prisma.maxInbox.updateMany({ where: { id: inbox.id, status: 'accepted' }, data: {
        status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
      } })
      return 'done'
    }

    const source = inbox.source
    if (!source) throw new TerminalTaskError('MAX message inbox has no source')
    if (source.status !== 'accepted') {
      await retryTerminalSourceCleanup(prisma, options.media, source)
      return 'skipped'
    }

    const hasAttachments = (event.attachments?.length ?? (event.hasAttachments ? 1 : 0)) > 0
    if (hasAttachments) {
      if (videoProcessor && event.attachments?.length === 1 && event.attachments[0]?.kind === 'video') {
        return videoProcessor({ inboxId: inbox.id, sourceId: source.id, event, signal })
      }
      if (voiceProcessor && event.attachments?.length === 1 && event.attachments[0]?.kind === 'voice') {
        return voiceProcessor({ inboxId: inbox.id, sourceId: source.id, event, signal })
      }
      if (imageProcessor && source) return imageProcessor({ inboxId: inbox.id, sourceId: source.id, event, signal })
      return await terminalSource(prisma, source, 'unsupported_media', responseActor(event), unsupportedMediaText) ? 'done' : 'skipped'
    }

    if (!isPublishableText(event.text)) {
      return await deny(prisma, source, undefined, event.isChannel === true) ? 'done' : 'skipped'
    }
    const text = event.text

    const targetResult = await resolveMaxTarget(prisma, source, new Date(), event.isChannel === true)
    if (targetResult.kind === 'pending') return 'done'
    if (targetResult.kind === 'expired') return expireMaxTarget(prisma, source.id, source.inboxId, responseActor(event))
    if (targetResult.kind !== 'target') return await deny(prisma, source,
      'Материал не сохранён: нет семьи с правом публикации и профилем ребёнка.', event.isChannel === true) ? 'done' : 'skipped'
    const admission = targetResult.target

    const scope: FamilyScope = {
      familyId: admission.familyId,
      principal: { userId: admission.userId, sessionId: `max:${source.id}` },
    }
    const publish = () => publisher.publish(scope, {
      id: source.plannedMemoryId,
      childId: admission.childId,
      kind: 'note',
      body: text,
      occurredAt: new Date(event.occurredAt),
      sourcePublishedAt: new Date(event.occurredAt),
      mediaIds: [],
    }, async (tx, memoryId) => {
        const family = await tx.family.findUniqueOrThrow({ where: { id: admission.familyId }, select: { name: true } })
        await tx.maxSource.update({ where: { id: source.id }, data: {
          status: 'published', memoryId, userId: admission.userId, familyId: admission.familyId, childId: admission.childId,
        } })
        await markInboxProcessed(tx, inbox.id)
      if (!event.isChannel) await createResponseAndTask(tx, {
        inboxId: inbox.id, destinationUserId: source.senderSubject, kind: 'saved', text: savedFamilyText(family.name),
      })
    })
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await publish()
          break
        } catch (error) {
          if (!isUniqueConstraint(error) || attempt >= 2) throw error
        }
      }
      return 'done'
    } catch (error) {
      if (isExpectedAuthorizationFailure(error)) {
        await deny(prisma, source, undefined, event.isChannel === true)
        return 'done'
      }
      throw error
    }
  }
}

async function retryTerminalSourceCleanup(
  db: DbClient,
  media: ReturnType<typeof import('../../media').createMediaService> | undefined,
  source: MaxSource | null,
) {
  if (!media || !source || (source.status !== 'denied' && source.status !== 'unsupported_media')) return
  const stored = await db.maxSource.findUnique({ where: { id: source.id }, include: { attachments: { select: { plannedMediaId: true } } } })
  if (!stored || stored.status === 'published') return
  await media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: stored.attachments.map(({ plannedMediaId }) => plannedMediaId) })
}

function inviteTokenFromPayload(payload: string | null) {
  if (!payload?.startsWith('invite_')) return null
  const token = payload.slice('invite_'.length)
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) && payload.length <= 512 ? token : null
}

function taskPayload(payload: unknown): string {
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || typeof payload.inboxId !== 'string' || !isUuid(payload.inboxId)) {
    throw new TerminalTaskError('MAX task payload is invalid')
  }
  return payload.inboxId
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isUuid(input: string) {
  return input !== '00000000-0000-0000-0000-000000000000'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)
}

function isPublishableText(text: string | null): text is string {
  return text !== null && text.trim().length > 0 && [...text].length <= 8_000
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002'
}

function isExpectedAuthorizationFailure(error: unknown) {
  if (!(error instanceof Error) || (error.name !== 'FamilyFailure' && error.name !== 'MemoryFailure')) return false
  const kind = (error as { kind?: unknown }).kind
  return kind === 'not_found' || kind === 'forbidden'
}

async function deny(db: DbClient, source: MaxSource, text = deniedText, suppressResponse = false) {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
      status: 'denied', rejectionCode: 'denied',
    } })
    if (changed.count !== 1) return false
    await markInboxProcessed(tx, source.inboxId)
      if (!suppressResponse) await createResponseAndTask(tx, {
        inboxId: source.inboxId, destinationUserId: source.senderSubject, kind: 'denied', text,
      })
    return true
  })
}

async function terminalSource(db: DbClient, source: MaxSource, kind: 'unsupported_media', destinationUserId: string, text: string) {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
      status: kind, rejectionCode: kind,
    } })
    if (changed.count !== 1) return false
    await markInboxProcessed(tx, source.inboxId)
    if (BigInt(destinationUserId) > 0n) await createResponseAndTask(tx, { inboxId: source.inboxId, destinationUserId, kind, text })
    return true
  })
}

async function terminalInbox(db: DbClient, inboxId: string, kind: 'welcome', destinationUserId: string, text: string) {
  return db.$transaction(async (tx) => {
    if (!(await markInboxProcessed(tx, inboxId))) return false
    await createResponseAndTask(tx, { inboxId, destinationUserId, kind, text })
    return true
  })
}

async function markInboxProcessed(tx: PrismaTransactionClient, inboxId: string) {
  const changed = await tx.maxInbox.updateMany({ where: { id: inboxId, status: 'accepted' }, data: {
    status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
  } })
  return changed.count === 1
}

async function createResponseAndTask(
  tx: PrismaTransactionClient,
  input: { inboxId: string; destinationUserId: string; kind: 'saved' | 'denied' | 'unsupported_media' | 'welcome'; text: string },
) {
  const response = await tx.maxOutgoingResponse.upsert({
    where: { inboxId_kind: { inboxId: input.inboxId, kind: input.kind } },
    create: { inboxId: input.inboxId, destinationUserId: BigInt(input.destinationUserId), kind: input.kind, text: input.text },
    update: { destinationUserId: BigInt(input.destinationUserId), text: input.text },
    select: { id: true },
  })
  await tx.taskOutbox.createMany({ data: [{
    type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date(),
  }], skipDuplicates: true })
}

function responseActor(event: Extract<MaxInboundEvent, { kind: 'message_created' }>) {
  return event.isChannel ? '0' : event.senderId
}
