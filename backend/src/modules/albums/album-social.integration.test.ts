import { afterAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { albumEntryCommentMutationResponseSchema, albumEntryCommentPageSchema, albumEntryDiscussionSummarySchema, albumEntryPageSchema, apiErrorSchema } from '@web-app-demo/contracts'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { albumSocialFixtures } from './infrastructure/album-social-test-fixtures'

requireIntegrationDatabaseUrl()
const f = albumSocialFixtures()
const albumIds: string[] = []
afterAll(async () => {
  await f.db.album.deleteMany({ where: { id: { in: albumIds } } })
  await f.cleanup()
})
async function target(kind: 'free' | 'events' | 'workshop' | 'year' = 'events', owner?: Awaited<ReturnType<typeof f.user>>, family?: Awaited<ReturnType<typeof f.family>>) {
  owner ??= await f.user()
  family ??= await f.family(owner)
  const album = await f.db.album.create({ data: {
    familyId: family.id, childId: kind === 'free' ? null : family.childId, kind, title: 'Синтетический альбом',
    createActorId: owner.id, createOperation: 'synthetic:album', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64),
  } })
  albumIds.push(album.id)
  const entry = await f.db.albumEntry.create({ data: {
    familyId: family.id, albumId: album.id, kind: kind === 'year' ? 'month' : kind === 'workshop' ? 'work' : 'event',
    monthNumber: kind === 'year' ? 1 : null, title: 'История', caption: 'Синтетическая история', orderKey: 1,
  } })
  return { owner, family, album, entry, path: `/api/v1/families/${family.id}/albums/${album.id}/entries/${entry.id}` }
}
const create = (t: Awaited<ReturnType<typeof target>>, token = t.owner.token, body = 'Комментарий', key = randomUUID(), discussionGeneration = 1) =>
  f.request(`${t.path}/comments`, token, 'POST', { body, discussionGeneration }, key)
