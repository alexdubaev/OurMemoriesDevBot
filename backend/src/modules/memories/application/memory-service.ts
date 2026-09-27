import { createHash } from 'node:crypto'

import type {
  CreateMemoryRequest,
  LikeResponse,
  ListMemoriesQuery,
  MemoryDto,
  MemoryPage,
  SeenMemoriesRequest,
  UpdateMemoryRequest,
} from '@web-app-demo/contracts'

import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'
import {
  decodeMemoryCursor,
  decodeUnreadMemoryCursor,
  encodeMemoryCursor,
  encodeUnreadMemoryCursor,
  type MemoryCursorFilters,
  validateMemoryCursorContext,
  validateUnreadMemoryCursorContext,
} from '../domain/memory-cursor'
import type { MediaMemoryCatalog, MemoryRepository } from './ports'

const cursorLifetimeMs = 15 * 60 * 1_000
const futureToleranceMs = 5 * 60 * 1_000

export class MemoryService {
  constructor(
    private readonly access: FamilyAccess,
    private readonly repository: MemoryRepository,
    private readonly mediaCatalog: MediaMemoryCatalog,
    private readonly cursorSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    scope: FamilyScope,
    input: CreateMemoryRequest,
    idempotencyKey: string,
  ): Promise<{ memory: MemoryDto; replayed: boolean }> {
    await this.access.requireFull(scope)
    const now = this.now()
    assertOccurredAt(input.occurredAt, now)
    if (input.kind !== 'note') {
      await this.mediaCatalog.assertReadyForPublication(scope, input.mediaIds)
    }
    return this.repository.create(scope, input, {
      key: idempotencyKey,
      payloadHash: hashPayload(input),
      now,
    })
  }

  async list(scope: FamilyScope, query: ListMemoriesQuery): Promise<MemoryPage> {
    await this.access.requireMember(scope)
    const filters: MemoryCursorFilters = {
      childId: query.childId ?? null,
      kind: query.kind ?? null,
    }
    const now = this.now()
    if (query.unreadOnly === true) {
      const cursor = query.cursor ? decodeUnreadMemoryCursor(query.cursor, this.cursorSecret, now) : undefined
      if (cursor) validateUnreadMemoryCursorContext(cursor, {
        familyId: scope.familyId, userId: scope.principal.userId, filters,
      })
      let page: { items: MemoryDto[]; hasNext: boolean }
      let unreadContext: { snapshotPublicationOrdinal: string; baselineOrdinal: string; orderVersion: string; membershipEpoch: number }
      if (cursor) {
        page = await this.repository.listUnreadAfter(scope, filters, cursor, query.limit)
        unreadContext = cursor
      } else {
        const firstPage = await this.repository.listUnreadFirst(scope, filters, query.limit)
        page = firstPage
        unreadContext = firstPage
      }
      const last = page.items.at(-1)
      return { items: page.items, nextCursor: page.hasNext && last
        ? encodeUnreadMemoryCursor({
          familyId: scope.familyId, userId: scope.principal.userId, filters,
          snapshotPublicationOrdinal: unreadContext.snapshotPublicationOrdinal,
          baselineOrdinal: unreadContext.baselineOrdinal,
          orderVersion: unreadContext.orderVersion,
          membershipEpoch: unreadContext.membershipEpoch,
          before: { id: last.id, occurredAt: last.occurredAt },
          expiresAt: cursor?.expiresAt ?? new Date(now.getTime() + cursorLifetimeMs).toISOString(),
        }, this.cursorSecret) : null }
    }
    const cursor = query.cursor
      ? decodeMemoryCursor(query.cursor, this.cursorSecret, now)
      : undefined
    if (cursor) validateMemoryCursorContext(cursor, { familyId: scope.familyId, filters })

    let page: { items: MemoryDto[]; hasNext: boolean }
    let snapshotWatermark: string
    if (cursor) {
      page = await this.repository.listAfter(
        scope,
        filters,
        cursor.snapshotWatermark,
        cursor.before,
        query.limit,
      )
      snapshotWatermark = cursor.snapshotWatermark
    } else {
      const firstPage = await this.repository.listFirst(scope, filters, query.limit)
      page = firstPage
      snapshotWatermark = firstPage.snapshotWatermark
    }
    const last = page.items.at(-1)
    return {
      items: page.items,
      nextCursor: page.hasNext && last
        ? encodeMemoryCursor({
            familyId: scope.familyId,
            filters,
            snapshotWatermark,
            before: { id: last.id, occurredAt: last.occurredAt },
            expiresAt: cursor?.expiresAt ?? new Date(now.getTime() + cursorLifetimeMs).toISOString(),
          }, this.cursorSecret)
        : null,
    }
  }

  async get(scope: FamilyScope, memoryId: string): Promise<MemoryDto> {
    await this.access.requireMember(scope)
    return this.repository.get(scope, memoryId)
  }

  async update(scope: FamilyScope, memoryId: string, input: UpdateMemoryRequest): Promise<MemoryDto> {
    await this.access.requireFull(scope)
    assertOccurredAt(input.occurredAt, this.now())
    return this.repository.update(scope, memoryId, input)
  }

  async delete(scope: FamilyScope, memoryId: string, expectedVersion: number): Promise<void> {
    await this.access.requireFull(scope)
    return this.repository.delete(scope, memoryId, expectedVersion, this.now())
  }

  async setLike(scope: FamilyScope, memoryId: string, liked: boolean): Promise<LikeResponse> {
    await this.access.requireMember(scope)
    return this.repository.setLike(scope, memoryId, liked)
  }

  async markSeen(scope: FamilyScope, input: SeenMemoriesRequest): Promise<void> {
    await this.access.requireMember(scope)
    await this.repository.markSeen(scope, input)
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
