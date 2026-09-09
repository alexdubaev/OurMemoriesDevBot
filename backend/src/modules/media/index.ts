import type { MiddlewareHandler } from 'hono'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { PrivateStorage } from '../../storage'
import type { AuthHttpEnv } from '../auth'
import type { FamilyAccess } from '../families'
import { MediaService } from './application/media-service'
import { PrismaMediaRepository } from './infrastructure/prisma-media-repository'
import { processPhoto } from './infrastructure/photo-processor'
import { probeMedia } from './infrastructure/media-probe'
import { createMediaRoutes } from './transport/routes'

export function createMediaModule(options: { db: DbClient; env: AppEnv; familyAccess: FamilyAccess;
  requireAuth: MiddlewareHandler<AuthHttpEnv>; storage: PrivateStorage }) {
  const repository = new PrismaMediaRepository(options.db)
  const service = new MediaService(options.familyAccess, repository, options.storage, {
    familyQuotaBytes: options.env.MEDIA_FAMILY_QUOTA_BYTES,
    maxPendingUploads: options.env.MEDIA_MAX_PENDING_UPLOADS,
    reservationTtlSeconds: options.env.MEDIA_RESERVATION_TTL_SECONDS,
    uploadUrlTtlSeconds: options.env.MEDIA_UPLOAD_URL_TTL_SECONDS,
  }, processPhoto, probeMedia)
  return { routes: createMediaRoutes({ requireAuth: options.requireAuth, service }), service }
}

export function createMediaTasks(runtime: { prisma: DbClient; privateStorage: { storage: PrivateStorage } }) {
  return {
    async deleteAsset({ mediaId }: { mediaId: string }) {
      const asset = await runtime.prisma.mediaAsset.findUnique({ where: { id: mediaId }, include: { variants: true } })
      if (!asset || asset.storageDeletedAt || !asset.deletedAt) return
      for (const key of [asset.originalKey, ...asset.variants.map(({ objectKey }) => objectKey)]) {
        await runtime.privateStorage.storage.deleteObject(key)
      }
      await runtime.prisma.$transaction(async (tx) => {
        const marked = await tx.mediaAsset.updateMany({ where: { id: mediaId, storageDeletedAt: null }, data: { storageDeletedAt: new Date() } })
        if (marked.count === 1 && asset.originalStatus === 'stored') {
          await tx.family.update({ where: { id: asset.familyId }, data: { storageUsedBytes: { decrement: asset.byteSize } } })
        }
      })
    },
  }
}
