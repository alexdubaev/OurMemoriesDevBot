import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { activateUnreadFamily } from '../../../scripts/activate-unread-tracking'
import { childrenFixtures, type FixtureFamily, type FixtureUser } from '../../test-support/children-fixtures'

const childrenHeader = { 'X-Memoly-Children': '1' }

describe('feed filtered by child tags', () => {
  const fx = childrenFixtures()
  afterEach(async () => { await fx.cleanup() })
  afterAll(async () => { await fx.disconnect() })

  async function photos(target: FixtureFamily, memoryId: string, count: number) {
    const ids: string[] = []
    for (let position = 0; position < count; position += 1) {
      const asset = await fx.db.mediaAsset.create({ data: {
        familyId: target.id, uploaderId: target.owner.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
        originalKey: `synthetic/${target.id}/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
        sha256: 'b'.repeat(64), byteSize: 10n, width: 64, height: 48, originalStatus: 'stored', renditionStatus: 'ready',
      } })
      await fx.db.memoryMedia.create({ data: { familyId: target.id, memoryId, mediaId: asset.id, position } })
      ids.push(asset.id)
    }
    return ids
  }

  /**
   * elderNote — elder on the whole publication; youngerPhoto — 5 photos, younger only on the 3rd;
   * bothNote — both children; untaggedNote — no tags.
   */
  async function seeded() {
    const target = await fx.family(undefined, ['Старшая', 'Младший'])
    const [elder, younger] = target.children
    const elderNote = await fx.memory(target, { kind: 'note', tags: [{ childId: elder!.id }] })
    const youngerPhoto = await fx.memory(target, { kind: 'photo' })
    const photoIds = await photos(target, youngerPhoto.id, 5)
    await fx.db.memoryChildTag.create({ data: {
      familyId: target.id, memoryId: youngerPhoto.id, childId: younger!.id, attachmentId: photoIds[2]!, createdBy: target.owner.id,
    } })
    const bothNote = await fx.memory(target, { kind: 'note', tags: [{ childId: elder!.id }, { childId: younger!.id }] })
    const untaggedNote = await fx.memory(target, { kind: 'note' })
    return { target, elder: elder!, younger: younger!, elderNote, youngerPhoto, photoIds, bothNote, untaggedNote }
  }

  const feed = (target: FixtureFamily, query = '', token = target.owner.token, headers: Record<string, string> = {}) =>
    fx.request(`/api/v1/families/${target.id}/memories${query ? `?${query}` : ''}`, token, 'GET', undefined, undefined, headers)
  const ids = (body: { items: Array<{ id: string }> }) => body.items.map(({ id }) => id).sort()

  async function allPages(target: FixtureFamily, query: string, token = target.owner.token) {
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page = await feed(target, `${query}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token)
      expect(page.response.status, JSON.stringify(page.body)).toBe(200)
      seen.push(...page.body.items.map(({ id }: { id: string }) => id))
      cursor = page.body.nextCursor
    } while (cursor)
    return seen.sort()
  }

  test('a child filter returns every memory with any tag of that child, whole and with all its photos', async () => {
    const data = await seeded()
    const elder = await feed(data.target, `childId=${data.elder.id}`)
    expect(elder.response.status).toBe(200)
    expect(ids(elder.body)).toEqual([data.elderNote.id, data.bothNote.id].sort())

    const younger = await feed(data.target, `childId=${data.younger.id}`)
    expect(ids(younger.body)).toEqual([data.youngerPhoto.id, data.bothNote.id].sort())
    const photo = younger.body.items.find(({ id }: { id: string }) => id === data.youngerPhoto.id)
    expect(photo.attachments.map(({ id }: { id: string }) => id)).toEqual(data.photoIds)
  })

  test('the untagged filter returns only memories without a single tag; "all" keeps everything', async () => {
    const data = await seeded()
    const untagged = await feed(data.target, 'untagged=true')
    expect(untagged.response.status).toBe(200)
    expect(ids(untagged.body)).toEqual([data.untaggedNote.id])

    const all = await feed(data.target)
    expect(ids(all.body)).toEqual([data.elderNote.id, data.youngerPhoto.id, data.bothNote.id, data.untaggedNote.id].sort())
  })

  test('filters page with cursors and a cursor cannot switch filters', async () => {
    const data = await seeded()
    expect(await allPages(data.target, `childId=${data.younger.id}`)).toEqual([data.youngerPhoto.id, data.bothNote.id].sort())
    expect(await allPages(data.target, 'untagged=true')).toEqual([data.untaggedNote.id])

    const first = await feed(data.target, `childId=${data.elder.id}&limit=1`)
    const cursor = encodeURIComponent(first.body.nextCursor)
    const switched = await feed(data.target, `untagged=true&limit=1&cursor=${cursor}`)
    expect(switched.response.status).toBe(422)
    const unfiltered = await feed(data.target, `limit=1&cursor=${cursor}`)
    expect(unfiltered.response.status).toBe(422)
  })

  test('a child together with untagged is rejected', async () => {
    const data = await seeded()
    const rejected = await feed(data.target, `childId=${data.elder.id}&untagged=true`)
    expect(rejected.response.status).toBe(422)
    expect(rejected.body.error.code).toBe('INVALID_INPUT')
  })

  test('a child of another family filters to nothing and leaks nothing', async () => {
    const data = await seeded()
    const stranger = await fx.family(undefined, ['Чужой'])
    await fx.memory(stranger, { kind: 'note', tags: [{ childId: stranger.children[0]!.id }] })
    const foreign = await feed(data.target, `childId=${stranger.children[0]!.id}`)
    expect(foreign.response.status).toBe(200)
    expect(foreign.body.items).toEqual([])
    expect((await feed(data.target, `childId=${data.elder.id}`, stranger.owner.token)).response.status).toBe(404)
  })

  test('feed items carry their tags with the children header only', async () => {
    const data = await seeded()
    const tagged = await feed(data.target, `childId=${data.younger.id}`, data.target.owner.token, childrenHeader)
    const photo = tagged.body.items.find(({ id }: { id: string }) => id === data.youngerPhoto.id)
    expect(photo.childTags).toEqual([{ childId: data.younger.id, attachmentId: data.photoIds[2]! }])
    expect(photo.childTagsVersion).toBe(1)
    const untagged = (await feed(data.target, 'untagged=true', data.target.owner.token, childrenHeader)).body.items[0]
    expect(untagged.childTags).toEqual([])

    const legacy = await feed(data.target)
    expect(legacy.body.items.every((item: object) => !('childTags' in item) && !('childTagsVersion' in item))).toBe(true)
  })

  test('the unread feed honours the child and untagged filters across pages', async () => {
    const target = await fx.family(undefined, ['Старшая', 'Младший'])
    const [elder, younger] = target.children
    expect(await activateUnreadFamily(fx.db, target.id)).toBe('activated')
    const relative = await fx.member(target.id, 'full')
    await fx.db.familyMember.update({ where: { familyId_userId: { familyId: target.id, userId: relative.id } }, data: { unreadBaselineOrdinal: 0n } })
    const post = async (author: FixtureUser, childIds: string[]) => {
      const created = await fx.request(`/api/v1/families/${target.id}/memories`, author.token, 'POST',
        { kind: 'note', body: 'Синтетика', occurredAt: '2026-09-08T10:00:00.000Z', childIds }, randomUUID())
      expect(created.response.status, JSON.stringify(created.body)).toBe(201)
      return created.body.id as string
    }
    const elderOne = await post(relative, [elder!.id])
    const elderTwo = await post(relative, [elder!.id, younger!.id])
    const youngerOnly = await post(relative, [younger!.id])
    const untagged = await post(relative, [])
    await post(target.owner, [elder!.id])

    const unread = async (query: string) => {
      const seen: string[] = []
      let cursor: string | null = null
      do {
        const page = await feed(target, `unreadOnly=true&limit=1&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        expect(page.response.status, JSON.stringify(page.body)).toBe(200)
        seen.push(...page.body.items.map(({ id }: { id: string }) => id))
        cursor = page.body.nextCursor
      } while (cursor)
      return seen.sort()
    }
    expect(await unread(`childId=${elder!.id}`)).toEqual([elderOne, elderTwo].sort())
    expect(await unread(`childId=${younger!.id}`)).toEqual([elderTwo, youngerOnly].sort())
    expect(await unread('untagged=true')).toEqual([untagged])
  })
})
