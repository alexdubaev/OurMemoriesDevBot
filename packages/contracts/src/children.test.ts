import { describe, expect, test } from 'bun:test'

import * as contracts from './index'

const ids = {
  family: '018f01d8-0c2a-7c25-bf83-ae68985c7e91',
  childA: '018f01d8-0c2a-7c25-bf83-ae68985c7ea1',
  childB: '018f01d8-0c2a-7c25-bf83-ae68985c7ea2',
  media: '018f01d8-0c2a-7c25-bf83-ae68985c7eb1',
  memory: '018f01d8-0c2a-7c25-bf83-ae68985c7ec1',
  author: '018f01d8-0c2a-7c25-bf83-ae68985c7ed1',
}
const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
const child = (id: string) => ({
  id, name: 'Синтетический ребёнок', birthDate: '2024-01-02', sex: 'girl' as const, avatarMediaId: ids.media,
  avatarCrop: crop, version: 1, isComplete: true,
})
const family = { id: ids.family, name: 'Семья', timezone: 'Europe/Moscow', ownerUserId: ids.author }
const memory = {
  id: ids.memory, familyId: ids.family, childId: ids.childA,
  author: { id: ids.author, name: 'Автор', avatarPath: null },
  kind: 'note' as const, body: 'Запись', occurredAt: '2026-09-09T10:00:00.000Z',
  firstPublishedAt: null, sourcePublishedAt: null, createdAt: '2026-09-09T10:00:00.000Z', version: 1,
  status: 'published' as const, attachments: [], reactionCounts: {}, currentUserReaction: null,
  likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true },
}

