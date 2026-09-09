import type {
  CreateMemoryRequest,
  LikeResponse,
  MemoryDto,
  MemoryStatus,
  UpdateMemoryRequest,
} from '@web-app-demo/contracts'
import { memoryDtoSchema } from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type {
  IdempotencyExecutor,
  JsonObject,
  PrismaTransactionClient,
} from '../../../idempotency'
import type { FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'
import type { MemoryCursorFilters, MemoryCursorPosition } from '../domain/memory-cursor'
import type { MemoryRepository } from '../application/ports'

type MemberRole = 'full' | 'viewer'

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(
    private readonly db: DbClient,
    private readonly idempotency: IdempotencyExecutor<PrismaTransactionClient>,
  ) {}

  async create(
    scope: FamilyScope,
    input: CreateMemoryRequest,
    idempotency: { key: string; payloadHash: string; now: Date },
  ) {
    const operation = `memory.create:${scope.familyId}`
    const result = await this.idempotency.run({
      actorUserId: scope.principal.userId,
      operation,
      key: idempotency.key,
      payloadHash: idempotency.payloadHash,
      now: idempotency.now,
      execute: async (tx) => {
        await lockFamilyFeed(tx, scope.familyId)
        const role = await lockMember(tx, scope, 'full')
        const child = await tx.child.findFirst({
          where: { id: input.childId, familyId: scope.familyId },
          select: { id: true },
        })
        if (!child) throw new MemoryFailure('not_found', 'Профиль ребёнка не найден')

        const author = await tx.user.findUnique({
          where: { id: scope.principal.userId },
          select: { id: true },
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
          include: memoryInclude(),
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
        const response = dto(memory, scope.principal.userId, role)
        return {
          resourceId: memory.id,
          response,
          responseSnapshot: jsonSnapshot(response),
        }
      },
      restore: (snapshot) => memorySnapshot(snapshot),
      payloadConflict: () => new MemoryFailure(
        'idempotency_conflict',
        'Этот Idempotency-Key уже использован с другими данными',
      ),
    })
    return { memory: result.response, replayed: result.replayed }
  }

  listFirst(scope: FamilyScope, filters: MemoryCursorFilters, limit: number) {
    return this.db.$transaction(async (tx) => {
      await lockFamilyFeed(tx, scope.familyId)
      const role = await lockMember(tx, scope, 'member')
      const watermarkRows = await tx.$queryRaw<Array<{ watermark: string }>>`
        SELECT nextval(pg_get_serial_sequence('memories', 'created_sequence'))::text AS watermark
      `
      const snapshotWatermark = watermarkRows[0]?.watermark
      if (!snapshotWatermark) throw new Error('Memory sequence watermark is unavailable')
      const page = await findPage(tx, scope, role, filters, snapshotWatermark, undefined, limit)
      return { ...page, snapshotWatermark }
    })
  }

  listAfter(
    scope: FamilyScope,
    filters: MemoryCursorFilters,
    snapshotWatermark: string,
    before: MemoryCursorPosition,
    limit: number,
  ) {
    return this.db.$transaction(async (tx) => {
      const role = await lockMember(tx, scope, 'member')
      return findPage(tx, scope, role, filters, snapshotWatermark, before, limit)
    })
  }

  get(scope: FamilyScope, memoryId: string) {
    return this.db.$transaction(async (tx) => {
      const role = await lockMember(tx, scope, 'member')
      return getMemory(tx, scope, role, memoryId)
    })
  }

  update(scope: FamilyScope, memoryId: string, input: UpdateMemoryRequest) {
    return this.db.$transaction(async (tx) => {
      const role = await lockMember(tx, scope, 'full')
      const updated = await tx.memory.updateMany({
        where: {
          id: memoryId,
          familyId: scope.familyId,
          version: input.expectedVersion,
          deletedAt: null,
        },
        data: {
          body: input.body,
          occurredAt: new Date(input.occurredAt),
          version: { increment: 1 },
        },
      })
      if (updated.count === 0) await throwMutationMiss(tx, scope.familyId, memoryId)
      return getMemory(tx, scope, role, memoryId)
    })
  }

  delete(scope: FamilyScope, memoryId: string, expectedVersion: number, now: Date) {
    return this.db.$transaction(async (tx) => {
      await lockMember(tx, scope, 'full')
      const memory = await tx.memory.findFirst({
        where: { id: memoryId, familyId: scope.familyId },
        select: { deletedAt: true, version: true },
      })
      if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
      if (memory.deletedAt) return
      if (memory.version !== expectedVersion) throw versionConflict()

      const deleted = await tx.memory.updateMany({
        where: { id: memoryId, familyId: scope.familyId, version: expectedVersion, deletedAt: null },
        data: { status: 'deleted', deletedAt: now, version: { increment: 1 } },
      })
      if (deleted.count === 0) {
        const concurrent = await tx.memory.findFirst({
          where: { id: memoryId, familyId: scope.familyId },
          select: { deletedAt: true },
        })
        if (concurrent?.deletedAt) return
        if (!concurrent) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
        throw versionConflict()
      }
    })
  }

  setLike(scope: FamilyScope, memoryId: string, liked: boolean): Promise<LikeResponse> {
    return this.db.$transaction(async (tx) => {
      await lockMember(tx, scope, 'member')
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
        tx.memoryLike.findUnique({
          where: { memoryId_userId: { memoryId, userId: scope.principal.userId } },
        }),
      ])
      return { count, likedByMe: ownLike !== null }
    })
  }
}