async function attachPhotos(t: Awaited<ReturnType<typeof target>>, count: number) {
  const assets = await Promise.all(Array.from({ length: count }, () => f.db.mediaAsset.create({ data: {
    familyId: t.family.id, uploaderId: t.owner.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
    originalKey: `synthetic/album-social/${randomUUID()}`, declaredMime: 'image/jpeg', verifiedMime: 'image/jpeg', sha256: 'a'.repeat(64),
    byteSize: 3, width: 640, height: 480, originalStatus: 'stored', renditionStatus: 'ready',
  } })))
  const album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
  const result = await f.request(`${t.path}/sources`, t.owner.token, 'PUT', { expectedVersion: album.version, sources: assets.map(({ id }) => ({ sourceKind: 'private_storage', sourceId: id, memoryId: null })) }, randomUUID())
  expect(result.response.status).toBe(200)
  return assets
}
async function removeComment(t: Awaited<ReturnType<typeof target>>, commentId: string, token = t.owner.token, version = 1, generation = 1) {
  return f.app.request(`${t.path}/comments/${commentId}?discussionGeneration=${generation}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'If-Match': String(version) } })
}
async function reaction(t: Awaited<ReturnType<typeof target>>, value: 'heart' | 'love' | 'laugh' | 'touched' | 'wow' | 'clap' | null, token = t.owner.token, generation = 1) {
  return f.request(`${t.path}/reaction`, token, 'PUT', { reaction: value, discussionGeneration: generation })
}

test('album-only history persists comments for owner/full/viewer without creating a Memory or changing album versions', async () => {
  const t = await target('workshop')
  await attachPhotos(t, 3)
  const albumBefore = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
  const memoryCount = await f.db.memory.count({ where: { familyId: t.family.id } })
  for (const role of ['owner', 'full', 'viewer'] as const) {
    const actor = role === 'owner' ? t.owner : await f.user()
    if (role !== 'owner') await f.db.familyMember.create({ data: { familyId: t.family.id, userId: actor.id, role } })
    const result = await create(t, actor.token, '  Привет\r\n😀  ')
    expect(result.response.status).toBe(201)
    expect(result.response.headers.get('cache-control')).toBe('private, no-store')
    const mutation = albumEntryCommentMutationResponseSchema.parse(result.body)
    expect(mutation.comment).toMatchObject({ entryId: t.entry.id, albumId: t.album.id, familyId: t.family.id, discussionGeneration: 1, body: 'Привет\n😀', author: { id: actor.id }, capabilities: { edit: true, delete: true } })
    const read = await f.request(`${t.path}/comments?discussionGeneration=1`, actor.token)
    expect(read.response.status).toBe(200)
    expect(albumEntryCommentPageSchema.parse(read.body).items.some(({ id }) => id === mutation.comment.id)).toBe(true)
    const summary = await f.request(`${t.path}/discussion`, actor.token)
    expect(summary.response.status).toBe(200)
    expect(albumEntryDiscussionSummarySchema.parse(summary.body).comments.count).toBeGreaterThan(0)
    if (role === 'viewer') expect((await f.request(t.path, actor.token, 'PATCH', { caption: 'Нет', expectedVersion: 1 })).response.status).toBe(403)
  }
  expect(await f.db.memory.count({ where: { familyId: t.family.id } })).toBe(memoryCount)
  expect((await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })).version).toBe(albumBefore.version)
  expect(await f.db.albumEntrySource.count({ where: { entryId: t.entry.id } })).toBe(3)
  expect(await f.db.albumEntryComment.count({ where: { entryId: t.entry.id } })).toBe(3)
})

test('the same direct or feed photo in two stories preserves distinct source associations and separate discussions', async () => {
  for (const kind of ['direct', 'feed'] as const) {
    const t = await target('free')
    const secondEntry = await f.db.albumEntry.create({ data: { familyId: t.family.id, albumId: t.album.id, kind: 'event', orderKey: 2, title: 'Вторая история', caption: 'Другой контекст того же фото' } })
    const other = { ...t, entry: secondEntry, path: t.path.replace(t.entry.id, secondEntry.id) }
    let photoId: string, memoryId: string | null
    if (kind === 'direct') {
      photoId = (await attachPhotos(t, 1))[0]!.id
      memoryId = null
    } else {
      const memory = await f.memory(t.family, t.owner, 'photo')
      memoryId = memory.id
      const asset = await f.db.mediaAsset.create({ data: {
        familyId: t.family.id, uploaderId: t.owner.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
        originalKey: `synthetic/shared-feed-photo/${randomUUID()}`, declaredMime: 'image/jpeg', verifiedMime: 'image/jpeg',
        sha256: 'b'.repeat(64), byteSize: 3, width: 640, height: 480, originalStatus: 'stored', renditionStatus: 'ready',
      } })
      photoId = asset.id
      await f.db.memoryMedia.create({ data: { familyId: t.family.id, memoryId, mediaId: photoId, position: 0 } })
      expect((await f.request(`${t.path}/sources`, t.owner.token, 'PUT', { expectedVersion: 1, sources: [{ sourceKind: 'private_storage', sourceId: photoId, memoryId }] }, randomUUID())).response.status).toBe(200)
    }
    const before = await f.db.mediaAsset.findUniqueOrThrow({ where: { id: photoId } })
    const album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
    expect((await f.request(`${other.path}/sources`, t.owner.token, 'PUT', { expectedVersion: album.version, sources: [{ sourceKind: 'private_storage', sourceId: photoId, memoryId }] }, randomUUID())).response.status).toBe(200)
    const result = await f.request(`/api/v1/families/${t.family.id}/albums/${t.album.id}/entries`, t.owner.token)
    expect(result.response.status).toBe(200)
    const page = albumEntryPageSchema.parse(result.body)
    expect(page.items.map(({ id }) => id)).toEqual([t.entry.id, other.entry.id])
    const sourceRows = await f.db.albumEntrySource.findMany({ where: { albumId: t.album.id }, orderBy: { entryId: 'asc' } })
    expect(sourceRows).toHaveLength(2)
    expect(new Set(page.items.flatMap(({ sources }) => sources.map(({ id }) => id))).size).toBe(2)
    for (const entry of page.items) {
      expect(entry.sourceCount).toBe(1)
      expect(entry.sources).toMatchObject([{ id: sourceRows.find(({ entryId }) => entryId === entry.id)!.id, sourceId: photoId, memoryId, available: true, attachment: { id: photoId } }])
    }
    await create(t, t.owner.token, 'Первая история')
    await create(other, t.owner.token, 'Вторая история')
    await create(other, t.owner.token, 'Ещё о второй')
    await reaction(t, 'heart')
    await reaction(other, 'wow')
    expect((await f.request(`${t.path}/discussion`, t.owner.token)).body).toMatchObject({ comments: { count: 1 }, reactionCounts: { heart: 1 }, currentUserReaction: 'heart' })
    expect((await f.request(`${other.path}/discussion`, t.owner.token)).body).toMatchObject({ comments: { count: 2 }, reactionCounts: { wow: 1 }, currentUserReaction: 'wow' })
    expect((await f.request(`${t.path}/comments?discussionGeneration=1`, t.owner.token)).body.items.map((item: { body: string }) => item.body)).toEqual(['Первая история'])
    expect((await f.request(`${other.path}/comments?discussionGeneration=1`, t.owner.token)).body.items.map((item: { body: string }) => item.body).sort()).toEqual(['Вторая история', 'Ещё о второй'].sort())
    expect(await f.db.mediaAsset.findUniqueOrThrow({ where: { id: photoId } })).toEqual(before)
    if (memoryId) {
      expect((await f.request(f.path(t.family.id, memoryId), t.owner.token)).body.summary.count).toBe(0)
      expect(await f.db.memoryLike.count({ where: { memoryId } })).toBe(0)
    } else expect(await f.db.memory.count({ where: { familyId: t.family.id } })).toBe(0)
  }
})

test('durable replay survives lost response and executor TTL, rejects another body or entry, and resolves fresh text', async () => {
  const t = await target(), other = await target('events', t.owner, t.family), key = randomUUID()
  const results = await Promise.all(Array.from({ length: 4 }, () => create(t, t.owner.token, ' same\r\n😀 ', key)))
  expect(results.map(({ response }) => response.status).sort()).toEqual([200, 200, 200, 201])
  const id = albumEntryCommentMutationResponseSchema.parse(results[0]!.body).comment.id
  expect(new Set(results.map(({ body }) => albumEntryCommentMutationResponseSchema.parse(body).comment.id)).size).toBe(1)
  expect((await create(t, t.owner.token, 'different', key)).response.status).toBe(409)
  expect((await create(other, t.owner.token, 'same\n😀', key)).response.status).toBe(409)
  expect((await f.request(`${t.path}/comments/${id}`, t.owner.token, 'PATCH', { body: 'new text', expectedVersion: 1, discussionGeneration: 1 })).response.status).toBe(200)
  expect((await create(t, t.owner.token, 'same\n😀', key)).body.comment.body).toBe('new text')
  await f.db.idempotencyRecord.deleteMany({ where: { actorUserId: t.owner.id, key } })
  const replay = await create(t, t.owner.token, 'same\n😀', key)
  expect(replay.response.status).toBe(200)
  expect(albumEntryCommentMutationResponseSchema.parse(replay.body).comment).toMatchObject({ id, body: 'new text', version: 2 })
  expect((await create(other, t.owner.token, 'same\n😀', key)).response.status).toBe(409)
  expect(await f.db.albumEntryComment.count({ where: { entryId: t.entry.id } })).toBe(1)
  expect((await removeComment(t, id, t.owner.token, 2)).status).toBe(200)
  expect((await create(t, t.owner.token, 'same\n😀', key)).response.status).toBe(409)
})

test('only authors edit; full cannot moderate; owner can delete another author with comment versions', async () => {
  const t = await target(), author = await f.user(), full = await f.user()
  await f.db.familyMember.createMany({ data: [
    { familyId: t.family.id, userId: author.id, role: 'viewer' }, { familyId: t.family.id, userId: full.id, role: 'full' },
  ] })
  const created = await create(t, author.token), id = created.body.comment.id
  for (const actor of [t.owner, full]) {
    const result = await f.request(`${t.path}/comments/${id}`, actor.token, 'PATCH', { body: 'forbidden', expectedVersion: 1, discussionGeneration: 1 })
    expect(result.response.status).toBe(403)
  }
  expect((await removeComment(t, id, full.token)).status).toBe(403)
  const ownerView = await f.request(`${t.path}/comments?discussionGeneration=1`, t.owner.token)
  expect(albumEntryCommentPageSchema.parse(ownerView.body).items[0]!.capabilities).toEqual({ edit: false, delete: true })
  const fullView = await f.request(`${t.path}/comments?discussionGeneration=1`, full.token)
  expect(albumEntryCommentPageSchema.parse(fullView.body).items[0]!.capabilities).toEqual({ edit: false, delete: false })
  expect((await f.request(`${t.path}/comments/${id}`, author.token, 'PATCH', { body: 'changed', expectedVersion: 1, discussionGeneration: 1 })).response.status).toBe(200)
  expect((await f.request(`${t.path}/comments/${id}`, author.token, 'PATCH', { body: 'stale', expectedVersion: 1, discussionGeneration: 1 })).response.status).toBe(409)
  expect((await removeComment(t, id, t.owner.token)).status).toBe(409)
  expect((await removeComment(t, id, t.owner.token, 2)).status).toBe(200)
  expect((await removeComment(t, id, t.owner.token, 2)).status).toBe(200)
  expect(await f.db.albumEntryComment.findUniqueOrThrow({ where: { id } })).toMatchObject({ body: '', version: 3 })
})

test('strict requests, signed pagination and UUID canonicalization retain distinct album and feed discussions', async () => {
  const t = await target('free'), other = await target('free', t.owner, t.family)
  const memory = await f.memory(t.family, t.owner)
  await f.db.albumEntrySource.createMany({ data: [t, other].map((item) => ({ familyId: t.family.id, albumId: item.album.id, entryId: item.entry.id, memoryId: memory.id, sourceKind: 'memory', sourceId: memory.id, kind: 'note' })) })
  const feed = await f.request(f.path(t.family.id, memory.id), t.owner.token, 'POST', { body: 'feed only' }, randomUUID())
  expect(feed.response.status).toBe(201)
  const key = randomUUID(), first = await create(t, t.owner.token, 'one', key)
  const upper = await f.request(`${t.path.toUpperCase().replace('/API/V1/FAMILIES/', '/api/v1/families/').replace('/ALBUMS/', '/albums/').replace('/ENTRIES/', '/entries/')}/comments`, t.owner.token, 'POST', { body: 'one', discussionGeneration: 1 }, key.toUpperCase())
  expect(upper.response.status).toBe(200)
  expect(upper.body.comment.id).toBe(first.body.comment.id)
  await create(t, t.owner.token, 'two')
  await create(other, t.owner.token, 'another entry')
  const page = await f.request(`${t.path}/comments?discussionGeneration=1&limit=1`, t.owner.token)
  const parsed = albumEntryCommentPageSchema.parse(page.body)
  expect(parsed.items).toHaveLength(1)
  expect(parsed.nextCursor).not.toBeNull()
  const older = await f.request(`${t.path}/comments?discussionGeneration=1&cursor=${encodeURIComponent(parsed.nextCursor!)}`, t.owner.token)
  expect(older.response.status).toBe(200)
  expect(older.body.items[0].id).not.toBe(parsed.items[0]!.id)
  for (const invalidPath of [
    `${other.path}/comments?discussionGeneration=1&cursor=${encodeURIComponent(parsed.nextCursor!)}`,
    `${t.path}/comments?discussionGeneration=2&cursor=${encodeURIComponent(parsed.nextCursor!)}`,
    `${t.path}/comments?discussionGeneration=1&cursor=${encodeURIComponent(parsed.nextCursor! + 'x')}`,
  ]) expect((await f.request(invalidPath, t.owner.token)).response.status).toBe(422)
  const feedPage = await f.request(f.path(t.family.id, memory.id), t.owner.token)
  expect(feedPage.body.items.map((item: { body: string }) => item.body)).toEqual(['feed only'])
  expect((await f.request(`${f.path(t.family.id, memory.id)}?cursor=${encodeURIComponent(parsed.nextCursor!)}`, t.owner.token)).response.status).toBe(400)
  for (const input of [{ body: '', discussionGeneration: 1 }, { body: 'a\0b', discussionGeneration: 1 }, { body: 'a' }, { body: 'a', discussionGeneration: 1, authorId: t.owner.id }])
    expect((await f.request(`${t.path}/comments`, t.owner.token, 'POST', input, randomUUID())).response.status).toBe(422)
  for (const [payload, status] of [['{', 422], [JSON.stringify({ body: 'x'.repeat(17_000), discussionGeneration: 1 }), 413]] as const) {
    const response = await f.app.request(`${t.path}/comments`, { method: 'POST', headers: { Authorization: `Bearer ${t.owner.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: payload })
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(apiErrorSchema.safeParse(await response.json()).success).toBe(true)
  }
})

