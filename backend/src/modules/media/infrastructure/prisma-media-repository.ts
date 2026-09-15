import type { MediaAssetDto, MediaVariant } from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import { insertTask } from '../../../outbox/store'
import type { FamilyScope } from '../../families'
import type {
  ContentObject,
  FinalizeCommit,
  FinalizePreparation,
  MediaRepository,
  PendingMediaUpload,
  StoredVariant,
} from '../application/ports'
import { MediaFailure } from '../domain/errors'

export class PrismaMediaRepository implements MediaRepository {
  constructor(private readonly db: DbClient) {}

  async reserve(input: PendingMediaUpload & { quotaBytes: number; maxPendingUploads: number; now: Date }) {
    await this.db.$transaction(async (tx) => {
      const family = await lockFamilyAndMember(tx, {
        principal: { userId: input.userId, sessionId: '' }, familyId: input.familyId,
      })
      if (!family) throw new MediaFailure('not_found', 'Семья не найдена')
      if (family.role !== 'full') throw new MediaFailure('forbidden', 'Для загрузки нужен полный доступ')
      const pending = await tx.uploadReservation.count({
        where: { familyId: input.familyId, releasedAt: null },
      })
      if (pending >= input.maxPendingUploads) {
        throw new MediaFailure('too_many_pending', 'Слишком много незавершённых загрузок')
      }
      if (family.used + family.reserved + BigInt(input.byteSize) > BigInt(input.quotaBytes)) {
        throw new MediaFailure('quota_exceeded', 'Лимит семейного архива исчерпан')
      }
      await tx.mediaAsset.create({
        data: {
          id: input.assetId,
          familyId: input.familyId,
          uploaderId: input.userId,
          sourceKind: input.sourceKind ?? 'upload',
          purpose: input.purpose,
          mediaKind: input.kind,
          originalKey: input.objectKey,
          declaredMime: input.declaredMime,
          byteSize: BigInt(input.byteSize),
        },
      })
      await tx.uploadReservation.create({
        data: {
          id: input.uploadId,
          familyId: input.familyId,
          userId: input.userId,
          mediaId: input.assetId,
          bytes: BigInt(input.byteSize),
          expiresAt: input.expiresAt,
        },
      })
      await tx.family.update({
        where: { id: input.familyId },
        data: { storageReservedBytes: { increment: BigInt(input.byteSize) } },
      })
    })
  }

  async findTrustedIngestion(scope: FamilyScope, assetId: string, sourceKind: 'telegram' | 'max'): Promise<FinalizePreparation | null> {
    const asset = await this.db.mediaAsset.findFirst({
      where: {
        id: assetId,
        familyId: scope.familyId,
        uploaderId: scope.principal.userId,
        sourceKind,
        purpose: 'memory',
      },
      include: { variants: true, reservation: true },
    })
    if (!asset) return null
    if (asset.originalStatus === 'stored' && !asset.deletedAt) {
      return { kind: 'ready', asset: assetDto(asset) }
    }
    if (asset.originalStatus !== 'pending' || asset.deletedAt || !asset.reservation || asset.reservation.releasedAt) {
      return { kind: 'expired' }
    }
    return { kind: 'pending', upload: pendingDto({ ...asset.reservation, asset }) }
  }

  async findTelegramIngestion(scope: FamilyScope, assetId: string) {
    return this.findTrustedIngestion(scope, assetId, 'telegram')
  }

  async discardTrustedSourceAssets(input: { sourceKind: 'telegram' | 'max'; assetIds: string[]; now: Date }) {
    const unique = [...new Set(input.assetIds)]
    if (unique.length === 0) return
    await this.db.$transaction(async (tx) => {
      const assets = await tx.mediaAsset.findMany({ where: {
        id: { in: unique }, sourceKind: input.sourceKind, purpose: 'memory', memories: { none: {} },
      }, select: { id: true, originalStatus: true } })
      for (const asset of assets) {
        if (asset.originalStatus === 'pending') await abandon(tx, asset.id, input.now)
        else if (asset.originalStatus === 'stored') {
          await tx.mediaAsset.updateMany({ where: { id: asset.id, deletedAt: null }, data: { deletedAt: input.now } })
          await insertTask(tx, { type: 'media:delete', dedupeKey: `media-delete:${asset.id}`, payload: { mediaId: asset.id }, scheduledFor: input.now })
        }
      }
    })
  }

