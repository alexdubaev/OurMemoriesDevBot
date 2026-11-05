import type {
  AlbumDto,
  AlbumEntryDto,
  AlbumKind,
  AlbumSourceSelection,
  CreateAlbumEntryRequest,
  CreateAlbumRequest,
  UpdateAlbumEntryRequest,
  UpdateAlbumRequest,
  AlbumEntrySourcePageQuery,
  AlbumMonthPhotoBatchRequest,
  AlbumMonthPhotoAppendRequest,
  AlbumMonthCoverRequest,
} from '@web-app-demo/contracts'
import type { AlbumMemoryPickerItem } from '../../memories'
import type { FamilyScope } from '../../families'

export type AlbumListCursor = { createdAt: string; id: string }
export type EntryListCursor = { orderKey?: number; dateValue?: string | null; id: string }
export type PickerListCursor = { occurredAt: string; id: string }

export interface AlbumRepository {
  listAlbums(scope: FamilyScope, input: { kind?: AlbumKind; filter: 'all' | 'template' | 'custom'; childId?: string; limit: number; before?: AlbumListCursor }): Promise<{ items: AlbumDto[]; hasNext: boolean; last: AlbumListCursor | null }>
  getAlbum(scope: FamilyScope, albumId: string): Promise<AlbumDto>
  createAlbum(scope: FamilyScope, input: CreateAlbumRequest, key: string, payloadHash: string): Promise<{ album: AlbumDto; replayed: boolean }>
  updateAlbum(scope: FamilyScope, albumId: string, input: UpdateAlbumRequest): Promise<AlbumDto>
  deleteAlbum(scope: FamilyScope, albumId: string, expectedVersion: number): Promise<void>
  listEntries(scope: FamilyScope, albumId: string, input: { limit: number; year?: number; category?: string; view?: 'month-summary'; before?: EntryListCursor }): Promise<{ items: AlbumEntryDto[]; hasNext: boolean; last: EntryListCursor | null; albumVersion: number }>
  createEntry(scope: FamilyScope, albumId: string, input: CreateAlbumEntryRequest, key: string, payloadHash: string): Promise<{ entry: AlbumEntryDto; replayed: boolean }>
  getEntry(scope: FamilyScope, albumId: string, entryId: string, view?: 'month-summary'): Promise<AlbumEntryDto>
  updateEntry(scope: FamilyScope, albumId: string, entryId: string, input: UpdateAlbumEntryRequest, view?: 'month-summary'): Promise<AlbumEntryDto>
  clearEntry(scope: FamilyScope, albumId: string, entryId: string, expectedVersion: number, view?: 'month-summary'): Promise<AlbumEntryDto>
  deleteEntry(scope: FamilyScope, albumId: string, entryId: string, expectedVersion: number): Promise<void>
  setSources(scope: FamilyScope, albumId: string, entryId: string, input: AlbumSourceSelection, key: string, payloadHash: string): Promise<AlbumEntryDto>
  listEntrySources(scope: FamilyScope, albumId: string, entryId: string, query: AlbumEntrySourcePageQuery, before?: { position: number; id: string }): Promise<{ items: AlbumEntryDto['sources']; hasNext: boolean; last: { position: number; id: string } | null; coverSourceId: string | null; coverId: string | null }>
  setMonthCover(scope: FamilyScope, albumId: string, entryId: string, input: AlbumMonthCoverRequest): Promise<AlbumEntryDto>
  reserveMonthPhotos(scope: FamilyScope, albumId: string, entryId: string, input: AlbumMonthPhotoBatchRequest, requestId: string, payloadHash: string): Promise<{ startPosition: number; nextPhotoPosition: number; discussionGeneration: number; membershipEpoch: number }>
  appendMonthPhoto(scope: FamilyScope, albumId: string, entryId: string, input: { source: AlbumMonthPhotoAppendRequest['source']; position: number; discussionGeneration: number; membershipEpoch: number }, requestId: string, payloadHash: string, actorUserId: string): Promise<void>
  removeMonthPhoto(scope: FamilyScope, albumId: string, entryId: string, sourceId: string, expectedVersion: number): Promise<void>
  reorderEntry(scope: FamilyScope, albumId: string, input: { expectedVersion: number; entryId: string; beforeEntryId: string | null }): Promise<AlbumDto>
  workshopGroups(scope: FamilyScope, albumId: string): Promise<{ groups: Array<{ year: number | null; month: number | null; count: number }> }>
  picker(scope: FamilyScope, filter: { kind?: 'photo' | 'video' | 'voice' | 'note'; from?: string; to?: string }, limit: number, before?: PickerListCursor): Promise<{ items: AlbumMemoryPickerItem[]; hasNext: boolean; last: PickerListCursor | null }>
}