async function lockFamilyFeed(tx: PrismaTransactionClient, familyId: string) {
  const lockName = `memory-feed:${familyId}`
  await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0)) IS NULL AS acquired
  `
}

async function lockMember(
  tx: PrismaTransactionClient,
  scope: FamilyScope,
  required: 'member' | 'full',
): Promise<MemberRole> {
  const rows = await tx.$queryRaw<Array<{ role: MemberRole }>>`
    SELECT fm.role::text AS role
      FROM family_members fm
      JOIN families f ON f.id = fm.family_id
     WHERE fm.family_id = ${scope.familyId}::uuid
       AND fm.user_id = ${scope.principal.userId}::uuid
       AND fm.revoked_at IS NULL
       AND f.status = 'active'
     FOR SHARE OF fm, f
  `
  const role = rows[0]?.role
  if (!role) throw new MemoryFailure('not_found', 'Семья не найдена')
  if (required === 'full' && role !== 'full') {
    throw new MemoryFailure('forbidden', 'Для этого действия нужен полный доступ')
  }
  return role
}

async function findPage(
  tx: PrismaTransactionClient,
  scope: FamilyScope,
  role: MemberRole,
  filters: MemoryCursorFilters,
  snapshotWatermark: string,
  before: MemoryCursorPosition | undefined,
  limit: number,
) {
  const memories = await tx.memory.findMany({
    where: {
      familyId: scope.familyId,
      deletedAt: null,
      createdSequence: { lt: BigInt(snapshotWatermark) },
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      status: { in: visibleStatuses(role) },
      ...(before ? { AND: [beforePosition(before)] } : {}),
    },
    include: memoryInclude(),
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const hasNext = memories.length > limit
  const page = hasNext ? memories.slice(0, limit) : memories
  return {
    items: page.map((memory) => dto(memory, scope.principal.userId, role)),
    hasNext,
  }
}

async function getMemory(
  tx: PrismaTransactionClient,
  scope: FamilyScope,
  role: MemberRole,
  memoryId: string,
) {
  const memory = await tx.memory.findFirst({
    where: {
      id: memoryId,
      familyId: scope.familyId,
      deletedAt: null,
      status: { in: visibleStatuses(role) },
    },
    include: memoryInclude(),
  })
  if (!memory) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
  return dto(memory, scope.principal.userId, role)
}

async function throwMutationMiss(
  tx: PrismaTransactionClient,
  familyId: string,
  memoryId: string,
): Promise<never> {
  const memory = await tx.memory.findFirst({
    where: { id: memoryId, familyId },
    select: { deletedAt: true },
  })
  if (!memory || memory.deletedAt) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
  throw versionConflict()
}

function versionConflict() {
  return new MemoryFailure('version_conflict', 'Воспоминание уже было изменено')
}

function beforePosition(position: MemoryCursorPosition) {
  const occurredAt = new Date(position.occurredAt)
  return {
    OR: [
      { occurredAt: { lt: occurredAt } },
      { occurredAt, id: { lt: position.id } },
    ],
  }
}

function visibleStatuses(role: MemberRole): MemoryStatus[] {
  return role === 'full' ? ['published', 'processing', 'failed'] : ['published']
}

function memoryInclude() {
  return {
    author: { select: { displayName: true } },
    likes: {
      where: { member: { revokedAt: null, family: { status: 'active' as const } } },
      select: { userId: true },
    },
  } as const
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
    likes: Array<{ userId: string }>
  },
  principalUserId: string,
  role: MemberRole,
): MemoryDto {
  return {
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
    likes: {
      count: memory.likes.length,
      likedByMe: memory.likes.some((like) => like.userId === principalUserId),
    },
    capabilities: { edit: role === 'full', delete: role === 'full', like: true },
  }
}

function memorySnapshot(snapshot: unknown): MemoryDto {
  const parsed = memoryDtoSchema.safeParse(snapshot)
  if (!parsed.success) throw new MemoryFailure('conflict', 'Результат запроса больше недоступен')
  return parsed.data
}

function jsonSnapshot(value: MemoryDto): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}
