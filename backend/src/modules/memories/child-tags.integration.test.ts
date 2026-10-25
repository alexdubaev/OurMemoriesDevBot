import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { childrenFixtures, type FixtureFamily } from '../../test-support/children-fixtures'
import { createPrismaFamilyAccess } from '../families'
import { createSourceMemoryPublisher } from './infrastructure/source-memory-publisher'

describe('memory creation child tags', () => {
  const fx = childrenFixtures()
  afterEach(async () => { await fx.cleanup() })
  afterAll(async () => { await fx.disconnect() })

  const note = (extra: Record<string, unknown> = {}) => ({
    kind: 'note', body: 'Синтетическая заметка', occurredAt: '2026-09-08T10:00:00.000Z', ...extra,
  })
  const create = (family: FixtureFamily, body: unknown, key = randomUUID(), token = family.owner.token) =>
    fx.request(`/api/v1/families/${family.id}/memories`, token, 'POST', body, key)
  const whole = (...childIds: string[]) => childIds.map((childId) => ({ childId, attachmentId: null }))
    .sort((a, b) => a.childId.localeCompare(b.childId))

  test('without childIds the only live child is tagged on the whole publication', async () => {
    const family = await fx.family(undefined, ['Лиля'])
    const created = await create(family, note())
    expect(created.response.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.childId).toBe(family.children[0]!.id)
    expect(await fx.tags(created.body.id)).toEqual(whole(family.children[0]!.id))
  })

  test('without childIds a family with two live children gets no tags and the oldest child as anchor', async () => {
    const family = await fx.family(undefined, ['Старшая', 'Младший'])
    const created = await create(family, note())
    expect(created.response.status).toBe(201)
    expect(created.body.childId).toBe(family.children[0]!.id)
    expect(await fx.tags(created.body.id)).toEqual([])
  })

  test('a legacy childId alone is treated as not specified', async () => {
    const family = await fx.family(undefined, ['Старшая', 'Младший'])
    const created = await create(family, note({ childId: family.children[1]!.id }))
    expect(created.response.status).toBe(201)
    expect(created.body.childId).toBe(family.children[0]!.id)
    expect(await fx.tags(created.body.id)).toEqual([])
  })

  test('explicit childIds tag exactly those children and the first one becomes the anchor', async () => {
    const family = await fx.family(undefined, ['Старшая', 'Средний', 'Младшая'])
    const [elder, middle, youngest] = family.children
    const created = await create(family, note({ childIds: [youngest!.id, elder!.id] }))
    expect(created.response.status).toBe(201)
    expect(created.body.childId).toBe(youngest!.id)
    expect(await fx.tags(created.body.id)).toEqual(whole(youngest!.id, elder!.id))
    expect((await fx.tags(created.body.id)).some(({ childId }) => childId === middle!.id)).toBe(false)
  })

  test('an empty childIds list publishes without tags even for the only child', async () => {
    const family = await fx.family(undefined, ['Лиля'])
    const created = await create(family, note({ childIds: [] }))
    expect(created.response.status).toBe(201)
    expect(created.body.childId).toBe(family.children[0]!.id)
    expect(await fx.tags(created.body.id)).toEqual([])
  })

  test('a child of another family or a deleted child is rejected as not found', async () => {
    const family = await fx.family(undefined, ['Живой', { name: 'Удалённый', deleted: true }])
    const other = await fx.family(undefined, ['Чужой'])
    for (const childId of [other.children[0]!.id, family.children[1]!.id, randomUUID()]) {
      const rejected = await create(family, note({ childIds: [family.children[0]!.id, childId] }))
      expect(rejected.response.status).toBe(404)
      expect(rejected.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Профиль ребёнка не найден' })
    }
    expect(await fx.db.memory.count({ where: { familyId: family.id } })).toBe(0)
  })

  test('a deleted elder child is never chosen; the remaining only live child is tagged', async () => {
    const family = await fx.family(undefined, [{ name: 'Удалённый', deleted: true }, 'Живая'])
    const created = await create(family, note())
    expect(created.response.status).toBe(201)
    expect(created.body.childId).toBe(family.children[1]!.id)
    expect(await fx.tags(created.body.id)).toEqual(whole(family.children[1]!.id))
  })

  test('a family without a live child still cannot publish', async () => {
    const family = await fx.family(undefined, [{ name: 'Удалённый', deleted: true }])
    const rejected = await create(family, note())
    expect(rejected.response.status).toBe(404)
    expect(rejected.body.error.message).toBe('Профиль ребёнка не найден')
  })

  test('an idempotent replay returns the same memory without duplicating tags', async () => {
    const family = await fx.family(undefined, ['Старшая', 'Младший'])
    const key = randomUUID()
    const body = note({ childIds: family.children.map(({ id }) => id) })
    const first = await create(family, body, key)
    const replay = await create(family, body, key)
    expect(first.response.status).toBe(201)
    expect(replay.response.status).toBe(200)
    expect(replay.body.id).toBe(first.body.id)
    expect(await fx.db.memoryChildTag.count({ where: { memoryId: first.body.id } })).toBe(2)
  })

  test('a viewer cannot publish even with explicit childIds', async () => {
    const family = await fx.family(undefined, ['Лиля'])
    const viewer = await fx.member(family.id, 'viewer')
    const rejected = await create(family, note({ childIds: [family.children[0]!.id] }), randomUUID(), viewer.token)
    expect(rejected.response.status).toBe(403)
    expect(await fx.db.memoryChildTag.count({ where: { familyId: family.id } })).toBe(0)
  })

  test('trusted media replacement drops tags of attachments that are gone and bumps only the tag version once', async () => {
    const family = await fx.family(undefined, ['Старшая', 'Младший'])
    const [elder, younger] = family.children
    const assets = await Promise.all(['a', 'b', 'c'].map((name) => fx.db.mediaAsset.create({ data: {
      familyId: family.id, uploaderId: family.owner.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey: `synthetic/${family.id}/${name}-${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: name.repeat(64), byteSize: 10n, width: 64, height: 48, originalStatus: 'stored', renditionStatus: 'ready',
    } })))
    const [a, b, c] = assets.map(({ id }) => id) as [string, string, string]
    const publisher = createSourceMemoryPublisher(fx.db, createPrismaFamilyAccess(fx.db))
    const scope = { familyId: family.id, principal: { userId: family.owner.id, sessionId: 'synthetic-source' } }
    const memoryId = randomUUID()
    await publisher.publish(scope, { id: memoryId, kind: 'photo', body: '', occurredAt: new Date(), mediaIds: [a, b] })
    expect(await fx.tags(memoryId)).toEqual([])
    await fx.db.memoryChildTag.createMany({ data: [
      { familyId: family.id, memoryId, childId: elder!.id, attachmentId: a, createdBy: family.owner.id },
      { familyId: family.id, memoryId, childId: younger!.id, attachmentId: b, createdBy: family.owner.id },
    ] })

    await publisher.replaceOrderedMedia(scope, memoryId, [a, c])
    expect(await fx.tags(memoryId)).toEqual([{ childId: elder!.id, attachmentId: a }])
    const replaced = await fx.db.memory.findUniqueOrThrow({ where: { id: memoryId } })
    expect(replaced.childTagsVersion).toBe(2)

    await publisher.replaceOrderedMedia(scope, memoryId, [a, c])
    expect((await fx.db.memory.findUniqueOrThrow({ where: { id: memoryId } })).childTagsVersion).toBe(2)
    await fx.db.memoryMedia.deleteMany({ where: { memoryId } })
  })

  test('trusted source publication honours explicit childIds and replays without new tags', async () => {
    const family = await fx.family(undefined, ['Старшая', 'Младший'])
    const publisher = createSourceMemoryPublisher(fx.db, createPrismaFamilyAccess(fx.db))
    const scope = { familyId: family.id, principal: { userId: family.owner.id, sessionId: 'synthetic-source' } }
    const input = { id: randomUUID(), childIds: [family.children[1]!.id], kind: 'note' as const, body: 'Источник', occurredAt: new Date(), mediaIds: [] }
    await publisher.publish(scope, input)
    await publisher.publish(scope, input)
    expect(await fx.tags(input.id)).toEqual(whole(family.children[1]!.id))
    expect((await fx.db.memory.findUniqueOrThrow({ where: { id: input.id } })).childId).toBe(family.children[1]!.id)
  })

  test('trusted MAX video positions must be contiguous and require the source publication callback', async () => {
    const family = await fx.family(undefined, ['Лиля'])
    const photo = await fx.db.mediaAsset.create({ data: {
      familyId: family.id, uploaderId: family.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'photo',
      originalKey: `synthetic/${family.id}/position-${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: 'a'.repeat(64), byteSize: 10n, width: 64, height: 48, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    const publisher = createSourceMemoryPublisher(fx.db, createPrismaFamilyAccess(fx.db))
    const scope = { familyId: family.id, principal: { userId: family.owner.id, sessionId: 'synthetic-max-video-position' } }
    const base = { kind: 'media' as const, body: '', occurredAt: new Date(), mediaIds: [photo.id], mediaPositions: [0], externalVideoPositions: [1] }
    await expect(publisher.publish(scope, { ...base, id: randomUUID(), externalVideoPositions: [2] }))
      .rejects.toMatchObject({ kind: 'invalid_input' })
    await expect(publisher.publish(scope, { ...base, id: randomUUID() }))
      .rejects.toMatchObject({ kind: 'invalid_input' })
    await expect(publisher.publish(scope, { ...base, kind: 'photo', id: randomUUID() }))
      .rejects.toMatchObject({ kind: 'invalid_input' })
    expect(await fx.db.memory.count({ where: { familyId: family.id } })).toBe(0)
  })
})
