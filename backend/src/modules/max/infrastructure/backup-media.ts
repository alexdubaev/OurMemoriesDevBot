import sharp from 'sharp'
import decodeHeic from 'heic-decode'

import type { DbClient } from '../../../db'
import type { MaxMemoryBackupState } from '../../../generated/prisma/enums'
import { TerminalTaskError } from '../../../outbox'
import type { PrivateStorage } from '../../../storage'
import type { MaxApiPort, MaxSendMediaMessageInput } from '../application/ports'
import { MaxProviderError } from './max-api'

const maxPhotoBytes = 20_000_000

type BackupAttachment = {
  position: number
  kind: 'image' | 'video'
  uploadToken: string | null
  media: null | {
    id: string
    familyId: string
    mediaKind: string
    originalKey: string
    byteSize: bigint
    verifiedMime: string | null
    declaredMime: string
    originalStatus: string
    deletedAt: Date | null
    storageDeletedAt: Date | null
  }
  uploadSession: null | {
    familyId: string
    state: string
    providerUploadToken: string | null
  }
}

type Backup = {
  id: string
  memoryId: string
  familyId: string
  body: string
  state: string
  channelChatId: bigint | null
  providerMessageId: string | null
  sendIntentAt: Date | null
  family: { maxBackupChatId: bigint | null }
  memory: { familyId: string; status: string; deletedAt: Date | null }
  attachments: BackupAttachment[]
}

export type MaxMemoryBackupRepository = {
  load(memoryId: string): Promise<Backup | null>
  persistUploadToken(backup: Backup, attachment: BackupAttachment, token: string): Promise<boolean>
  updateState(backup: Backup, state: 'pending' | 'needs_configuration' | 'uploading' | 'send_intent' | 'sent' | 'ambiguous' | 'failed', patch?: { sendIntentAt?: Date | null; providerMessageId?: string; lastErrorCode?: string | null }): Promise<boolean>
}

