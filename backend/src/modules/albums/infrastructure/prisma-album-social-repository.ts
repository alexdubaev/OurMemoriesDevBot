import type {
  AlbumEntryCommentDto, AlbumEntryCommentSummary, AlbumEntryDiscussionSummary,
  CreateAlbumEntryCommentRequest, SetAlbumEntryReactionRequest, UpdateAlbumEntryCommentRequest,
} from '@web-app-demo/contracts'
import type { DbClient } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import type { IdempotencyExecutor, PrismaTransactionClient } from '../../../idempotency'
import type { FamilyScope } from '../../families'
import { projectCommentAuthors } from '../../memories'
import { albumMissing, albumScopeUnavailable, AlbumFailure } from '../domain/errors'
import type { AlbumCommentPosition, AlbumDiscussionTarget, AlbumSocialRepository } from '../application/album-social-ports'
import type { AlbumSourceCatalog } from './composed-album-source-catalog'

type CommentRow = Prisma.AlbumEntryCommentGetPayload<{}>
type LockedTarget = AlbumDiscussionTarget & { ownerId: string }
const replayConflict = () => new AlbumFailure('idempotency_conflict', 'Этот Idempotency-Key уже использован или комментарий удалён')
const versionConflict = () => new AlbumFailure('version_conflict', 'Комментарий был изменён или удалён')
const generationConflict = () => new AlbumFailure('version_conflict', 'Глава очищена. Откройте историю заново: прежнее обсуждение сброшено')
const whereTarget = (scope: FamilyScope, target: AlbumDiscussionTarget) => ({ familyId: scope.familyId, albumId: target.albumId, entryId: target.entryId, discussionGeneration: target.discussionGeneration })

export class PrismaAlbumSocialRepository implements AlbumSocialRepository {
  constructor(private readonly db: DbClient, private readonly idempotency: IdempotencyExecutor<PrismaTransactionClient>, private readonly catalog: AlbumSourceCatalog) {}