test('one current reaction per participant replaces or removes counts and never changes MemoryLike', async () => {
  const t = await target(), viewer = await f.user()
  await f.db.familyMember.create({ data: { familyId: t.family.id, userId: viewer.id, role: 'viewer' } })
  for (const value of ['heart', 'heart', 'wow', null, null] as const) {
    const result = await reaction(t, value, viewer.token)
    expect(result.response.status).toBe(200)
    expect(albumEntryDiscussionSummarySchema.parse(result.body)).toMatchObject({ reactionCounts: value ? { [value]: 1 } : {}, currentUserReaction: value })
  }
  await reaction(t, 'clap')
  await reaction(t, 'clap', viewer.token)
  expect((await f.request(`${t.path}/discussion`, viewer.token)).body.reactionCounts).toEqual({ clap: 2 })
  await f.db.familyMember.update({ where: { familyId_userId: { familyId: t.family.id, userId: viewer.id } }, data: { revokedAt: new Date() } })
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).body.reactionCounts).toEqual({ clap: 1 })
  expect(await f.db.memoryLike.count({ where: { familyId: t.family.id } })).toBe(0)
})

test('foreign family/album/entry IDs and composite database links cannot cross scopes', async () => {
  const t = await target(), foreign = await target(), sameFamily = await target('events', t.owner, t.family)
  for (const path of [t.path.replace(t.family.id, foreign.family.id), t.path.replace(t.album.id, sameFamily.album.id), t.path.replace(t.entry.id, foreign.entry.id)]) {
    expect((await f.request(`${path}/discussion`, t.owner.token)).response.status).toBe(404)
    expect((await f.request(`${path}/comments`, t.owner.token, 'POST', { body: 'no', discussionGeneration: 1 }, randomUUID())).response.status).toBe(404)
    expect((await f.request(`${path}/reaction`, t.owner.token, 'PUT', { reaction: 'heart', discussionGeneration: 1 })).response.status).toBe(404)
  }
  await expect(Promise.resolve(f.db.albumEntryComment.create({ data: { familyId: t.family.id, albumId: sameFamily.album.id, entryId: t.entry.id, discussionGeneration: 1, authorId: t.owner.id, body: 'no', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64) } }))).rejects.toThrow()
  await expect(Promise.resolve(f.db.albumEntryReaction.create({ data: { familyId: t.family.id, albumId: foreign.album.id, entryId: t.entry.id, discussionGeneration: 1, userId: t.owner.id, reaction: 'heart' } }))).rejects.toThrow()
})

