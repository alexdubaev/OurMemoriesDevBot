import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  createAlbumEntryRequestSchema,
  createAlbumRequestSchema,
  updateAlbumEntryRequestSchema,
  updateAlbumRequestSchema,
  albumSourceSelectionSchema,
  type CreateAlbumEntryRequest,
  type CreateAlbumRequest,
  type ListAlbumsQuery,
  type ListAlbumEntriesQuery,
  type AlbumSourceSelection,
  type UpdateAlbumEntryRequest,
  type UpdateAlbumRequest,
} from '@web-app-demo/contracts'
import type { FamilyScope } from '../../families'
import type { AlbumRepository } from './album-repository'
import { AlbumFailure } from '../domain/errors'

type Cursor = Record<string, unknown> & { version: 1; familyId: string; albumId?: string; kind: string; last: Record<string, unknown>; albumVersion?: number; filters?: unknown }

export class AlbumService {
  constructor(private readonly repository: AlbumRepository, private readonly secret: string) {}

  list(scope: FamilyScope, query: ListAlbumsQuery) {
    const before = query.cursor ? this.readCursor(query.cursor, { familyId: scope.familyId, kind: 'albums', filters: { kind: query.kind ?? null, filter: query.filter } }) : undefined
    return this.repository.listAlbums(scope, { ...query, before: before?.last as { createdAt: string; id: string } | undefined })
      .then((page) => ({ items: page.items, nextCursor: page.hasNext && page.last ? this.writeCursor({ version: 1, familyId: scope.familyId, kind: 'albums', filters: { kind: query.kind ?? null, filter: query.filter }, last: page.last }) : null }))
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
    const filters = { year: query.year ?? null, category: query.category ?? null }
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
  getEntry(scope: FamilyScope, albumId: string, entryId: string) { return this.repository.getEntry(scope, albumId, entryId) }

  async setSources(scope: FamilyScope, albumId: string, entryId: string, input: AlbumSourceSelection, key: string) {
    const normalized = albumSourceSelectionSchema.parse(input)
    return this.repository.setSources(scope, albumId, entryId, normalized, key.toLowerCase(), digest({ albumId, entryId, ...normalized }))
  }

  clearEntry(scope: FamilyScope, albumId: string, entryId: string, version: number) { return this.repository.clearEntry(scope, albumId, entryId, version) }
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
