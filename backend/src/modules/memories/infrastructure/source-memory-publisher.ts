import type { MemoryKind } from '../../../generated/prisma/enums'
import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'
import { allocatePublicationOrdinal, firstPublicationTime, lockPublicationFamily } from './publication-boundary'

export type SourceMemoryInput = {
  id: string
  childId: string
  kind: MemoryKind
  body: string
  occurredAt: Date
  mediaIds: string[]
  /** Trusted source/provider publication instant. Never accepted by the HTTP create/edit DTO. */
  sourcePublishedAt?: Date
  externalAttachment?: 'max-video' | 'telegram-video'
}

type AfterMemoryWrite = (tx: PrismaTransactionClient, memoryId: string) => Promise<void>

/** Trusted adapter boundary: fixed ids make a crash between publication and source bookkeeping
 * replay-safe, while the same family/media invariants as the HTTP service stay enforced. */
export function createSourceMemoryPublisher(db: DbClient, access: FamilyAccess) {
  return {
    async publish(scope: FamilyScope, input: SourceMemoryInput, afterWrite?: AfterMemoryWrite) {
      await access.requireFull(scope)
      validateAttachmentShape(input)
      return db.$transaction(async (tx) => {
        const publication = await lockFullMember(tx, scope)
        const existing = await tx.memory.findUnique({
          where: { id: input.id },
          select: { id: true, familyId: true, childId: true, authorId: true, kind: true, status: true, deletedAt: true,
            firstPublishedAt: true, sourcePublishedAt: true,
            media: { orderBy: { position: 'asc' }, select: { mediaId: true } } },
        })
        if (existing) {
          if (existing.familyId !== scope.familyId) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
          if (existing.deletedAt || existing.status === 'deleted') throw new MemoryFailure('not_found', 'Воспоминание не найдено')
          if (existing.childId !== input.childId || existing.kind !== input.kind || existing.authorId !== scope.principal.userId) {
            throw new MemoryFailure('invalid_input', 'Источник не соответствует сохранённому воспоминанию')
          }
          if (existing.sourcePublishedAt && input.sourcePublishedAt && existing.sourcePublishedAt.getTime() !== input.sourcePublishedAt.getTime()) {
            throw new MemoryFailure('invalid_input', 'Источник не соответствует сохранённому времени публикации')
          }
          await lockMediaAssetsForUpdate(tx, scope.familyId, input.mediaIds)
          await reconcileOrderedMedia(tx, scope.familyId, existing.id, existing.kind, existing.media.map(({ mediaId }) => mediaId), input.mediaIds)
          if (existing.status !== 'published') {
            const firstPublishedOrdinal = await allocatePublicationOrdinal(tx, scope.familyId, publication.trackingActivated)
            await tx.memory.update({ where: { id: existing.id }, data: { status: 'published', firstPublishedOrdinal,
              firstPublishedAt: firstPublicationTime(), ...(existing.sourcePublishedAt === null && input.sourcePublishedAt ? { sourcePublishedAt: input.sourcePublishedAt } : {}) } })
          } else if (existing.sourcePublishedAt === null && input.sourcePublishedAt) {
            // Existing published legacy rows can only receive source time through their trusted source boundary.
            // The DB trigger keeps the value immutable once assigned.
            await tx.memory.update({ where: { id: existing.id }, data: { sourcePublishedAt: input.sourcePublishedAt } })
          }
          await afterWrite?.(tx, existing.id)
          return existing.id
        }
        const child = await tx.child.findFirst({ where: { id: input.childId, familyId: scope.familyId }, select: { id: true } })
        if (!child) throw new MemoryFailure('not_found', 'Профиль ребёнка не найден')
        validateAttachmentShape(input)
        if (input.mediaIds.length) await lockMediaAssetsForUpdate(tx, scope.familyId, input.mediaIds)
        if (input.mediaIds.length && !(await readyMediaCount(tx, scope.familyId, input.mediaIds, input.kind))) {
          throw new MemoryFailure('not_found', 'Медиа недоступно для публикации')
        }
        const firstPublishedOrdinal = await allocatePublicationOrdinal(tx, scope.familyId, publication.trackingActivated)
        await tx.memory.create({ data: {
          id: input.id, familyId: scope.familyId, childId: input.childId,
          authorId: scope.principal.userId, kind: input.kind, body: input.body, occurredAt: input.occurredAt,
          firstPublishedOrdinal, firstPublishedAt: firstPublicationTime(), sourcePublishedAt: input.sourcePublishedAt,
        } })
        if (input.mediaIds.length > 0) await tx.memoryMedia.createMany({ data: input.mediaIds.map((mediaId, position) => ({
          familyId: scope.familyId, memoryId: input.id, mediaId, position,
        })) })
        await afterWrite?.(tx, input.id)
        return input.id
      })
    },

    async replaceOrderedMedia(scope: FamilyScope, memoryId: string, mediaIds: string[], afterWrite?: AfterMemoryWrite) {
      await access.requireFull(scope)
      return db.$transaction(async (tx) => {
        await lockFullMember(tx, scope)
        const memory = await tx.memory.findFirst({ where: { id: memoryId, familyId: scope.familyId, deletedAt: null }, select: { id: true, kind: true } })
        if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
        validateAttachmentShape({ kind: memory.kind, mediaIds })
        const linked = await tx.memoryMedia.findMany({ where: { memoryId, familyId: scope.familyId }, orderBy: { position: 'asc' }, select: { mediaId: true } })
        await reconcileOrderedMedia(tx, scope.familyId, memoryId, memory.kind, linked.map(({ mediaId }) => mediaId), mediaIds)
        await afterWrite?.(tx, memoryId)
        return memoryId
      })
    },
  }
}

