import {
  avatarCropSchema,
  type CommentDto,
  type CommentSummary,
  type CreateCommentRequest,
} from '@web-app-demo/contracts'
import type { DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import type {
  IdempotencyExecutor,
  PrismaTransactionClient,
} from '../../../idempotency'
import type { FamilyScope } from '../../families'
import type {
  CommentPosition,
  CommentRepository,
} from '../application/comment-ports'
import { MemoryFailure } from '../domain/errors'

type CommentRow = {
  id: string
  familyId: string
  memoryId: string
  authorId: string
  body: string
  createdAt: Date
  updatedAt: Date
  version: number
}
const missing = () =>
  new MemoryFailure('not_found', 'Семья или публикация недоступна')
const conflict = () =>
  new MemoryFailure(
    'idempotency_conflict',
    'Этот Idempotency-Key уже использован или комментарий удалён',
  )
const versionConflict = () =>
  new MemoryFailure('version_conflict', 'Комментарий был изменён или удалён')
function assertMutationPermission(authorId: string, scope: FamilyScope, familyOwnerId: string) {
  if (authorId !== scope.principal.userId && familyOwnerId !== scope.principal.userId)
    throw new MemoryFailure('forbidden', 'Недостаточно прав для изменения комментария')
}

export class PrismaCommentRepository implements CommentRepository {
  constructor(
    private readonly db: DbClient,
    private readonly idempotency: IdempotencyExecutor<PrismaTransactionClient>,
  ) {}
  async list(
    scope: FamilyScope,
    memoryId: string,
    limit: number,
    before?: CommentPosition,
  ) {
    return this.db.$transaction(async (tx) => {
      const familyOwnerId = await lockScope(tx, scope)
      await lockMemory(tx, scope, memoryId)
      const rows = await tx.memoryComment.findMany({
        where: {
          familyId: scope.familyId,
          memoryId,
          deletedAt: null,
          ...(before
            ? {
                OR: [
                  { createdAt: { lt: new Date(before.createdAt) } },
                  {
                    createdAt: new Date(before.createdAt),
                    id: { lt: before.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      })
      return {
        items: await project(tx, scope, rows.slice(0, limit), familyOwnerId),
        hasNext: rows.length > limit,
        summary: await summary(tx, scope, memoryId),
      }
    })
  }
  async create(
    scope: FamilyScope,
    memoryId: string,
    input: CreateCommentRequest,
    idempotency: { key: string; payloadHash: string; now: Date },
  ) {
    const result = await this.idempotency.run({
      actorUserId: scope.principal.userId,
      operation: `comment.create:${scope.familyId}`,
      key: idempotency.key,
      payloadHash: idempotency.payloadHash,
      now: idempotency.now,
      execute: async (tx) => {
        await lockScope(tx, scope)
        await lockMemory(tx, scope, memoryId, true)
        const existing = await tx.memoryComment.findUnique({
          where: {
            familyId_authorId_createRequestId: {
              familyId: scope.familyId,
              authorId: scope.principal.userId,
              createRequestId: idempotency.key,
            },
          },
        })
        if (
          existing &&
          (existing.initialPayloadHash !== idempotency.payloadHash ||
            existing.deletedAt)
        )
          throw conflict()
        const row =
          existing ??
          (await tx.memoryComment.create({
            data: {
              familyId: scope.familyId,
              memoryId,
              authorId: scope.principal.userId,
              body: input.body,
              createRequestId: idempotency.key,
              initialPayloadHash: idempotency.payloadHash,
            },
          }))
        return {
          resourceId: row.id,
          response: { commentId: row.id, durableReplay: Boolean(existing) },
          responseSnapshot: { commentId: row.id },
        }
      },
      restore: (snapshot) => {
        if (
          !snapshot ||
          typeof snapshot !== 'object' ||
          !('commentId' in snapshot) ||
          typeof snapshot.commentId !== 'string'
        )
          throw conflict()
        return { commentId: snapshot.commentId, durableReplay: true }
      },
      payloadConflict: conflict,
    })
    // Snapshots deliberately contain no text. Both executor replay paths resolve fresh data
    // under the same family/member/memory locks as an ordinary authorized read.
    return this.db.$transaction(async (tx) => {
      const familyOwnerId = await lockScope(tx, scope)
      await lockMemory(tx, scope, memoryId)
      const row = await tx.memoryComment.findFirst({
        where: {
          id: result.response.commentId,
          familyId: scope.familyId,
          memoryId,
          authorId: scope.principal.userId,
          deletedAt: null,
        },
      })
      if (!row) throw conflict()
      const [comment] = await project(tx, scope, [row], familyOwnerId)
      return {
        comment: comment!,
        summary: await summary(tx, scope, memoryId),
        replayed: result.replayed || result.response.durableReplay,
      }
    })
  }
  async summaries(scope: FamilyScope, memoryIds: string[]) {
    return this.db.$transaction(async (tx) => {
      await lockScope(tx, scope)
      const rows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM memories WHERE family_id=${scope.familyId}::uuid AND id IN (${Prisma.join(memoryIds.map((id) => Prisma.sql`${id}::uuid`))}) AND status='published' AND deleted_at IS NULL ORDER BY id FOR SHARE`,
      )
      const counts = await tx.memoryComment.groupBy({
        by: ['memoryId'],
        where: {
          familyId: scope.familyId,
          memoryId: { in: rows.map((row) => row.id) },
          deletedAt: null,
        },
        _count: { _all: true },
      })
      const byId = new Map(counts.map((row) => [row.memoryId, row._count._all]))
      const visible = new Set(rows.map((row) => row.id))
      return {
        items: memoryIds
          .filter((id) => visible.has(id))
          .map((memoryId) => makeSummary(memoryId, byId.get(memoryId) ?? 0)),
      }
    })
  }

  async update(scope: FamilyScope, memoryId: string, commentId: string, input: import('@web-app-demo/contracts').UpdateCommentRequest) {
    return this.db.$transaction(async (tx) => {
      const familyOwnerId = await lockScope(tx, scope)
      await lockMemory(tx, scope, memoryId, true)
      const row = await tx.memoryComment.findFirst({
        where: { id: commentId, familyId: scope.familyId, memoryId },
      })
      if (!row) throw missing()
      if (row.authorId !== scope.principal.userId)
        throw new MemoryFailure('forbidden', 'Можно изменять только свой комментарий')
      if (row.deletedAt) throw new MemoryFailure('conflict', 'Комментарий уже удалён')
      const now = new Date()
      const changed = await tx.memoryComment.updateMany({
        where: { id: commentId, familyId: scope.familyId, memoryId, version: input.expectedVersion, deletedAt: null },
        data: { body: input.body, version: { increment: 1 }, updatedAt: now },
      })
      if (!changed.count) throw versionConflict()
      const updated = await tx.memoryComment.findUniqueOrThrow({ where: { id: commentId } })
      const [comment] = await project(tx, scope, [updated], familyOwnerId)
      return { comment: comment!, summary: await summary(tx, scope, memoryId) }
    })
  }

  async delete(scope: FamilyScope, memoryId: string, commentId: string, expectedVersion: number) {
    return this.db.$transaction(async (tx) => {
      const familyOwnerId = await lockScope(tx, scope)
      await lockMemory(tx, scope, memoryId, true)
      const row = await tx.memoryComment.findFirst({
        where: { id: commentId, familyId: scope.familyId, memoryId },
      })
      if (!row) throw missing()
      assertMutationPermission(row.authorId, scope, familyOwnerId)
      if (!row.deletedAt) {
        const now = new Date()
        const changed = await tx.memoryComment.updateMany({
          where: { id: commentId, familyId: scope.familyId, memoryId, version: expectedVersion, deletedAt: null },
          data: { body: '', deletedAt: now, updatedAt: now, version: { increment: 1 } },
        })
        if (!changed.count) throw versionConflict()
      }
      return { deletedId: commentId, summary: await summary(tx, scope, memoryId) }
    })
  }
}

async function lockScope(tx: PrismaTransactionClient, scope: FamilyScope) {
  const user = await tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM users WHERE id=${scope.principal.userId}::uuid FOR SHARE`
  if (!user.length) throw missing()
  const family = await tx.$queryRaw<
    Array<{ id: string; owner_user_id: string }>
  >`SELECT id, owner_user_id FROM families WHERE id=${scope.familyId}::uuid AND status='active' FOR SHARE`
  if (!family.length) throw missing()
  const members = await tx.$queryRaw<
    Array<{ user_id: string }>
  >`SELECT user_id FROM family_members WHERE family_id=${scope.familyId}::uuid AND user_id=${scope.principal.userId}::uuid AND revoked_at IS NULL FOR SHARE`
  if (!members.length) throw missing()
  return family[0]!.owner_user_id
}
async function lockMemory(
  tx: PrismaTransactionClient,
  scope: FamilyScope,
  memoryId: string,
  write = false,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM memories WHERE id=${memoryId}::uuid AND family_id=${scope.familyId}::uuid AND status='published' AND deleted_at IS NULL ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`,
  )
  if (!rows.length) throw missing()
}
function makeSummary(memoryId: string, count: number): CommentSummary {
  return { memoryId, count, capabilities: { read: true, create: true } }
}
async function summary(
  tx: PrismaTransactionClient,
  scope: FamilyScope,
  memoryId: string,
) {
  return makeSummary(
    memoryId,
    await tx.memoryComment.count({
      where: { familyId: scope.familyId, memoryId, deletedAt: null },
    }),
  )
}
async function project(
  tx: PrismaTransactionClient,
  scope: FamilyScope,
  rows: CommentRow[],
  familyOwnerId: string,
): Promise<CommentDto[]> {
  if (!rows.length) return []
  const members = await tx.familyMember.findMany({
    where: {
      familyId: scope.familyId,
      userId: { in: [...new Set(rows.map((row) => row.authorId))] },
    },
    select: {
      userId: true,
      familyDisplayName: true,
      revokedAt: true,
      user: {
        select: {
          displayName: true,
          avatars: {
            where: { state: 'ready' },
            select: { id: true, avatarCrop: true },
            take: 1,
          },
        },
      },
    },
  })
  const byId = new Map(members.map((member) => [member.userId, member]))
  return rows.map((row) => {
    const member = byId.get(row.authorId),
      avatar = member && !member.revokedAt ? member.user.avatars[0] : undefined
    const crop = avatarCropSchema.safeParse(avatar?.avatarCrop)
    return {
      id: row.id,
      familyId: row.familyId,
      memoryId: row.memoryId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
      capabilities: {
        edit: row.authorId === scope.principal.userId,
        delete: row.authorId === scope.principal.userId || familyOwnerId === scope.principal.userId,
      },
      author: {
        id: row.authorId,
        name:
          member?.familyDisplayName?.trim() ||
          member?.user.displayName?.trim() ||
          'Участник семьи',
        avatarPath: avatar
          ? `/api/v1/families/${scope.familyId}/media/avatars/${row.authorId}/${avatar.id}/content`
          : null,
        avatarCrop: avatar && crop.success ? crop.data : null,
      },
    }
  })
}