  async prepareFinalize(scope: FamilyScope, uploadId: string, now: Date): Promise<FinalizePreparation> {
    return this.db.$transaction(async (tx) => {
      const reservation = await reservationFor(tx, scope, uploadId)
      if (!reservation) throw new MediaFailure('not_found', 'Загрузка не найдена')
      const access = await lockFamilyAndMember(tx, scope)
      if (!access || access.role !== 'full') {
        if (!reservation.finalizedAt) await abandon(tx, reservation.mediaId, now)
        return { kind: 'forbidden' }
      }
      if (reservation.finalizedAt) return { kind: 'ready', asset: assetDto(reservation.asset) }
      if (reservation.releasedAt || reservation.expiresAt.getTime() <= now.getTime()) {
        await abandon(tx, reservation.mediaId, now)
        return { kind: 'expired' }
      }
      return { kind: 'pending', upload: pendingDto(reservation) }
    })
  }

  async rejectUpload(scope: FamilyScope, uploadId: string, now: Date) {
    await this.db.$transaction(async (tx) => {
      const reservation = await reservationFor(tx, scope, uploadId)
      if (reservation && !reservation.releasedAt) await abandon(tx, reservation.mediaId, now)
    })
  }

  async commitFinalization(input: {
    scope: FamilyScope
    uploadId: string
    verifiedMime: string
    sha256: string
    width: number | null
    height: number | null
    durationMs: number | null
    waveform?: number[] | null
    renditionStatus: 'pending' | 'ready'
    variants: StoredVariant[]
    now: Date
  }): Promise<FinalizeCommit> {
    return this.db.$transaction(async (tx) => {
      const reservation = await reservationFor(tx, input.scope, input.uploadId)
      if (!reservation) throw new MediaFailure('not_found', 'Загрузка не найдена')
      const access = await lockFamilyAndMember(tx, input.scope)
      if (!access || access.role !== 'full') {
        if (!reservation.finalizedAt) await abandon(tx, reservation.mediaId, input.now)
        return { kind: 'forbidden' }
      }
      if (reservation.finalizedAt) return { kind: 'ready', asset: assetDto(reservation.asset) }
      if (reservation.releasedAt || reservation.expiresAt.getTime() <= input.now.getTime()) {
        await abandon(tx, reservation.mediaId, input.now)
        return { kind: 'expired' }
      }
      if (input.variants.length > 0) {
        await tx.mediaVariant.createMany({
          data: input.variants.map((variant) => ({
            familyId: input.scope.familyId,
            mediaId: reservation.mediaId,
            variant: variant.variant,
            objectKey: variant.objectKey,
            sha256: variant.sha256,
            byteSize: BigInt(variant.byteSize),
            mime: variant.mime,
            width: variant.width,
            height: variant.height,
            durationMs: variant.durationMs,
          })),
        })
      }
      await tx.mediaAsset.update({
        where: { id: reservation.mediaId },
        data: {
          verifiedMime: input.verifiedMime,
          sha256: input.sha256,
          width: input.width,
          height: input.height,
          durationMs: input.durationMs,
          waveform: input.waveform ?? undefined,
          originalStatus: 'stored',
          renditionStatus: input.renditionStatus,
        },
      })
      await tx.uploadReservation.update({
        where: { id: reservation.id },
        data: { finalizedAt: input.now, releasedAt: input.now },
      })
      await tx.family.update({
        where: { id: input.scope.familyId },
        data: {
          storageReservedBytes: { decrement: reservation.bytes },
          storageUsedBytes: { increment: reservation.bytes },
        },
      })
      if (reservation.asset.mediaKind === 'voice' || reservation.asset.mediaKind === 'video') {
        await insertTask(tx, {
          type: 'media:prepare', dedupeKey: `media-prepare:${reservation.mediaId}`,
          payload: { mediaId: reservation.mediaId }, scheduledFor: input.now,
        })
      }
      const ready = await tx.mediaAsset.findUniqueOrThrow({
        where: { id: reservation.mediaId }, include: { variants: true },
      })
      return { kind: 'ready', asset: assetDto(ready) }
    })
  }

  async readyForMemory(scope: FamilyScope, mediaIds: string[]) {
    const unique = [...new Set(mediaIds)]
    if (unique.length !== mediaIds.length) return false
    const count = await this.db.mediaAsset.count({
      where: {
        id: { in: unique }, familyId: scope.familyId, purpose: 'memory',
        originalStatus: 'stored', deletedAt: null, memories: { none: {} },
      },
    })
    return count === unique.length
  }