async function reconcileOrderedMedia(
  tx: PrismaTransactionClient,
  familyId: string,
  memoryId: string,
  memoryKind: MemoryKind,
  linkedIds: string[],
  mediaIds: string[],
) {
  await lockMediaAssetsForUpdate(tx, familyId, mediaIds)
  const newlyAttached = mediaIds.filter((id) => !linkedIds.includes(id))
  if (!(await readyMediaCount(tx, familyId, newlyAttached, memoryKind))) {
    throw new MemoryFailure('not_found', 'Медиа недоступно для публикации')
  }
  if (linkedIds.length === mediaIds.length && linkedIds.every((id, index) => id === mediaIds[index])) return
  await tx.memoryMedia.deleteMany({ where: { memoryId, familyId } })
  if (mediaIds.length > 0) await tx.memoryMedia.createMany({
    data: mediaIds.map((mediaId, position) => ({ familyId, memoryId, mediaId, position })),
  })
  await tx.memory.update({ where: { id: memoryId }, data: { version: { increment: 1 } } })
}

async function readyMediaCount(
  tx: Pick<PrismaTransactionClient, 'mediaAsset'>,
  familyId: string,
  mediaIds: string[],
  memoryKind: MemoryKind,
) {
  const unique = [...new Set(mediaIds)]
  if (unique.length !== mediaIds.length) return false
  if (unique.length === 0) return true
  const expectedKinds = memoryKind === 'media' ? ['photo', 'video'] : [memoryKind]
  if (memoryKind === 'note' || memoryKind === 'video' && mediaIds.length !== 1 || memoryKind === 'voice' && mediaIds.length !== 1 ||
      memoryKind === 'media' && (mediaIds.length < 1 || mediaIds.length > 10) || memoryKind === 'photo' && (mediaIds.length < 1 || mediaIds.length > 10)) return false
  const assets = await tx.mediaAsset.findMany({ where: {
    id: { in: unique }, familyId, purpose: 'memory', originalStatus: 'stored', deletedAt: null,
    memories: { none: {} },
  }, select: { mediaKind: true } })
  return assets.length === unique.length && assets.every(({ mediaKind }) => expectedKinds.includes(mediaKind))
}

function validateAttachmentShape(input: Pick<SourceMemoryInput, 'kind' | 'mediaIds' | 'externalAttachment'>) {
  const count = input.mediaIds.length
  const valid = input.kind === 'note' ? count === 0
    : input.kind === 'media' ? count >= 1 && count <= 10
      : input.kind === 'photo' ? count >= 1 && count <= 10
        : input.kind === 'video' ? count === 1 || (count === 0 && (input.externalAttachment === 'max-video' || input.externalAttachment === 'telegram-video'))
          : count === 1
  if (!valid || new Set(input.mediaIds).size !== count) throw new MemoryFailure('invalid_input', 'Неподходящий состав вложений')
}

async function lockMediaAssetsForUpdate(tx: Pick<PrismaTransactionClient, '$queryRaw'>, familyId: string, mediaIds: string[]) {
  const unique = [...new Set(mediaIds)].sort()
  if (unique.length === 0) return
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM media_assets
     WHERE family_id = ${familyId}::uuid
       AND id IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))})
     ORDER BY id FOR UPDATE
  `)
}

async function lockFullMember(tx: PrismaTransactionClient, scope: FamilyScope) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${scope.principal.userId}::uuid FOR UPDATE`
  const family = await lockPublicationFamily(tx, scope.familyId)
  const rows = await tx.$queryRaw<Array<{ role: string }>>`
    SELECT fm.role::text AS role
      FROM family_members fm
     WHERE fm.family_id = ${scope.familyId}::uuid
       AND fm.user_id = ${scope.principal.userId}::uuid
       AND fm.revoked_at IS NULL
     FOR SHARE OF fm
  `
  if (!rows[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
  if (rows[0].role !== 'full') throw new MemoryFailure('forbidden', 'Для этого действия нужен полный доступ')
  return family
}
