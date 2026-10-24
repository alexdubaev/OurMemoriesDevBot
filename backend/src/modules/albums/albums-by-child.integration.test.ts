import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { childrenFixtures, type FixtureFamily } from '../../test-support/children-fixtures'

describe('albums of one child', () => {
  const fx = childrenFixtures()
  const touchedFamilies: string[] = []

  afterEach(async () => {
    await fx.db.album.deleteMany({ where: { familyId: { in: touchedFamilies } } })
    touchedFamilies.length = 0
    await fx.cleanup()
  })
  afterAll(async () => { await fx.disconnect() })

  async function family(...args: Parameters<typeof fx.family>) {
    const created = await fx.family(...args)
    touchedFamilies.push(created.id)
    return created
  }

  async function album(target: FixtureFamily, childId: string | null, kind: 'free' | 'events' | 'workshop' | 'year', title: string) {
    return fx.db.album.create({ data: {
      familyId: target.id, childId, kind, title,
      createActorId: target.owner.id, createOperation: 'test:create', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64),
    } })
  }

  function list(target: FixtureFamily, query: string, token = target.owner.token) {
    return fx.request(`/api/v1/families/${target.id}/albums?${query}`, token)
  }

  test('lists only albums of the requested child and keeps the filter in the cursor', async () => {
    const target = await family(undefined, ['Лиля', 'Миша'])
    const [lilya, misha] = target.children as [FixtureFamily['children'][0], FixtureFamily['children'][0]]
    const lilyaYear = await album(target, lilya!.id, 'year', 'Первый год Лили')
    await album(target, misha!.id, 'workshop', 'Мастерская Миши')
    await album(target, null, 'free', 'Семейный')
    const lilyaWorkshop = await album(target, lilya!.id, 'workshop', 'Мастерская Лили')

    const first = await list(target, `childId=${lilya!.id}&limit=1`)
    expect(first.response.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([lilyaWorkshop.id])
    expect(first.body.nextCursor).toEqual(expect.any(String))
    const second = await list(target, `childId=${lilya!.id}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
    expect(second.response.status).toBe(200)
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([lilyaYear.id])
    expect(second.body.nextCursor).toBeNull()

    const swapped = await list(target, `childId=${misha!.id}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
    expect(swapped.response.status).toBe(422)
    const unfiltered = await list(target, `limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`)
    expect(unfiltered.response.status).toBe(422)

    const all = await list(target, 'limit=10')
    expect(all.body.items).toHaveLength(4)
  })

  test('a child of another family or a deleted child is not found', async () => {
    const target = await family(undefined, ['Лиля', { name: 'Удалённый', deleted: true }])
    const stranger = await family(undefined, ['Чужой'])
    await album(stranger, stranger.children[0]!.id, 'workshop', 'Чужая мастерская')
    const foreign = await list(target, `childId=${stranger.children[0]!.id}`)
    expect(foreign.response.status).toBe(404)
    const deleted = await list(target, `childId=${target.children[1]!.id}`)
    expect(deleted.response.status).toBe(404)
  })

  test('an album cannot be created for a deleted child', async () => {
    const target = await family(undefined, ['Лиля', { name: 'Удалённый', deleted: true }])
    const deletedChild = target.children[1]!.id
    for (const kind of ['year', 'events', 'workshop'] as const) {
      const created = await fx.request(`/api/v1/families/${target.id}/albums`, target.owner.token, 'POST',
        { kind, title: 'Альбом', childId: deletedChild }, randomUUID())
      expect(created.response.status, `${kind}: ${JSON.stringify(created.body)}`).toBe(404)
    }
    expect(await fx.db.album.count({ where: { familyId: target.id } })).toBe(0)
    const live = await fx.request(`/api/v1/families/${target.id}/albums`, target.owner.token, 'POST',
      { kind: 'workshop', title: 'Альбом', childId: target.children[0]!.id }, randomUUID())
    expect(live.response.status, JSON.stringify(live.body)).toBe(201)
  })
})
