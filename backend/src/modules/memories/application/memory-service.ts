import { createHash, randomUUID } from 'node:crypto'

import type {
  CreateMemoryRequest,
  LikeResponse,
  ListMemoriesQuery,
  MemoryDto,
  MemoryPage,
  MemoryStatus,
  UpdateMemoryRequest,
} from '@web-app-demo/contracts'
import { memoryDtoSchema } from '@web-app-demo/contracts'
import type { DbClient } from '../../../db'
import type { FamilyAccess, FamilyScope } from '../../families'
import type { MediaMemoryCatalog } from './ports'
import { MemoryFailure } from '../domain/errors'
import {
  decodeMemoryCursor,
  encodeMemoryCursor,
  type MemoryCursorFilters,
  type MemoryCursorPosition,
  validateMemoryCursorContext,
} from '../domain/memory-cursor'

type TransactionClient = Parameters<Parameters<DbClient['$transaction']>[0]>[0]
type Principal = FamilyScope['principal']
type MemoryWhereInput = NonNullable<NonNullable<Parameters<DbClient['memory']['findFirst']>[0]>['where']>
type IdempotencyResponseSnapshot = NonNullable<Parameters<DbClient['idempotencyRecord']['create']>[0]>['data']['responseSnapshot']

const cursorLifetimeMs = 15 * 60 * 1_000
const futureToleranceMs = 5 * 60 * 1_000

export class MemoryService {
  constructor(
    private readonly db: DbClient,
    private readonly access: FamilyAccess,
    private readonly mediaCatalog: MediaMemoryCatalog,
    private readonly idempotencySecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    scope: FamilyScope,
    input: CreateMemoryRequest,
    idempotencyKey: string,
  ): Promise<{ memory: MemoryDto; replayed: boolean }> {
    await this.access.requireFull(scope)
    assertOccurredAt(input.occurredAt, this.now())

    if (input.kind !== 'note') {
      await this.mediaCatalog.assertReadyForPublication(scope, input.mediaIds)
    }

    const payloadHash = hashPayload(input)
    return this.runIdempotent({
      principal: scope.principal,
      operation: `memory.create:${scope.familyId}`,
      idempotencyKey,
      payloadHash,
      execute: async (tx) => {
        // Authorisation is deliberately re-read immediately before the mutation, rather than
        // trusting a capability that may have been rendered before a membership revocation.
        await this.access.requireFull(scope)
        const child = await tx.child.findFirst({
          where: { id: input.childId, familyId: scope.familyId },
          select: { id: true },
        })
        if (!child) throw new MemoryFailure('not_found', 'Профиль ребёнка не найден')

        const author = await tx.user.findUnique({
          where: { id: scope.principal.userId },
          select: { displayName: true },
        })
        if (!author) throw new MemoryFailure('not_found', 'Пользователь не найден')

        const memory = await tx.memory.create({
          data: {
            familyId: scope.familyId,
            childId: input.childId,
            authorId: scope.principal.userId,
            kind: input.kind,
            body: input.body,
            occurredAt: new Date(input.occurredAt),
          },
          include: { author: { select: { displayName: true } } },
        })
        if (input.kind !== 'note') {
          await tx.memoryMedia.createMany({
            data: input.mediaIds.map((mediaId, position) => ({
              familyId: scope.familyId,
              memoryId: memory.id,
              mediaId,
              position,
            })),
          })
        }
        const response = dto(memory, scope.principal.userId, 'full', 0, false)
        return { resourceId: memory.id, response, responseSnapshot: response }
      },
      restore: (snapshot) => memorySnapshot(snapshot),
    })
  }