describe('children contracts', () => {
  test('family limit and opt-in header are shared constants', () => {
    expect(contracts.MAX_FAMILY_CHILDREN).toBe(12)
    expect(contracts.MEMOLY_CHILDREN_HEADER).toBe('X-Memoly-Children')
  })

  test('create child requires the completed profile fields', () => {
    const input = { name: ' Лиля ', birthDate: '2024-01-02', sex: 'girl' as const, avatarMediaId: ids.media, avatarCrop: crop }
    expect(contracts.createChildRequestSchema.parse(input)).toEqual({ ...input, name: 'Лиля' })
    for (const field of ['name', 'birthDate', 'sex', 'avatarMediaId', 'avatarCrop'] as const) {
      const { [field]: _omitted, ...partial } = input
      expect(contracts.createChildRequestSchema.safeParse(partial).success).toBe(false)
    }
    expect(contracts.createChildRequestSchema.safeParse({ ...input, expectedVersion: 1 }).success).toBe(false)
  })

  test('update child is partial, versioned and keeps the avatar pair together', () => {
    expect(contracts.updateChildRequestSchema.parse({ name: 'Миша', expectedVersion: 2 })).toEqual({ name: 'Миша', expectedVersion: 2 })
    expect(contracts.updateChildRequestSchema.parse({ sex: 'boy', expectedVersion: 1 })).toEqual({ sex: 'boy', expectedVersion: 1 })
    expect(contracts.updateChildRequestSchema.safeParse({ name: 'Миша' }).success).toBe(false)
    expect(contracts.updateChildRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false)
    expect(contracts.updateChildRequestSchema.safeParse({ avatarMediaId: ids.media, expectedVersion: 1 }).success).toBe(false)
    expect(contracts.updateChildRequestSchema.safeParse({ avatarMediaId: ids.media, avatarCrop: crop, expectedVersion: 1 }).success).toBe(true)
  })

  test('child response wraps one child and family response lists children only when present', () => {
    expect(contracts.childResponseSchema.parse({ child: child(ids.childA) }).child.id).toBe(ids.childA)
    const legacy = { family, child: child(ids.childA) }
    expect(contracts.familyResponseSchema.parse(legacy)).toEqual(legacy)
    expect(contracts.familyResponseSchema.parse({ ...legacy, children: [child(ids.childA), child(ids.childB)] }).children?.map(({ id }) => id))
      .toEqual([ids.childA, ids.childB])
    expect(contracts.familyResponseSchema.safeParse({ ...legacy, children: Array.from({ length: 13 }, () => child(ids.childA)) }).success).toBe(false)
  })

  test('memory create accepts legacy childId, optional unique childIds, or neither', () => {
    const base = { kind: 'note', body: 'Текст', occurredAt: '2026-09-09T10:00:00.000Z' }
    expect(contracts.createMemoryRequestSchema.parse({ ...base, childId: ids.childA })).toMatchObject({ childId: ids.childA })
    expect(contracts.createMemoryRequestSchema.parse(base)).not.toHaveProperty('childIds')
    expect(contracts.createMemoryRequestSchema.parse({ ...base, childIds: [] })).toMatchObject({ childIds: [] })
    expect(contracts.createMemoryRequestSchema.parse({ ...base, kind: 'photo', mediaIds: [ids.media], childIds: [ids.childA, ids.childB] }))
      .toMatchObject({ childIds: [ids.childA, ids.childB] })
    expect(contracts.createMemoryRequestSchema.safeParse({ ...base, childIds: [ids.childA, ids.childA] }).success).toBe(false)
    const thirteen = Array.from({ length: 13 }, (_, index) => `018f01d8-0c2a-7c25-bf83-ae68985c7f${String(index).padStart(2, '0')}`)
    expect(contracts.createMemoryRequestSchema.safeParse({ ...base, childIds: thirteen }).success).toBe(false)
    expect(contracts.createMemoryRequestSchema.safeParse({ ...base, childIds: thirteen.slice(0, 12) }).success).toBe(true)
  })

  test('memory DTO child tags are optional and old payloads still validate', () => {
    expect(contracts.memoryDtoSchema.parse(memory)).not.toHaveProperty('childTags')
    const tagged = { ...memory, childTags: [{ childId: ids.childA, attachmentId: null }, { childId: ids.childB, attachmentId: ids.media }], childTagsVersion: 3 }
    expect(contracts.memoryDtoSchema.parse(tagged)).toEqual(tagged)
    expect(contracts.memoryDtoSchema.safeParse({ ...memory, childTags: [{ childId: ids.childA }] }).success).toBe(false)
    expect(contracts.memoryDtoSchema.safeParse({ ...memory, childTagsVersion: 0 }).success).toBe(false)
    expect(contracts.memoryPageSchema.parse({ items: [memory], nextCursor: null }).items).toHaveLength(1)
  })

  test('feed query accepts either a child or untagged filter, not both', () => {
    expect(contracts.listMemoriesQuerySchema.parse({ untagged: 'true' })).toMatchObject({ untagged: true })
    expect(contracts.listMemoriesQuerySchema.parse({ childId: ids.childA })).toMatchObject({ childId: ids.childA })
    expect(contracts.listMemoriesQuerySchema.parse({})).not.toHaveProperty('untagged')
    expect(contracts.listMemoriesQuerySchema.safeParse({ childId: ids.childA, untagged: 'true' }).success).toBe(false)
    expect(contracts.listMemoriesQuerySchema.safeParse({ untagged: 'yes' }).success).toBe(false)
  })

  test('replace child tags is versioned and rejects duplicate tags', () => {
    const tags = [{ childId: ids.childA, attachmentId: null }, { childId: ids.childB, attachmentId: ids.media }]
    expect(contracts.replaceMemoryChildTagsRequestSchema.parse({ tags, expectedChildTagsVersion: 1 })).toEqual({ tags, expectedChildTagsVersion: 1 })
    expect(contracts.replaceMemoryChildTagsRequestSchema.parse({ tags: [], expectedChildTagsVersion: 4 }).tags).toEqual([])
    expect(contracts.replaceMemoryChildTagsRequestSchema.safeParse({ tags }).success).toBe(false)
    expect(contracts.replaceMemoryChildTagsRequestSchema.safeParse({ tags: [tags[0], tags[0]], expectedChildTagsVersion: 1 }).success).toBe(false)
    expect(contracts.memoryChildTagsResponseSchema.parse({ childTags: tags, childTagsVersion: 2 })).toEqual({ childTags: tags, childTagsVersion: 2 })
  })

  test('album catalog accepts an optional child filter', () => {
    expect(contracts.listAlbumsQuerySchema.parse({ childId: ids.childA })).toMatchObject({ childId: ids.childA, filter: 'all' })
    expect(contracts.listAlbumsQuerySchema.parse({})).not.toHaveProperty('childId')
    expect(contracts.listAlbumsQuerySchema.safeParse({ childId: 'not-a-uuid' }).success).toBe(false)
  })
})
