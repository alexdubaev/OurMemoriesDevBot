import { createHash } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import { TerminalTaskError } from '../../../outbox'
import { insertTask } from '../../../outbox/store'
import type { FamilyAccess, FamilyScope } from '../../families'
import type { MaxApiPort } from '../application/ports'
import { MaxProviderError } from './max-api'
import { createMaxPosterDownload, MaxMediaDownloadError } from './media-download'

const maxPosterBytes = 2 * 1024 * 1024
const posterTaskType = 'max:video-poster'

export function maxVideoPosterMediaId(referenceId: string) {
  const hex = createHash('sha256').update(`max-video-poster-v1:${referenceId}`).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export function enqueueMaxVideoPoster(tx: PrismaTransactionClient | Pick<DbClient, 'taskOutbox'>, referenceId: string, scheduledFor = new Date()) {
  return insertTask(tx, { type: posterTaskType, dedupeKey: `max-video-poster:${referenceId}`, payload: { referenceId }, scheduledFor })
}

export function createMaxVideoPosterProcessor(options: {
  prisma: Pick<DbClient, 'maxVideoReference' | '$transaction'>
  familyAccess: Pick<FamilyAccess, 'requireFull'>
  api: MaxApiPort
  media: { ingestTrustedPhoto(scope: FamilyScope, input: { assetId: string; sourceKind: 'max'; bytes: Uint8Array }): Promise<unknown>
    resumeTrustedMedia(scope: FamilyScope, input: { assetId: string; sourceKind: 'max' }): Promise<unknown | null>
    discardTrustedSourceAssets(input: { sourceKind: 'max'; assetIds: string[] }): Promise<void> }
  download?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; contentType: string | null; contentLength: number }>
}) {
  const download = options.download ?? createMaxPosterDownload()
  return async (payload: unknown, signal?: AbortSignal): Promise<'done' | 'skipped'> => {
    const referenceId = (payload as { referenceId?: unknown } | null)?.referenceId
    if (typeof referenceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(referenceId)) throw new TerminalTaskError('MAX poster task is missing a usable reference id')
    const reference = await options.prisma.maxVideoReference.findFirst({ where: { id: referenceId }, select: {
      id: true, familyId: true, memoryId: true, attachmentPosition: true, providerAttachmentId: true, thumbnailMediaId: true,
      source: { select: { id: true, status: true, familyId: true, memoryId: true, messageId: true, senderSubject: true,
        recipientId: true, originalMessageId: true, originalChannelId: true } },
      outboundSource: { select: { id: true, familyId: true, messageId: true, recipientId: true } },
      memory: { select: { id: true, familyId: true, authorId: true, status: true, deletedAt: true } },
    } })
    const source = reference?.source ?? reference?.outboundSource
    if (!reference || !source || source.familyId !== reference.familyId || reference.memory.familyId !== reference.familyId ||
        reference.memory.id !== reference.memoryId || reference.memory.status !== 'published' || reference.memory.deletedAt !== null ||
        (reference.source && (reference.source.status !== 'published' || reference.source.memoryId !== reference.memoryId))) return 'skipped'
    if (reference.thumbnailMediaId) return 'done'

    const scope: FamilyScope = { familyId: reference.familyId, principal: { userId: reference.memory.authorId, sessionId: `max-poster:${reference.id}` } }
    try { await options.familyAccess.requireFull(scope) } catch (error) {
      if (isAccessFailure(error)) return 'skipped'
      throw error
    }
    const assetId = maxVideoPosterMediaId(reference.id)
    let existing = await options.media.resumeTrustedMedia(scope, { assetId, sourceKind: 'max' })
    if (!existing) {
      if (typeof options.api.getVideo !== 'function') throw new MaxProviderError(undefined, true)
      const isForward = Boolean(reference.source?.originalMessageId && reference.source.originalChannelId !== null)
      const isEnvelopeForward = Boolean(reference.source?.originalMessageId && reference.source.originalChannelId === null)
      const expectedMessageId = isForward ? reference.source!.originalMessageId! : source.messageId
      const expectedRecipientId = isForward ? String(reference.source!.originalChannelId) : String(source.recipientId)
      let expectedSenderId: string | null = null
      if (!isForward && reference.source) expectedSenderId = reference.source.senderSubject
      else if (!isForward) {
        const identity = await options.api.getMe(signal)
        if (!identity.isBot || !Number.isSafeInteger(identity.userId) || identity.userId <= 0) throw new MaxMediaDownloadError()
        expectedSenderId = String(identity.userId)
      }
      const message = await options.api.getMessage(expectedMessageId, signal)
      const identityMatches = message.messageId === expectedMessageId && message.recipientId === expectedRecipientId &&
        (isForward ? message.recipientType === 'channel' : message.senderId === expectedSenderId) &&
        (!isEnvelopeForward || message.forwardedFrom?.messageId === reference.source!.originalMessageId)
      const attachments = isEnvelopeForward ? message.forwardedAttachments : message.attachments
      const attachment = attachments?.[reference.source ? reference.attachmentPosition : 0]
      if (!identityMatches || !attachment || attachment.kind !== 'video' || attachment.providerAttachmentId !== reference.providerAttachmentId) return 'skipped'
      const video = await options.api.getVideo(attachment.currentToken, signal)
      if (!video.thumbnailUrl) throw new MaxProviderError(undefined, true)
      const poster = await download(video.thumbnailUrl, maxPosterBytes, signal)
      if (poster.contentLength !== poster.bytes.byteLength || poster.contentLength > maxPosterBytes ||
          !poster.contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(poster.contentType.split(';', 1)[0]!.trim().toLowerCase())) throw new MaxMediaDownloadError()
      existing = await options.media.ingestTrustedPhoto(scope, { assetId, sourceKind: 'max', bytes: poster.bytes })
    }

    const linked = await options.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM families WHERE id = ${reference.familyId}::uuid FOR UPDATE`
      const active = await tx.maxVideoReference.findFirst({ where: { id: reference.id, familyId: reference.familyId,
        thumbnailMediaId: null, memory: { id: reference.memoryId, familyId: reference.familyId, status: 'published', deletedAt: null } },
      select: { id: true } })
      if (!active) return { count: 0 }
      return tx.maxVideoReference.updateMany({ where: { id: active.id, familyId: reference.familyId, thumbnailMediaId: null }, data: { thumbnailMediaId: assetId } })
    })
    if (linked.count === 1) return 'done'
    const current = await options.prisma.maxVideoReference.findFirst({ where: { id: reference.id, familyId: reference.familyId }, select: { thumbnailMediaId: true } })
    if (current?.thumbnailMediaId === assetId) return 'done'
    await options.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: [assetId] })
    return 'skipped'
  }
}

function isAccessFailure(error: unknown) {
  return error instanceof Error && ['FamilyFailure', 'MemoryFailure'].includes(error.name) && ['forbidden', 'not_found'].includes(String((error as { kind?: unknown }).kind))
}
