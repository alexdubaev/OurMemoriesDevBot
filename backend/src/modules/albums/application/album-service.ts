import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  createAlbumEntryRequestSchema,
  createAlbumRequestSchema,
  updateAlbumEntryRequestSchema,
  updateAlbumRequestSchema,
  albumSourceSelectionSchema,
  albumSourceChangesSchema,
  type CreateAlbumEntryRequest,
  type CreateAlbumRequest,
  type ListAlbumsQuery,
  type ListAlbumEntriesQuery,
  type AlbumSourceSelection,
  type AlbumSourceChanges,
  type UpdateAlbumEntryRequest,
  type UpdateAlbumRequest,
  albumEntrySourcePageQuerySchema,
  albumMonthPhotoBatchRequestSchema,
  albumMonthPhotoAppendRequestSchema,
  albumPhotoUploadCompleteRequestSchema,
  albumMonthCoverRequestSchema,
  type AlbumEntrySourcePageQuery,
  type AlbumMonthPhotoBatchRequest,
  type AlbumMonthPhotoAppendRequest,
  type AlbumMonthCoverRequest,
} from '@web-app-demo/contracts'
import type { FamilyScope } from '../../families'
import type { AlbumRepository } from './album-repository'
import { AlbumFailure } from '../domain/errors'

type Cursor = Record<string, unknown> & { version: 1; familyId: string; albumId?: string; kind: string; last: Record<string, unknown>; albumVersion?: number; filters?: unknown }

export class AlbumService {
  constructor(private readonly repository: AlbumRepository, private readonly secret: string) {}

  list(scope: FamilyScope, query: ListAlbumsQuery) {
    // `childId` joins the signed filters only when set, so cursors issued before it stay valid.
    const filters = { kind: query.kind ?? null, filter: query.filter, ...(query.childId ? { childId: query.childId } : {}) }
    const before = query.cursor ? this.readCursor(query.cursor, { familyId: scope.familyId, kind: 'albums', filters }) : undefined
    return this.repository.listAlbums(scope, { ...query, before: before?.last as { createdAt: string; id: string } | undefined })
      .then((page) => ({ items: page.items, nextCursor: page.hasNext && page.last ? this.writeCursor({ version: 1, familyId: scope.familyId, kind: 'albums', filters, last: page.last }) : null }))
  }

  async create(scope: FamilyScope, input: CreateAlbumRequest, key: string) {
    const normalized = createAlbumRequestSchema.parse(input)
    const result = await this.repository.createAlbum(scope, normalized, key.toLowerCase(), digest(normalized))
    return { album: result.album, replayed: result.replayed }
  }

  async get(scope: FamilyScope, albumId: string) { return this.repository.getAlbum(scope, albumId) }

  async update(scope: FamilyScope, albumId: string, input: UpdateAlbumRequest) {
    return this.repository.updateAlbum(scope, albumId, updateAlbumRequestSchema.parse(input))
  }

  remove(scope: FamilyScope, albumId: string, version: number) { return this.repository.deleteAlbum(scope, albumId, version) }

  async entries(scope: FamilyScope, albumId: string, query: ListAlbumEntriesQuery) {
    const filters = { year: query.year ?? null, category: query.category ?? null, view: query.view ?? null }
    let before: { orderKey?: number; dateValue?: string | null; id: string } | undefined
    let cursorVersion: number | undefined
    if (query.cursor) {
      const parsed = this.readCursor(query.cursor, { familyId: scope.familyId, albumId, kind: 'entries', filters })
      before = parsed.last as typeof before
      cursorVersion = parsed.albumVersion
    }
    const page = await this.repository.listEntries(scope, albumId, { ...query, before })
    if (cursorVersion !== undefined && cursorVersion !== page.albumVersion) throw new AlbumFailure('version_conflict', 'Список альбома изменился. Загрузите его заново')
    return {
      items: page.items,
      nextCursor: page.hasNext && page.last ? this.writeCursor({ version: 1, familyId: scope.familyId, albumId, kind: 'entries', filters, albumVersion: page.albumVersion, last: page.last }) : null,
    }
  }

