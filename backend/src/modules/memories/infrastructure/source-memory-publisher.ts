import type { MemoryKind } from '../../../generated/prisma/enums'
import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'
import { allocatePublicationOrdinal, firstPublicationTime, lockPublicationFamily } from './publication-boundary'
import { insertPublicationChildTags, removeDetachedAttachmentTags, resolveCreationChildTags } from './child-tags'
import { enqueuePilotNotification, type MaxNotificationPilot } from '../../../max-notifications-pilot'

export type SourceMemoryInput = {
  id: string
  /** @deprecated Legacy bot/upload target. Ignored: the anchor and tags follow `resolveCreationChildTags`. */
  childId?: string
  /** Explicit whole-publication tags; absent applies the default rule (only child, else none). */
  childIds?: string[]
  kind: MemoryKind
  body: string
  occurredAt: Date
  mediaIds: string[]
  /** Trusted MAX source adapter positions for private media, parallel to mediaIds. */
  mediaPositions?: number[]
  /** Trusted MAX source adapter positions occupied by provider video references. */
  externalVideoPositions?: number[]
  /** Trusted source/provider publication instant. Never accepted by the HTTP create/edit DTO. */
  sourcePublishedAt?: Date
  externalAttachment?: 'max-video' | 'telegram-video'
}

type AfterMemoryWrite = (tx: PrismaTransactionClient, memoryId: string) => Promise<void>

/** Trusted adapter boundary: fixed ids make a crash between publication and source bookkeeping
 * replay-safe, while the same family/media invariants as the HTTP service stay enforced. */
