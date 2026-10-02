import type { BackendRuntime } from '../../../runtime'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createMediaService, MediaFailure, detectVoiceMime } from '../../media'
import { createSourceMemoryPublisher } from '../../memories'
import { isMaxCaptionWithinLimit } from '../application/accept-update'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import { MaxMediaDownloadError, type MaxDownloadedMedia } from './media-download'
import { MaxProviderError } from './max-api'
import { expireMaxTarget, resolveMaxTarget } from './source-target'
import { savedFamilyText } from '../../../bot-family-target'
import { claimMaxSourceAttachment, assertSourcePublicationTransition, waitForMaxAttachmentPoll } from './process-image'
import { assertMaxForwardBinding } from './forward-import'

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const attachmentWaitTimeoutMs = 30_000

export function createMaxVoiceProcessor(options: {
  runtime: BackendRuntime
  api: MaxApiPort
  media: ReturnType<typeof createMediaService>
  download: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
}) {
  const prisma = options.runtime.prisma
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)
  return async (input: { inboxId: string; sourceId: string; event: Extract<MaxInboundEvent, { kind: 'message_created' }>; signal?: AbortSignal;
    verifiedMessage?: Awaited<ReturnType<MaxApiPort['getMessage']>>; verifiedChannelId?: bigint }): Promise<'done' | 'skipped'> => {
    const source = await prisma.maxSource.findUnique({ where: { id: input.sourceId }, include: { attachments: true } })
    if (!source || source.status !== 'accepted') return 'skipped'
    const attachment = input.event.attachments?.length === 1 ? input.event.attachments[0] : undefined
    if (!attachment || attachment.kind !== 'voice') throw new MaxProviderError()
    if (!isMaxCaptionWithinLimit(input.event.text)) return terminalDenied(prisma, source.id, input.inboxId, responseActor(input.event))
    if (typeof options.api.getMessage !== 'function') throw new Error('MAX message lookup is unavailable')
    const targetResult = await resolveMaxTarget(prisma, source, new Date(), input.event.isChannel === true)
    if (targetResult.kind === 'pending') return 'done'
    if (targetResult.kind === 'expired') return expireMaxTarget(prisma, source.id, input.inboxId, responseActor(input.event))
    if (targetResult.kind !== 'target') return terminalDenied(prisma, source.id, input.inboxId, responseActor(input.event),
      'Материал не сохранён: нет семьи с правом публикации и профилем ребёнка.')
    const admission = targetResult.target

    let current: Extract<Awaited<ReturnType<typeof resolveMaxVoiceSource>>, { kind: 'voice' }>
    try {
      current = await resolveMaxVoiceSource(options.api, input.event, input.signal, input.verifiedMessage, input.verifiedChannelId)
    } catch (error) {
      if (error instanceof MaxProviderError && error.code === 'message_identity_mismatch') {
        return terminalDenied(prisma, source.id, input.inboxId, responseActor(input.event))
      }
      throw error
    }
    const row = [...source.attachments].sort((a, b) => a.position - b.position)[0]
    if (!row || source.attachments.length !== 1) throw new MaxProviderError()
    const scope: FamilyScope = { familyId: admission.familyId, principal: { userId: admission.userId, sessionId: `max:${source.id}` } }
    try {
      const mediaId = await ensureVoiceStored({
        prisma, media: options.media, download: options.download, scope, row,
        current, maxBytes: options.runtime.env.MAX_FILE_MAX_BYTES, signal: input.signal,
      })
      await publisher.publish(scope, {
        id: source.plannedMemoryId, childId: admission.childId, kind: 'voice', body: input.event.text ?? '',
        occurredAt: new Date(input.event.occurredAt), sourcePublishedAt: new Date(input.event.occurredAt), mediaIds: [mediaId],
      }, async (tx, memoryId) => {
        if (input.verifiedChannelId !== undefined) await assertMaxForwardBinding(tx, admission.familyId, input.verifiedChannelId)
        const family = await tx.family.findUniqueOrThrow({ where: { id: admission.familyId }, select: { name: true } })
        await assertSourcePublicationTransition(tx, source.id)
        await tx.maxSource.update({ where: { id: source.id }, data: {
          status: 'published', memoryId, userId: admission.userId, familyId: admission.familyId, childId: admission.childId,
        } })
        await tx.maxSourceAttachment.updateMany({ where: { sourceId: source.id }, data: { status: 'stored' } })
        await tx.maxInbox.updateMany({ where: { id: input.inboxId, status: 'accepted' }, data: {
          status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
        } })
        if (input.event.isChannel) return
        const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId: input.inboxId, kind: 'saved' } },
          create: { inboxId: input.inboxId, destinationUserId: BigInt(input.event.senderId), kind: 'saved', text: savedFamilyText(family.name) },
          update: { destinationUserId: BigInt(input.event.senderId), text: savedFamilyText(family.name) }, select: { id: true } })
        await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date() }], skipDuplicates: true })
      })
      return 'done'
    } catch (error) {
      await options.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: [row.plannedMediaId] })
      if (isAuthorizationFailure(error)) return terminalDenied(prisma, source.id, input.inboxId, responseActor(input.event))
      if (isPermanentAudioFailure(error)) return terminalDenied(prisma, source.id, input.inboxId, responseActor(input.event))
      // A recognized audio message is a supported path. Transient acquisition/storage
      // failures remain retryable; neither path emits the unsupported-media fallback.
      throw error
    }
  }
}

