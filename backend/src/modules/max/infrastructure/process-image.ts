import { randomUUID } from 'node:crypto'

import type { BackendRuntime } from '../../../runtime'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import { TerminalTaskError } from '../../../outbox'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createMediaService, MediaFailure } from '../../media'
import { createSourceMemoryPublisher } from '../../memories'
import { classifyMaxImageMessage } from '../application/image-policy'
import type { MaxApiPort, MaxInboundEvent, MaxResolvedAttachment } from '../application/ports'
import { MaxProviderError } from './max-api'
import type { MaxDownloadedMedia, MaxVideoStream } from './media-download'
import { createMaxVideoStreamDownload, MaxMediaDownloadError } from './media-download'
import { expireMaxTarget, resolveMaxTarget } from './source-target'
import { savedFamilyText } from '../../../bot-family-target'

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const unsupportedText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const attachmentClaimLeaseMs = 15 * 60 * 1_000
const attachmentWaitTimeoutMs = 30_000

export function createMaxImageProcessor(options: {
  runtime: BackendRuntime
  api: MaxApiPort
  media: ReturnType<typeof createMediaService>
  download: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
  videoDownload?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxVideoStream>
}) {
  const prisma = options.runtime.prisma
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)
  const videoDownload = options.videoDownload ?? createMaxVideoStreamDownload()
  const process = async (input: { inboxId: string; sourceId: string; event: Extract<MaxInboundEvent, { kind: 'message_created' }>; signal?: AbortSignal }): Promise<'done' | 'skipped'> => {
    const source = await prisma.maxSource.findUnique({ where: { id: input.sourceId }, include: { attachments: true } })
    if (!source || source.status !== 'accepted') return 'skipped'
    const policy = classifyMaxImageMessage(input.event)
    if (policy.kind === 'denied') return terminal(prisma, source.id, input.inboxId, 'denied', input.event.senderId, deniedText)
    if (policy.kind === 'unsupported') return terminal(prisma, source.id, input.inboxId, 'unsupported_media', input.event.senderId, unsupportedText)
    if (typeof options.api.getMessage !== 'function') throw new Error('MAX message lookup is unavailable')
    const targetResult = await resolveMaxTarget(prisma, source)
    if (targetResult.kind === 'pending') return 'done'
    if (targetResult.kind === 'expired') return expireMaxTarget(prisma, source.id, input.inboxId, input.event.senderId)
    if (targetResult.kind !== 'target') return terminal(prisma, source.id, input.inboxId, 'denied', input.event.senderId,
      'Материал не сохранён: нет семьи с правом публикации и профилем ребёнка.')
    const admission = targetResult.target
    const scope: FamilyScope = { familyId: admission.familyId, principal: { userId: admission.userId, sessionId: `max:${source.id}` } }
    try { await access.requireFull(scope) } catch (error) {
      if (isAuthorizationFailure(error)) return terminal(prisma, source.id, input.inboxId, 'denied', input.event.senderId, deniedText)
      throw error
    }
    let resolved
    try { resolved = await options.api.getMessage(input.event.messageId, input.signal) } catch (error) { throw error }
    const accepted = policy.kind === 'quick-images' || policy.kind === 'mixed-media' ? policy.attachments : [policy.attachment]
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
        if (row.providerKind !== (current.kind === 'image' ? 'image' : current.kind === 'video' ? 'video' : 'file') ||
            row.providerAttachmentId !== current.providerAttachmentId || current.kind === 'voice') throw new MaxMediaDownloadError()
        if (current.kind === 'video') {
          mediaIds.push(await ensureVideoStored({ prisma, media: options.media, api: options.api, download: videoDownload,
            scope, row, current, maxBytes: options.runtime.env.MAX_VIDEO_MAX_BYTES, signal: input.signal }))
        } else {
          mediaIds.push(await ensureAttachmentStored({ prisma, media: options.media, download: options.download, scope, row, current, maxBytes: options.runtime.env.MAX_FILE_MAX_BYTES, signal: input.signal }))
        }
      }
      await publisher.publish(scope, { id: source.plannedMemoryId, childId: admission.childId, kind: policy.kind === 'mixed-media' ? 'media' : 'photo', body: policy.body,
        occurredAt: new Date(input.event.occurredAt), sourcePublishedAt: new Date(input.event.occurredAt), mediaIds }, async (tx, memoryId) => {
        const family = await tx.family.findUniqueOrThrow({ where: { id: admission.familyId }, select: { name: true } })
        await assertSourcePublicationTransition(tx, source.id)
        await tx.maxSource.update({ where: { id: source.id }, data: { status: 'published', memoryId,
          userId: admission.userId, familyId: admission.familyId, childId: admission.childId } })
        await tx.maxSourceAttachment.updateMany({ where: { sourceId: source.id }, data: { status: 'stored' } })
        await tx.maxInbox.updateMany({ where: { id: input.inboxId, status: 'accepted' }, data: { status: 'processed', processedAt: new Date(),
          encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } })
        const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId: input.inboxId, kind: 'saved' } },
          create: { inboxId: input.inboxId, destinationUserId: BigInt(input.event.senderId), kind: 'saved', text: savedFamilyText(family.name) },
          update: { destinationUserId: BigInt(input.event.senderId), text: savedFamilyText(family.name) }, select: { id: true } })
        await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date() }], skipDuplicates: true })
      })
      return 'done'
    } catch (error) {
      if (error instanceof SourcePublicationLostError) {
        const current = await prisma.maxSource.findUnique({ where: { id: source.id }, select: { status: true } })
        if (current?.status === 'denied' || current?.status === 'unsupported_media') {
          await options.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: planned.map((row) => row.plannedMediaId) })
        }
        return 'skipped'
      }
      if (isPermanent(error)) {
        const denied = isAuthorizationFailure(error)
        const result = await terminal(prisma, source.id, input.inboxId, denied ? 'denied' : 'unsupported_media', input.event.senderId,
          denied ? deniedText : unsupportedText)
        if (result === 'done') await options.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: planned.map((row) => row.plannedMediaId) })
        return result
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
    if (input.signal?.aborted || Date.now() >= waitDeadline) throw new MaxProviderError(undefined, true)
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

