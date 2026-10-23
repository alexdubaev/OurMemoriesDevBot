import { createHash } from 'node:crypto'

import type {
  CreateMemoryRequest,
  LikeResponse,
  ListMemoriesQuery,
  MemoryDto,
  MemoryChildTagsResponse,
  MemoryPage,
  ReplaceMemoryChildTagsRequest,
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
    includeChildTags = false,
  ): Promise<{ memory: MemoryDto; replayed: boolean }> {
    await this.access.requireFull(scope)
    const now = this.now()
    assertOccurredAt(input.occurredAt, now)
    const result = await this.repository.create(scope, input, {
      key: idempotencyKey,
      payloadHash: hashPayload(input),
      now,
    })
    return { ...result, memory: await this.withChildTags(scope, result.memory, includeChildTags) }
  }

  async list(scope: FamilyScope, query: ListMemoriesQuery, includePublicationAttribution = false, includeChannelAvatar = false,
    includeChildTags = false): Promise<MemoryPage> {
    await this.access.requireMember(scope)
    if (query.untagged === true && query.childId) {
      throw new MemoryFailure('invalid_input', 'Нельзя одновременно выбрать ребёнка и «Без отметки»')
    }
    const filters: MemoryCursorFilters = {
      childId: query.childId ?? null,
      kind: query.kind ?? null,
      untagged: query.untagged === true,
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
      const items = await this.decorate(scope, page.items, includePublicationAttribution, includeChannelAvatar, includeChildTags)
      return { items, nextCursor: page.hasNext && last
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
    const items = await this.decorate(scope, page.items, includePublicationAttribution, includeChannelAvatar, includeChildTags)
    return {
      items,
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

  async get(scope: FamilyScope, memoryId: string, includePublicationAttribution = false, includeChannelAvatar = false,
    includeChildTags = false): Promise<MemoryDto> {
    await this.access.requireMember(scope)
    const memory = await this.repository.get(scope, memoryId)
    return (await this.decorate(scope, [memory], includePublicationAttribution, includeChannelAvatar, includeChildTags))[0]!
  }

  async update(scope: FamilyScope, memoryId: string, input: UpdateMemoryRequest, includeChildTags = false): Promise<MemoryDto> {
    await this.access.requireFull(scope)
    assertOccurredAt(input.occurredAt, this.now())
    return this.withChildTags(scope, await this.repository.update(scope, memoryId, input), includeChildTags)
  }

  /** Any full member may retag any memory of the family; this grants nothing on the memory itself. */
  async replaceChildTags(scope: FamilyScope, memoryId: string, input: ReplaceMemoryChildTagsRequest): Promise<MemoryChildTagsResponse> {
    await this.access.requireFull(scope)
    return this.repository.replaceChildTags(scope, memoryId, input)
  }

  async delete(scope: FamilyScope, memoryId: string, expectedVersion: number): Promise<void> {
    await this.access.requireFull(scope)
    return this.repository.delete(scope, memoryId, expectedVersion, this.now())
  }

  async setLike(scope: FamilyScope, memoryId: string, liked: boolean): Promise<LikeResponse> {
    await this.access.requireMember(scope)
    const result = await this.repository.setReaction(scope, memoryId, liked ? 'heart' : null)
    return result.likes
  }

  async setReaction(scope: FamilyScope, memoryId: string, reaction: import('@web-app-demo/contracts').MemoryReaction | null) {
    await this.access.requireMember(scope)
    return this.repository.setReaction(scope, memoryId, reaction)
  }

  async markSeen(scope: FamilyScope, input: SeenMemoriesRequest): Promise<void> {
    await this.access.requireMember(scope)
    await this.repository.markSeen(scope, input)
  }

  private async decorate(scope: FamilyScope, memories: MemoryDto[], includePublicationAttribution: boolean,
    includeChannelAvatar: boolean, includeChildTags: boolean) {
    const attributed = includePublicationAttribution
      ? await this.repository.addPublicationAttribution(scope, memories, includeChannelAvatar)
      : memories
    return includeChildTags ? this.repository.attachChildTags(scope, attributed) : attributed
  }

  private async withChildTags(scope: FamilyScope, memory: MemoryDto, includeChildTags: boolean) {
    return includeChildTags ? (await this.repository.attachChildTags(scope, [memory]))[0]! : memory
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
