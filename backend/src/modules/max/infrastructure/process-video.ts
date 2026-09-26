import { randomUUID } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { BackendRuntime } from '../../../runtime'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createSourceMemoryPublisher } from '../../memories'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import { classifyMaxVideoMessage, normalizeVideoDurationMs } from '../application/video-policy'
import { MaxProviderError } from './max-api'
import { expireMaxTarget, resolveMaxTarget } from './source-target'
import { savedFamilyText } from '../../../bot-family-target'

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const unsupportedText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const allowedCdnHost = /^maxvd[0-9]+\.okcdn\.ru$/i
const maxHeight = 720

export function createMaxVideoProcessor(options: { runtime: BackendRuntime; api: MaxApiPort }) {
  const { prisma } = options.runtime
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)

  return async (input: { inboxId: string; sourceId: string; event: Extract<MaxInboundEvent, { kind: 'message_created' }>; signal?: AbortSignal }): Promise<'done' | 'skipped'> => {
    const source = await prisma.maxSource.findUnique({ where: { id: input.sourceId } })
    if (!source || source.status !== 'accepted') return 'skipped'
    const policy = classifyMaxVideoMessage(input.event)
    if (policy.kind === 'denied') return terminal(prisma, source.id, source.inboxId, 'denied', input.event.senderId, deniedText)
    if (policy.kind !== 'video' || typeof options.api.getVideo !== 'function') {
      return terminal(prisma, source.id, source.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
    }

    const targetResult = await resolveMaxTarget(prisma, source)
    if (targetResult.kind === 'pending') return 'done'
    if (targetResult.kind === 'expired') return expireMaxTarget(prisma, source.id, source.inboxId, input.event.senderId)
    if (targetResult.kind !== 'target') return terminal(prisma, source.id, source.inboxId, 'denied', input.event.senderId,
      'Материал не сохранён: нет семьи с правом публикации и профилем ребёнка.')
    const admission = targetResult.target

    let resolved
    try {
      resolved = await options.api.getMessage(input.event.messageId, input.signal)
    } catch (error) {
      if (isTerminalProviderShape(error)) return terminal(prisma, source.id, source.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
      throw error
    }
    const attachment = resolved.attachments.length === 1 ? resolved.attachments[0] : null
    if (!attachment || attachment.kind !== 'video' || resolved.messageId !== input.event.messageId ||
      resolved.senderId !== input.event.senderId || resolved.recipientId !== input.event.recipientId ||
      attachment.providerAttachmentId !== policy.attachment.providerAttachmentId) {
      return terminal(prisma, source.id, source.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
    }

    let video
    try {
      video = await options.api.getVideo(attachment.currentToken, input.signal)
    } catch (error) {
      if (isTerminalProviderShape(error)) return terminal(prisma, source.id, source.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
      throw error
    }
    const rendition = video.renditions
      .filter((candidate) => isAllowedCdnUrl(candidate.url) && candidate.height !== null && candidate.height > 0 && candidate.height <= maxHeight)
      .sort((a, b) => (b.height! - a.height!) || ((b.width ?? 0) - (a.width ?? 0)))[0]
    if (!rendition) return terminal(prisma, source.id, source.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)

    const durationMs = normalizeVideoDurationMs(attachment.inboundDurationSeconds, video.durationMs)
    const scope: FamilyScope = { familyId: admission.familyId, principal: { userId: admission.userId, sessionId: `max:${source.id}` } }
    try {
      const publish = () => publisher.publish(scope, {
        id: source.plannedMemoryId,
        childId: admission.childId,
        kind: 'video',
        body: policy.body,
        occurredAt: new Date(input.event.occurredAt),
        mediaIds: [],
      }, async (tx, memoryId) => {
        const family = await tx.family.findUniqueOrThrow({ where: { id: admission.familyId }, select: { name: true } })
        const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
          status: 'published', memoryId, userId: admission.userId, familyId: admission.familyId, childId: admission.childId,
        } })
        const currentSource = await tx.maxSource.findUnique({ where: { id: source.id }, select: { status: true, memoryId: true, familyId: true } })
        if (!currentSource || currentSource.familyId !== admission.familyId || currentSource.status !== 'published' || !currentSource.memoryId || (changed.count !== 1 && currentSource.memoryId !== memoryId)) {
          throw new Error('MAX source publication state changed')
        }
        await tx.maxVideoReference.upsert({ where: { sourceId: source.id }, update: {
          memoryId: currentSource.memoryId, familyId: admission.familyId, attachmentPosition: 0, providerAttachmentId: attachment.providerAttachmentId,
          ...resolveVideoDimensions(rendition, attachment, video), durationMs,
        }, create: {
          id: randomUUID(), sourceId: source.id, memoryId: currentSource.memoryId, familyId: admission.familyId,
          attachmentPosition: 0, providerAttachmentId: attachment.providerAttachmentId,
          ...resolveVideoDimensions(rendition, attachment, video), durationMs,
        } })
        await tx.maxInbox.updateMany({ where: { id: input.inboxId, status: 'accepted' }, data: {
          status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
        } })
        const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId: input.inboxId, kind: 'saved' } },
          create: { inboxId: input.inboxId, destinationUserId: BigInt(input.event.senderId), kind: 'saved', text: savedFamilyText(family.name) },
          update: { destinationUserId: BigInt(input.event.senderId), text: savedFamilyText(family.name) }, select: { id: true } })
        await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date() }], skipDuplicates: true })
      })
      for (let attempt = 0; ; attempt += 1) {
        try { await publish(); break } catch (error) {
          if (!isUniqueConstraint(error) || attempt >= 2) throw error
        }
      }
      return 'done'
    } catch (error) {
      if (isExpectedAuthorizationFailure(error)) return terminal(prisma, source.id, source.inboxId, 'denied', input.event.senderId, deniedText)
      throw error
    }
  }
}

function isAllowedCdnUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && allowedCdnHost.test(url.hostname)
  } catch { return false }
}

function positiveOrNull(value: number | null) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647 ? value : null
}

export function resolveVideoDimensions(
  rendition: { width: number | null; height: number | null },
  inbound: { width: number | null; height: number | null },
  provider?: { width: number | null; height: number | null },
) {
  const providerWidth = positiveOrNull(provider?.width ?? null)
  const providerHeight = positiveOrNull(provider?.height ?? null)
  if (providerWidth !== null && providerHeight !== null) return { width: providerWidth, height: providerHeight }

  const renditionWidth = positiveOrNull(rendition.width)
  const renditionHeight = positiveOrNull(rendition.height)
  if (renditionWidth !== null && renditionHeight !== null) return { width: renditionWidth, height: renditionHeight }

  const inboundWidth = positiveOrNull(inbound.width)
  const inboundHeight = positiveOrNull(inbound.height)
  if (inboundWidth !== null && inboundHeight !== null) return { width: inboundWidth, height: inboundHeight }

  return { width: null, height: null }
}

async function terminal(db: DbClient, sourceId: string, inboxId: string, kind: 'denied' | 'unsupported_media', destinationUserId: string, text: string): Promise<'done' | 'skipped'> {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: sourceId, status: 'accepted' }, data: { status: kind, rejectionCode: kind } })
    if (changed.count !== 1) return 'skipped'
    await tx.maxInbox.updateMany({ where: { id: inboxId, status: 'accepted' }, data: { status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } })
    const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId, kind } }, create: { inboxId, destinationUserId: BigInt(destinationUserId), kind, text }, update: { destinationUserId: BigInt(destinationUserId), text }, select: { id: true } })
    await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date() }], skipDuplicates: true })
    return 'done'
  })
}

function isExpectedAuthorizationFailure(error: unknown) {
  if (!(error instanceof Error) || (error.name !== 'FamilyFailure' && error.name !== 'MemoryFailure')) return false
  const kind = (error as { kind?: unknown }).kind
  return kind === 'not_found' || kind === 'forbidden'
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002'
}

function isTerminalProviderShape(error: unknown) {
  return error instanceof MaxProviderError && !error.retryable
}
