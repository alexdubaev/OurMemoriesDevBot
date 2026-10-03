import type { MiddlewareHandler } from 'hono'
import { createHash } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { PrivateStorage, StorageObjectRead } from '../../storage'
import type { AuthenticatedPrincipal, AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { MediaService } from './application/media-service'
export { MediaFailure } from './domain/errors'
import { PrismaMediaRepository } from './infrastructure/prisma-media-repository'
import { processPhoto } from './infrastructure/photo-processor'
import { probeMediaWithRunner } from './infrastructure/media-probe'
import { assertFfmpegCapabilities, createFfmpegRunner } from './infrastructure/ffmpeg-runner'
import { prepareMedia } from './infrastructure/media-processor'
import { extractVideoPoster, VIDEO_ORIGINAL_MAX_BYTES, VIDEO_POSTER_MAX_BYTES, videoPosterObjectKey } from './infrastructure/video-poster'
export { detectVoiceMime } from './domain/media-policy'
import { createMediaRoutes } from './transport/routes'
import type { MaxVideoPlayback } from './application/ports'
export type { MaxVideoPlayback } from './application/ports'

export function createMediaModule(options: { db: DbClient; env: AppEnv; familyAccess: FamilyAccess;
  authenticateMediaAccess: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  requireAuth: MiddlewareHandler<AuthHttpEnv>; storage: PrivateStorage; maxVideoPlayback?: MaxVideoPlayback }) {
  const service = createMediaService(options)
  return { routes: createMediaRoutes({ authenticateMediaAccess: options.authenticateMediaAccess, cookieSecure: options.env.COOKIE_SECURE, requireAuth: options.requireAuth, service, maxVideoPlayback: options.maxVideoPlayback }), service }
}

export function createMediaService(options: { db: DbClient; env: AppEnv; familyAccess: FamilyAccess;
  storage: PrivateStorage }) {
  const repository = new PrismaMediaRepository(options.db)
  const ffmpeg = createFfmpegRunner({ ffmpegPath: options.env.FFMPEG_PATH, ffprobePath: options.env.FFPROBE_PATH })
  return new MediaService(options.familyAccess, repository, options.storage, {
    familyQuotaBytes: options.env.MEDIA_FAMILY_QUOTA_BYTES,
    maxPendingUploads: options.env.MEDIA_MAX_PENDING_UPLOADS,
    reservationTtlSeconds: options.env.MEDIA_RESERVATION_TTL_SECONDS,
    uploadUrlTtlSeconds: options.env.MEDIA_UPLOAD_URL_TTL_SECONDS,
  }, processPhoto, (path, kind) => probeMediaWithRunner(path, kind, ffmpeg))
}

/** Startup check for the outbox worker that owns long-running voice and video preparation. */
export async function assertMediaProcessorRuntime(env: Pick<AppEnv, 'FFMPEG_PATH' | 'FFPROBE_PATH'>) {
  await assertFfmpegCapabilities(createFfmpegRunner({ ffmpegPath: env.FFMPEG_PATH, ffprobePath: env.FFPROBE_PATH }))
}

export function createMediaTasks(runtime: { prisma: DbClient; privateStorage: { storage: PrivateStorage };
  env: Pick<AppEnv, 'FFMPEG_PATH' | 'FFPROBE_PATH'> & Partial<Pick<AppEnv, 'PRIVATE_STORAGE_UPLOAD_MAX_BYTES'>> }) {
  return {
    async deleteAsset({ mediaId }: { mediaId: string }) {
      const asset = await runtime.prisma.mediaAsset.findUnique({ where: { id: mediaId }, include: { variants: true } })
      if (!asset || asset.storageDeletedAt || !asset.deletedAt) return
      const keys = [asset.originalKey, ...asset.variants.map(({ objectKey }) => objectKey)]
      if (asset.mediaKind === 'video') keys.push(videoPosterObjectKey(asset.originalKey))
      if (asset.mediaKind === 'photo') keys.push(
        asset.originalKey.replace('media-originals/', 'media-display/'),
        asset.originalKey.replace('media-originals/', 'media-preview/'),
      )
      for (const key of new Set(keys)) {
        await runtime.privateStorage.storage.deleteObject(key)
      }
      await runtime.prisma.$transaction(async (tx) => {
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM families WHERE id = ${asset.familyId}::uuid FOR UPDATE
          `)
          await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM media_assets
             WHERE id = ${mediaId}::uuid AND family_id = ${asset.familyId}::uuid
             FOR UPDATE
          `)
        }
        const current = typeof tx.mediaAsset.findUnique === 'function'
          ? await tx.mediaAsset.findUnique({ where: { id: mediaId } })
          : asset
        if (!current || current.storageDeletedAt || !current.deletedAt) return
        const marked = await tx.mediaAsset.updateMany({ where: { id: mediaId, storageDeletedAt: null, deletedAt: { not: null } }, data: { storageDeletedAt: new Date() } })
        if (marked.count === 1 && current.originalStatus === 'stored') {
          await tx.family.update({ where: { id: current.familyId }, data: { storageUsedBytes: { decrement: current.byteSize } } })
        }
      })
    },
    async prepareAsset({ mediaId, signal }: { mediaId: string; signal?: AbortSignal }) {
      const asset = await runtime.prisma.mediaAsset.findUnique({ where: { id: mediaId } })
      if (!asset || asset.deletedAt || asset.originalStatus !== 'stored' || asset.renditionStatus === 'ready' ||
          (asset.mediaKind !== 'voice' && asset.mediaKind !== 'video')) return
      const runner = createFfmpegRunner({ ffmpegPath: runtime.env.FFMPEG_PATH, ffprobePath: runtime.env.FFPROBE_PATH })
      await assertFfmpegCapabilities(runner)
      const directory = await mkdtemp(join(tmpdir(), 'our-memories-rendition-'))
      const inputPath = join(directory, 'original')
      const outputPath = join(directory, asset.mediaKind === 'voice' ? 'playback.m4a' : 'playback.mp4')
      const objectKey = asset.originalKey.replace('media-originals/', 'media-playback/')
      try {
        const original = await runtime.privateStorage.storage.readObject({ key: asset.originalKey })
        if (!original) throw new Error('media original is missing')
        await pipeline(Readable.fromWeb(original.body as never), createWriteStream(inputPath))
        const prepared = await prepareMedia({ inputPath, outputPath, kind: asset.mediaKind, signal }, runner)
        const bytes = await Bun.file(outputPath).arrayBuffer()
        const sha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex')
        const existing = await runtime.privateStorage.storage.headObject(objectKey)
        if (!existing) {
          await runtime.privateStorage.storage.writeObject({ key: objectKey, body: Bun.file(outputPath).stream(),
            contentLength: bytes.byteLength, contentType: prepared.mime })
        } else if (existing.contentLength !== bytes.byteLength || existing.contentType !== prepared.mime) {
          throw new Error('existing playback rendition metadata does not match the prepared output')
        } else {
          const stored = await runtime.privateStorage.storage.readObject({ key: objectKey })
          if (!stored) throw new Error('existing playback rendition disappeared')
          const storedHash = createHash('sha256').update(Buffer.from(await new Response(stored.body).arrayBuffer())).digest('hex')
          if (storedHash !== sha256) throw new Error('existing playback rendition hash does not match the prepared output')
        }
        await runtime.prisma.$transaction(async (tx) => {
          const active = await tx.mediaAsset.findFirst({ where: { id: mediaId, deletedAt: null, originalStatus: 'stored' } })
          if (!active) return
          await tx.mediaVariant.upsert({ where: { mediaId_variant: { mediaId, variant: 'playback' } }, create: {
            familyId: asset.familyId, mediaId, variant: 'playback', objectKey, sha256, byteSize: BigInt(bytes.byteLength),
            mime: prepared.mime, width: prepared.width, height: prepared.height, durationMs: prepared.durationMs,
            codec: asset.mediaKind === 'voice' ? 'aac' : 'h264+aac',
          }, update: { sha256, byteSize: BigInt(bytes.byteLength), mime: prepared.mime, width: prepared.width,
            height: prepared.height, durationMs: prepared.durationMs, codec: asset.mediaKind === 'voice' ? 'aac' : 'h264+aac' } })
          await tx.mediaAsset.update({ where: { id: mediaId }, data: { renditionStatus: 'ready', durationMs: prepared.durationMs,
            width: prepared.width, height: prepared.height, waveform: prepared.waveform ?? undefined, processingErrorCode: null } })
        })
      } catch (error) {
        await runtime.prisma.mediaAsset.updateMany({ where: { id: mediaId, deletedAt: null, renditionStatus: { not: 'ready' } },
          data: { renditionStatus: 'failed', processingErrorCode: 'preparation_failed' } })
        throw error
      } finally { await rm(directory, { recursive: true, force: true }) }
    },
    async createVideoPoster({ mediaId, signal }: { mediaId: string; signal?: AbortSignal }) {
      const asset = await runtime.prisma.mediaAsset.findUnique({
        where: { id: mediaId }, include: { variants: { where: { variant: { in: ['preview', 'display'] } } } },
      })
      if (!asset || asset.deletedAt || asset.storageDeletedAt || asset.originalStatus !== 'stored' || asset.mediaKind !== 'video') return
      if (hasExistingPoster(asset.variants)) return

      const operationSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(75_000)])
        : AbortSignal.timeout(75_000)
      const byteLimit = runtime.env.PRIVATE_STORAGE_UPLOAD_MAX_BYTES ?? VIDEO_ORIGINAL_MAX_BYTES
      if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) throw new Error('Private storage video admission limit is invalid')
      const expectedLength = Number(asset.byteSize)
      if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0 || expectedLength > byteLimit) {
        throw new Error('Stored video original exceeds the poster extraction byte budget')
      }
      const runner = createFfmpegRunner({ ffmpegPath: runtime.env.FFMPEG_PATH, ffprobePath: runtime.env.FFPROBE_PATH })
      const directory = await mkdtemp(join(tmpdir(), 'our-memories-video-poster-'))
      const inputPath = join(directory, 'original')
      const outputPath = join(directory, 'poster.jpg')
      const objectKey = videoPosterObjectKey(asset.originalKey)
      try {
        operationSignal.throwIfAborted()
        const original = await waitWithSignal(
          () => runtime.privateStorage.storage.readObject({ key: asset.originalKey }),
          operationSignal,
          cancelStorageRead,
        )
        if (!original || original.contentLength !== expectedLength || original.contentLength > byteLimit) {
          cancelStorageRead(original)
          throw new Error('Stored video original is missing or its length does not match its media row')
        }
        let copiedBytes = 0
        await pipeline(
          Readable.fromWeb(original.body as never),
          new Transform({ transform(chunk: Buffer, _encoding, callback) {
            copiedBytes += chunk.byteLength
            callback(copiedBytes > byteLimit ? new Error('Stored video original exceeded its byte budget') : null, chunk)
          } }),
          createWriteStream(inputPath, { flags: 'wx' }),
          { signal: operationSignal },
        )
        if (copiedBytes !== expectedLength) throw new Error('Stored video original stream length does not match its media row')
        operationSignal.throwIfAborted()
        const poster = await extractVideoPoster({ inputPath, outputPath, signal: operationSignal }, runner)
        if (poster.bytes.byteLength > VIDEO_POSTER_MAX_BYTES) throw new Error('Video poster exceeded its publication byte budget')

        await runtime.prisma.$transaction(async (tx) => {
          operationSignal.throwIfAborted()
          await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM families WHERE id = ${asset.familyId}::uuid FOR UPDATE
          `)
          await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id FROM media_assets
             WHERE id = ${mediaId}::uuid AND family_id = ${asset.familyId}::uuid
             FOR UPDATE
          `)
          const current = await tx.mediaAsset.findFirst({
            where: { id: mediaId, familyId: asset.familyId, deletedAt: null, storageDeletedAt: null,
              originalStatus: 'stored', mediaKind: 'video' },
            include: { variants: { where: { variant: { in: ['preview', 'display'] } } } },
          })
          if (!current) return
          if (hasExistingPoster(current.variants)) return
          operationSignal.throwIfAborted()

          const existing = await waitWithSignal(
            () => runtime.privateStorage.storage.headObject(objectKey), operationSignal,
          )
          if (existing) {
            if (existing.contentLength !== poster.bytes.byteLength || existing.contentType !== poster.mime ||
                existing.contentLength > VIDEO_POSTER_MAX_BYTES) {
              throw new Error('Existing deterministic video poster has invalid metadata')
            }
            const storedBytes = await readBoundedStorageObject(runtime.privateStorage.storage, objectKey,
              poster.mime, poster.bytes.byteLength, VIDEO_POSTER_MAX_BYTES, operationSignal)
            if (createHash('sha256').update(storedBytes).digest('hex') !== poster.sha256) {
              throw new Error('Existing deterministic video poster hash does not match extracted output')
            }
          } else {
            operationSignal.throwIfAborted()
            await waitWithSignal(() => runtime.privateStorage.storage.writeObject({
              key: objectKey, body: Readable.toWeb(Readable.from([poster.bytes])) as unknown as ReadableStream<Uint8Array>,
              contentLength: poster.bytes.byteLength, contentType: poster.mime,
            }), operationSignal)
          }
          operationSignal.throwIfAborted()
          await tx.mediaVariant.create({ data: {
            familyId: asset.familyId, mediaId, variant: 'preview', objectKey, sha256: poster.sha256,
            byteSize: BigInt(poster.bytes.byteLength), mime: poster.mime, width: poster.width,
            height: poster.height, durationMs: null, codec: null,
          } })
        })
      } finally { await rm(directory, { recursive: true, force: true }) }
    },
  }
}

