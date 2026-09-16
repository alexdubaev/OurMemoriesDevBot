import { randomUUID } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { BackendRuntime } from '../../../runtime'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createSourceMemoryPublisher } from '../../memories'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import { classifyMaxVideoMessage, normalizeVideoDurationMs } from '../application/video-policy'
import { MaxProviderError } from './max-api'

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const unsupportedText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const savedText = 'Сохранено в семейную ленту.'
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

    const admission = await findAdmission(prisma, input.event.senderId)
    if (!admission) return terminal(prisma, source.id, source.inboxId, 'denied', input.event.senderId, deniedText)

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
        const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
          status: 'published', memoryId, userId: admission.userId, familyId: admission.familyId, childId: admission.childId,
        } })
        const currentSource = await tx.maxSource.findUnique({ where: { id: source.id }, select: { status: true, memoryId: true, familyId: true } })
        if (!currentSource || currentSource.familyId !== admission.familyId || currentSource.status !== 'published' || !currentSource.memoryId || (changed.count !== 1 && currentSource.memoryId !== memoryId)) {
          throw new Error('MAX source publication state changed')
        }
        await tx.maxVideoReference.upsert({ where: { sourceId: source.id }, update: {
          memoryId: currentSource.memoryId, familyId: admission.familyId, attachmentPosition: 0, providerAttachmentId: attachment.providerAttachmentId,
          width: positiveOrNull(rendition.width ?? attachment.width), height: positiveOrNull(rendition.height ?? attachment.height), durationMs,
        }, create: {
          id: randomUUID(), sourceId: source.id, memoryId: currentSource.memoryId, familyId: admission.familyId,
          attachmentPosition: 0, providerAttachmentId: attachment.providerAttachmentId,
          width: positiveOrNull(rendition.width ?? attachment.width),
          height: positiveOrNull(rendition.height ?? attachment.height), durationMs,
        } })
        await tx.maxInbox.updateMany({ where: { id: input.inboxId, status: 'accepted' }, data: {
          status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
        } })
        const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId: input.inboxId, kind: 'saved' } },
          create: { inboxId: input.inboxId, destinationUserId: BigInt(input.event.senderId), kind: 'saved', text: savedText },
          update: { destinationUserId: BigInt(input.event.senderId), text: savedText }, select: { id: true } })
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

async function findAdmission(db: DbClient, senderSubject: string) {
  const identity = await db.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: senderSubject } }, select: {
    user: { select: { id: true, familyMemberships: { where: { revokedAt: null, family: { status: 'active' } }, orderBy: { joinedAt: 'asc' }, take: 2,
      select: { familyId: true, role: true, family: { select: { children: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } } } } } } } },
  } })
  const memberships = identity?.user.familyMemberships ?? []
  const child = memberships[0]?.family.children[0]
  if (!identity || memberships.length !== 1 || memberships[0]!.role !== 'full' || !child) return null
  return { userId: identity.user.id, familyId: memberships[0]!.familyId, childId: child.id }
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
