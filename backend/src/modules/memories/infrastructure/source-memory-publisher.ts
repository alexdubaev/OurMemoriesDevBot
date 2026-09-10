import type { MemoryKind } from '../../../generated/prisma/enums'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'

export type SourceMemoryInput = {
  id: string
  childId: string
  kind: MemoryKind
  body: string
  occurredAt: Date
  mediaIds: string[]
}

/** Trusted adapter boundary: fixed ids make a crash between publication and source bookkeeping
 * replay-safe, while the same family/media invariants as the HTTP service stay enforced. */
export function createSourceMemoryPublisher(db: DbClient, access: FamilyAccess) {
  return {
    async publish(scope: FamilyScope, input: SourceMemoryInput) {
      await access.requireFull(scope)
      return db.$transaction(async (tx) => {
        await lockFullMember(tx, scope)
        const existing = await tx.memory.findUnique({ where: { id: input.id }, select: { id: true, familyId: true } })
        if (existing) {
          if (existing.familyId !== scope.familyId) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
          return existing.id
        }
        const child = await tx.child.findFirst({ where: { id: input.childId, familyId: scope.familyId }, select: { id: true } })
        if (!child) throw new MemoryFailure('not_found', 'Профиль ребёнка не найден')
        if (input.kind === 'note' && input.mediaIds.length !== 0) throw new MemoryFailure('invalid_input', 'У заметки не бывает вложений')
        if (input.kind !== 'note' && !(await readyMediaCount(tx, scope.familyId, input.mediaIds))) {
          throw new MemoryFailure('not_found', 'Медиа недоступно для публикации')
        }
        await tx.memory.create({ data: {
          id: input.id, familyId: scope.familyId, childId: input.childId,
          authorId: scope.principal.userId, kind: input.kind, body: input.body, occurredAt: input.occurredAt,
        } })
        if (input.mediaIds.length > 0) await tx.memoryMedia.createMany({ data: input.mediaIds.map((mediaId, position) => ({
          familyId: scope.familyId, memoryId: input.id, mediaId, position,
        })) })
        return input.id
      })
    },

    async replaceOrderedMedia(scope: FamilyScope, memoryId: string, mediaIds: string[]) {
      await access.requireFull(scope)
      return db.$transaction(async (tx) => {
        await lockFullMember(tx, scope)
        const memory = await tx.memory.findFirst({ where: { id: memoryId, familyId: scope.familyId, deletedAt: null }, select: { id: true } })
        if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
        const linked = await tx.memoryMedia.findMany({ where: { memoryId, familyId: scope.familyId }, select: { mediaId: true } })
        const newlyAttached = mediaIds.filter((id) => !linked.some(({ mediaId }) => mediaId === id))
        if (!(await readyMediaCount(tx, scope.familyId, newlyAttached))) throw new MemoryFailure('not_found', 'Медиа недоступно для публикации')
        await tx.memoryMedia.deleteMany({ where: { memoryId, familyId: scope.familyId } })
        await tx.memoryMedia.createMany({ data: mediaIds.map((mediaId, position) => ({ familyId: scope.familyId, memoryId, mediaId, position })) })
        await tx.memory.update({ where: { id: memoryId }, data: { version: { increment: 1 } } })
        return memoryId
      })
    },
  }
}

async function readyMediaCount(
  tx: Pick<PrismaTransactionClient, 'mediaAsset'>,
  familyId: string,
  mediaIds: string[],
) {
  const unique = [...new Set(mediaIds)]
  if (unique.length !== mediaIds.length) return false
  if (unique.length === 0) return true
  return (await tx.mediaAsset.count({ where: {
    id: { in: unique }, familyId, purpose: 'memory', originalStatus: 'stored', deletedAt: null,
    memories: { none: {} },
  } })) === unique.length
}

async function lockFullMember(tx: PrismaTransactionClient, scope: FamilyScope) {
  const rows = await tx.$queryRaw<Array<{ role: string }>>`
    SELECT fm.role::text AS role
      FROM family_members fm
      JOIN families f ON f.id = fm.family_id
     WHERE fm.family_id = ${scope.familyId}::uuid
       AND fm.user_id = ${scope.principal.userId}::uuid
       AND fm.revoked_at IS NULL
       AND f.status = 'active'
     FOR SHARE OF fm, f
  `
  if (!rows[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
  if (rows[0].role !== 'full') throw new MemoryFailure('forbidden', 'Для этого действия нужен полный доступ')
}