function hasExistingPoster(variants: Array<{ variant: 'preview' | 'display' | 'playback'; mime: string }>) {
  const preview = variants.find(({ variant }) => variant === 'preview')
  if (preview && !preview.mime.toLowerCase().startsWith('image/')) {
    throw new Error('Existing private video preview variant is not an image')
  }
  return Boolean(preview || variants.some(({ variant, mime }) => variant === 'display' && mime.toLowerCase().startsWith('image/')))
}

function cancelStorageRead(value: StorageObjectRead | null) {
  if (!value) return
  void value.body.cancel().catch(() => undefined)
}

function waitWithSignal<T>(operation: () => Promise<T>, signal: AbortSignal, onLateValue?: (value: T) => void): Promise<T> {
  signal.throwIfAborted()
  let aborted = false
  let abortListener: (() => void) | undefined
  const work = Promise.resolve().then(operation).then((value) => {
    if (aborted && onLateValue) void Promise.resolve(onLateValue(value)).catch(() => undefined)
    return value
  })
  const cancelled = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      aborted = true
      reject(new Error('Video poster operation aborted'))
    }
    signal.addEventListener('abort', abortListener, { once: true })
    if (signal.aborted) abortListener()
  })
  return Promise.race([work, cancelled]).finally(() => {
    if (abortListener) signal.removeEventListener('abort', abortListener)
  })
}

async function readBoundedStorageObject(
  storage: PrivateStorage,
  key: string,
  expectedMime: string,
  expectedLength: number,
  maxBytes: number,
  signal: AbortSignal,
) {
  const object = await waitWithSignal(() => storage.readObject({ key }), signal, cancelStorageRead)
  if (!object || object.contentLength !== expectedLength || object.contentType !== expectedMime || object.contentLength > maxBytes) {
    cancelStorageRead(object)
    throw new Error('Existing deterministic video poster has invalid storage metadata')
  }
  const reader = object.body.getReader()
  const chunks: Buffer[] = []
  let length = 0
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      const { done, value } = await waitWithSignal(() => reader.read(), signal)
      if (done) break
      length += value.byteLength
      if (length > maxBytes || length > expectedLength) throw new Error('Existing deterministic video poster exceeds its byte budget')
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
  if (length !== expectedLength) throw new Error('Existing deterministic video poster length does not match its storage metadata')
  return Buffer.concat(chunks, length)
}