  async createEntry(scope: FamilyScope, albumId: string, input: CreateAlbumEntryRequest, key: string) {
    const normalized = createAlbumEntryRequestSchema.parse(input)
    return this.repository.createEntry(scope, albumId, normalized, key.toLowerCase(), digest(normalized))
  }

  async updateEntry(scope: FamilyScope, albumId: string, entryId: string, input: UpdateAlbumEntryRequest) {
    return this.repository.updateEntry(scope, albumId, entryId, updateAlbumEntryRequestSchema.parse(input))
  }
  getEntry(scope: FamilyScope, albumId: string, entryId: string, view?: 'month-summary' | 'collection-summary') { return this.repository.getEntry(scope, albumId, entryId, view) }

  async entrySources(scope: FamilyScope, albumId: string, entryId: string, query: AlbumEntrySourcePageQuery) {
    query = albumEntrySourcePageQuerySchema.parse(query)
    const filters = { kind: query.kind, entryId }
    const cursor = query.cursor ? this.readCursor(query.cursor, { familyId: scope.familyId, albumId, kind: 'month-sources', filters }) : undefined
    const last = cursor?.last as { position: number; id: string; coverSourceId: string | null; coverId: string | null; entryVersion?: number } | undefined
    const page = await this.repository.listEntrySources(scope, albumId, entryId, query, last)
    if (last && (last.coverSourceId !== page.coverSourceId || last.coverId !== page.coverId || (last.entryVersion !== undefined && last.entryVersion !== page.entryVersion))) throw new AlbumFailure('version_conflict', 'Коллекция изменилась. Загрузите страницу материалов заново')
    return {
      items: page.items,
      nextCursor: page.hasNext && page.last
        ? this.writeCursor({ version: 1, familyId: scope.familyId, albumId, kind: 'month-sources', filters,
          last: { ...page.last, coverSourceId: page.coverSourceId, coverId: page.coverId, entryVersion: page.entryVersion } })
        : null,
    }
  }

  async setMonthCover(scope: FamilyScope, albumId: string, entryId: string, input: AlbumMonthCoverRequest) {
    return this.repository.setMonthCover(scope, albumId, entryId, albumMonthCoverRequestSchema.parse(input))
  }

  async updateMonthEntry(scope: FamilyScope, albumId: string, entryId: string, input: UpdateAlbumEntryRequest, view?: 'month-summary' | 'collection-summary') {
    return this.repository.updateEntry(scope, albumId, entryId, updateAlbumEntryRequestSchema.parse(input), view)
  }

  async reserveMonthPhotos(scope: FamilyScope, albumId: string, entryId: string, input: AlbumMonthPhotoBatchRequest, requestId: string) {
    const normalized = albumMonthPhotoBatchRequestSchema.parse(input)
    const payloadHash = digest({ albumId, entryId, ...normalized })
    const reservation = await this.repository.reserveMonthPhotos(scope, albumId, entryId, normalized, requestId.toLowerCase(), payloadHash)
    const grant = this.writeCursor({
      version: 1, familyId: scope.familyId, albumId, kind: 'month-photo-batch',
      filters: { entryId, actorId: scope.principal.userId, sessionId: scope.principal.sessionId },
      last: { requestId: requestId.toLowerCase(), startPosition: reservation.startPosition,
        count: normalized.count, discussionGeneration: reservation.discussionGeneration, membershipEpoch: reservation.membershipEpoch },
    })
    return { grant }
  }

  async appendMonthPhoto(scope: FamilyScope, albumId: string, entryId: string, input: AlbumMonthPhotoAppendRequest, requestId: string) {
    const normalized = albumMonthPhotoAppendRequestSchema.parse(input)
    const cursor = this.readCursor(normalized.grant, { familyId: scope.familyId, albumId, kind: 'month-photo-batch',
      filters: { entryId, actorId: scope.principal.userId, sessionId: scope.principal.sessionId } })
    const grant = cursor.last as { startPosition: number; count: number; discussionGeneration: number; membershipEpoch: number }
    if (!Number.isSafeInteger(grant.startPosition) || !Number.isSafeInteger(grant.count) || !Number.isSafeInteger(grant.discussionGeneration) ||
        !Number.isSafeInteger(grant.membershipEpoch) || normalized.offset >= grant.count) {
      throw new AlbumFailure('invalid_input', 'Разрешение на загрузку фотографий недействительно. Начните загрузку заново')
    }
    const { offset, source } = normalized
    await this.repository.appendMonthPhoto(scope, albumId, entryId, {
      source, notificationBatchId: normalized.notificationBatchId, position: grant.startPosition + offset,
      discussionGeneration: grant.discussionGeneration, membershipEpoch: grant.membershipEpoch,
    }, requestId.toLowerCase(), digest({ grant: normalized.grant, offset, source, ...(normalized.notificationBatchId ? { notificationBatchId: normalized.notificationBatchId } : {}) }), scope.principal.userId)
  }

