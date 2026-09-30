import type {
  CreateMemoryRequest,
  LikeResponse,
  ReactionResponse,
  MemoryReaction,
  MemoryDto,
  SeenMemoriesRequest,
  UpdateMemoryRequest,
} from '@web-app-demo/contracts'

import type { FamilyScope } from '../../families'
import type { MemoryCursorFilters, MemoryCursorPosition, UnreadMemoryCursorClaims } from '../domain/memory-cursor'

/**
 * Block 03 replaces the production rejection with a catalog that verifies family ownership,
 * stored originals, and deletion lifecycle before a media memory can be published.
 */
export type MediaMemoryCatalog = {
  assertReadyForPublication(scope: FamilyScope, mediaIds: string[]): Promise<void>
}

export type MemoryRepository = {
  create(
    scope: FamilyScope,
    input: CreateMemoryRequest,
    idempotency: { key: string; payloadHash: string; now: Date },
  ): Promise<{ memory: MemoryDto; replayed: boolean }>
  listFirst(
    scope: FamilyScope,
    filters: MemoryCursorFilters,
    limit: number,
  ): Promise<{ items: MemoryDto[]; hasNext: boolean; snapshotWatermark: string }>
  listAfter(
    scope: FamilyScope,
    filters: MemoryCursorFilters,
    snapshotWatermark: string,
    before: MemoryCursorPosition,
    limit: number,
  ): Promise<{ items: MemoryDto[]; hasNext: boolean }>
  listUnreadFirst(scope: FamilyScope, filters: MemoryCursorFilters, limit: number): Promise<{
    items: MemoryDto[]; hasNext: boolean; snapshotPublicationOrdinal: string
    baselineOrdinal: string; orderVersion: string; membershipEpoch: number
  }>
  listUnreadAfter(scope: FamilyScope, filters: MemoryCursorFilters,
    cursor: UnreadMemoryCursorClaims, limit: number): Promise<{ items: MemoryDto[]; hasNext: boolean }>
  get(scope: FamilyScope, memoryId: string): Promise<MemoryDto>
  update(scope: FamilyScope, memoryId: string, input: UpdateMemoryRequest): Promise<MemoryDto>
  delete(scope: FamilyScope, memoryId: string, expectedVersion: number, now: Date): Promise<void>
  setLike(scope: FamilyScope, memoryId: string, liked: boolean): Promise<LikeResponse>
  setReaction(scope: FamilyScope, memoryId: string, reaction: MemoryReaction | null): Promise<ReactionResponse>
  markSeen(scope: FamilyScope, input: SeenMemoriesRequest): Promise<void>
}
