import type { MaxSource } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { BackendRuntime } from '../../../runtime'
import { TerminalTaskError } from '../../../outbox'
import { createInviteStartResolver, createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createSourceMemoryPublisher } from '../../memories'
import type { MaxInboundEvent } from '../application/ports'

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
}): (payload: unknown) => Promise<'done' | 'skipped'> {
  const { prisma } = options.runtime
  const resolveInviteStart = options.resolveInviteStart ?? createInviteStartResolver(prisma)
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)

  return async (payload) => {
    const inboxId = taskPayload(payload)
    const inbox = await prisma.maxInbox.findUnique({ where: { id: inboxId }, include: { source: true } })
    if (!inbox || inbox.status === 'processed' || inbox.processedAt) return 'skipped'

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

    const source = inbox.source
    if (!source) throw new TerminalTaskError('MAX message inbox has no source')
    if (source.status !== 'accepted') return 'skipped'

    if (event.hasAttachments) {
      return await terminalSource(prisma, source, 'unsupported_media', event.senderId, unsupportedMediaText) ? 'done' : 'skipped'
    }

    if (!isPublishableText(event.text)) {
      return await deny(prisma, source) ? 'done' : 'skipped'
    }
    const text = event.text

    const admission = await findAdmission(prisma, event.senderId)
    if (!admission) {
      return await deny(prisma, source) ? 'done' : 'skipped'
    }

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
      mediaIds: [],
    }, async (tx, memoryId) => {
        await tx.maxSource.update({ where: { id: source.id }, data: {
          status: 'published', memoryId, userId: admission.userId, familyId: admission.familyId, childId: admission.childId,
        } })
        await markInboxProcessed(tx, inbox.id)
        await createResponseAndTask(tx, {
          inboxId: inbox.id, destinationUserId: source.senderSubject, kind: 'saved', text: 'Сохранено в семейную ленту.',
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
        await deny(prisma, source)
        return 'done'
      }
      throw error
    }
  }
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

async function findAdmission(db: DbClient, senderSubject: string) {
  const identity = await db.externalIdentity.findUnique({
    where: { provider_subject: { provider: 'max', subject: senderSubject } },
    select: {
      user: {
        select: {
          id: true,
          familyMemberships: {
            where: { revokedAt: null, family: { status: 'active' } },
            orderBy: { joinedAt: 'asc' },
            take: 2,
            select: {
              familyId: true,
              family: { select: { children: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } } } },
            },
          },
        },
      },
    },
  })
  const membership = identity?.user.familyMemberships[0]
  const child = membership?.family.children[0]
  if (!identity || !membership || !child || identity.user.familyMemberships.length !== 1) return null
  return { userId: identity.user.id, familyId: membership.familyId, childId: child.id }
}

async function deny(db: DbClient, source: MaxSource) {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
      status: 'denied', rejectionCode: 'denied',
    } })
    if (changed.count !== 1) return false
    await markInboxProcessed(tx, source.inboxId)
    await createResponseAndTask(tx, {
      inboxId: source.inboxId, destinationUserId: source.senderSubject, kind: 'denied', text: deniedText,
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
    await createResponseAndTask(tx, { inboxId: source.inboxId, destinationUserId, kind, text })
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
