import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { ReserveMediaUploadRequest } from '@web-app-demo/contracts'

import { createStorageObjectKey, StorageError, type PrivateStorage } from '../../../storage'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MediaFailure } from '../domain/errors'
import { detectDeclaredMedia, detectPhotoMime, parseSingleRange } from '../domain/media-policy'
import type { MediaProbe, MediaRepository, PendingMediaUpload, PhotoProcessor, StoredVariant } from './ports'

export class MediaService {
  constructor(
    private readonly access: FamilyAccess,
    private readonly repository: MediaRepository,
    private readonly storage: PrivateStorage,
    private readonly config: { familyQuotaBytes: number; maxPendingUploads: number; reservationTtlSeconds: number; uploadUrlTtlSeconds: number },
    private readonly processPhoto: PhotoProcessor,
    private readonly probeMedia: MediaProbe,
    private readonly now: () => Date = () => new Date(),
    private readonly cleanupTemporaryDirectory: (directory: string) => Promise<void> = removeTemporaryDirectory,
    private readonly warnCleanupFailure: (errorName: string) => void = warnTemporaryCleanupFailure,
  ) {}

  async reserve(scope: FamilyScope, input: ReserveMediaUploadRequest, idempotencyKey?: string) {
    if (input.purpose === 'child_avatar') await this.access.requireOwner(scope)
    else await this.access.requireFull(scope)
    const now = this.now()
    const operationKey = idempotencyKey ?? randomUUID()
    const uploadId = deterministicUuid('media-upload', scope, operationKey)
    const assetId = deterministicUuid('media-asset', scope, operationKey)
    const objectKey = createStorageObjectKey({ namespace: 'media-originals', id: assetId, now })
    const expiresAt = new Date(now.getTime() + this.config.reservationTtlSeconds * 1_000)
    try {
      await this.repository.reserve({
        uploadId, assetId, familyId: scope.familyId, userId: scope.principal.userId,
        purpose: input.purpose, kind: input.kind, objectKey, declaredMime: input.contentType,
        byteSize: input.byteSize, expiresAt, quotaBytes: this.config.familyQuotaBytes,
        maxPendingUploads: this.config.maxPendingUploads, now,
      })
    } catch (error) {
      if (!isUniqueConstraint(error) || !idempotencyKey || !this.repository.findUpload) throw error
      const existing = await this.repository.findUpload(scope, uploadId)
      if (!existing || existing.assetId !== assetId || existing.purpose !== input.purpose || existing.kind !== input.kind || existing.declaredMime !== input.contentType || existing.byteSize !== input.byteSize) {
        throw new MediaFailure('idempotency_conflict', 'Этот ключ уже использован для другой загрузки')
      }
      try {
        return await this.createUploadResponse(existing, input.contentType)
      } catch (error) {
        throw storageFailure(error)
      }
    }
    try {
      const ticket = await this.storage.createUploadUrl({
        key: objectKey, contentType: input.contentType, byteSize: input.byteSize,
        expiresInSeconds: this.config.uploadUrlTtlSeconds,
      })
      return {
        assetId,
        upload: { uploadId, method: ticket.method, url: ticket.url, headers: ticket.headers,
          contentLength: ticket.contentLength, expiresAt: ticket.expiresAt },
        reservationExpiresAt: expiresAt.toISOString(),
      }
    } catch (error) {
      await this.repository.rejectUpload(scope, uploadId, now)
      throw storageFailure(error)
    }
  }

  private createUploadResponse(upload: PendingMediaUpload, contentType: ReserveMediaUploadRequest['contentType']) {
    return this.storage.createUploadUrl({
      key: upload.objectKey, contentType, byteSize: upload.byteSize,
      expiresInSeconds: this.config.uploadUrlTtlSeconds,
    }).then((ticket) => ({
      assetId: upload.assetId,
      upload: { uploadId: upload.uploadId, method: ticket.method, url: ticket.url, headers: ticket.headers,
        contentLength: ticket.contentLength, expiresAt: ticket.expiresAt },
      reservationExpiresAt: upload.expiresAt.toISOString(),
    }))
  }

