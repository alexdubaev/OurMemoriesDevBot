import { createHash } from 'node:crypto'
import type {
  AlbumDatePrecision,
  AlbumEntryKind,
  AlbumEntrySourceKind,
  AlbumKind,
  AlbumSourceMediaKind,
  Prisma,
} from '../../../generated/prisma/client'
import type {
  AlbumDto,
  AlbumEntryDto,
  AlbumSourceSelection,
  CreateAlbumEntryRequest,
  CreateAlbumRequest,
  UpdateAlbumEntryRequest,
  UpdateAlbumRequest,
  AlbumMemoryPickerItem,
  AlbumMemorySourceCatalog,
  AlbumMemorySourceRef,
} from '../application/album-types'
import { albumDateSchema } from '@web-app-demo/contracts'
import type { FamilyScope } from '../../families'
import type { DbClient } from '../../../db'
import type { IdempotencyExecutor, JsonObject, PrismaTransactionClient } from '../../../idempotency'
import { Prisma as PrismaSql } from '../../../generated/prisma/client'
import { albumMissing, albumScopeUnavailable, albumVersionConflict, AlbumFailure } from '../domain/errors'
import type { AlbumRepository } from '../application/album-repository'

type Role = 'full' | 'viewer'
type AlbumCursor = { createdAt: string; id: string }
type EntryCursor = { orderKey?: number; dateValue?: string | null; id: string }
type SourceCursor = { occurredAt: string; id: string }
type AlbumRow = Prisma.AlbumGetPayload<{}>
type EntryRow = Prisma.AlbumEntryGetPayload<{ include: { sources: { orderBy: { position: 'asc' } } } }>
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export class PrismaAlbumRepository implements AlbumRepository {
  constructor(
    private readonly db: DbClient,
    private readonly idempotency: IdempotencyExecutor<PrismaTransactionClient>,
    private readonly sourceCatalog: AlbumMemorySourceCatalog,
  ) {}

  async listAlbums(scope: FamilyScope, input: { kind?: AlbumKind; filter: 'all' | 'template' | 'custom'; limit: number; before?: AlbumCursor }) {
    return this.db.$transaction(async (tx) => {
      const access = await lockScope(tx, scope, false)
      const where: Prisma.AlbumWhereInput = {
        familyId: scope.familyId,
        deletedAt: null,
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.filter === 'template' ? { kind: { in: ['year', 'events', 'workshop'] } } : {}),
        ...(input.filter === 'custom' ? { kind: 'free' } : {}),
        ...(input.before ? { OR: [
          { createdAt: { lt: new Date(input.before.createdAt) } },
          { createdAt: new Date(input.before.createdAt), id: { lt: input.before.id } },
        ] } : {}),
      }
      const rows = await tx.album.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1 })
      const page = rows.slice(0, input.limit)
      const items = await projectAlbums(tx, this.sourceCatalog, scope, access.role, page)
      const last = page.at(-1)
      return { items, hasNext: rows.length > input.limit, last: last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null }
    })
  }

  async getAlbum(scope: FamilyScope, albumId: string): Promise<AlbumDto> {
    return this.db.$transaction(async (tx) => {
      const access = await lockScope(tx, scope, false)
      const row = await tx.album.findFirst({ where: { id: albumId, familyId: scope.familyId, deletedAt: null } })
      if (!row) throw albumMissing()
      return (await projectAlbums(tx, this.sourceCatalog, scope, access.role, [row]))[0]!
    })
  }

  async createAlbum(scope: FamilyScope, input: CreateAlbumRequest, key: string, payloadHash: string) {
    const result = await this.idempotency.run<{ albumId: string; reused: boolean }>({
      actorUserId: scope.principal.userId,
      operation: 'albums:create', key, payloadHash, now: new Date(),
      payloadConflict: () => idempotencyConflict(),
      restore: (snapshot) => ({ albumId: snapshotId(snapshot, 'albumId'), reused: true }),
      async execute(tx) {
        await lockScope(tx, scope, true)
        const existing = await tx.album.findUnique({ where: { familyId_createActorId_createOperation_createRequestId: {
          familyId: scope.familyId, createActorId: scope.principal.userId, createOperation: 'albums:create', createRequestId: key,
        } } })
        if (existing) {
          if (existing.initialPayloadHash !== payloadHash) throw idempotencyConflict()
          if (existing.deletedAt) throw new AlbumFailure('conflict', 'Результат исходного запроса уже удалён')
          return { resourceId: existing.id, response: { albumId: existing.id, reused: true }, responseSnapshot: { albumId: existing.id } }
        }
        if (input.kind === 'free' ? input.childId !== null : !input.childId) throw new AlbumFailure('invalid_input', 'Для этого типа альбома нужен текущий профиль ребёнка')
        if (input.childId && !await tx.child.findFirst({ where: { id: input.childId, familyId: scope.familyId }, select: { id: true } })) throw albumMissing()
        if (input.kind === 'year') {
          await tx.$queryRaw`SELECT id FROM children WHERE id=${input.childId!}::uuid AND family_id=${scope.familyId}::uuid FOR UPDATE`
          const existingYear = await tx.album.findFirst({ where: { familyId: scope.familyId, childId: input.childId, kind: 'year', deletedAt: null }, select: { id: true } })
          if (existingYear) throw new AlbumFailure('conflict', 'Для этого ребёнка уже создан первый год')
        }
        const album = await tx.album.create({ data: {
          familyId: scope.familyId, childId: input.childId, kind: input.kind, templateVersion: 1,
          title: input.title, description: input.description ?? null,
          createActorId: scope.principal.userId, createOperation: 'albums:create', createRequestId: key, initialPayloadHash: payloadHash,
        }, select: { id: true } })
        if (input.kind === 'year') await tx.albumEntry.createMany({ data: Array.from({ length: 12 }, (_, i) => ({
          familyId: scope.familyId, albumId: album.id, kind: 'month' as const, monthNumber: i + 1, orderKey: i + 1,
        })) })
        return { resourceId: album.id, response: { albumId: album.id, reused: false }, responseSnapshot: { albumId: album.id } }
      },
    })
    return { album: await this.getAlbum(scope, result.response.albumId), replayed: result.replayed || result.response.reused }
  }

  async updateAlbum(scope: FamilyScope, albumId: string, input: UpdateAlbumRequest) {
    await this.db.$transaction(async (tx) => {
      const access = await lockScope(tx, scope, true)
      const album = await lockAlbum(tx, scope.familyId, albumId)
      assertVersion(album.version, input.expectedVersion)
      if (input.coverSourceId !== undefined && input.coverSourceId !== null) {
        const source = await tx.albumEntrySource.findFirst({ where: { id: input.coverSourceId, albumId, familyId: scope.familyId } })
        if (!source) throw albumMissing()
        const [projected] = await this.sourceCatalog.resolve(tx, scope, [sourceRef(source)], 'share')
        if (!projected || (projected.kind !== 'photo' && projected.kind !== 'video')) throw new AlbumFailure('invalid_input', 'Обложкой может быть доступное фото или видео')
      }
      await tx.album.update({ where: { id: albumId }, data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.coverSourceId !== undefined ? { coverSourceId: input.coverSourceId } : {}),
        version: { increment: 1 },
      } })
      void access
    })
    return this.getAlbum(scope, albumId)
  }

  async deleteAlbum(scope: FamilyScope, albumId: string, expectedVersion: number) {
    await this.db.$transaction(async (tx) => {
      await lockScope(tx, scope, true)
      const album = await lockAlbum(tx, scope.familyId, albumId)
      assertVersion(album.version, expectedVersion)
      await tx.album.update({ where: { id: albumId }, data: { deletedAt: new Date(), version: { increment: 1 } } })
    })
  }

  async listEntries(scope: FamilyScope, albumId: string, input: { limit: number; year?: number; category?: string; before?: EntryCursor }) {
    return this.db.$transaction(async (tx) => {
      const access = await lockScope(tx, scope, false)
      const album = await tx.album.findFirst({ where: { id: albumId, familyId: scope.familyId, deletedAt: null } })
      if (!album) throw albumMissing()
      const where: Prisma.AlbumEntryWhereInput = {
        albumId, familyId: scope.familyId, deletedAt: null,
        ...(input.year ? { dateValue: { startsWith: String(input.year) } } : {}),
        ...(input.category ? { category: input.category } : {}),
      }
      const dated = album.kind === 'events' || album.kind === 'workshop'
      const direction = album.kind === 'workshop' ? 'desc' : 'asc'
      if (input.before) {
        if (dated && input.before.dateValue !== undefined) {
          const dateValue = input.before.dateValue
          where.OR = dateValue === null
            ? [{ dateValue: null, id: { gt: input.before.id } }]
            : direction === 'asc'
              ? [{ dateValue: { gt: dateValue } }, { dateValue, id: { gt: input.before.id } }, { dateValue: null }]
              : [{ dateValue: { lt: dateValue } }, { dateValue, id: { gt: input.before.id } }, { dateValue: null }]
        } else {
          where.OR = [{ orderKey: { gt: input.before.orderKey ?? 0 } }, { orderKey: input.before.orderKey ?? 0, id: { gt: input.before.id } }]
        }
      }
      const orderBy: Prisma.AlbumEntryOrderByWithRelationInput[] = dated
        ? [{ dateValue: { sort: direction, nulls: 'last' } }, { id: 'asc' }]
        : [{ orderKey: 'asc' }, { id: 'asc' }]
      const rows = await tx.albumEntry.findMany({ where, orderBy, take: input.limit + 1, include: { sources: { orderBy: { position: 'asc' } } } })
      const page = rows.slice(0, input.limit)
      const items = await projectEntries(tx, this.sourceCatalog, scope, access.role, album, page)
      const last = page.at(-1)
      return { items, hasNext: rows.length > input.limit, last: last ? { ...(dated ? { dateValue: last.dateValue } : { orderKey: last.orderKey }), id: last.id } : null, albumVersion: album.version }
    })
  }

  async createEntry(scope: FamilyScope, albumId: string, input: CreateAlbumEntryRequest, key: string, payloadHash: string) {
    const sourceCatalog = this.sourceCatalog
    const result = await this.idempotency.run<{ entryId: string; reused: boolean }>({
      actorUserId: scope.principal.userId, operation: `albums:${albumId}:entries:create`, key, payloadHash, now: new Date(),
      payloadConflict: () => idempotencyConflict(),
      restore: (snapshot) => ({ entryId: snapshotId(snapshot, 'entryId'), reused: true }),
      async execute(tx) {
        await lockScope(tx, scope, true)
        const album = await lockAlbum(tx, scope.familyId, albumId)
        const existing = await tx.albumEntry.findFirst({ where: { familyId: scope.familyId, albumId, createActorId: scope.principal.userId,
          createOperation: `albums:${albumId}:entries:create`, createRequestId: key } })
        if (existing) {
          if (existing.initialPayloadHash !== payloadHash) throw idempotencyConflict()
          if (existing.deletedAt) throw new AlbumFailure('conflict', 'Результат исходного запроса уже удалён')
          return { resourceId: existing.id, response: { entryId: existing.id, reused: true }, responseSnapshot: { entryId: existing.id } }
        }
        assertVersion(album.version, input.expectedVersion)
        if (album.kind === 'year') throw new AlbumFailure('invalid_input', 'Месяцы первого года создаются вместе с альбомом')
        const refs = input.sources as AlbumMemorySourceRef[]
        const resolved = await sourceCatalog.resolve(tx, scope, refs, 'update')
        validateEntryCreate(album.kind, input, resolved)
        const lastOrder = await tx.albumEntry.aggregate({ where: { familyId: scope.familyId, albumId, deletedAt: null }, _max: { orderKey: true } })
        const entry = await tx.albumEntry.create({ data: {
          familyId: scope.familyId, albumId, kind: input.kind === 'event' ? 'event' : 'work', orderKey: (lastOrder._max.orderKey ?? 0) + 1,
          title: input.title ?? null, caption: input.caption ?? null, childQuote: input.childQuote ?? null,
          category: input.category ?? null, dateValue: input.date?.value ?? null, datePrecision: (input.date?.precision ?? 'unknown') as AlbumDatePrecision,
          createActorId: scope.principal.userId, createOperation: `albums:${albumId}:entries:create`, createRequestId: key, initialPayloadHash: payloadHash,
        }, select: { id: true } })
        if (resolved.length) await tx.albumEntrySource.createMany({ data: resolved.map((source, position) => ({
          familyId: scope.familyId, albumId, entryId: entry.id, memoryId: source.memoryId,
          sourceKind: source.sourceKind as AlbumEntrySourceKind, sourceId: source.sourceId, kind: source.kind as AlbumSourceMediaKind, position,
        })) })
        await tx.album.update({ where: { id: albumId }, data: { version: { increment: 1 } } })
        return { resourceId: entry.id, response: { entryId: entry.id, reused: false }, responseSnapshot: { entryId: entry.id } }
      },
    })
    const entry = await this.getEntry(scope, albumId, result.response.entryId)
    return { entry, replayed: result.replayed || result.response.reused }
  }

  async getEntry(scope: FamilyScope, albumId: string, entryId: string): Promise<AlbumEntryDto> {
    return this.db.$transaction(async (tx) => {
      const access = await lockScope(tx, scope, false)
      const album = await tx.album.findFirst({ where: { id: albumId, familyId: scope.familyId, deletedAt: null } })
      if (!album) throw albumMissing()
      const row = await tx.albumEntry.findFirst({ where: { id: entryId, albumId, familyId: scope.familyId, deletedAt: null }, include: { sources: { orderBy: { position: 'asc' } } } })
      if (!row) throw albumMissing()
      return (await projectEntries(tx, this.sourceCatalog, scope, access.role, album, [row]))[0]!
    })
  }

  async updateEntry(scope: FamilyScope, albumId: string, entryId: string, input: UpdateAlbumEntryRequest) {
    await this.db.$transaction(async (tx) => {
      const access = await lockScope(tx, scope, true)
      const album = await lockAlbum(tx, scope.familyId, albumId)
      assertVersion(album.version, input.expectedVersion)
      const entry = await lockEntry(tx, scope.familyId, albumId, entryId)
      const values = {
        title: input.title !== undefined ? input.title : entry.title,
        caption: input.caption !== undefined ? input.caption : entry.caption,
        sourceCount: await countAvailableSources(tx, this.sourceCatalog, scope, entryId),
      }
      if (album.kind === 'events' && !(values.title?.trim() && (values.caption?.trim() || values.sourceCount > 0))) throw new AlbumFailure('invalid_input', 'Событию нужны название и описание либо хотя бы один источник')
      await tx.albumEntry.update({ where: { id: entryId }, data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.caption !== undefined ? { caption: input.caption } : {}),
        ...(input.childQuote !== undefined ? { childQuote: input.childQuote } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.date ? { dateValue: input.date.value, datePrecision: input.date.precision } : {}),
        version: { increment: 1 },
      } })
      await tx.album.update({ where: { id: albumId }, data: { version: { increment: 1 } } })
      void access
    })
    return this.getEntry(scope, albumId, entryId)
  }

  async clearEntry(scope: FamilyScope, albumId: string, entryId: string, expectedVersion: number) {
    await this.db.$transaction(async (tx) => {
      await lockScope(tx, scope, true)
      const album = await lockAlbum(tx, scope.familyId, albumId)
      assertVersion(album.version, expectedVersion)
      if (album.kind !== 'year') throw new AlbumFailure('invalid_input', 'Очистка содержимого доступна только для месяца первого года')
      await lockEntry(tx, scope.familyId, albumId, entryId)
      await tx.albumEntrySource.deleteMany({ where: { familyId: scope.familyId, albumId, entryId } })
      await tx.albumEntry.update({ where: { id: entryId }, data: {
        title: null, caption: null, childQuote: null, category: null, dateValue: null, datePrecision: 'unknown', version: { increment: 1 },
      } })
      await tx.album.update({ where: { id: albumId }, data: { version: { increment: 1 } } })
    })
    return this.getEntry(scope, albumId, entryId)
  }

  async deleteEntry(scope: FamilyScope, albumId: string, entryId: string, expectedVersion: number) {
    await this.db.$transaction(async (tx) => {
      await lockScope(tx, scope, true)
      const album = await lockAlbum(tx, scope.familyId, albumId)
      assertVersion(album.version, expectedVersion)
      if (album.kind === 'year') throw new AlbumFailure('invalid_input', 'Номер месяца нельзя удалить; очистите его содержимое')
      await lockEntry(tx, scope.familyId, albumId, entryId)
      await tx.albumEntrySource.deleteMany({ where: { familyId: scope.familyId, albumId, entryId } })
      await tx.albumEntry.update({ where: { id: entryId }, data: { deletedAt: new Date(), version: { increment: 1 } } })
      await tx.album.update({ where: { id: albumId }, data: { version: { increment: 1 } } })
    })
  }

  async setSources(scope: FamilyScope, albumId: string, entryId: string, input: AlbumSourceSelection, key: string, payloadHash: string) {
    const sourceCatalog = this.sourceCatalog
    const result = await this.idempotency.run<{ entryId: string }>({
      actorUserId: scope.principal.userId, operation: `albums:${albumId}:entries:${entryId}:sources`, key, payloadHash, now: new Date(),
      payloadConflict: () => idempotencyConflict(),
      restore: (snapshot) => ({ entryId: snapshotId(snapshot, 'entryId') }),
      async execute(tx) {
      await lockScope(tx, scope, true)
      const album = await lockAlbum(tx, scope.familyId, albumId)
      const receipt = await tx.albumSourceOperation.findUnique({ where: {
        familyId_actorUserId_albumId_entryId_operation_requestId: {
          familyId: scope.familyId, actorUserId: scope.principal.userId, albumId, entryId,
          operation: 'set_sources', requestId: key,
        },
      } })
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw idempotencyConflict()
        return { resourceId: entryId, response: { entryId }, responseSnapshot: { entryId } }
      }
      assertVersion(album.version, input.expectedVersion)
      const entry = await lockEntry(tx, scope.familyId, albumId, entryId)
      const refs = input.sources as AlbumMemorySourceRef[]
      const resolved = await sourceCatalog.resolve(tx, scope, refs, 'update')
      if (album.kind === 'workshop' && resolved.some((source) => source.kind !== 'photo')) throw new AlbumFailure('invalid_input', 'В мастерской можно размещать только фото работ')
      if (album.kind === 'year' && resolved.some((source) => source.kind !== 'photo' && source.kind !== 'video')) throw new AlbumFailure('invalid_input', 'В первом годе доступны только фото и видео')
      const existing = await tx.albumEntrySource.findMany({ where: { familyId: scope.familyId, albumId, entryId }, orderBy: { position: 'asc' } })
      const keyOf = (ref: AlbumMemorySourceRef) => `${ref.memoryId}:${ref.sourceKind}:${ref.sourceId}`
      const byKey = new Map(existing.map((row) => [keyOf(sourceRef(row)), row]))
      const retained = new Set<string>()
      for (const [position, source] of resolved.entries()) {
        const found = byKey.get(keyOf(source))
        if (found) {
          retained.add(found.id)
          if (found.position !== position) await tx.albumEntrySource.update({ where: { id: found.id }, data: { position } })
        } else {
          const created = await tx.albumEntrySource.create({ data: {
            familyId: scope.familyId, albumId, entryId, memoryId: source.memoryId,
            sourceKind: source.sourceKind as AlbumEntrySourceKind, sourceId: source.sourceId, kind: source.kind as AlbumSourceMediaKind, position,
          } })
          retained.add(created.id)
        }
      }
      await tx.albumEntrySource.deleteMany({ where: { familyId: scope.familyId, albumId, entryId, ...(retained.size ? { id: { notIn: [...retained] } } : {}) } })
      if (album.kind === 'events' && entry.kind === 'event' && !(entry.title?.trim() && (entry.caption?.trim() || resolved.length > 0))) throw new AlbumFailure('invalid_input', 'Событию нужны название и описание либо хотя бы один источник')
      if (album.kind === 'workshop' && resolved.length === 0) throw new AlbumFailure('invalid_input', 'Для работы добавьте хотя бы одно фото')
      await tx.albumEntry.update({ where: { id: entryId }, data: { version: { increment: 1 } } })
      await tx.album.update({ where: { id: albumId }, data: { version: { increment: 1 } } })
      await tx.albumSourceOperation.create({ data: {
        familyId: scope.familyId, albumId, entryId, actorUserId: scope.principal.userId,
        operation: 'set_sources', requestId: key, payloadHash,
      } })
      return { resourceId: entryId, response: { entryId }, responseSnapshot: { entryId } }
    },
    })
    return this.getEntry(scope, albumId, result.response.entryId)
  }

  async reorderEntry(scope: FamilyScope, albumId: string, input: { expectedVersion: number; entryId: string; beforeEntryId: string | null }) {
    await this.db.$transaction(async (tx) => {
      await lockScope(tx, scope, true)
      const album = await lockAlbum(tx, scope.familyId, albumId)
      assertVersion(album.version, input.expectedVersion)
      if (album.kind !== 'free') throw new AlbumFailure('invalid_input', 'Перестановка доступна только в свободном альбоме')
      await lockEntry(tx, scope.familyId, albumId, input.entryId)
      if (input.beforeEntryId === input.entryId) return
      const siblings = await tx.albumEntry.findMany({ where: { familyId: scope.familyId, albumId, deletedAt: null }, orderBy: [{ orderKey: 'asc' }, { id: 'asc' }], select: { id: true } })
      const oldIndex = siblings.findIndex(({ id }) => id === input.entryId)
      const beforeIndex = input.beforeEntryId ? siblings.findIndex(({ id }) => id === input.beforeEntryId) : siblings.length
      if (oldIndex < 0 || beforeIndex < 0) throw albumMissing()
      const [moved] = siblings.splice(oldIndex, 1)
      const insertAt = input.beforeEntryId ? siblings.findIndex(({ id }) => id === input.beforeEntryId) : siblings.length
      siblings.splice(insertAt, 0, moved!)
      for (const [index, row] of siblings.entries()) await tx.albumEntry.update({ where: { id: row.id }, data: { orderKey: (index + 1) * 1000 } })
      await tx.album.update({ where: { id: albumId }, data: { version: { increment: 1 } } })
    })
    return this.getAlbum(scope, albumId)
  }

  async workshopGroups(scope: FamilyScope, albumId: string) {
    return this.db.$transaction(async (tx) => {
      await lockScope(tx, scope, false)
      const album = await tx.album.findFirst({ where: { id: albumId, familyId: scope.familyId, kind: 'workshop', deletedAt: null }, select: { id: true } })
      if (!album) throw albumMissing()
      const rows = await tx.$queryRaw<Array<{ year: number | null; month: number | null; count: bigint }>>`
        SELECT CASE WHEN date_precision = 'unknown' THEN NULL ELSE left(date_value, 4)::int END AS year,
               CASE WHEN date_precision IN ('day','month') THEN substring(date_value from 6 for 2)::int ELSE NULL END AS month,
               count(*) AS count
          FROM album_entries
         WHERE album_id = ${albumId}::uuid AND family_id = ${scope.familyId}::uuid AND kind = 'work' AND deleted_at IS NULL
         GROUP BY 1,2 ORDER BY 1 DESC NULLS LAST, 2 DESC NULLS LAST
      `
      return { groups: rows.map(({ year, month, count }) => ({ year, month, count: Number(count) })) }
    })
  }

  async picker(scope: FamilyScope, filter: { kind?: 'photo' | 'video' | 'voice' | 'note'; from?: string; to?: string }, limit: number, before?: SourceCursor) {
    return this.db.$transaction(async (tx) => {
      await lockScope(tx, scope, false)
      return this.sourceCatalog.list(tx, scope, filter, limit, before)
    })
  }
}