test('ordinary edits, covers and source reorder preserve discussion while month clear advances generation and keeps retry markers', async () => {
  const t = await target('year'), assets = await attachPhotos(t, 2), key = randomUUID()
  const created = await create(t, t.owner.token, 'old generation', key), id = created.body.comment.id
  await reaction(t, 'love')
  let album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
  const sources = await f.db.albumEntrySource.findMany({ where: { entryId: t.entry.id }, orderBy: { position: 'asc' } })
  expect((await f.request(`/api/v1/families/${t.family.id}/albums/${t.album.id}`, t.owner.token, 'PATCH', { coverSourceId: sources[0]!.id, expectedVersion: album.version })).response.status).toBe(200)
  album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
  expect((await f.request(t.path, t.owner.token, 'PATCH', { caption: 'updated story', expectedVersion: album.version })).response.status).toBe(200)
  album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
  expect((await f.request(`${t.path}/sources`, t.owner.token, 'PUT', { expectedVersion: album.version, sources: [...assets].reverse().map(({ id: sourceId }) => ({ sourceId, memoryId: null, sourceKind: 'private_storage' })) }, randomUUID())).response.status).toBe(200)
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).body).toMatchObject({ discussionGeneration: 1, comments: { count: 1 }, reactionCounts: { love: 1 } })
  album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
  expect((await f.request(`${t.path}/clear`, t.owner.token, 'POST', { expectedVersion: album.version })).response.status).toBe(200)
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).response.status).toBe(409)
  expect((await create(t, t.owner.token, 'old generation', key)).response.status).toBe(409)
  expect((await create(t, t.owner.token, 'empty', randomUUID(), 2)).response.status).toBe(409)
  expect((await reaction(t, 'heart', t.owner.token, 2)).response.status).toBe(409)
  expect(await f.db.albumEntryComment.findUniqueOrThrow({ where: { id } })).toMatchObject({ body: '', discussionGeneration: 1 })
  album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
  expect((await f.request(t.path, t.owner.token, 'PATCH', { caption: 'new chapter', expectedVersion: album.version })).response.status).toBe(200)
  const fresh = await f.request(`${t.path}/discussion`, t.owner.token)
  expect(fresh.body).toMatchObject({ discussionGeneration: 2, comments: { count: 0 }, reactionCounts: {} })
  await f.db.idempotencyRecord.deleteMany({ where: { actorUserId: t.owner.id, key } })
  expect((await create(t, t.owner.token, 'old generation', key)).response.status).toBe(409)
  expect((await create(t, t.owner.token, 'old generation', key, 2)).response.status).toBe(409)
  expect((await create(t, t.owner.token, 'new discussion', randomUUID(), 2)).response.status).toBe(201)
  expect((await f.request(`${t.path}/comments?discussionGeneration=1`, t.owner.token)).response.status).toBe(409)
  expect((await removeComment(t, id)).status).toBe(409)
  expect((await reaction(t, 'heart')).response.status).toBe(409)
  expect(await f.db.mediaAsset.count({ where: { id: { in: assets.map(({ id: mediaId }) => mediaId) }, deletedAt: null } })).toBe(2)
})

