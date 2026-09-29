import type {
  CreateMemoryRequest,
  LikeResponse,
  MemoryDto,
  MemoryStatus,
  SeenMemoriesRequest,
  UpdateMemoryRequest,
} from '@web-app-demo/contracts'
import { memoryDtoSchema } from '@web-app-demo/contracts'
import { Prisma } from '../../../generated/prisma/client'

import type { DbClient } from '../../../db'
import { insertTask } from '../../../outbox/store'
import type {
  IdempotencyExecutor,
  JsonObject,
  PrismaTransactionClient,
} from '../../../idempotency'
import type { FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'
import type { MemoryCursorFilters, MemoryCursorPosition, UnreadMemoryCursorClaims } from '../domain/memory-cursor'
import type { MemoryRepository } from '../application/ports'
import { allocatePublicationOrdinal, firstPublicationTime, lockPublicationFamily } from './publication-boundary'

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
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${scope.principal.userId}::uuid FOR UPDATE`
        const publication = await lockPublicationFamily(tx, scope.familyId)
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

        const firstPublishedOrdinal = await allocatePublicationOrdinal(tx, scope.familyId, publication.trackingActivated)
        const firstPublishedAt = firstPublicationTime()
        const attachments = input.kind === 'media'
          ? input.attachments ?? (input.mediaIds ?? []).map((mediaId) => ({ source: 'private_storage' as const, mediaId }))
          : input.kind === 'note' ? [] : input.mediaIds.map((mediaId) => ({ source: 'private_storage' as const, mediaId }))
        const mediaIds = attachments.flatMap((entry) => entry.source === 'private_storage' ? [entry.mediaId] : [])
        const sessionIds = attachments.flatMap((entry) => entry.source === 'max' ? [entry.sessionId] : [])
        let assetKindById = new Map<string, 'photo' | 'video' | 'voice'>()
        if (input.kind !== 'note') {
          if (attachments.length < 1 || attachments.length > 10 || new Set(sessionIds).size !== sessionIds.length) {
            throw new MemoryFailure('invalid_input', 'Неподходящий состав вложений')
          }
          await lockMediaAssets(tx, scope.familyId, mediaIds)
          const assetKinds = await tx.mediaAsset.findMany({ where: {
            id: { in: mediaIds }, familyId: scope.familyId, purpose: 'memory', originalStatus: 'stored', deletedAt: null,
            memories: { none: {} },
          }, select: { id: true, mediaKind: true } })
          assetKindById = new Map(assetKinds.map(({ id, mediaKind }) => [id, mediaKind]))
          const expected = input.kind === 'media' ? ['photo', 'video'] : [input.kind]
          if (assetKinds.length !== mediaIds.length || new Set(mediaIds).size !== mediaIds.length ||
              assetKinds.some(({ mediaKind }) => !expected.includes(mediaKind))) {
            throw new MemoryFailure('media_unavailable', 'Медиа недоступно для публикации')
          }
        }
        for (const sessionId of [...sessionIds].sort()) {
          await tx.$queryRaw`SELECT id FROM max_video_upload_sessions WHERE id = ${sessionId}::uuid AND family_id = ${scope.familyId}::uuid FOR UPDATE`
        }
        const sessions = sessionIds.length ? await tx.maxVideoUploadSession.findMany({
          where: { id: { in: sessionIds }, familyId: scope.familyId, authorId: scope.principal.userId,
            childId: input.childId, mode: 'attachment', state: 'finalized' },
          include: { outboundSource: { include: { videoReference: true } } },
        }) : []
        if (sessions.length !== sessionIds.length || sessions.some((session) => !session.outboundSource || session.outboundSource.videoReference)) {
          throw new MemoryFailure('invalid_input', 'Видео MAX не готово или уже использовано')
        }

        const created = await tx.memory.create({
          data: {
            familyId: scope.familyId,
            childId: input.childId,
            authorId: scope.principal.userId,
            kind: input.kind,
            body: input.body,
            occurredAt: new Date(input.occurredAt),
            firstPublishedOrdinal,
            firstPublishedAt,
          },
          include: memoryInclude(),
        })
        if (input.kind !== 'note') {
          if (mediaIds.length) await tx.memoryMedia.createMany({
            data: attachments.flatMap((entry, position) => entry.source === 'private_storage' ? [{
              familyId: scope.familyId,
              memoryId: created.id,
              mediaId: entry.mediaId,
              position,
            }] : []),
          })
          for (const [position, entry] of attachments.entries()) {
            if (entry.source !== 'max') continue
            const source = sessions.find((session) => session.id === entry.sessionId)?.outboundSource
            if (!source) throw new MemoryFailure('invalid_input', 'Видео MAX не найдено')
            await tx.maxVideoReference.create({ data: {
              familyId: scope.familyId, memoryId: created.id, outboundSourceId: source.id,
              attachmentPosition: position, providerAttachmentId: source.providerAttachmentId,
              width: source.width, height: source.height, durationMs: source.durationMs,
            } })
          }
        }
        if (input.kind === 'photo' || input.kind === 'media') {
          const family = await tx.family.findUniqueOrThrow({
            where: { id: scope.familyId }, select: { maxBackupChatId: true },
          })
          const backup = await tx.maxMemoryBackup.create({ data: {
            familyId: scope.familyId,
            memoryId: created.id,
            body: input.body,
            state: family.maxBackupChatId === null ? 'needs_configuration' : 'pending',
            channelChatId: family.maxBackupChatId,
          } })
          await tx.maxMemoryBackupAttachment.createMany({ data: attachments.map((entry, position) => ({
            backupId: backup.id,
            familyId: scope.familyId,
            position,
            kind: entry.source === 'max' || assetKindById.get(entry.mediaId) === 'video' ? 'video' : 'image',
            ...(entry.source === 'max' ? { uploadSessionId: entry.sessionId } : { mediaId: entry.mediaId }),
          })) })
          if (family.maxBackupChatId !== null) {
            await insertTask(tx, {
              type: 'max:backup-media',
              dedupeKey: `max-backup-media:${created.id}`,
              payload: { memoryId: created.id },
              scheduledFor: idempotency.now,
            })
          }
        }
        const memory = input.kind === 'note' ? created : await tx.memory.findUniqueOrThrow({
          where: { id: created.id }, include: memoryInclude(),
        })
        const response = dto(memory, scope.principal.userId, role)
        return {
          resourceId: created.id,
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
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${scope.principal.userId}::uuid FOR UPDATE`
      const publication = await lockPublicationFamily(tx, scope.familyId)
      const role = await lockMember(tx, scope, 'full')
      const current = await tx.memory.findFirst({
        where: { id: memoryId, familyId: scope.familyId },
        select: { occurredAt: true, status: true, firstPublishedOrdinal: true },
      })
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
      if (publication.trackingActivated && current?.status === 'published' &&
          current.firstPublishedOrdinal !== null &&
          current.occurredAt.getTime() !== new Date(input.occurredAt).getTime()) {
        await tx.$executeRaw`
          UPDATE families SET unread_order_version = unread_order_version + 1
           WHERE id = ${scope.familyId}::uuid
        `
      }
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
      const [linked, telegramVideo] = await Promise.all([
        tx.memoryMedia.findMany({ where: { memoryId, familyId: scope.familyId }, select: { mediaId: true } }),
        tx.$queryRaw<Array<{ thumbnailMediaId: string | null }>>`
          SELECT "thumbnail_media_id" AS "thumbnailMediaId"
            FROM "telegram_video_references"
           WHERE "memory_id" = ${memoryId}::uuid AND "family_id" = ${scope.familyId}::uuid
        `,
      ])
      const mediaIds = [...linked.map(({ mediaId }) => mediaId), ...(telegramVideo[0]?.thumbnailMediaId ? [telegramVideo[0].thumbnailMediaId] : [])]
      for (const mediaId of mediaIds) {
        await tx.mediaAsset.updateMany({ where: { id: mediaId, familyId: scope.familyId, deletedAt: null }, data: { deletedAt: now } })
        await insertTask(tx, { type: 'media:delete', dedupeKey: `media-delete:${mediaId}`,
          payload: { mediaId }, scheduledFor: now })
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

  listUnreadFirst(scope: FamilyScope, filters: MemoryCursorFilters, limit: number) {
    return this.db.$transaction(async (tx) => {
      const context = await lockUnreadContext(tx, scope)
      const snapshotPublicationOrdinal = context.trackingActivated ? context.publicationOrdinal.toString() : '0'
      const baselineOrdinal = context.baselineOrdinal.toString()
      const orderVersion = context.orderVersion.toString()
      const page = await findUnreadPage(tx, scope, context.role, filters,
        snapshotPublicationOrdinal, baselineOrdinal, context.membershipEpoch, undefined, limit)
      return { ...page, snapshotPublicationOrdinal, baselineOrdinal, orderVersion, membershipEpoch: context.membershipEpoch }
    })
  }

  listUnreadAfter(scope: FamilyScope, filters: MemoryCursorFilters, cursor: UnreadMemoryCursorClaims, limit: number) {
    return this.db.$transaction(async (tx) => {
      const context = await lockUnreadContext(tx, scope)
      if (context.membershipEpoch !== cursor.membershipEpoch ||
          context.baselineOrdinal.toString() !== cursor.baselineOrdinal ||
          context.orderVersion.toString() !== cursor.orderVersion ||
          !context.trackingActivated) {
        throw new MemoryFailure('version_conflict', 'Период просмотра изменился')
      }
      return findUnreadPage(tx, scope, context.role, filters, cursor.snapshotPublicationOrdinal,
        cursor.baselineOrdinal, cursor.membershipEpoch, cursor.before, limit)
    })
  }

  async markSeen(scope: FamilyScope, input: SeenMemoriesRequest): Promise<void> {
    const memoryIds = [...new Set(input.memoryIds)].sort()
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${scope.principal.userId}::uuid FOR UPDATE`
      const family = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM families WHERE id = ${scope.familyId}::uuid AND status = 'active' FOR SHARE
      `
      if (!family[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
      const members = await tx.$queryRaw<Array<{ membershipEpoch: number }>>`
        SELECT membership_epoch AS "membershipEpoch" FROM family_members
         WHERE family_id = ${scope.familyId}::uuid AND user_id = ${scope.principal.userId}::uuid
           AND revoked_at IS NULL FOR SHARE
      `
      const member = members[0]
      if (!member) throw new MemoryFailure('not_found', 'Семья не найдена')
      if (member.membershipEpoch !== input.expectedMembershipEpoch) {
        throw new MemoryFailure('version_conflict', 'Период членства изменился')
      }
      // Lock all submitted rows in a stable order so deletion cannot commit after validation
      // but before seen is inserted, and overlapping batches cannot invert row-lock order.
      const found = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM memories
         WHERE family_id = ${scope.familyId}::uuid
           AND id IN (${Prisma.join(memoryIds.map((id) => Prisma.sql`${id}::uuid`))})
           AND status = 'published' AND deleted_at IS NULL
         ORDER BY id FOR SHARE
      `)
      if (found.length !== memoryIds.length) throw new MemoryFailure('not_found', 'Воспоминание не найдено')
      await tx.memorySeen.createMany({ data: memoryIds.map((memoryId) => ({
        familyId: scope.familyId, userId: scope.principal.userId,
        membershipEpoch: member.membershipEpoch, memoryId,
      })), skipDuplicates: true })
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
  const family = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM families WHERE id = ${scope.familyId}::uuid AND status = 'active' FOR SHARE
  `
  if (!family[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
  const rows = await tx.$queryRaw<Array<{ role: MemberRole }>>`
    SELECT role::text AS role FROM family_members
     WHERE family_id = ${scope.familyId}::uuid
       AND user_id = ${scope.principal.userId}::uuid
       AND revoked_at IS NULL
     FOR SHARE
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

async function lockUnreadContext(tx: PrismaTransactionClient, scope: FamilyScope) {
  const family = await tx.$queryRaw<Array<{
    publicationOrdinal: bigint; orderVersion: bigint; trackingActivated: boolean
  }>>`
    SELECT publication_ordinal AS "publicationOrdinal",
           unread_order_version AS "orderVersion",
           unread_tracking_activated_at IS NOT NULL AS "trackingActivated"
      FROM families
     WHERE id = ${scope.familyId}::uuid AND status = 'active'
     FOR SHARE
  `
  if (!family[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
  const member = await tx.$queryRaw<Array<{
    role: MemberRole; membershipEpoch: number; baselineOrdinal: bigint
  }>>`
    SELECT role::text AS role, membership_epoch AS "membershipEpoch",
           COALESCE(unread_baseline_ordinal, 0) AS "baselineOrdinal"
      FROM family_members
     WHERE family_id = ${scope.familyId}::uuid AND user_id = ${scope.principal.userId}::uuid
       AND revoked_at IS NULL
     FOR SHARE
  `
  if (!member[0]) throw new MemoryFailure('not_found', 'Семья не найдена')
  return { ...family[0], ...member[0] }
}

async function findUnreadPage(tx: PrismaTransactionClient, scope: FamilyScope, role: MemberRole,
  filters: MemoryCursorFilters, snapshotPublicationOrdinal: string, baselineOrdinal: string,
  membershipEpoch: number, before: MemoryCursorPosition | undefined, limit: number) {
  const memories = await tx.memory.findMany({
    where: {
      familyId: scope.familyId, status: 'published', deletedAt: null,
      authorId: { not: scope.principal.userId },
      firstPublishedOrdinal: { gt: BigInt(baselineOrdinal), lte: BigInt(snapshotPublicationOrdinal) },
      seenByMembers: { none: { userId: scope.principal.userId, membershipEpoch } },
      ...(filters.childId ? { childId: filters.childId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(before ? { AND: [beforePosition(before)] } : {}),
    },
    include: memoryInclude(),
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })
  const hasNext = memories.length > limit
  const page = hasNext ? memories.slice(0, limit) : memories
  return { items: page.map((memory) => dto(memory, scope.principal.userId, role)), hasNext }
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
    author: { select: {
      displayName: true,
      avatars: { where: { state: 'ready' as const }, select: { id: true }, take: 1 },
      familyMemberships: { where: { revokedAt: null, family: { status: 'active' as const } }, select: { familyId: true } },
    } },
    likes: {
      where: { member: { revokedAt: null, family: { status: 'active' as const } } },
      select: { userId: true },
    },
    media: {
      orderBy: { position: 'asc' as const },
      include: { asset: { include: { variants: true } } },
    },
    telegramVideoReference: {
      select: { id: true, width: true, height: true, durationMs: true, thumbnailMedia: { select: { id: true, variants: { select: { variant: true } } } } },
    },
    maxVideoReferences: {
      orderBy: { attachmentPosition: 'asc' as const },
      select: { id: true, attachmentPosition: true, width: true, height: true, durationMs: true },
    },
  } as const
}

function dto(
  memory: {
    id: string
    familyId: string
    childId: string
    authorId: string
    kind: 'note' | 'photo' | 'video' | 'voice' | 'media'
    firstPublishedAt: Date | null
    sourcePublishedAt: Date | null
    body: string
    occurredAt: Date
    createdAt: Date
    version: number
    status: 'processing' | 'published' | 'failed' | 'deleted'
    author: { displayName: string | null; avatars: Array<{ id: string }>; familyMemberships: Array<{ familyId: string }> }
    likes: Array<{ userId: string }>
    media: Array<{ position: number; asset: {
      id: string
      mediaKind: 'photo' | 'video' | 'voice'
      width: number | null
      height: number | null
      durationMs: number | null
      waveform: unknown
      renditionStatus: 'pending' | 'ready' | 'failed'
      variants: Array<{ variant: 'preview' | 'display' | 'playback' }>
    } }>
    telegramVideoReference: { id: string; width: number | null; height: number | null; durationMs: number | null; thumbnailMedia: { id: string; variants: Array<{ variant: 'preview' | 'display' | 'playback' }> } | null } | null
    maxVideoReferences: Array<{ id: string; attachmentPosition: number; width: number | null; height: number | null; durationMs: number | null }>
  },
  principalUserId: string,
  role: MemberRole,
): MemoryDto {
  return {
    id: memory.id,
    familyId: memory.familyId,
    childId: memory.childId,
    author: { id: memory.authorId, name: memory.author.displayName ?? 'Участник семьи',
      avatarPath: memory.author.familyMemberships.some(({ familyId }) => familyId === memory.familyId) && memory.author.avatars[0]
        ? `/api/v1/families/${memory.familyId}/media/avatars/${memory.authorId}/${memory.author.avatars[0].id}/content`
        : null },
    kind: memory.kind,
    body: memory.body,
    occurredAt: memory.occurredAt.toISOString(),
    firstPublishedAt: memory.firstPublishedAt?.toISOString() ?? null,
    sourcePublishedAt: memory.sourcePublishedAt?.toISOString() ?? null,
    createdAt: memory.createdAt.toISOString(),
    version: memory.version,
    status: memory.status,
    attachments: [
      ...memory.media.map(({ asset, position }) => {
      const path = (variant: string) => `/api/v1/families/${memory.familyId}/media/${asset.id}/content?variant=${variant}`
      const variants = new Set(asset.variants.map(({ variant }) => variant))
      return { position, attachment: {
        id: asset.id,
        source: 'private_storage' as const,
        kind: asset.mediaKind,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        renditionStatus: asset.renditionStatus,
        previewPath: variants.has('preview') ? path('preview') : null,
        displayPath: variants.has('display') ? path('display') : null,
        playbackPath: variants.has('playback') ? path('playback') : null,
        originalDownloadPath: path('original'),
        waveform: measuredWaveform(asset.waveform),
      } }
      }),
      ...(memory.telegramVideoReference ? [{ position: memory.media.length, attachment: {
        id: memory.telegramVideoReference.id,
        source: 'telegram' as const,
        kind: 'video' as const,
        width: memory.telegramVideoReference.width,
        height: memory.telegramVideoReference.height,
        durationMs: memory.telegramVideoReference.durationMs,
        thumbnailPath: memory.telegramVideoReference.thumbnailMedia?.variants.some(({ variant }) => variant === 'display')
          ? `/api/v1/families/${memory.familyId}/media/${memory.telegramVideoReference.thumbnailMedia.id}/content?variant=display`
          : null,
        openInTelegramPath: `/api/v1/families/${memory.familyId}/memories/${memory.id}/telegram-video`,
      } }] : []),
      ...memory.maxVideoReferences.map((reference) => ({ position: reference.attachmentPosition, attachment: {
        id: reference.id,
        source: 'max' as const,
        kind: 'video' as const,
        width: reference.width,
        height: reference.height,
        durationMs: reference.durationMs,
        playbackPath: `/api/v1/families/${memory.familyId}/media/max-videos/${reference.id}/content`,
      } })),
    ].sort((a, b) => a.position - b.position).map((entry) => entry.attachment),
    likes: {
      count: memory.likes.length,
      likedByMe: memory.likes.some((like) => like.userId === principalUserId),
    },
    capabilities: { edit: role === 'full', delete: role === 'full', like: true },
  }
}

function measuredWaveform(value: unknown) {
  return Array.isArray(value) && value.length === 48 && value.every((peak) =>
    typeof peak === 'number' && Number.isFinite(peak) && peak >= 0 && peak <= 1)
    ? value as number[]
    : null
}

async function lockMediaAssets(tx: Pick<PrismaTransactionClient, '$queryRaw'>, familyId: string, mediaIds: string[]) {
  const unique = [...new Set(mediaIds)].sort()
  if (unique.length === 0) return
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM media_assets
     WHERE family_id = ${familyId}::uuid
       AND id IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))})
     ORDER BY id FOR UPDATE
  `)
}

function memorySnapshot(snapshot: unknown): MemoryDto {
  const normalizedSnapshot = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? {
        ...snapshot,
        ...(!Object.hasOwn(snapshot, 'firstPublishedAt') ? { firstPublishedAt: null } : {}),
        ...(!Object.hasOwn(snapshot, 'sourcePublishedAt') ? { sourcePublishedAt: null } : {}),
      }
    : snapshot
  const parsed = memoryDtoSchema.safeParse(normalizedSnapshot)
  if (!parsed.success) throw new MemoryFailure('conflict', 'Результат запроса больше недоступен')
  return parsed.data
}

function jsonSnapshot(value: MemoryDto): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}