export function createMaxMemoryBackupProcessor(options: {
  repository: MaxMemoryBackupRepository
  storage: PrivateStorage
  api: Pick<MaxApiPort, 'uploadImage' | 'sendMediaMessage'>
  now?: () => Date
}) {
  return async function process(payload: unknown, signal?: AbortSignal, finalAttempt = false) {
    const memoryId = (payload as { memoryId?: unknown } | null)?.memoryId
    if (typeof memoryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(memoryId)) {
      throw new TerminalTaskError('MAX backup payload is invalid')
    }

    let backup = await options.repository.load(memoryId)
    if (!backup) throw new TerminalTaskError('MAX backup reservation does not exist')
    if (backup.state === 'sent' || backup.state === 'ambiguous' || backup.state === 'failed' || backup.state === 'needs_configuration') return
    // Another delivery may be the worker that owns this send. Never start a second POST from
    // this durable intent; provider outcomes are ambiguous until that worker records its result.
    if (backup.state === 'send_intent' || backup.sendIntentAt) return

    if (!backup.family.maxBackupChatId || backup.channelChatId !== backup.family.maxBackupChatId) {
      await options.repository.updateState(backup, 'needs_configuration', { lastErrorCode: 'backup_channel_not_configured' })
      throw new TerminalTaskError('MAX backup channel is not configured for this family')
    }
    if (backup.memory.familyId !== backup.familyId || backup.memory.status !== 'published' || backup.memory.deletedAt !== null) {
      await options.repository.updateState(backup, 'failed', { lastErrorCode: 'memory_unavailable' })
      throw new TerminalTaskError('MAX backup Memory is not published and active')
    }
    if (!options.api.uploadImage || !options.api.sendMediaMessage) throw new TerminalTaskError('MAX media backup is unavailable')
    if (backup.attachments.length < 1 || backup.attachments.length > 10) {
      await options.repository.updateState(backup, 'failed', { lastErrorCode: 'invalid_attachment_count' })
      throw new TerminalTaskError('MAX backup must contain 1 to 10 attachments')
    }
    try {
      await options.repository.updateState(backup, 'uploading')

      for (const attachment of backup.attachments) {
        if (attachment.uploadToken) continue
        let token: string
        if (attachment.kind === 'video') {
          const session = attachment.uploadSession
          if (!session || session.familyId !== backup.familyId || session.state !== 'finalized' || !session.providerUploadToken) {
            await options.repository.updateState(backup, 'failed', { lastErrorCode: 'video_upload_not_finalized' })
            throw new TerminalTaskError('MAX backup video does not have a finalized provider upload')
          }
          token = session.providerUploadToken
        } else {
          const media = attachment.media
          if (!media || media.familyId !== backup.familyId || media.mediaKind !== 'photo' || media.originalStatus !== 'stored' ||
              media.deletedAt || media.storageDeletedAt) {
            await options.repository.updateState(backup, 'failed', { lastErrorCode: 'photo_unavailable' })
            throw new TerminalTaskError('MAX backup photo original is unavailable')
          }
          if (media.byteSize <= 0n || media.byteSize > BigInt(maxPhotoBytes)) {
            await options.repository.updateState(backup, 'failed', { lastErrorCode: 'photo_too_large' })
            throw new TerminalTaskError('MAX backup photo exceeds the 20 MB provider limit')
          }
          const stored = await options.storage.readObject({ key: media.originalKey })
          if (!stored || stored.contentLength > maxPhotoBytes || stored.contentLength !== Number(media.byteSize)) {
            await options.repository.updateState(backup, 'failed', { lastErrorCode: 'photo_original_invalid' })
            throw new TerminalTaskError('MAX backup photo original is missing or exceeds the provider limit')
          }
          const bytes = await readBounded(stored.body, maxPhotoBytes)
          const sourceMime = media.verifiedMime ?? media.declaredMime
          const image = await normalizePhoto(bytes, sourceMime)
          const uploaded = await options.api.uploadImage({
            bytes: image.bytes,
            contentType: image.contentType,
            fileName: `backup_${attachment.position + 1}.${image.contentType === 'image/png' ? 'png' : image.contentType === 'image/heic' ? 'heic' : 'jpg'}`,
          }, signal)
          token = uploaded.token
        }

        if (!token || token.length > 4_096) throw new TerminalTaskError('MAX returned an unusable backup media token')
        const persisted = await options.repository.persistUploadToken(backup, attachment, token)
        if (!persisted) {
          backup = await options.repository.load(memoryId)
          if (!backup) throw new TerminalTaskError('MAX backup reservation disappeared')
        }
      }

      // Reload after each durable attachment write so the final provider call is built from the
      // winner of any concurrent upload-token race, in original attachment order.
      backup = await options.repository.load(memoryId)
      if (!backup || backup.attachments.some(({ uploadToken }) => !uploadToken)) throw new Error('MAX backup media tokens were not persisted')
      if (backup.state === 'sent' || backup.state === 'ambiguous' || backup.state === 'send_intent') return
      if (backup.family.maxBackupChatId !== backup.channelChatId || !backup.channelChatId || backup.memory.status !== 'published' || backup.memory.deletedAt) {
        await options.repository.updateState(backup, 'failed', { lastErrorCode: 'backup_precondition_changed' })
        throw new TerminalTaskError('MAX backup preconditions changed before send')
      }
    } catch (error) {
      if (backup && finalAttempt && !(error instanceof TerminalTaskError)) {
        await options.repository.updateState(backup, 'failed', { lastErrorCode: 'pre_send_attempts_exhausted' }).catch(() => false)
      }
      throw error
    }
    const chatId = backup.channelChatId.toString()
    const sendIntentAt = (options.now ?? (() => new Date()))()
    const intended = await options.repository.updateState(backup, 'send_intent', { sendIntentAt })
    if (!intended) return
    backup = { ...backup, state: 'send_intent', sendIntentAt }

    let sent: { messageId: string }
    try {
      const input: MaxSendMediaMessageInput = {
        chatId,
        text: backup.body,
        attachments: backup.attachments.map(({ kind, uploadToken }) => ({ kind, token: uploadToken! })),
      }
      sent = await options.api.sendMediaMessage(input, signal)
    } catch (error) {
      if (isExplicitAttachmentNotReady(error) || isExplicitRateLimit(error)) {
        const lastErrorCode = isExplicitRateLimit(error) ? 'rate_limited' : 'attachment_not_ready'
        if (finalAttempt) {
          const failed = await options.repository.updateState(backup, 'failed', {
            sendIntentAt: null,
            lastErrorCode,
          }).catch(() => false)
          if (failed) throw new TerminalTaskError('MAX backup send was rejected on its final attempt', { cause: error })
          throw new TerminalTaskError('MAX backup state changed after an explicit send rejection', { cause: error })
        }

        const released = await options.repository.updateState(backup, 'uploading', {
          sendIntentAt: null,
          lastErrorCode,
        }).catch(() => false)
        if (!released) throw new TerminalTaskError('MAX backup send intent could not be safely released', { cause: error })
        throw new MaxProviderError(error.retryAfterSeconds, true, error.status, error.code)
      }
      await options.repository.updateState(backup, 'ambiguous', { lastErrorCode: 'send_result_unknown' }).catch(() => false)
      throw new TerminalTaskError('MAX backup send result is ambiguous and will not be retried', { cause: error })
    }
    try {
      const saved = await options.repository.updateState(backup, 'sent', { providerMessageId: sent.messageId, lastErrorCode: null })
      if (!saved) throw new Error('MAX backup provider reference was not saved')
    } catch (error) {
      await options.repository.updateState(backup, 'ambiguous', { lastErrorCode: 'provider_reference_save_failed' }).catch(() => false)
      throw new TerminalTaskError('MAX backup was sent but its provider reference could not be saved', { cause: error })
    }
  }
}