test('empty months do not gain a story from title, child quote, unavailable source or comments', async () => {
  const t = await target('year')
  await f.db.albumEntry.update({ where: { id: t.entry.id }, data: { caption: null, childQuote: 'A quote' } })
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).response.status).toBe(409)
  expect((await create(t)).response.status).toBe(409)
  const assets = await attachPhotos(t, 1)
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).response.status).toBe(200)
  await f.db.mediaAsset.update({ where: { id: assets[0]!.id }, data: { originalStatus: 'failed' } })
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).response.status).toBe(409)
})

test('removed entry and album deny social reads, replay and writes but retain original media', async () => {
  for (const removeAlbum of [false, true]) {
    const t = await target('workshop'), assets = await attachPhotos(t, 1), key = randomUUID(), created = await create(t, t.owner.token, 'before delete', key)
    const album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
    const response = await f.app.request(removeAlbum ? `/api/v1/families/${t.family.id}/albums/${t.album.id}` : t.path, { method: 'DELETE', headers: { Authorization: `Bearer ${t.owner.token}`, 'If-Match': String(album.version) } })
    expect(response.status).toBe(204)
    expect((await f.request(`${t.path}/discussion`, t.owner.token)).response.status).toBe(404)
    expect((await f.request(`${t.path}/comments?discussionGeneration=1`, t.owner.token)).response.status).toBe(404)
    expect((await create(t, t.owner.token, 'before delete', key)).response.status).toBe(404)
    expect((await removeComment(t, created.body.comment.id)).status).toBe(404)
    expect((await reaction(t, 'heart')).response.status).toBe(404)
    expect((await f.db.mediaAsset.findUniqueOrThrow({ where: { id: assets[0]!.id } })).deletedAt).toBeNull()
  }
})