async function projectAlbums(tx: PrismaTransactionClient, catalog: AlbumMemorySourceCatalog, scope: FamilyScope, role: Role, albums: AlbumRow[]): Promise<AlbumDto[]> {
  if (!albums.length) return []
  const ids = albums.map(({ id }) => id)
  const selectedIds = albums.flatMap(({ coverSourceId }) => coverSourceId ? [coverSourceId] : [])
  const fallbackRows = await tx.$queryRaw<Array<{ id: string }>>(PrismaSql.sql`
    SELECT DISTINCT ON (s.album_id) s.id
      FROM album_entry_sources s
      JOIN album_entries e ON e.id=s.entry_id AND e.album_id=s.album_id AND e.family_id=s.family_id
      JOIN memories m ON m.id=s.memory_id AND m.family_id=s.family_id AND m.status='published' AND m.deleted_at IS NULL
     WHERE e.deleted_at IS NULL AND s.family_id=${scope.familyId}::uuid AND s.album_id IN (${PrismaSql.join(ids.map((id) => PrismaSql.sql`${id}::uuid`))})
       AND s.kind IN ('photo','video')
       AND ((s.source_kind='private_storage' AND EXISTS (
             SELECT 1 FROM memory_media mm JOIN media_assets a ON a.id=mm.media_id AND a.family_id=mm.family_id
              WHERE mm.memory_id=s.memory_id AND mm.family_id=s.family_id AND a.id=s.source_id
                AND a.purpose='memory' AND a.original_status='stored' AND a.deleted_at IS NULL))
         OR (s.source_kind='max_video' AND EXISTS (SELECT 1 FROM max_video_references r WHERE r.id=s.source_id AND r.memory_id=s.memory_id AND r.family_id=s.family_id))
         OR (s.source_kind='telegram_video' AND EXISTS (SELECT 1 FROM telegram_video_references r WHERE r.id=s.source_id AND r.memory_id=s.memory_id AND r.family_id=s.family_id)))
     ORDER BY s.album_id,e.order_key,s.position,s.id
  `)
  const wantedSourceIds = [...new Set([...selectedIds, ...fallbackRows.map(({ id }) => id)])]
  const projectRows = wantedSourceIds.length ? await tx.albumEntrySource.findMany({
    where: { familyId: scope.familyId, albumId: { in: ids }, id: { in: wantedSourceIds }, kind: { in: ['photo', 'video'] }, entry: { is: { deletedAt: null } } },
    include: { entry: { select: { orderKey: true } } },
    orderBy: [{ entry: { orderKey: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
  }) : []
  const sourceRows = projectRows
  const projected = await catalog.project(tx, scope, projectRows.map((row) => ({ ...sourceRef(row), id: row.id, kind: row.kind })))
  const byId = new Map(projected.map((source) => [source.id, source]))
  const countRows = await tx.$queryRaw<Array<{ albumId: string; entryCount: bigint }>>(PrismaSql.sql`
    SELECT a.id AS "albumId",
      CASE WHEN a.kind = 'year' THEN count(e.id) FILTER (
        WHERE NULLIF(btrim(e.caption), '') IS NOT NULL
           OR NULLIF(btrim(e.child_quote), '') IS NOT NULL
           OR EXISTS (
             SELECT 1
               FROM album_entry_sources s
               JOIN memories m ON m.id=s.memory_id AND m.family_id=s.family_id AND m.status='published' AND m.deleted_at IS NULL
              WHERE s.entry_id=e.id AND s.family_id=a.family_id
                AND (
                  (s.source_kind='memory' AND s.source_id=s.memory_id AND m.kind IN ('note','voice'))
                  OR (s.source_kind='private_storage' AND EXISTS (
                    SELECT 1 FROM memory_media mm JOIN media_assets ma ON ma.id=mm.media_id AND ma.family_id=mm.family_id
                     WHERE mm.memory_id=s.memory_id AND mm.family_id=s.family_id AND ma.id=s.source_id AND ma.purpose='memory' AND ma.original_status='stored' AND ma.deleted_at IS NULL
                  ))
                  OR (s.source_kind='max_video' AND EXISTS (SELECT 1 FROM max_video_references r WHERE r.id=s.source_id AND r.memory_id=s.memory_id AND r.family_id=s.family_id))
                  OR (s.source_kind='telegram_video' AND EXISTS (SELECT 1 FROM telegram_video_references r WHERE r.id=s.source_id AND r.memory_id=s.memory_id AND r.family_id=s.family_id))
                )
           )
      ) ELSE count(e.id) END AS "entryCount"
    FROM albums a LEFT JOIN album_entries e ON e.album_id=a.id AND e.family_id=a.family_id AND e.deleted_at IS NULL
    WHERE a.id IN (${PrismaSql.join(ids.map((id) => PrismaSql.sql`${id}::uuid`))})
    GROUP BY a.id, a.kind
  `)
  const counts = new Map(countRows.map(({ albumId, entryCount }) => [albumId, Number(entryCount)]))
  return albums.map((album) => {
    const primary = album.coverSourceId ? byId.get(album.coverSourceId) : undefined
    const fallback = sourceRows.filter((source) => source.albumId === album.id).map(({ id }) => byId.get(id)).find((source) => source?.available && (source.kind === 'photo' || source.kind === 'video'))
    const cover = primary?.available && (primary.kind === 'photo' || primary.kind === 'video') ? primary : fallback ?? null
    return {
      id: album.id, kind: album.kind, templateVersion: album.templateVersion, title: album.title, description: album.description,
      childId: album.childId, version: album.version, cover: cover ? sourceDto(cover) : null,
      entryCount: counts.get(album.id) ?? 0, createdAt: album.createdAt.toISOString(), updatedAt: album.updatedAt.toISOString(),
      capabilities: { edit: role === 'full', delete: role === 'full' },
    }
  })
}

async function projectEntries(tx: PrismaTransactionClient, catalog: AlbumMemorySourceCatalog, scope: FamilyScope, role: Role, album: AlbumRow, entries: EntryRow[]): Promise<AlbumEntryDto[]> {
  const rows = entries.flatMap((entry) => entry.sources)
  const projected = await catalog.project(tx, scope, rows.map((row) => ({ ...sourceRef(row), id: row.id, kind: row.kind })))
  const byId = new Map(projected.map((source) => [source.id, source]))
  return entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    monthNumber: entry.monthNumber,
    title: entry.title,
    caption: entry.caption,
    childQuote: entry.childQuote,
    category: entry.category as AlbumEntryDto['category'],
    date: albumDateSchema.parse({ value: entry.dateValue, precision: entry.datePrecision }),
    version: entry.version,
    order: entry.orderKey,
    sourceCount: entry.sources.filter(({ id }) => byId.get(id)?.available).length,
    sources: entry.sources.map(({ id }) => sourceDto(byId.get(id)!)),
    aggregateVersion: album.version,
    capabilities: { edit: role === 'full', delete: role === 'full' && album.kind !== 'year' },
  }))
}