  async list(scope: FamilyScope, query: ListMemoriesQuery): Promise<MemoryPage> {
    const member = await this.access.requireMember(scope)
    const filters: MemoryCursorFilters = { childId: query.childId ?? null, kind: query.kind ?? null }
    const baseWhere = {
      familyId: scope.familyId,
      deletedAt: null,
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      status: { in: visibleStatuses(member.role) },
    } as const
    const now = this.now()
    const cursor = query.cursor
      ? decodeMemoryCursor(query.cursor, this.idempotencySecret, now)
      : undefined
    if (cursor) validateMemoryCursorContext(cursor, { familyId: scope.familyId, filters })

    const snapshot = cursor?.snapshot ?? await this.latestPosition(baseWhere)
    if (!snapshot) return { items: [], nextCursor: null }
    const memories = await this.db.memory.findMany({
      where: {
        ...baseWhere,
        AND: [
          atOrBefore(snapshot),
          ...(cursor ? [before(cursor.before)] : []),
        ],
      },
      include: {
        author: { select: { displayName: true } },
        likes: {
          where: { member: { revokedAt: null, family: { status: 'active' } } },
          select: { userId: true },
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const hasNext = memories.length > query.limit
    const page = hasNext ? memories.slice(0, query.limit) : memories
    const last = page.at(-1)
    return {
      items: page.map((memory) => dto(
        memory,
        scope.principal.userId,
        member.role,
        memory.likes.length,
        memory.likes.some((like) => like.userId === scope.principal.userId),
      )),
      nextCursor: hasNext && last
        ? encodeMemoryCursor({
            familyId: scope.familyId,
            filters,
            snapshot,
            before: position(last),
            expiresAt: new Date(now.getTime() + cursorLifetimeMs).toISOString(),
          }, this.idempotencySecret)
        : null,
    }
  }

  async get(scope: FamilyScope, memoryId: string): Promise<MemoryDto> {
    const member = await this.access.requireMember(scope)
    const memory = await this.db.memory.findFirst({
      where: {
        id: memoryId,
        familyId: scope.familyId,
        deletedAt: null,
        status: { in: visibleStatuses(member.role) },
      },
      include: {
        author: { select: { displayName: true } },
        likes: {
          where: { member: { revokedAt: null, family: { status: 'active' } } },
          select: { userId: true },
        },
      },
    })
    if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
    return dto(
      memory,
      scope.principal.userId,
      member.role,
      memory.likes.length,
      memory.likes.some((like) => like.userId === scope.principal.userId),
    )
  }

  async update(scope: FamilyScope, memoryId: string, input: UpdateMemoryRequest): Promise<MemoryDto> {
    await this.access.requireFull(scope)
    assertOccurredAt(input.occurredAt, this.now())
    const memory = await this.db.memory.findFirst({
      where: { id: memoryId, familyId: scope.familyId, deletedAt: null },
      select: { id: true, version: true },
    })
    if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
    if (memory.version !== input.expectedVersion) {
      throw new MemoryFailure('conflict', 'Воспоминание уже было изменено')
    }
    const updated = await this.db.memory.updateMany({
      where: {
        id: memoryId,
        familyId: scope.familyId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: { body: input.body, occurredAt: new Date(input.occurredAt), version: { increment: 1 } },
    })
    if (updated.count === 0) throw new MemoryFailure('conflict', 'Воспоминание уже было изменено')
    return this.get(scope, memoryId)
  }

  async delete(scope: FamilyScope, memoryId: string, expectedVersion: number): Promise<void> {
    await this.access.requireFull(scope)
    const memory = await this.db.memory.findFirst({
      where: { id: memoryId, familyId: scope.familyId },
      select: { version: true, deletedAt: true },
    })
    if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
    // DELETE is safely repeatable for the original operation.  It must not
    // reveal a cross-family resource, and an already-deleted row is never
    // made visible again regardless of the supplied version.
    if (memory.deletedAt !== null) return
    if (memory.version !== expectedVersion) {
      throw new MemoryFailure('conflict', 'Воспоминание уже было изменено')
    }
    const deleted = await this.db.memory.updateMany({
      where: { id: memoryId, familyId: scope.familyId, version: expectedVersion, deletedAt: null },
      data: { status: 'deleted', deletedAt: this.now(), version: { increment: 1 } },
    })
    if (deleted.count === 0) throw new MemoryFailure('conflict', 'Воспоминание уже было изменено')
  }

  async setLike(scope: FamilyScope, memoryId: string, liked: boolean): Promise<LikeResponse> {
    await this.access.requireMember(scope)
    return this.db.$transaction(async (tx) => {
      // PostgreSQL's upsert can still race when two transactions observe a
      // missing composite key. Serialize this one actor/resource pair while
      // retaining concurrency for every other like.
      const lockName = `memory-like:${memoryId}:${scope.principal.userId}`
      await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0)) IS NULL AS acquired
      `
      const memory = await tx.memory.findFirst({
        where: { id: memoryId, familyId: scope.familyId, deletedAt: null, status: 'published' },
        select: { id: true },
      })
      if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
      if (liked) {
        await tx.memoryLike.upsert({
          where: { memoryId_userId: { memoryId, userId: scope.principal.userId } },
          update: {},
          create: { familyId: scope.familyId, memoryId, userId: scope.principal.userId },
        })
      } else {
        await tx.memoryLike.deleteMany({
          where: { familyId: scope.familyId, memoryId, userId: scope.principal.userId },
        })
      }
      const [count, ownLike] = await Promise.all([
        tx.memoryLike.count({
          where: {
            familyId: scope.familyId,
            memoryId,
            member: { revokedAt: null, family: { status: 'active' } },
          },
        }),
        tx.memoryLike.findUnique({ where: { memoryId_userId: { memoryId, userId: scope.principal.userId } } }),
      ])
      return { count, likedByMe: ownLike !== null }
    })
  }

  private async latestPosition(where: MemoryWhereInput): Promise<MemoryCursorPosition | null> {
    const first = await this.db.memory.findFirst({
      where,
      select: { id: true, occurredAt: true },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    })
    return first ? position(first) : null
  }

  private async runIdempotent<Response>({
    principal,
    operation,
    idempotencyKey,
    payloadHash,
    execute,
    restore,
  }: {
    principal: Principal
    operation: string
    idempotencyKey: string
    payloadHash: string
    execute(tx: TransactionClient): Promise<{
      resourceId: string
      response: Response
      responseSnapshot: IdempotencyResponseSnapshot
    }>
    restore(responseSnapshot: unknown): Response
  }): Promise<{ memory: Response; replayed: boolean }> {
    return this.db.$transaction(async (tx) => {
      const lockName = `idempotency:${principal.userId}:${operation}:${idempotencyKey}`
      await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0)) IS NULL AS acquired
      `
      const now = this.now()
      const existing = await tx.idempotencyRecord.findUnique({
        where: { actorUserId_operation_key: { actorUserId: principal.userId, operation, key: idempotencyKey } },
      })
      if (existing && existing.expiresAt > now) {
        if (existing.payloadHash !== payloadHash) {
          throw new MemoryFailure('idempotency_conflict', 'Этот Idempotency-Key уже использован с другими данными')
        }
        return { memory: restore(existing.responseSnapshot), replayed: true }
      }
      if (existing) await tx.idempotencyRecord.delete({ where: { id: existing.id } })
      const result = await execute(tx)
      await tx.idempotencyRecord.create({
        data: {
          id: randomUUID(),
          actorUserId: principal.userId,
          operation,
          key: idempotencyKey,
          payloadHash,
          resourceId: result.resourceId,
          responseSnapshot: result.responseSnapshot,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        },
      })
      return { memory: result.response, replayed: false }
    }, { timeout: 15_000 })
  }
}

function hashPayload(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function assertOccurredAt(occurredAt: string, now: Date) {
  const parsed = new Date(occurredAt)
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime() + futureToleranceMs) {
    throw new MemoryFailure('invalid_input', 'Дата воспоминания не может быть в будущем')
  }
}

function visibleStatuses(role: 'full' | 'viewer'): MemoryStatus[] {
  return role === 'full' ? ['published', 'processing', 'failed'] : ['published']
}

function atOrBefore(position: MemoryCursorPosition): MemoryWhereInput {
  const occurredAt = new Date(position.occurredAt)
  return {
    OR: [
      { occurredAt: { lt: occurredAt } },
      { occurredAt, id: { lte: position.id } },
    ],
  }
}

function before(position: MemoryCursorPosition): MemoryWhereInput {
  const occurredAt = new Date(position.occurredAt)
  return {
    OR: [
      { occurredAt: { lt: occurredAt } },
      { occurredAt, id: { lt: position.id } },
    ],
  }
}

function position(memory: { id: string; occurredAt: Date }): MemoryCursorPosition {
  return { id: memory.id, occurredAt: memory.occurredAt.toISOString() }
}

function dto(
  memory: {
    id: string
    familyId: string
    childId: string
    authorId: string
    kind: 'note' | 'photo' | 'video' | 'voice'
    body: string
    occurredAt: Date
    createdAt: Date
    version: number
    status: 'processing' | 'published' | 'failed' | 'deleted'
    author: { displayName: string | null }
  },
  principalUserId: string,
  role: 'full' | 'viewer',
  likeCount: number,
  likedByMe: boolean,
): MemoryDto {
  const response: MemoryDto = {
    id: memory.id,
    familyId: memory.familyId,
    childId: memory.childId,
    author: { id: memory.authorId, name: memory.author.displayName ?? 'Участник семьи' },
    kind: memory.kind,
    body: memory.body,
    occurredAt: memory.occurredAt.toISOString(),
    createdAt: memory.createdAt.toISOString(),
    version: memory.version,
    status: memory.status,
    attachments: [],
    likes: { count: likeCount, likedByMe },
    capabilities: { edit: role === 'full', delete: role === 'full', like: principalUserId.length > 0 },
  }
  return response
}

function memorySnapshot(snapshot: unknown): MemoryDto {
  const parsed = memoryDtoSchema.safeParse(snapshot)
  if (!parsed.success) throw new MemoryFailure('conflict', 'Результат запроса больше недоступен')
  return parsed.data
}