export function createPrismaMaxMemoryBackupRepository(prisma: DbClient): MaxMemoryBackupRepository {
  return {
    async load(memoryId) {
      return prisma.maxMemoryBackup.findUnique({
        where: { memoryId },
        include: {
          family: { select: { maxBackupChatId: true } },
          memory: { select: { familyId: true, status: true, deletedAt: true } },
          attachments: { orderBy: { position: 'asc' }, include: { media: true, uploadSession: true } },
        },
      }) as Promise<Backup | null>
    },
    async persistUploadToken(backup, attachment, token) {
      const result = await prisma.maxMemoryBackupAttachment.updateMany({
        where: { backupId: backup.id, familyId: backup.familyId, position: attachment.position, uploadToken: null },
        data: { uploadToken: token },
      })
      return result.count === 1
    },
    async updateState(backup, state, patch = {}) {
      const releasingSendIntent = (state === 'uploading' || state === 'failed') && backup.state === 'send_intent' && backup.sendIntentAt !== null && patch.sendIntentAt === null
      const allowed: MaxMemoryBackupState[] = state === 'send_intent'
        ? ['pending', 'uploading']
        : state === 'sent' || state === 'ambiguous' || releasingSendIntent ? ['send_intent'] : ['pending', 'uploading']
      const result = await prisma.maxMemoryBackup.updateMany({
        where: {
          id: backup.id,
          familyId: backup.familyId,
          state: { in: allowed },
          ...(state === 'send_intent' ? { sendIntentAt: null } : {}),
          ...(releasingSendIntent ? { sendIntentAt: backup.sendIntentAt } : {}),
        },
        data: { state, ...patch },
      })
      return result.count === 1
    },
  }
}

function isExplicitAttachmentNotReady(error: unknown): error is MaxProviderError {
  return error instanceof MaxProviderError && error.code === 'attachment.not.ready' &&
    typeof error.status === 'number' && error.status >= 400 && error.status < 500
}

function isExplicitRateLimit(error: unknown): error is MaxProviderError {
  return error instanceof MaxProviderError && error.status === 429
}

async function readBounded(body: ReadableStream<Uint8Array>, maximum: number) {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) throw new TerminalTaskError('MAX backup photo exceeds the 20 MB provider limit')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

async function normalizePhoto(bytes: Uint8Array, mime: string): Promise<{
  bytes: Uint8Array
  contentType: 'image/jpeg' | 'image/png' | 'image/heic'
}> {
  if (mime === 'image/jpeg' || mime === 'image/png') {
    const source = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, pages: 1 })
    const metadata = await source.metadata()
    if (!metadata.width || !metadata.height) throw new TerminalTaskError('MAX backup photo dimensions are unavailable')
    if (metadata.width <= 7_680 && metadata.height <= 7_680) return { bytes, contentType: mime }
    const converted = await source.rotate().resize({ width: 7_680, height: 7_680, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
    if (converted.byteLength > maxPhotoBytes) throw new TerminalTaskError('Converted MAX backup photo exceeds the 20 MB provider limit')
    return { bytes: new Uint8Array(converted), contentType: 'image/jpeg' }
  }
  let converted: Buffer
  if (mime === 'image/webp') {
    converted = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000, pages: 1 }).rotate()
      .resize({ width: 7_680, height: 7_680, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  } else if (mime === 'image/heic') {
    const decoded = await decodeHeic({ buffer: Buffer.from(bytes) })
    converted = await sharp(Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 }, limitInputPixels: 40_000_000,
    }).resize({ width: 7_680, height: 7_680, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  } else throw new TerminalTaskError('MAX backup photo format is unsupported')
  if (converted.byteLength > maxPhotoBytes) throw new TerminalTaskError('Converted MAX backup photo exceeds the 20 MB provider limit')
  return { bytes: new Uint8Array(converted), contentType: 'image/jpeg' as const }
}