  completePhotoUpload(scope: FamilyScope, albumId: string, input: { batchId: string }) {
    return this.repository.completePhotoUpload(scope, albumId, albumPhotoUploadCompleteRequestSchema.parse(input).batchId)
  }

  async setSources(scope: FamilyScope, albumId: string, entryId: string, input: AlbumSourceSelection, key: string) {
    const normalized = albumSourceSelectionSchema.parse(input)
    return this.repository.setSources(scope, albumId, entryId, normalized, key.toLowerCase(), digest({ albumId, entryId, ...normalized }))
  }
  async changeSources(scope: FamilyScope, albumId: string, entryId: string, input: AlbumSourceChanges, key: string) {
    const normalized = albumSourceChangesSchema.parse(input)
    return this.repository.changeSources(scope, albumId, entryId, normalized, key.toLowerCase(), digest({ albumId, entryId, ...normalized }))
  }

  clearEntry(scope: FamilyScope, albumId: string, entryId: string, version: number, view?: 'month-summary' | 'collection-summary') { return this.repository.clearEntry(scope, albumId, entryId, version, view) }
  removeMonthPhoto(scope: FamilyScope, albumId: string, entryId: string, sourceId: string, expectedVersion: number) {
    return this.repository.removeMonthPhoto(scope, albumId, entryId, sourceId, expectedVersion)
  }
  deleteEntry(scope: FamilyScope, albumId: string, entryId: string, version: number) { return this.repository.deleteEntry(scope, albumId, entryId, version) }
  reorder(scope: FamilyScope, albumId: string, expectedVersion: number, entryId: string, beforeEntryId: string | null) {
    return this.repository.reorderEntry(scope, albumId, { expectedVersion, entryId, beforeEntryId })
  }
  groups(scope: FamilyScope, albumId: string) { return this.repository.workshopGroups(scope, albumId) }

  picker(scope: FamilyScope, query: { kind?: 'photo' | 'video' | 'voice' | 'note'; from?: string; to?: string; limit: number; cursor?: string }) {
    const filters = { kind: query.kind ?? null, from: query.from ?? null, to: query.to ?? null }
    const before = query.cursor ? this.readCursor(query.cursor, { familyId: scope.familyId, kind: 'picker', filters }) : undefined
    return this.repository.picker(scope, query, query.limit, before?.last as { occurredAt: string; id: string } | undefined).then((page) => ({
      items: page.items,
      nextCursor: page.hasNext && page.last ? this.writeCursor({ version: 1, familyId: scope.familyId, kind: 'picker', filters, last: page.last }) : null,
    }))
  }

  private writeCursor(cursor: Cursor) {
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url')
    return `${encoded}.${this.sign(encoded).toString('base64url')}`
  }
  private readCursor(cursor: string, expected: { familyId: string; albumId?: string; kind: string; filters?: unknown }): Cursor {
    try {
      const [payload, signature, ...extra] = cursor.split('.')
      if (!payload || !signature || extra.length) throw new Error()
      const actual = Buffer.from(signature, 'base64url'); const wanted = this.sign(payload)
      if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new Error()
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Cursor
      if (decoded.version !== 1 || decoded.familyId !== expected.familyId || decoded.albumId !== expected.albumId || decoded.kind !== expected.kind || JSON.stringify(decoded.filters) !== JSON.stringify(expected.filters)) throw new Error()
      return decoded
    } catch {
      throw new AlbumFailure('invalid_input', 'Курсор списка недействителен')
    }
  }
  private sign(value: string) { return createHmac('sha256', this.secret).update(value).digest() }
}

function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