  /** Server-side ingestion for trusted adapters. It deliberately follows the same reservation,
   * validation, quota and finalization lifecycle as browser uploads. */
  async ingestTelegram(scope: FamilyScope, input: {
    assetId: string
    kind: 'photo' | 'video' | 'voice'
    contentType: ReserveMediaUploadRequest['contentType']
    byteSize: number
    body: ReadableStream<Uint8Array>
    sourceKind?: 'telegram' | 'max'
  }) {
    await this.access.requireFull(scope)
    const now = this.now()
    const sourceKind = input.sourceKind ?? 'telegram'
    let preparation = this.repository.findTrustedIngestion
      ? await this.repository.findTrustedIngestion(scope, input.assetId, sourceKind)
      : await this.repository.findTelegramIngestion(scope, input.assetId)
    if (preparation?.kind === 'ready') return { asset: preparation.asset }
    if (preparation?.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван')
    if (preparation?.kind === 'expired') throw new MediaFailure('upload_expired', 'Срок загрузки истёк')
    if (!preparation) {
      const uploadId = randomUUID()
      const objectKey = createStorageObjectKey({ namespace: 'media-originals', id: input.assetId, now })
      const expiresAt = new Date(now.getTime() + this.config.reservationTtlSeconds * 1_000)
      try {
        await this.repository.reserve({
          uploadId,
          assetId: input.assetId,
          familyId: scope.familyId,
          userId: scope.principal.userId,
          sourceKind,
          purpose: 'memory',
          kind: input.kind,
          objectKey,
          declaredMime: input.contentType,
          byteSize: input.byteSize,
          expiresAt,
          quotaBytes: this.config.familyQuotaBytes,
          maxPendingUploads: this.config.maxPendingUploads,
          now,
        })
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error
        const raced = this.repository.findTrustedIngestion
          ? await this.repository.findTrustedIngestion(scope, input.assetId, sourceKind)
          : await this.repository.findTelegramIngestion(scope, input.assetId)
        if (raced) preparation = raced
        else throw error
      }
      if (preparation) {
        if (preparation.kind === 'ready') return { asset: preparation.asset }
        if (preparation.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван')
        if (preparation.kind === 'expired') throw new MediaFailure('upload_expired', 'Срок загрузки истёк')
      }
      if (preparation) {
        // A concurrent fixed-ID ingestion won the reservation; continue with its upload.
      } else {
      preparation = { kind: 'pending', upload: {
        uploadId, assetId: input.assetId, familyId: scope.familyId, userId: scope.principal.userId,
        sourceKind, purpose: 'memory', kind: input.kind, objectKey,
        declaredMime: input.contentType, byteSize: input.byteSize, expiresAt,
      } }
      }
    }
    const upload = preparation.upload
    if (upload.kind !== input.kind || upload.declaredMime !== input.contentType || upload.byteSize !== input.byteSize) {
      await input.body.cancel().catch(() => undefined)
      await this.repository.rejectUpload(scope, upload.uploadId, this.now())
      throw new MediaFailure('invalid_file', 'Telegram изменил метаданные файла между попытками')
    }
    try {
      const stored = await this.storage.headObject(upload.objectKey)
      if (stored) {
        await input.body.cancel().catch(() => undefined)
        if (stored.contentLength !== upload.byteSize || stored.contentType !== upload.declaredMime) {
          await this.repository.rejectUpload(scope, upload.uploadId, this.now())
          throw new MediaFailure('invalid_file', 'Сохранённый оригинал не соответствует Telegram-файлу')
        }
      } else {
        await this.storage.writeObject({
          key: upload.objectKey,
          body: input.body,
          contentLength: upload.byteSize,
          contentType: upload.declaredMime,
        })
      }
      return await this.finalize(scope, upload.uploadId)
    } catch (error) {
      if (error instanceof StorageError) throw storageFailure(error)
      throw error
    }
  }

  async ingestTrustedPhoto(scope: FamilyScope, input: { assetId: string; sourceKind: 'telegram' | 'max'; bytes: Uint8Array }) {
    const existing = this.repository.findTrustedIngestion
      ? await this.repository.findTrustedIngestion(scope, input.assetId, input.sourceKind)
      : await this.repository.findTelegramIngestion(scope, input.assetId)
    if (existing?.kind === 'ready') return { asset: existing.asset }
    if (existing?.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван')
    if (existing?.kind === 'expired') throw new MediaFailure('upload_expired', 'Срок загрузки истёк')
    const contentType = detectPhotoMime(input.bytes)
    return this.ingestTelegram(scope, {
      assetId: input.assetId, sourceKind: input.sourceKind, kind: 'photo', contentType,
      byteSize: input.bytes.byteLength,
      body: new Blob([input.bytes.slice().buffer as ArrayBuffer]).stream(),
    })
  }

  /** Resume a deterministic trusted-media reservation when a prior worker wrote the object but
   * crashed before its adapter bookkeeping. Returns null only when the provider body is still
   * required; it never performs provider I/O. */
  async resumeTrustedMedia(scope: FamilyScope, input: { assetId: string; sourceKind: 'telegram' | 'max' }) {
    await this.access.requireFull(scope)
    const preparation = this.repository.findTrustedIngestion
      ? await this.repository.findTrustedIngestion(scope, input.assetId, input.sourceKind)
      : await this.repository.findTelegramIngestion(scope, input.assetId)
    if (!preparation || preparation.kind === 'pending') {
      if (!preparation) return null
      const head = await this.storage.headObject(preparation.upload.objectKey)
      if (!head) return null
      if (head.contentLength !== preparation.upload.byteSize || head.contentType !== preparation.upload.declaredMime) {
        await this.repository.rejectUpload(scope, preparation.upload.uploadId, this.now())
        throw new MediaFailure('invalid_file', 'Сохранённый оригинал не соответствует MAX-файлу')
      }
      return (await this.finalize(scope, preparation.upload.uploadId)).asset
    }
    if (preparation.kind === 'ready') return preparation.asset
    if (preparation.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван')
    throw new MediaFailure('upload_expired', 'Срок загрузки истёк')
  }

  /** @deprecated Use resumeTrustedMedia; retained for the existing Telegram image adapter. */
  async resumeTrustedPhoto(scope: FamilyScope, input: { assetId: string; sourceKind: 'telegram' | 'max' }) {
    return this.resumeTrustedMedia(scope, input)
  }

  async discardTrustedSourceAssets(input: { sourceKind: 'telegram' | 'max'; assetIds: string[]; now?: Date }) {
    if (this.repository.discardTrustedSourceAssets) {
      await this.repository.discardTrustedSourceAssets({ sourceKind: input.sourceKind, assetIds: input.assetIds, now: input.now ?? this.now() })
    }
  }

  async finalize(scope: FamilyScope, uploadId: string) {
    const preparation = await this.repository.prepareFinalize(scope, uploadId, this.now())
    if (preparation.kind === 'ready') return { asset: preparation.asset }
    if (preparation.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван', 'PHOTO_FINALIZE_ACCESS_REVOKED')
    if (preparation.kind === 'expired') throw new MediaFailure('upload_expired', 'Срок загрузки истёк', 'PHOTO_FINALIZE_RESERVATION_EXPIRED')
    const upload = preparation.upload
    const head = await this.storage.headObject(upload.objectKey).catch((error) => { throw storageFailure(error) })
    if (!head || head.contentLength !== upload.byteSize || head.contentType !== upload.declaredMime) {
      if (head) {
        await this.repository.rejectUpload(scope, uploadId, this.now())
        throw new MediaFailure('upload_incomplete', 'Файл загружен не полностью', 'PHOTO_FINALIZE_OBJECT_METADATA_MISMATCH')
      }
      throw new MediaFailure('upload_incomplete', 'Файл загружен не полностью', 'PHOTO_FINALIZE_OBJECT_MISSING')
    }
    const magic = await this.storage.readRange(upload.objectKey, { start: 0, end: Math.min(31, upload.byteSize - 1) })
      .catch((error) => { throw storageFailure(error) })
    if (!magic) throw new MediaFailure('upload_incomplete', 'Файл не найден в хранилище')
    try {
      detectDeclaredMedia(magic, upload.kind, upload.declaredMime)
    } catch (error) {
      await this.repository.rejectUpload(scope, uploadId, this.now())
      if (error instanceof MediaFailure) {
        throw new MediaFailure(error.kind, error.message, 'PHOTO_FINALIZE_MEDIA_VERIFICATION_FAILED', error.details)
      }
      throw error
    }

    const directory = await mkdtemp(join(tmpdir(), 'our-memories-media-'))
    const originalPath = join(directory, 'original')
    let finalizationCommitted = false
    let operationError: unknown = undefined
    try {
      const original = await this.storage.readObject({ key: upload.objectKey })
      if (!original) throw new MediaFailure('upload_incomplete', 'Файл не найден в хранилище')
      await pipeline(Readable.fromWeb(original.body as never), createWriteStream(originalPath))
      let verifiedMime = upload.declaredMime
      let sha256 = await sha256File(originalPath)
      let width: number | null = null
      let height: number | null = null
      let durationMs: number | null = null
      let renditionStatus: 'pending' | 'ready' = 'pending'
      const variants: StoredVariant[] = []
      if (upload.kind === 'photo') {
        const photo = await this.processPhoto(originalPath)
        verifiedMime = photo.verifiedMime
        sha256 = photo.originalSha256
        width = photo.width
        height = photo.height
        renditionStatus = 'ready'
        for (const [variant, rendered] of [['display', photo.display], ['preview', photo.preview]] as const) {
          const key = upload.objectKey.replace('media-originals/', `media-${variant}/`)
          try {
            await this.storage.writeObject({ key, body: new Blob([rendered.bytes.slice().buffer as ArrayBuffer]).stream(),
              contentLength: rendered.bytes.byteLength, contentType: 'image/webp' })
          } catch (error) {
            if (!(error instanceof StorageError && error.kind === 'already_exists') ||
              !(await storageObjectMatches(this.storage, key, rendered.bytes.byteLength, rendered.sha256))) throw error
          }
          variants.push({ variant, objectKey: key, sha256: rendered.sha256,
            byteSize: rendered.bytes.byteLength, mime: 'image/webp', width: rendered.width,
            height: rendered.height, durationMs: null })
        }
      } else {
        const probed = await this.probeMedia(originalPath, upload.kind)
        width = probed.width
        height = probed.height
        durationMs = probed.durationMs
      }
      const finalization = await this.repository.commitFinalization({ scope, uploadId, verifiedMime,
        sha256, width, height, durationMs, renditionStatus, variants, now: this.now() })
      if (finalization.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван', 'PHOTO_FINALIZE_ACCESS_REVOKED')
      if (finalization.kind === 'expired') throw new MediaFailure('upload_expired', 'Срок загрузки истёк', 'PHOTO_FINALIZE_RESERVATION_EXPIRED')
      finalizationCommitted = true
      return { asset: finalization.asset }
    } catch (error) {
      operationError = error
      if (error instanceof MediaFailure && ['invalid_file', 'unsupported_media'].includes(error.kind)) {
        await this.repository.rejectUpload(scope, uploadId, this.now())
        if (upload.kind === 'photo') {
          throw new MediaFailure(error.kind, error.message, 'PHOTO_FINALIZE_MEDIA_PROCESSING_FAILED', error.details)
        }
      }
      if (error instanceof StorageError) throw storageFailure(error)
      throw error
    } finally {
      try {
        await this.cleanupTemporaryDirectory(directory)
      } catch (error) {
        if (finalizationCommitted || operationError !== undefined) {
          this.warnCleanupFailure(error instanceof Error ? error.name : 'UnknownError')
        } else {
          throw error
        }
      }
    }
  }

  async content(scope: FamilyScope, mediaId: string, variant: 'preview' | 'display' | 'playback' | 'original', rangeHeader?: string) {
    await this.access.requireMember(scope)
    const object = await this.repository.resolveContent(scope, mediaId, variant)
    if (!object) throw new MediaFailure('not_found', 'Медиа не найдено')
    const range = rangeHeader ? parseSingleRange(rangeHeader, object.contentLength) : undefined
    const stored = await this.storage.readObject({ key: object.objectKey, range }).catch((error) => { throw storageFailure(error) })
    if (!stored) throw new MediaFailure('not_found', 'Медиа не найдено')
    return { ...object, body: stored.body, range }
  }

  async authorizePlaybackSession(scope: FamilyScope) {
    await this.access.requireMember(scope)
  }

  async assertReadyForMemory(scope: FamilyScope, mediaIds: string[]) {
    if (!(await this.repository.readyForMemory(scope, mediaIds))) {
      throw new MediaFailure('not_found', 'Медиа недоступно для публикации')
    }
  }
}

function removeTemporaryDirectory(directory: string) {
  return rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

function warnTemporaryCleanupFailure(errorName: string) {
  console.warn('Temporary media cleanup failed', { errorName })
}

async function sha256File(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function storageFailure(error: unknown) {
  return error instanceof MediaFailure ? error : new MediaFailure('storage_unavailable', 'Хранилище временно недоступно')
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002'
}

function deterministicUuid(namespace: string, scope: FamilyScope, key: string) {
  const digest = createHash('sha256').update([namespace, scope.principal.userId, scope.familyId, key].join('\0')).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}

async function storageObjectMatches(storage: PrivateStorage, key: string, expectedLength: number, expectedSha256: string) {
  const stored = await storage.readObject({ key })
  if (!stored || stored.contentLength !== expectedLength || stored.contentType !== 'image/webp') return false
  const hash = createHash('sha256')
  for await (const chunk of Readable.fromWeb(stored.body as never)) hash.update(chunk as Buffer)
  return hash.digest('hex') === expectedSha256
}
