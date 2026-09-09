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
import { detectDeclaredMedia, parseSingleRange } from '../domain/media-policy'
import type { MediaProbe, MediaRepository, PhotoProcessor, StoredVariant } from './ports'

export class MediaService {
  constructor(
    private readonly access: FamilyAccess,
    private readonly repository: MediaRepository,
    private readonly storage: PrivateStorage,
    private readonly config: { familyQuotaBytes: number; maxPendingUploads: number; reservationTtlSeconds: number; uploadUrlTtlSeconds: number },
    private readonly processPhoto: PhotoProcessor,
    private readonly probeMedia: MediaProbe,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(scope: FamilyScope, input: ReserveMediaUploadRequest) {
    await this.access.requireFull(scope)
    const now = this.now()
    const uploadId = randomUUID()
    const assetId = randomUUID()
    const objectKey = createStorageObjectKey({ namespace: 'media-originals', id: assetId, now })
    const expiresAt = new Date(now.getTime() + this.config.reservationTtlSeconds * 1_000)
    await this.repository.reserve({
      uploadId, assetId, familyId: scope.familyId, userId: scope.principal.userId,
      purpose: input.purpose, kind: input.kind, objectKey, declaredMime: input.contentType,
      byteSize: input.byteSize, expiresAt, quotaBytes: this.config.familyQuotaBytes,
      maxPendingUploads: this.config.maxPendingUploads, now,
    })
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

  async finalize(scope: FamilyScope, uploadId: string) {
    const preparation = await this.repository.prepareFinalize(scope, uploadId, this.now())
    if (preparation.kind === 'ready') return { asset: preparation.asset }
    if (preparation.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван')
    if (preparation.kind === 'expired') throw new MediaFailure('upload_expired', 'Срок загрузки истёк')
    const upload = preparation.upload
    const head = await this.storage.headObject(upload.objectKey).catch((error) => { throw storageFailure(error) })
    if (!head || head.contentLength !== upload.byteSize || head.contentType !== upload.declaredMime) {
      if (head) await this.repository.rejectUpload(scope, uploadId, this.now())
      throw new MediaFailure('upload_incomplete', 'Файл загружен не полностью')
    }
    const magic = await this.storage.readRange(upload.objectKey, { start: 0, end: Math.min(31, upload.byteSize - 1) })
      .catch((error) => { throw storageFailure(error) })
    if (!magic) throw new MediaFailure('upload_incomplete', 'Файл не найден в хранилище')
    try {
      detectDeclaredMedia(magic, upload.kind, upload.declaredMime)
    } catch (error) {
      await this.repository.rejectUpload(scope, uploadId, this.now())
      throw error
    }

    const directory = await mkdtemp(join(tmpdir(), 'our-memories-media-'))
    const originalPath = join(directory, 'original')
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
      const committed = await this.repository.commitFinalization({ scope, uploadId, verifiedMime,
        sha256, width, height, durationMs, renditionStatus, variants, now: this.now() })
      if (committed.kind === 'forbidden') throw new MediaFailure('forbidden', 'Доступ к загрузке отозван')
      if (committed.kind === 'expired') throw new MediaFailure('upload_expired', 'Срок загрузки истёк')
      return { asset: committed.asset }
    } catch (error) {
      if (error instanceof MediaFailure && ['invalid_file', 'unsupported_media'].includes(error.kind)) {
        await this.repository.rejectUpload(scope, uploadId, this.now())
      }
      if (error instanceof StorageError) throw storageFailure(error)
      throw error
    } finally {
      await rm(directory, { recursive: true, force: true })
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

  async assertReadyForMemory(scope: FamilyScope, mediaIds: string[]) {
    if (!(await this.repository.readyForMemory(scope, mediaIds))) {
      throw new MediaFailure('not_found', 'Медиа недоступно для публикации')
    }
  }
}

async function sha256File(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function storageFailure(error: unknown) {
  return error instanceof MediaFailure ? error : new MediaFailure('storage_unavailable', 'Хранилище временно недоступно')
}

async function storageObjectMatches(storage: PrivateStorage, key: string, expectedLength: number, expectedSha256: string) {
  const stored = await storage.readObject({ key })
  if (!stored || stored.contentLength !== expectedLength || stored.contentType !== 'image/webp') return false
  const hash = createHash('sha256')
  for await (const chunk of Readable.fromWeb(stored.body as never)) hash.update(chunk as Buffer)
  return hash.digest('hex') === expectedSha256
}