function sourceDto(source: Awaited<ReturnType<AlbumMemorySourceCatalog['project']>>[number]) {
  return { id: source.id, memoryId: source.memoryId, sourceKind: source.sourceKind, sourceId: source.sourceId, kind: source.kind,
    available: source.available, attachment: source.available ? source.attachment : null, body: source.available ? source.body : null, occurredAt: source.occurredAt }
}

function sourceRef(source: { memoryId: string; sourceKind: AlbumEntrySourceKind; sourceId: string }) {
  return { memoryId: source.memoryId, sourceKind: source.sourceKind, sourceId: source.sourceId }
}

async function lockScope(tx: PrismaTransactionClient, scope: FamilyScope, write: boolean): Promise<{ role: Role; owner: boolean; membershipEpoch: number }> {
  const user = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id=${scope.principal.userId}::uuid FOR SHARE`
  if (!user.length) throw albumScopeUnavailable()
  const session = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM auth_sessions WHERE id=${scope.principal.sessionId}::uuid AND user_id=${scope.principal.userId}::uuid AND revoked_at IS NULL AND expires_at > now() FOR SHARE`
  if (!session.length) throw albumScopeUnavailable()
  const family = await tx.$queryRaw<Array<{ id: string; owner_user_id: string }>>`SELECT id, owner_user_id FROM families WHERE id=${scope.familyId}::uuid AND status='active' FOR SHARE`
  if (!family.length) throw albumScopeUnavailable()
  const members = await tx.$queryRaw<Array<{ role: Role; membership_epoch: number }>>`SELECT role::text AS role, membership_epoch FROM family_members WHERE family_id=${scope.familyId}::uuid AND user_id=${scope.principal.userId}::uuid AND revoked_at IS NULL FOR SHARE`
  if (!members.length) throw albumScopeUnavailable()
  if (write && members[0]!.role !== 'full') throw new AlbumFailure('forbidden', 'Для изменения альбома нужен полный доступ')
  return { role: members[0]!.role, owner: family[0]!.owner_user_id === scope.principal.userId, membershipEpoch: members[0]!.membership_epoch }
}