export async function resolveMaxVoiceSource(
  api: MaxApiPort,
  event: Extract<MaxInboundEvent, { kind: 'message_created' }>,
  signal?: AbortSignal,
  verifiedMessage?: Awaited<ReturnType<MaxApiPort['getMessage']>>,
  verifiedChannelId?: bigint,
) {
  const attachment = event.attachments?.length === 1 ? event.attachments[0] : undefined
  if (!attachment || attachment.kind !== 'voice') throw new MaxProviderError()
  try {
    const resolved = verifiedMessage ?? await api.getMessage(event.messageId, signal)
    const current = resolved.attachments[0]
    const identityMatches = event.forwardedFrom
      ? resolved.messageId === event.forwardedFrom.messageId && resolved.recipientType === 'channel' && resolved.recipientId === String(verifiedChannelId)
      : resolved.messageId === event.messageId && (event.isChannel || resolved.senderId === event.senderId) && resolved.recipientId === event.recipientId
    if (!identityMatches ||
        resolved.attachments.length !== 1 || current?.kind !== 'voice' || current.providerAttachmentId !== attachment.providerAttachmentId) {
        throw new MaxProviderError(undefined, false, 400, 'message_identity_mismatch')
    }
    return current
  } catch (error) {
    // MAX can acknowledge a native audio update but return an empty message lookup.
    // The webhook's validated HTTPS URL is retained only in the encrypted inbox until
    // this task finishes; it is never copied to MaxSource or durable media metadata.
    if (!(error instanceof MaxProviderError) || error.code !== 'message_not_found') throw error
    return attachment
  }
}