test('revoked memberships and sessions cannot read, create, replay, edit, delete or react', async () => {
  for (const revokeSession of [false, true]) {
    const t = await target(), actor = await f.user(), key = randomUUID()
    await f.db.familyMember.create({ data: { familyId: t.family.id, userId: actor.id, role: 'viewer' } })
    const created = await create(t, actor.token, 'before revoke', key), id = created.body.comment.id
    if (revokeSession) await f.db.authSession.updateMany({ where: { userId: actor.id }, data: { revokedAt: new Date() } })
    else await f.db.familyMember.update({ where: { familyId_userId: { familyId: t.family.id, userId: actor.id } }, data: { revokedAt: new Date() } })
    for (const result of [
      await f.request(`${t.path}/discussion`, actor.token), await f.request(`${t.path}/comments?discussionGeneration=1`, actor.token),
      await create(t, actor.token, 'before revoke', key), await create(t, actor.token),
      await f.request(`${t.path}/comments/${id}`, actor.token, 'PATCH', { body: 'no', expectedVersion: 1, discussionGeneration: 1 }), await reaction(t, 'heart', actor.token),
    ]) expect([401, 404]).toContain(result.response.status)
    expect([401, 404]).toContain((await removeComment(t, id, actor.token)).status)
    expect((await f.db.albumEntryComment.findUniqueOrThrow({ where: { id } })).body).toBe('before revoke')
  }
})