async function lockAlbum(tx: PrismaTransactionClient, familyId: string, albumId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM albums WHERE id=${albumId}::uuid AND family_id=${familyId}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw albumMissing()
  const row = await tx.album.findUnique({ where: { id: albumId } })
  if (!row) throw albumMissing()
  return row
}
async function lockEntry(tx: PrismaTransactionClient, familyId: string, albumId: string, entryId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM album_entries WHERE id=${entryId}::uuid AND album_id=${albumId}::uuid AND family_id=${familyId}::uuid AND deleted_at IS NULL FOR UPDATE`
  if (!rows.length) throw albumMissing()
  const row = await tx.albumEntry.findUnique({ where: { id: entryId } })
  if (!row) throw albumMissing()
  return row
}
function assertVersion(actual: number, expected: number) { if (actual !== expected) throw albumVersionConflict() }
function idempotencyConflict() { return new AlbumFailure('idempotency_conflict', 'Этот Idempotency-Key уже использован с другими данными') }
function snapshotId(snapshot: unknown, property: string) {
  if (!snapshot || typeof snapshot !== 'object' || !(property in snapshot) || typeof (snapshot as Record<string, unknown>)[property] !== 'string') throw new AlbumFailure('conflict', 'Результат исходного запроса недоступен')
  return (snapshot as Record<string, string>)[property]!
}
function validateEntryCreate(kind: AlbumKind, input: CreateAlbumEntryRequest, sources: Awaited<ReturnType<AlbumMemorySourceCatalog['resolve']>>) {
  if (kind === 'events' && input.kind !== 'event') throw new AlbumFailure('invalid_input', 'В альбоме открытий можно создать только событие')
  if ((kind === 'free' || kind === 'workshop') && input.kind !== 'work') throw new AlbumFailure('invalid_input', 'Для этого альбома создаётся работа')
  if (kind === 'events' && !(input.title?.trim() && (input.caption?.trim() || sources.length > 0))) throw new AlbumFailure('invalid_input', 'Событию нужны название и описание либо хотя бы один источник')
  if (kind === 'workshop' && (!sources.some(({ kind: sourceKind }) => sourceKind === 'photo') || sources.some(({ kind: sourceKind }) => sourceKind !== 'photo'))) throw new AlbumFailure('invalid_input', 'Для работы добавьте хотя бы одно фото')
  if (kind === 'year') throw new AlbumFailure('invalid_input', 'В первом годе нельзя создавать дополнительные главы')
}

async function countAvailableSources(tx: PrismaTransactionClient, catalog: AlbumMemorySourceCatalog, scope: FamilyScope, entryId: string) {
  const rows = await tx.albumEntrySource.findMany({ where: { entryId, familyId: scope.familyId }, orderBy: { position: 'asc' } })
  const projected = await catalog.project(tx, scope, rows.map((row) => ({ ...sourceRef(row), id: row.id, kind: row.kind })))
  return projected.filter(({ available }) => available).length
}
