import type { MemoryAttachment } from '@web-app-demo/contracts'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyScope } from '../../families'

export type AlbumSourceKind = 'memory' | 'private_storage' | 'max_video' | 'telegram_video'
export type AlbumMemorySourceRef = { memoryId: string; sourceKind: AlbumSourceKind; sourceId: string }
export type AlbumMemorySourceProjection = AlbumMemorySourceRef & {
  id: string
  kind: 'photo' | 'video' | 'voice' | 'note'
  available: boolean
  attachment: MemoryAttachment | null
  body: string | null
  occurredAt: string | null
}
export type AlbumSourceCursor = { occurredAt: string; id: string }
export type AlbumSourceFilter = { kind?: 'photo' | 'video' | 'voice' | 'note'; from?: string; to?: string }
export type AlbumMemoryPickerItem = {
  memoryId: string
  kind: 'photo' | 'video' | 'voice' | 'note' | 'media'
  occurredAt: string
  sources: AlbumMemorySourceProjection[]
}

export type AlbumMemorySourceCatalog = {
  resolve(
    tx: PrismaTransactionClient,
    scope: FamilyScope,
    refs: AlbumMemorySourceRef[],
    lock: 'share' | 'update',
  ): Promise<AlbumMemorySourceProjection[]>
  project(
    tx: PrismaTransactionClient,
    scope: FamilyScope,
    refs: Array<AlbumMemorySourceRef & { id?: string; kind: AlbumMemorySourceProjection['kind'] }>,
    lock?: 'share' | 'update',
  ): Promise<AlbumMemorySourceProjection[]>
  list(
    tx: PrismaTransactionClient,
    scope: FamilyScope,
    filter: AlbumSourceFilter,
    limit: number,
    before?: AlbumSourceCursor,
  ): Promise<{ items: AlbumMemoryPickerItem[]; hasNext: boolean; last: AlbumSourceCursor | null }>
}