  discussion(scope: FamilyScope, albumId: string, entryId: string) {
    return this.db.$transaction(async (tx) => {
      const target = await this.lockTarget(tx, scope, { albumId, entryId }, false)
      return discussionSummary(tx, scope, target)
    })
  }
  list(scope: FamilyScope, target: AlbumDiscussionTarget, limit: number, before?: AlbumCommentPosition) {
    return this.db.$transaction(async (tx) => {
      const locked = await this.lockTarget(tx, scope, target, false)
      const rows = await tx.albumEntryComment.findMany({
        where: { ...whereTarget(scope, target), deletedAt: null, ...(before ? { OR: [
          { createdAt: { lt: new Date(before.createdAt) } }, { createdAt: new Date(before.createdAt), id: { lt: before.id } },
        ] } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      })
      return { items: await project(tx, scope, rows.slice(0, limit), locked.ownerId), hasNext: rows.length > limit, summary: await commentSummary(tx, scope, target) }
    })
  }
  async create(scope: FamilyScope, target: AlbumDiscussionTarget, input: CreateAlbumEntryCommentRequest, idempotency: { key: string; payloadHash: string; now: Date }) {
    const result = await this.idempotency.run({
      actorUserId: scope.principal.userId, operation: `album-entry-comment.create:${scope.familyId}`, key: idempotency.key,
      payloadHash: idempotency.payloadHash, now: idempotency.now, payloadConflict: replayConflict,
      execute: async (tx) => {
        await this.lockTarget(tx, scope, target, true)
        const existing = await tx.albumEntryComment.findUnique({ where: { familyId_authorId_createRequestId: {
          familyId: scope.familyId, authorId: scope.principal.userId, createRequestId: idempotency.key,
        } } })
        if (existing && (existing.initialPayloadHash !== idempotency.payloadHash || existing.deletedAt)) throw replayConflict()
        const row = existing ?? await tx.albumEntryComment.create({ data: {
          ...whereTarget(scope, target), authorId: scope.principal.userId, body: input.body,
          createRequestId: idempotency.key, initialPayloadHash: idempotency.payloadHash,
        } })
        return { resourceId: row.id, response: { commentId: row.id, durableReplay: Boolean(existing) }, responseSnapshot: { commentId: row.id } }
      },
      restore: (snapshot) => {
        if (!snapshot || typeof snapshot !== 'object' || !('commentId' in snapshot) || typeof snapshot.commentId !== 'string') throw replayConflict()
        return { commentId: snapshot.commentId, durableReplay: true }
      },
    })
    // As in feed comments, replay snapshots carry no private text. Resolve fresh state,
    // including the current generation, under the complete authorization lock chain.
    return this.db.$transaction(async (tx) => {
      const locked = await this.lockTarget(tx, scope, target, false)
      const row = await tx.albumEntryComment.findFirst({ where: {
        ...whereTarget(scope, target), id: result.response.commentId, authorId: scope.principal.userId, deletedAt: null,
      } })
      if (!row) throw replayConflict()
      const [comment] = await project(tx, scope, [row], locked.ownerId)
      return { comment: comment!, summary: await commentSummary(tx, scope, target), replayed: result.replayed || result.response.durableReplay }
    })
  }
  update(scope: FamilyScope, target: AlbumDiscussionTarget, commentId: string, input: UpdateAlbumEntryCommentRequest) {
    return this.db.$transaction(async (tx) => {
      const locked = await this.lockTarget(tx, scope, target, true)
      const row = await tx.albumEntryComment.findFirst({ where: { ...whereTarget(scope, target), id: commentId } })
      if (!row) throw albumMissing()
      if (row.authorId !== scope.principal.userId) throw new AlbumFailure('forbidden', 'Можно изменять только свой комментарий')
      const changed = await tx.albumEntryComment.updateMany({
        where: { ...whereTarget(scope, target), id: commentId, version: input.expectedVersion, deletedAt: null },
        data: { body: input.body, updatedAt: new Date(), version: { increment: 1 } },
      })
      if (!changed.count) throw versionConflict()
      const updated = await tx.albumEntryComment.findUniqueOrThrow({ where: { id: commentId } })
      const [comment] = await project(tx, scope, [updated], locked.ownerId)
      return { comment: comment!, summary: await commentSummary(tx, scope, target) }
    })
  }
  delete(scope: FamilyScope, target: AlbumDiscussionTarget, commentId: string, expectedVersion: number) {
    return this.db.$transaction(async (tx) => {
      const locked = await this.lockTarget(tx, scope, target, true)
      const row = await tx.albumEntryComment.findFirst({ where: { ...whereTarget(scope, target), id: commentId } })
      if (!row) throw albumMissing()
      if (row.authorId !== scope.principal.userId && locked.ownerId !== scope.principal.userId) throw new AlbumFailure('forbidden', 'Недостаточно прав для удаления комментария')
      if (!row.deletedAt) {
        const now = new Date()
        const changed = await tx.albumEntryComment.updateMany({
          where: { ...whereTarget(scope, target), id: commentId, version: expectedVersion, deletedAt: null },
          data: { body: '', deletedAt: now, updatedAt: now, version: { increment: 1 } },
        })
        if (!changed.count) throw versionConflict()
      }
      return { deletedId: commentId, summary: await commentSummary(tx, scope, target) }
    })
  }
  setReaction(scope: FamilyScope, target: AlbumDiscussionTarget, input: SetAlbumEntryReactionRequest) {
    return this.db.$transaction(async (tx) => {
      await this.lockTarget(tx, scope, target, true)
      if (input.reaction === null) await tx.albumEntryReaction.deleteMany({ where: { ...whereTarget(scope, target), userId: scope.principal.userId } })
      else await tx.albumEntryReaction.upsert({
        where: { entryId_userId: { entryId: target.entryId, userId: scope.principal.userId } },
        update: { reaction: input.reaction },
        create: { ...whereTarget(scope, target), userId: scope.principal.userId, reaction: input.reaction },
      })
      return discussionSummary(tx, scope, target)
    })
  }
  private async lockTarget(tx: PrismaTransactionClient, scope: FamilyScope, target: { albumId: string; entryId: string; discussionGeneration?: number }, write: boolean): Promise<LockedTarget> {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id=${scope.principal.userId}::uuid AND control_state='active' FOR SHARE`
    if (!users.length) throw albumScopeUnavailable()
    const sessions = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM auth_sessions WHERE id=${scope.principal.sessionId}::uuid AND user_id=${scope.principal.userId}::uuid AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE`
    if (!sessions.length) throw albumScopeUnavailable()
    const families = await tx.$queryRaw<Array<{ owner_user_id: string }>>`SELECT owner_user_id FROM families WHERE id=${scope.familyId}::uuid AND status='active' FOR SHARE`
    if (!families.length) throw albumScopeUnavailable()
    const members = await tx.$queryRaw<Array<{ user_id: string }>>`SELECT user_id FROM family_members WHERE family_id=${scope.familyId}::uuid AND user_id=${scope.principal.userId}::uuid AND revoked_at IS NULL FOR SHARE`
    if (!members.length) throw albumScopeUnavailable()
    const albums = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM albums WHERE id=${target.albumId}::uuid AND family_id=${scope.familyId}::uuid AND deleted_at IS NULL FOR SHARE`
    if (!albums.length) throw albumMissing()
    const entries = await tx.$queryRaw<Array<{ kind: string; caption: string | null; discussion_generation: number }>>(
      Prisma.sql`SELECT kind::text AS kind, caption, discussion_generation FROM album_entries WHERE id=${target.entryId}::uuid AND album_id=${target.albumId}::uuid AND family_id=${scope.familyId}::uuid AND deleted_at IS NULL ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`,
    )
    const entry = entries[0]
    if (!entry) throw albumMissing()
    if (target.discussionGeneration !== undefined && target.discussionGeneration !== entry.discussion_generation) throw generationConflict()
    if (entry.kind === 'month' && !entry.caption?.trim()) {
      const sources = await tx.albumEntrySource.findMany({ where: { familyId: scope.familyId, albumId: target.albumId, entryId: target.entryId } })
      const projected = await this.catalog.project(tx, scope, sources)
      if (!projected.some(({ available }) => available)) throw new AlbumFailure('conflict', 'Обсуждение появится после добавления истории в этот месяц')
    }
    return { albumId: target.albumId, entryId: target.entryId, discussionGeneration: entry.discussion_generation, ownerId: families[0]!.owner_user_id }
  }
}

async function commentSummary(tx: PrismaTransactionClient, scope: FamilyScope, target: AlbumDiscussionTarget): Promise<AlbumEntryCommentSummary> {
  return { ...whereTarget(scope, target), count: await tx.albumEntryComment.count({ where: { ...whereTarget(scope, target), deletedAt: null } }), capabilities: { read: true, create: true } }
}
async function discussionSummary(tx: PrismaTransactionClient, scope: FamilyScope, target: AlbumDiscussionTarget): Promise<AlbumEntryDiscussionSummary> {
  const grouped = await tx.albumEntryReaction.groupBy({
    by: ['reaction'], where: { ...whereTarget(scope, target), member: { revokedAt: null, family: { status: 'active' } } }, _count: { _all: true },
  })
  const own = await tx.albumEntryReaction.findFirst({ where: { ...whereTarget(scope, target), userId: scope.principal.userId } })
  return { ...whereTarget(scope, target), comments: await commentSummary(tx, scope, target),
    reactionCounts: Object.fromEntries(grouped.map(({ reaction, _count }) => [reaction, _count._all])), currentUserReaction: own?.reaction ?? null }
}
async function project(tx: PrismaTransactionClient, scope: FamilyScope, rows: CommentRow[], ownerId: string): Promise<AlbumEntryCommentDto[]> {
  const authors = await projectCommentAuthors(tx, scope.familyId, rows.map(({ authorId }) => authorId))
  return rows.map((row) => ({
    id: row.id, familyId: row.familyId, albumId: row.albumId, entryId: row.entryId, discussionGeneration: row.discussionGeneration,
    author: authors.get(row.authorId)!, body: row.body, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), version: row.version,
    capabilities: { edit: row.authorId === scope.principal.userId, delete: row.authorId === scope.principal.userId || ownerId === scope.principal.userId },
  }))
}
