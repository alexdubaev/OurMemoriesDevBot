import type { MiddlewareHandler } from 'hono'
import { createHash } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { PrivateStorage } from '../../storage'
import type { AuthenticatedPrincipal, AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { MediaService } from './application/media-service'
export { MediaFailure } from './domain/errors'
import { PrismaMediaRepository } from './infrastructure/prisma-media-repository'
import { processPhoto } from './infrastructure/photo-processor'
import { probeMediaWithRunner } from './infrastructure/media-probe'
import { assertFfmpegCapabilities, createFfmpegRunner } from './infrastructure/ffmpeg-runner'
import { prepareMedia } from './infrastructure/media-processor'
import { createMediaRoutes } from './transport/routes'

export function createMediaModule(options: { db: DbClient; env: AppEnv; familyAccess: FamilyAccess;
  authenticateMediaAccess: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  requireAuth: MiddlewareHandler<AuthHttpEnv>; storage: PrivateStorage }) {
  const service = createMediaService(options)
  return { routes: createMediaRoutes({ authenticateMediaAccess: options.authenticateMediaAccess, cookieSecure: options.env.COOKIE_SECURE, requireAuth: options.requireAuth, service }), service }
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
  env: Pick<AppEnv, 'FFMPEG_PATH' | 'FFPROBE_PATH'> }) {
  return {
    async deleteAsset({ mediaId }: { mediaId: string }) {
      const asset = await runtime.prisma.mediaAsset.findUnique({ where: { id: mediaId }, include: { variants: true } })
      if (!asset || asset.storageDeletedAt || !asset.deletedAt) return
      const keys = [asset.originalKey, ...asset.variants.map(({ objectKey }) => objectKey)]
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
  }
}