export function createSourceMemoryPublisher(db: DbClient, access: FamilyAccess, notificationPilot?: MaxNotificationPilot) {
  return {
    async publish(scope: FamilyScope, input: SourceMemoryInput, afterWrite?: AfterMemoryWrite) {
      await access.requireFull(scope)
      validateAttachmentShape(input)
      if (input.externalVideoPositions?.length && !afterWrite) {
        throw new MemoryFailure('invalid_input', 'Видеоссылки источника не подтверждены')
      }
      return db.$transaction(async (tx) => {
        const publication = await lockFullMember(tx, scope)
        const existing = await tx.memory.findUnique({
          where: { id: input.id },
          select: { id: true, familyId: true, authorId: true, kind: true, status: true, deletedAt: true,
            firstPublishedAt: true, sourcePublishedAt: true,
            media: { orderBy: { position: 'asc' }, select: { mediaId: true, position: true } } },
        })
        if (existing) {
          if (existing.familyId !== scope.familyId) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
          if (existing.deletedAt || existing.status === 'deleted') throw new MemoryFailure('not_found', 'Воспоминание не найдено')
          // Replays keep their original anchor and tags; the anchor is not part of the source identity.
          if (existing.kind !== input.kind || existing.authorId !== scope.principal.userId) {
            throw new MemoryFailure('invalid_input', 'Источник не соответствует сохранённому воспоминанию')
          }
          if (existing.sourcePublishedAt && input.sourcePublishedAt && existing.sourcePublishedAt.getTime() !== input.sourcePublishedAt.getTime()) {
            throw new MemoryFailure('invalid_input', 'Источник не соответствует сохранённому времени публикации')
          }
          await lockMediaAssetsForUpdate(tx, scope.familyId, input.mediaIds)
          await reconcileOrderedMedia(tx, scope.familyId, existing.id, existing.kind,
            existing.media.map(({ mediaId, position }) => ({ mediaId, position })), orderedMedia(input), input.mediaIds)
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
          if (existing.status !== 'published' && existing.firstPublishedAt === null) {
            await enqueuePilotNotification(tx, notificationPilot, { kind: 'feed', familyId: scope.familyId, memoryId: existing.id })
          }
          return existing.id
        }
        const childTags = await resolveCreationChildTags(tx, scope.familyId, input.childIds)
        validateAttachmentShape(input)
        if (input.mediaIds.length) await lockMediaAssetsForUpdate(tx, scope.familyId, input.mediaIds)
        if (input.mediaIds.length && !(await readyMediaCount(tx, scope.familyId, input.mediaIds, input.kind))) {
          throw new MemoryFailure('not_found', 'Медиа недоступно для публикации')
        }
        const firstPublishedOrdinal = await allocatePublicationOrdinal(tx, scope.familyId, publication.trackingActivated)
        await tx.memory.create({ data: {
          id: input.id, familyId: scope.familyId, childId: childTags.anchorChildId,
          authorId: scope.principal.userId, kind: input.kind, body: input.body, occurredAt: input.occurredAt,
          firstPublishedOrdinal, firstPublishedAt: firstPublicationTime(), sourcePublishedAt: input.sourcePublishedAt,
        } })
        await insertPublicationChildTags(tx, {
          familyId: scope.familyId, memoryId: input.id, createdBy: scope.principal.userId, childIds: childTags.childIds,
        })
        if (input.mediaIds.length > 0) await tx.memoryMedia.createMany({ data: input.mediaIds.map((mediaId, index) => ({
          familyId: scope.familyId, memoryId: input.id, mediaId, position: input.mediaPositions?.[index] ?? index,
        })) })
        await afterWrite?.(tx, input.id)
        await enqueuePilotNotification(tx, notificationPilot, { kind: 'feed', familyId: scope.familyId, memoryId: input.id })
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
        const linked = await tx.memoryMedia.findMany({ where: { memoryId, familyId: scope.familyId }, orderBy: { position: 'asc' }, select: { mediaId: true, position: true } })
        await reconcileOrderedMedia(tx, scope.familyId, memoryId, memory.kind,
          linked.map(({ mediaId, position }) => ({ mediaId, position })), mediaIds.map((mediaId, position) => ({ mediaId, position })), mediaIds)
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
  linked: Array<{ mediaId: string; position: number }>,
  desired: Array<{ mediaId: string; position: number }>,
  mediaIds: string[],
) {
  await lockMediaAssetsForUpdate(tx, familyId, mediaIds)
  const linkedIds = linked.map(({ mediaId }) => mediaId)
  const newlyAttached = mediaIds.filter((id) => !linkedIds.includes(id))
  if (!(await readyMediaCount(tx, familyId, newlyAttached, memoryKind))) {
    throw new MemoryFailure('not_found', 'Медиа недоступно для публикации')
  }
  if (linked.length === desired.length && linked.every(({ mediaId, position }, index) =>
    mediaId === desired[index]?.mediaId && position === desired[index]?.position)) return
  await tx.memoryMedia.deleteMany({ where: { memoryId, familyId } })
  if (desired.length > 0) await tx.memoryMedia.createMany({
    data: desired.map(({ mediaId, position }) => ({ familyId, memoryId, mediaId, position })),
  })
  await removeDetachedAttachmentTags(tx, { familyId, memoryId, attachmentIds: linkedIds.filter((id) => !mediaIds.includes(id)) })
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
    memories: { none: {} }, albumPhoto: { is: null },
  }, select: { mediaKind: true } })
  return assets.length === unique.length && assets.every(({ mediaKind }) => expectedKinds.includes(mediaKind))
}

function orderedMedia(input: SourceMemoryInput) {
  return input.mediaIds.map((mediaId, index) => ({ mediaId, position: input.mediaPositions?.[index] ?? index }))
}

function validateAttachmentShape(input: Pick<SourceMemoryInput, 'kind' | 'mediaIds' | 'externalAttachment' | 'mediaPositions' | 'externalVideoPositions'>) {
  const count = input.mediaIds.length
  const mediaPositions = input.mediaPositions ?? input.mediaIds.map((_, index) => index)
  const externalVideoPositions = input.externalVideoPositions ?? []
  if ((input.mediaPositions !== undefined || externalVideoPositions.length > 0) && input.kind !== 'media') {
    throw new MemoryFailure('invalid_input', 'Неподходящий состав вложений')
  }
  if (mediaPositions.length !== count || mediaPositions.some((position) => !Number.isInteger(position) || position < 0) ||
      externalVideoPositions.some((position) => !Number.isInteger(position) || position < 0)) {
    throw new MemoryFailure('invalid_input', 'Неподходящий состав вложений')
  }
  const positions = [...mediaPositions, ...externalVideoPositions]
  if (input.mediaPositions !== undefined || externalVideoPositions.length > 0) {
    const sorted = [...positions].sort((a, b) => a - b)
    if (sorted.length < 1 || sorted.length > 10 || new Set(sorted).size !== sorted.length || sorted.some((position, index) => position !== index)) {
      throw new MemoryFailure('invalid_input', 'Неподходящий состав вложений')
    }
  }
  const logicalCount = positions.length
  const valid = input.kind === 'note' ? count === 0
    : input.kind === 'media' ? (input.externalVideoPositions?.length ? logicalCount >= 1 && logicalCount <= 10 : count >= 1 && count <= 10)
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