async function ensureVoiceStored(input: {
  prisma: BackendRuntime['prisma']
  media: ReturnType<typeof createMediaService>
  download: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
  scope: FamilyScope
  row: { id: string; plannedMediaId: string; mediaId: string | null; status: 'planned' | 'processing' | 'stored' | 'failed'; claimUntil: Date | null }
  current: { kind: 'voice'; providerAttachmentId: string; url: string }
  maxBytes: number
  signal?: AbortSignal
}) {
  if (input.row.status === 'stored' && input.row.mediaId) return input.row.mediaId
  const waitDeadline = Date.now() + attachmentWaitTimeoutMs
  for (;;) {
    if (input.signal?.aborted || Date.now() >= waitDeadline) throw new MaxProviderError()
    const fresh = await input.prisma.maxSourceAttachment.findUnique({ where: { id: input.row.id }, select: { id: true, plannedMediaId: true, mediaId: true, status: true, claimUntil: true } })
    if (!fresh) throw new Error('MAX audio attachment disappeared')
    if (fresh.status === 'stored' && fresh.mediaId) return fresh.mediaId
    const claim = await claimMaxSourceAttachment(input.prisma, input.row.id, new Date())
    if (claim) {
      try {
        const resumed = await input.media.resumeTrustedMedia(input.scope, { assetId: fresh.plannedMediaId, sourceKind: 'max' })
        const asset = resumed ?? await (async () => {
          const downloaded = await input.download(input.current.url, input.maxBytes, input.signal)
          const contentType = voiceContentType(downloaded.contentType) ?? detectVoiceMime(downloaded.bytes)
          const result = await input.media.ingestTelegram(input.scope, {
            assetId: fresh.plannedMediaId, sourceKind: 'max', kind: 'voice', contentType,
            byteSize: downloaded.contentLength,
            body: new Blob([downloaded.bytes.slice().buffer as ArrayBuffer]).stream(),
          })
          return result.asset
        })()
        const stored = await input.prisma.maxSourceAttachment.updateMany({ where: { id: input.row.id, status: 'processing', claimToken: claim.token }, data: { status: 'stored', mediaId: asset.id, claimToken: null, claimUntil: null } })
        if (stored.count === 1) return asset.id
        throw new Error('MAX audio attachment claim was lost')
      } catch (error) {
        await input.prisma.maxSourceAttachment.updateMany({ where: { id: input.row.id, status: 'processing', claimToken: claim.token }, data: { status: 'planned', claimToken: null, claimUntil: null } })
        throw error
      }
    }
    const waited = await input.prisma.maxSourceAttachment.findUnique({ where: { id: input.row.id }, select: { mediaId: true, status: true, claimUntil: true } })
    if (waited?.status === 'stored' && waited.mediaId) return waited.mediaId
    await waitForMaxAttachmentPoll(input.signal)
  }
}

function voiceContentType(value: string | null): 'audio/ogg' | 'audio/opus' | 'audio/webm' | 'audio/mp4' | null {
  if (!value) return null
  const mime = value.split(';', 1)[0]!.trim().toLowerCase()
  return mime === 'audio/ogg' || mime === 'audio/opus' || mime === 'audio/webm' || mime === 'audio/mp4' ? mime : null
}

function isAuthorizationFailure(error: unknown) {
  if (error instanceof MediaFailure) return ['forbidden', 'not_found', 'quota_exceeded'].includes(error.kind)
  if (error instanceof Error && (error.name === 'FamilyFailure' || error.name === 'MemoryFailure')) {
    const kind = (error as { kind?: unknown }).kind
    return kind === 'forbidden' || kind === 'not_found'
  }
  return false
}

function isPermanentAudioFailure(error: unknown) {
  if (error instanceof MaxMediaDownloadError) return true
  if (error instanceof MediaFailure) return ['unsupported_media', 'invalid_file', 'quota_exceeded'].includes(error.kind)
  return false
}

async function terminalDenied(db: DbClient, sourceId: string, inboxId: string, destinationUserId: string, text = deniedText): Promise<'done' | 'skipped'> {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: sourceId, status: 'accepted' }, data: { status: 'denied', rejectionCode: 'denied' } })
    if (changed.count !== 1) return 'skipped'
    await tx.maxInbox.updateMany({ where: { id: inboxId, status: 'accepted' }, data: { status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } })
    if (BigInt(destinationUserId) === 0n) return 'done'
    const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId, kind: 'denied' } }, create: { inboxId, destinationUserId: BigInt(destinationUserId), kind: 'denied', text }, update: { destinationUserId: BigInt(destinationUserId), text }, select: { id: true } })
    await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date() }], skipDuplicates: true })
    return 'done'
  })
}

function responseActor(event: Extract<MaxInboundEvent, { kind: 'message_created' }>) {
  return event.isChannel ? '0' : event.senderId
}