  async resolveContent(scope: FamilyScope, mediaId: string, variant: MediaVariant): Promise<ContentObject | null> {
    const asset = await this.db.mediaAsset.findFirst({
      where: {
        id: mediaId,
        familyId: scope.familyId,
        originalStatus: 'stored',
        deletedAt: null,
        OR: [
          { purpose: 'memory', memories: { some: { memory: { status: 'published', deletedAt: null } } } },
          { telegramVideoThumbnailFor: { memory: { status: 'published', deletedAt: null } } },
          { purpose: 'child_avatar', avatarForChildren: { some: { familyId: scope.familyId } } },
        ],
      },
      include: { variants: true },
    })
    if (!asset) return null
    if (variant === 'original') {
      return { objectKey: asset.originalKey, contentType: asset.verifiedMime!, contentLength: Number(asset.byteSize) }
    }
    const stored = asset.variants.find((candidate) => candidate.variant === variant)
    return stored
      ? { objectKey: stored.objectKey, contentType: stored.mime, contentLength: Number(stored.byteSize) }
      : null
  }
}

async function reservationFor(tx: PrismaTransactionClient, scope: FamilyScope, uploadId: string) {
  return tx.uploadReservation.findFirst({
    where: { id: uploadId, familyId: scope.familyId, userId: scope.principal.userId },
    include: { asset: { include: { variants: true } } },
  })
}

async function lockFamilyAndMember(tx: PrismaTransactionClient, scope: FamilyScope) {
  const rows = await tx.$queryRaw<Array<{
    role: 'full' | 'viewer'
    used: bigint
    reserved: bigint
  }>>`
    SELECT fm.role::text AS role,
           f.storage_used_bytes AS used,
           f.storage_reserved_bytes AS reserved
      FROM families f
      JOIN family_members fm ON fm.family_id = f.id
     WHERE f.id = ${scope.familyId}::uuid
       AND fm.user_id = ${scope.principal.userId}::uuid
       AND fm.revoked_at IS NULL
       AND f.status = 'active'
     FOR UPDATE OF f, fm
  `
  return rows[0] ?? null
}

async function abandon(tx: PrismaTransactionClient, mediaId: string, now: Date) {
  const reservation = await tx.uploadReservation.findFirst({ where: { mediaId } })
  if (reservation && !reservation.releasedAt) {
    const released = await tx.uploadReservation.updateMany({
      where: { id: reservation.id, releasedAt: null }, data: { releasedAt: now },
    })
    if (released.count === 1) {
      await tx.family.update({ where: { id: reservation.familyId },
        data: { storageReservedBytes: { decrement: reservation.bytes } } })
    }
  }
  await tx.mediaAsset.updateMany({
    where: { id: mediaId, deletedAt: null, originalStatus: 'pending' },
    data: { deletedAt: now, originalStatus: 'failed', renditionStatus: 'failed' },
  })
  await insertTask(tx, {
    type: 'media:delete', dedupeKey: `media-delete:${mediaId}`, payload: { mediaId }, scheduledFor: now,
  })
}

function pendingDto(reservation: Awaited<ReturnType<typeof reservationFor>> & {}) : PendingMediaUpload {
  if (!reservation) throw new Error('Reservation is required')
  return {
    uploadId: reservation.id,
    assetId: reservation.mediaId,
    familyId: reservation.familyId,
    userId: reservation.userId,
    purpose: reservation.asset.purpose,
    kind: reservation.asset.mediaKind,
    objectKey: reservation.asset.originalKey,
    declaredMime: reservation.asset.declaredMime as PendingMediaUpload['declaredMime'],
    byteSize: Number(reservation.bytes),
    expiresAt: reservation.expiresAt,
  }
}

function assetDto(asset: {
  id: string
  familyId: string
  purpose: 'memory' | 'child_avatar'
  mediaKind: 'photo' | 'video' | 'voice'
  originalStatus: 'pending' | 'stored' | 'failed'
  renditionStatus: 'pending' | 'ready' | 'failed'
  width: number | null
  height: number | null
  durationMs: number | null
  waveform: unknown
  variants: Array<{ variant: 'preview' | 'display' | 'playback' }>
}): MediaAssetDto {
  const path = (variant: MediaVariant) =>
    `/api/v1/families/${asset.familyId}/media/${asset.id}/content?variant=${variant}`
  const variants = new Set(asset.variants.map(({ variant }) => variant))
  return {
    id: asset.id,
    purpose: asset.purpose,
    kind: asset.mediaKind,
    originalStatus: asset.originalStatus,
    renditionStatus: asset.renditionStatus,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    waveform: Array.isArray(asset.waveform) && asset.waveform.length === 48 && asset.waveform.every((peak) => typeof peak === 'number')
      ? asset.waveform as number[] : null,
    previewPath: variants.has('preview') ? path('preview') : null,
    displayPath: variants.has('display') ? path('display') : null,
    playbackPath: variants.has('playback') ? path('playback') : null,
    originalDownloadPath: path('original'),
  }
}
