import type { BackendRuntime } from '../../../runtime'
import type { DbClient } from '../../../db'
import { TerminalTaskError } from '../../../outbox'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createMediaService, MediaFailure } from '../../media'
import { createSourceMemoryPublisher } from '../../memories'
import { classifyMaxImageMessage } from '../application/image-policy'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import type { MaxDownloadedMedia } from './media-download'
import { MaxMediaDownloadError } from './media-download'

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const unsupportedText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'

export function createMaxImageProcessor(options: {
  runtime: BackendRuntime
  api: MaxApiPort
  media: ReturnType<typeof createMediaService>
  download: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
}) {
  const prisma = options.runtime.prisma
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)
  return async (input: { inboxId: string; sourceId: string; event: Extract<MaxInboundEvent, { kind: 'message_created' }>; signal?: AbortSignal }): Promise<'done' | 'skipped'> => {
    const source = await prisma.maxSource.findUnique({ where: { id: input.sourceId }, include: { attachments: true } })
    if (!source || source.status !== 'accepted') return 'skipped'
    const policy = classifyMaxImageMessage(input.event)
    if (policy.kind === 'denied') return terminal(prisma, source.id, input.inboxId, 'denied', input.event.senderId, deniedText)
    if (policy.kind === 'unsupported') return terminal(prisma, source.id, input.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
    if (typeof options.api.getMessage !== 'function') throw new Error('MAX message lookup is unavailable')
    const admission = await findAdmission(prisma, input.event.senderId)
    if (!admission) return terminal(prisma, source.id, input.inboxId, 'denied', input.event.senderId, deniedText)
    let resolved
    try { resolved = await options.api.getMessage(input.event.messageId, input.signal) } catch (error) { throw error }
    const accepted = policy.kind === 'quick-images' ? policy.attachments : [policy.attachment]
    if (resolved.messageId !== input.event.messageId || resolved.senderId !== input.event.senderId || resolved.recipientId !== input.event.recipientId ||
        resolved.attachments.length !== accepted.length || resolved.attachments.some((item, index) => item.kind !== accepted[index]!.kind || item.providerAttachmentId !== accepted[index]!.providerAttachmentId)) {
      return terminal(prisma, source.id, input.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
    }
    const planned = [...source.attachments].sort((a, b) => a.position - b.position)
    if (planned.length !== accepted.length) return terminal(prisma, source.id, input.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
    const mediaIds: string[] = []
    try {
      for (let index = 0; index < planned.length; index += 1) {
        const row = planned[index]!
        const current = resolved.attachments[index]!
        const maxBytes = options.runtime.env.MAX_FILE_MAX_BYTES
        const downloaded = row.status === 'stored' && row.mediaId === row.plannedMediaId
          ? null
          : await options.download(current.url, maxBytes, input.signal)
        if (downloaded) {
          const result = await options.media.ingestTrustedPhoto({ familyId: admission.familyId, principal: { userId: admission.userId, sessionId: `max:${source.id}` } }, {
            assetId: row.plannedMediaId, sourceKind: 'max', bytes: downloaded.bytes,
          })
          await prisma.maxSourceAttachment.updateMany({ where: { id: row.id, status: 'planned' }, data: { status: 'stored', mediaId: result.asset.id } })
        }
        mediaIds.push(row.mediaId ?? row.plannedMediaId)
      }
      const scope: FamilyScope = { familyId: admission.familyId, principal: { userId: admission.userId, sessionId: `max:${source.id}` } }
      await publisher.publish(scope, { id: source.plannedMemoryId, childId: admission.childId, kind: 'photo', body: policy.body,
        occurredAt: new Date(input.event.occurredAt), mediaIds }, async (tx, memoryId) => {
        await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: { status: 'published', memoryId,
          userId: admission.userId, familyId: admission.familyId, childId: admission.childId } })
        await tx.maxSourceAttachment.updateMany({ where: { sourceId: source.id }, data: { status: 'stored' } })
        await tx.maxInbox.updateMany({ where: { id: input.inboxId, status: 'accepted' }, data: { status: 'processed', processedAt: new Date(),
          encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } })
        const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId: input.inboxId, kind: 'saved' } },
          create: { inboxId: input.inboxId, destinationUserId: BigInt(input.event.senderId), kind: 'saved', text: 'Сохранено в семейную ленту.' },
          update: { destinationUserId: BigInt(input.event.senderId), text: 'Сохранено в семейную ленту.' }, select: { id: true } })
        await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date() }], skipDuplicates: true })
      })
      return 'done'
    } catch (error) {
      if (isPermanent(error)) {
        await options.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: planned.map((row) => row.plannedMediaId) })
        return terminal(prisma, source.id, input.inboxId, error instanceof MediaFailure && error.kind === 'quota_exceeded' ? 'denied' : 'unsupported_media', input.event.senderId,
          error instanceof MediaFailure && error.kind === 'quota_exceeded' ? deniedText : unsupportedText)
      }
      throw error
    }
  }
}

function isPermanent(error: unknown) {
  if (error instanceof MediaFailure) return ['unsupported_media', 'invalid_file', 'quota_exceeded', 'forbidden', 'not_found', 'upload_expired'].includes(error.kind)
  if (error instanceof Error && (error.name === 'FamilyFailure' || error.name === 'MemoryFailure')) {
    const kind = (error as { kind?: unknown }).kind
    return kind === 'forbidden' || kind === 'not_found'
  }
  if (error instanceof MaxMediaDownloadError) return true
  return false
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

export function taskPayloadForImage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as { inboxId?: unknown }).inboxId !== 'string') throw new TerminalTaskError('MAX task payload is invalid')
  return (value as { inboxId: string }).inboxId
}