async function ensureVideoStored(input: {
  prisma: BackendRuntime['prisma']
  media: ReturnType<typeof createMediaService>
  api: MaxApiPort
  download: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxVideoStream>
  scope: FamilyScope
  row: { id: string; plannedMediaId: string; mediaId: string | null; status: 'planned' | 'processing' | 'stored' | 'failed' }
  current: Extract<MaxResolvedAttachment, { kind: 'video' }>
  maxBytes: number
  signal?: AbortSignal
}) {
  if (input.row.status === 'stored' && input.row.mediaId) return input.row.mediaId
  const waitDeadline = Date.now() + attachmentWaitTimeoutMs
  for (;;) {
    if (input.signal?.aborted || Date.now() >= waitDeadline) throw new MaxProviderError(undefined, true)
    const fresh = await input.prisma.maxSourceAttachment.findUnique({ where: { id: input.row.id }, select: { plannedMediaId: true, mediaId: true, status: true } })
    if (!fresh) throw new MaxMediaDownloadError()
    if (fresh.status === 'stored' && fresh.mediaId) return fresh.mediaId
    if (fresh.status === 'failed') throw new MaxMediaDownloadError()
    const claim = await claimMaxSourceAttachment(input.prisma, input.row.id, new Date())
    if (!claim) {
      await waitForMaxAttachmentPoll(input.signal)
      continue
    }
    try {
      const resumed = await input.media.resumeTrustedMedia(input.scope, { assetId: fresh.plannedMediaId, sourceKind: 'max' })
      const asset = resumed ?? await (async () => {
        if (!input.api.getVideo) throw new MaxProviderError(undefined, true)
        const video = await input.api.getVideo(input.current.currentToken, input.signal).catch((error: unknown) => {
          if (error instanceof MaxProviderError && !error.retryable && error.status && error.status >= 400 && error.status < 500) {
            throw new MaxMediaDownloadError()
          }
          throw error
        })
        const rendition = video.renditions
          .filter((candidate) => candidate.height !== null && candidate.height > 0 && candidate.height <= 720 && isAllowedVideoUrl(candidate.url))
          .sort((a, b) => b.height! - a.height! || (b.width ?? 0) - (a.width ?? 0))[0]
        if (!rendition || rendition.contentLength !== null && rendition.contentLength > input.maxBytes) throw new MaxMediaDownloadError()
        const downloaded = await input.download(rendition.url, input.maxBytes, input.signal)
        if (rendition.contentLength !== null && rendition.contentLength !== downloaded.contentLength) {
          void downloaded.body.cancel().catch(() => undefined)
          throw new MaxMediaDownloadError()
        }
        try {
          return (await input.media.ingestTelegram(input.scope, {
            assetId: fresh.plannedMediaId, sourceKind: 'max', kind: 'video', contentType: downloaded.contentType,
            byteSize: downloaded.contentLength, body: downloaded.body,
          })).asset
        } catch (error) {
          throw downloaded.failure() ?? error
        } finally {
          void downloaded.body.cancel().catch(() => undefined)
        }
      })()
      const stored = await input.prisma.maxSourceAttachment.updateMany({ where: { id: input.row.id, status: 'processing', claimToken: claim.token }, data: { status: 'stored', mediaId: asset.id, claimToken: null, claimUntil: null } })
      if (stored.count === 1) return asset.id
      throw new MaxProviderError(undefined, true)
    } catch (error) {
      await input.prisma.maxSourceAttachment.updateMany({ where: { id: input.row.id, status: 'processing', claimToken: claim.token }, data: {
        status: isPermanent(error) ? 'failed' : 'planned', claimToken: null, claimUntil: null,
      } })
      throw error
    }
  }
}

function isAllowedVideoUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && /^maxvd[0-9]+\.okcdn\.ru$/i.test(url.hostname)
  } catch { return false }
}

export async function waitForMaxAttachmentPoll(signal?: AbortSignal) {
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
    return
  }
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new MaxProviderError(undefined, true)) }
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

export function taskPayloadForImage(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof (value as { inboxId?: unknown }).inboxId !== 'string') throw new TerminalTaskError('MAX task payload is invalid')
  return (value as { inboxId: string }).inboxId
}
