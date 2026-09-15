import { randomUUID } from 'node:crypto'

import type { BackendRuntime } from '../../../runtime'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import { TerminalTaskError } from '../../../outbox'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createMediaService, MediaFailure } from '../../media'
import { createSourceMemoryPublisher } from '../../memories'
import { classifyMaxImageMessage } from '../application/image-policy'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import { MaxProviderError } from './max-api'
import type { MaxDownloadedMedia } from './media-download'
import { MaxMediaDownloadError } from './media-download'

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const unsupportedText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const attachmentClaimLeaseMs = 15 * 60 * 1_000
const attachmentWaitTimeoutMs = 30_000

export function createMaxImageProcessor(options: {
  runtime: BackendRuntime
  api: MaxApiPort
  media: ReturnType<typeof createMediaService>
  download: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
}) {
  const prisma = options.runtime.prisma
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)
  const process = async (input: { inboxId: string; sourceId: string; event: Extract<MaxInboundEvent, { kind: 'message_created' }>; signal?: AbortSignal }): Promise<'done' | 'skipped'> => {
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
    const scope: FamilyScope = { familyId: admission.familyId, principal: { userId: admission.userId, sessionId: `max:${source.id}` } }
    try {
      for (let index = 0; index < planned.length; index += 1) {
        const row = planned[index]!
        const current = resolved.attachments[index]!
        if (current.kind === 'video') return terminal(prisma, source.id, input.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
        mediaIds.push(await ensureAttachmentStored({ prisma, media: options.media, download: options.download, scope, row, current, maxBytes: options.runtime.env.MAX_FILE_MAX_BYTES, signal: input.signal }))
      }
      await publisher.publish(scope, { id: source.plannedMemoryId, childId: admission.childId, kind: 'photo', body: policy.body,
        occurredAt: new Date(input.event.occurredAt), mediaIds }, async (tx, memoryId) => {
        await assertSourcePublicationTransition(tx, source.id)
        await tx.maxSource.update({ where: { id: source.id }, data: { status: 'published', memoryId,
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
      if (error instanceof SourcePublicationLostError) {
        await options.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: planned.map((row) => row.plannedMediaId) })
        return 'skipped'
      }
      if (isPermanent(error)) {
        await options.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: planned.map((row) => row.plannedMediaId) })
        const denied = isAuthorizationFailure(error)
        return terminal(prisma, source.id, input.inboxId, denied ? 'denied' : 'unsupported_media', input.event.senderId,
          denied ? deniedText : unsupportedText)
      }
      throw error
    }
  }
  return process
}

class SourcePublicationLostError extends Error {}

export async function assertSourcePublicationTransition(tx: Pick<PrismaTransactionClient, 'maxSource'>, sourceId: string) {
  const changed = await tx.maxSource.updateMany({ where: { id: sourceId, status: 'accepted' }, data: { status: 'published' } })
  if (changed.count !== 1) throw new SourcePublicationLostError('MAX source publication transition was lost')
}

export async function claimMaxSourceAttachment(
  tx: Pick<PrismaTransactionClient, 'maxSourceAttachment'>,
  attachmentId: string,
  now: Date,
) {
  const token = randomUUID()
  const claimUntil = new Date(now.getTime() + attachmentClaimLeaseMs)
  const data = { status: 'processing' as const, claimToken: token, claimUntil }
  const fresh = await tx.maxSourceAttachment.updateMany({ where: { id: attachmentId, status: 'planned' }, data })
  if (fresh.count === 1) return { attachmentId, token }
  const recovered = await tx.maxSourceAttachment.updateMany({ where: { id: attachmentId, status: 'processing', claimUntil: { lte: now } }, data })
  return recovered.count === 1 ? { attachmentId, token } : null
}

async function ensureAttachmentStored(input: {
  prisma: BackendRuntime['prisma']
  media: ReturnType<typeof createMediaService>
  download: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
  scope: FamilyScope
  row: { id: string; plannedMediaId: string; mediaId: string | null; status: 'planned' | 'processing' | 'stored' | 'failed'; claimUntil: Date | null }
  current: { kind: 'image'; providerAttachmentId: string; url: string } | { kind: 'file'; providerAttachmentId: string; filename: string | null; declaredSize: number | null; url: string }
  maxBytes: number
  signal?: AbortSignal
}) {
  if (input.row.status === 'stored' && input.row.mediaId) return input.row.mediaId
  const waitDeadline = Date.now() + attachmentWaitTimeoutMs
  for (;;) {
    if (input.signal?.aborted || Date.now() >= waitDeadline) throw new MaxProviderError()
    const fresh = await input.prisma.maxSourceAttachment.findUnique({ where: { id: input.row.id }, select: { id: true, plannedMediaId: true, mediaId: true, status: true, claimUntil: true } })
    if (!fresh) throw new Error('MAX attachment disappeared')
    if (fresh.status === 'stored' && fresh.mediaId) return fresh.mediaId
    const claim = await claimMaxSourceAttachment(input.prisma, input.row.id, new Date())
    if (claim) {
      try {
        const resumed = await input.media.resumeTrustedPhoto(input.scope, { assetId: fresh.plannedMediaId, sourceKind: 'max' })
        const asset = resumed ?? await (async () => {
          const downloaded = await input.download(input.current.url, input.maxBytes, input.signal)
          const result = await input.media.ingestTrustedPhoto(input.scope, { assetId: fresh.plannedMediaId, sourceKind: 'max', bytes: downloaded.bytes })
          return result.asset
        })()
        const stored = await input.prisma.maxSourceAttachment.updateMany({ where: { id: input.row.id, status: 'processing', claimToken: claim.token }, data: { status: 'stored', mediaId: asset.id, claimToken: null, claimUntil: null } })
        if (stored.count === 1) return asset.id
        throw new Error('MAX attachment claim was lost')
      } catch (error) {
        if (isPermanent(error)) {
          await input.prisma.maxSourceAttachment.updateMany({ where: { id: input.row.id, status: 'processing', claimToken: claim.token }, data: { status: 'failed', claimToken: null, claimUntil: null } })
        } else {
          await input.prisma.maxSourceAttachment.updateMany({ where: { id: input.row.id, status: 'processing', claimToken: claim.token }, data: { status: 'planned', claimToken: null, claimUntil: null } })
        }
        throw error
      }
    }
    const waited = await input.prisma.maxSourceAttachment.findUnique({ where: { id: input.row.id }, select: { mediaId: true, status: true, claimUntil: true } })
    if (waited?.status === 'stored' && waited.mediaId) return waited.mediaId
    if (waited?.status === 'failed') throw new MaxMediaDownloadError()
    await waitForMaxAttachmentPoll(input.signal)
  }
}

export async function waitForMaxAttachmentPoll(signal?: AbortSignal) {
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    return
  }
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new MaxProviderError()) }
    timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 25)
    signal.addEventListener('abort', abort, { once: true })
  })
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

function isAuthorizationFailure(error: unknown) {
  if (error instanceof MediaFailure) return ['forbidden', 'not_found', 'quota_exceeded'].includes(error.kind)
  if (error instanceof Error && (error.name === 'FamilyFailure' || error.name === 'MemoryFailure')) {
    const kind = (error as { kind?: unknown }).kind
    return kind === 'forbidden' || kind === 'not_found'
  }
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