test('writes and fresh replay waiting behind a membership revoke fail inside the transaction', async () => {
  const t = await target(), actor = await f.user(), key = randomUUID()
  await f.db.familyMember.create({ data: { familyId: t.family.id, userId: actor.id, role: 'viewer' } })
  const created = await create(t, actor.token, 'kept', key), id = created.body.comment.id
  const blocker = await f.blocker('UPDATE family_members SET revoked_at=now() WHERE family_id=$1 AND user_id=$2', [t.family.id, actor.id])
  const pending: Array<Promise<{ status: number }>> = []
  try {
    const unwrap = (request: ReturnType<typeof f.request>) => request.then(({ response }) => ({ status: response.status }))
    pending.push(
      unwrap(create(t, actor.token, 'kept', key)), unwrap(create(t, actor.token, 'no write')),
      unwrap(f.request(`${t.path}/comments/${id}`, actor.token, 'PATCH', { body: 'no edit', expectedVersion: 1, discussionGeneration: 1 })),
      removeComment(t, id, actor.token).then(({ status }) => ({ status })), unwrap(reaction(t, 'heart', actor.token)),
      unwrap(f.request(`${t.path}/comments?discussionGeneration=1`, actor.token)), unwrap(f.request(`${t.path}/discussion`, actor.token)),
    )
    await f.waitLocked(blocker, 'SELECT user_id FROM family_members')
    await blocker.query('COMMIT')
    for (const result of await Promise.all(pending)) expect(result.status).toBe(404)
    expect((await f.db.albumEntryComment.findUniqueOrThrow({ where: { id } })).body).toBe('kept')
    expect(await f.db.albumEntryComment.count({ where: { entryId: t.entry.id } })).toBe(1)
    expect(await f.db.albumEntryReaction.count({ where: { entryId: t.entry.id } })).toBe(0)
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined)
    await blocker.end()
    await Promise.allSettled(pending)
  }
})

test('a request authenticated before concurrent session revocation is denied at the locked session', async () => {
  const t = await target()
  const blocker = await f.blocker('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1', [t.owner.id])
  let pending: ReturnType<typeof create> | undefined
  try {
    pending = create(t)
    await f.waitLocked(blocker, 'SELECT id FROM auth_sessions')
    await blocker.query('COMMIT')
    expect((await pending).response.status).toBe(404)
    expect(await f.db.albumEntryComment.count({ where: { entryId: t.entry.id } })).toBe(0)
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined)
    await blocker.end()
    if (pending) await Promise.allSettled([pending])
  }
})

test('real month clear and entry delete serialize late sends, replay and reactions before returning counters', async () => {
  for (const clearMonth of [true, false]) {
    const t = await target(clearMonth ? 'year' : 'workshop'), key = randomUUID()
    await attachPhotos(t, 1)
    await create(t, t.owner.token, 'old text', key)
    const album = await f.db.album.findUniqueOrThrow({ where: { id: t.album.id } })
    const blocker = await f.blocker('SELECT id FROM album_entry_sources WHERE entry_id=$1 FOR UPDATE', [t.entry.id])
    const pending: Array<Promise<Response>> = []
    try {
      const removal = Promise.resolve(f.app.request(clearMonth ? `${t.path}/clear` : t.path, {
        method: clearMonth ? 'POST' : 'DELETE', headers: { Authorization: `Bearer ${t.owner.token}`, 'Content-Type': 'application/json', 'If-Match': String(album.version) },
        ...(clearMonth ? { body: JSON.stringify({ expectedVersion: album.version }) } : {}),
      }))
      pending.push(removal)
      await f.waitLocked(blocker, 'album_entry_sources')
      const sends = [create(t, t.owner.token, 'late'), create(t, t.owner.token, 'old text', key), reaction(t, 'heart')].map((request) => request.then(({ response }) => response))
      pending.push(...sends)
      await f.waitLocked(blocker, 'SELECT owner_user_id FROM families')
      await blocker.query('COMMIT')
      expect((await removal).status).toBe(clearMonth ? 200 : 204)
      for (const response of await Promise.all(sends)) expect(response.status).toBe(clearMonth ? 409 : 404)
      expect(await f.db.albumEntryComment.count({ where: { entryId: t.entry.id, deletedAt: null, discussionGeneration: clearMonth ? 2 : 1 } })).toBe(clearMonth ? 0 : 1)
      expect(await f.db.albumEntryReaction.count({ where: { entryId: t.entry.id } })).toBe(0)
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      await blocker.end()
      await Promise.allSettled(pending)
    }
  }
})
