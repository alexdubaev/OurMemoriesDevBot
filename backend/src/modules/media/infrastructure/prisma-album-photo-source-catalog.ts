import { mediaDtoSchema } from '@web-app-demo/contracts'
import { Prisma } from '../../../generated/prisma/client'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyScope } from '../../families'
import type { AlbumPhotoSourceCatalog, AlbumPhotoSourceProjection } from '../application/ports'
import { MediaFailure } from '../domain/errors'

const photoInclude = { variants: { select: { variant: true } } } as const

export function createPrismaAlbumPhotoSourceCatalog(): AlbumPhotoSourceCatalog {
  return {
    async claim(tx, scope, mediaIds) {
      const ids = [...new Set(mediaIds)].sort()
      if (ids.length !== mediaIds.length) throw unavailable()
      if (!ids.length) return []
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM media_assets
         WHERE family_id = ${scope.familyId}::uuid
           AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
         ORDER BY id FOR UPDATE
      `)
      if (rows.length !== ids.length) throw unavailable()
      const assets = await tx.mediaAsset.findMany({
        where: { id: { in: ids }, familyId: scope.familyId },
        include: photoInclude,
      })
      const byId = new Map(assets.map((asset) => [asset.id, asset]))
      const existing = await tx.albumPhoto.findMany({ where: { mediaId: { in: ids }, familyId: scope.familyId }, select: { mediaId: true } })
      const registered = new Set(existing.map(({ mediaId }) => mediaId))
      for (const id of ids) {
        const asset = byId.get(id)
        if (!asset || !isReadyAlbumPhoto(asset)) throw unavailable()
        if (!registered.has(id)) {
          if (asset.uploaderId !== scope.principal.userId || await tx.memoryMedia.findFirst({ where: { mediaId: id, familyId: scope.familyId }, select: { mediaId: true } })) throw unavailable()
          await tx.albumPhoto.create({ data: { mediaId: id, familyId: scope.familyId } })
        }
      }
      return ids.map((id) => projectAsset(byId.get(id)! as Parameters<typeof projectAsset>[0], scope.familyId))
    },
    async project(tx, scope, mediaIds) {
      const ids = [...new Set(mediaIds)].sort()
      if (!ids.length) return []
      const rows = await tx.albumPhoto.findMany({
        where: { mediaId: { in: ids }, familyId: scope.familyId },
        include: { media: { include: photoInclude } },
      })
      const byId = new Map(rows.map((row) => [row.mediaId, row.media]))
      return ids.map((id) => {
        const asset = byId.get(id)
        return asset && isReadyAlbumPhoto(asset) ? projectAsset(asset as Parameters<typeof projectAsset>[0], scope.familyId) : unavailableProjection(id, scope.familyId)
      })
    },
  }
}

function isReadyAlbumPhoto(asset: { purpose: string; sourceKind: string; mediaKind: string; originalStatus: string; renditionStatus: string; deletedAt: Date | null; storageDeletedAt: Date | null } | undefined): boolean {
  return Boolean(asset && asset.purpose === 'memory' && asset.sourceKind === 'upload' && asset.mediaKind === 'photo' &&
    asset.originalStatus === 'stored' && asset.renditionStatus === 'ready' && asset.deletedAt === null && asset.storageDeletedAt === null)
}

function projectAsset(asset: {
  id: string; familyId: string; mediaKind: 'photo'; purpose: 'memory'; width: number | null; height: number | null;
  durationMs: number | null; renditionStatus: 'ready'; waveform: unknown; variants: Array<{ variant: string }>
}, familyId: string): AlbumPhotoSourceProjection {
  const variants = new Set(asset.variants.map(({ variant }) => variant))
  const path = (variant: string) => `/api/v1/families/${familyId}/media/${asset.id}/content?variant=${variant}`
  return {
    mediaId: asset.id, familyId, kind: 'photo', available: true, occurredAt: null,
    attachment: mediaDtoSchema.parse({
      id: asset.id, source: 'private_storage', kind: 'photo', width: asset.width, height: asset.height,
      durationMs: asset.durationMs, renditionStatus: 'ready', previewPath: variants.has('preview') ? path('preview') : null,
      displayPath: variants.has('display') ? path('display') : null, playbackPath: null,
      originalDownloadPath: path('original'), waveform: null,
    }),
  }
}

function unavailableProjection(mediaId: string, familyId: string): AlbumPhotoSourceProjection {
  return { mediaId, familyId, kind: 'photo', available: false, attachment: null, occurredAt: null }
}

function unavailable(): Error { return new MediaFailure('not_found', 'Фото недоступно') }
