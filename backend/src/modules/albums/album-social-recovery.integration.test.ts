import { afterAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { albumEntryDiscussionSummarySchema } from '@web-app-demo/contracts'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { albumSocialFixtures } from './infrastructure/album-social-test-fixtures'

requireIntegrationDatabaseUrl()
const f = albumSocialFixtures()
afterAll(f.cleanup)

async function month(photoCount = 0) {
  const owner = await f.user(), family = await f.family(owner)
  const album = await f.db.album.create({ data: {
    familyId: family.id, childId: family.childId, kind: 'year', title: 'Синтетический первый год',
    createActorId: owner.id, createOperation: 'synthetic:recovery', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64),
  } })
  const entry = await f.db.albumEntry.create({ data: { familyId: family.id, albumId: album.id, kind: 'month', monthNumber: 1, orderKey: 1, caption: 'До очистки' } })
  const mediaIds: string[] = []
  for (let position = 0; position < photoCount; position++) {
    const asset = await f.db.mediaAsset.create({ data: {
      familyId: family.id, uploaderId: owner.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey: `synthetic/album-social-recovery/${randomUUID()}`, declaredMime: 'image/jpeg', verifiedMime: 'image/jpeg',
      byteSize: 3, sha256: 'a'.repeat(64), originalStatus: 'stored', renditionStatus: 'ready',
    } })
    mediaIds.push(asset.id)
    await f.db.albumPhoto.create({ data: { familyId: family.id, mediaId: asset.id } })
    await f.db.albumEntrySource.create({ data: { familyId: family.id, albumId: album.id, entryId: entry.id, albumPhotoMediaId: asset.id, memoryId: null, sourceKind: 'private_storage', kind: 'photo', sourceId: asset.id, position } })
  }
  const path = `/api/v1/families/${family.id}/albums/${album.id}/entries/${entry.id}`
  const key = randomUUID()
  expect((await f.request(`${path}/comments`, owner.token, 'POST', { body: 'Старое обсуждение', discussionGeneration: 1 }, key)).response.status).toBe(201)
  expect((await f.request(`${path}/reaction`, owner.token, 'PUT', { reaction: 'heart', discussionGeneration: 1 })).response.status).toBe(200)
  return { owner, family, album, entry, path, key, mediaIds }
}
async function legacyClear(t: Awaited<ReturnType<typeof month>>) {
  const { owner, family, album, entry } = t
  // Exact data mutations of clearEntry at pinned 26cfab9c. The recovery runtime
  // predates discussionGeneration and cannot know about social tables.
  await f.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${owner.id}::uuid FOR SHARE`
    await tx.$queryRaw`SELECT id FROM families WHERE id=${family.id}::uuid AND status='active' FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM albums WHERE id=${album.id}::uuid AND family_id=${family.id}::uuid AND deleted_at IS NULL FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM album_entries WHERE id=${entry.id}::uuid AND album_id=${album.id}::uuid AND family_id=${family.id}::uuid AND deleted_at IS NULL FOR UPDATE`
    await tx.albumEntrySource.deleteMany({ where: { familyId: family.id, albumId: album.id, entryId: entry.id } })
    await tx.albumEntry.update({ where: { id: entry.id }, data: { title: null, caption: null, childQuote: null, category: null, dateValue: null, datePrecision: 'unknown', version: { increment: 1 } } })
    await tx.album.update({ where: { id: album.id }, data: { version: { increment: 1 } } })
  })
}

test('pinned S3 recovery runtime month clear cannot resurrect discussion when the new runtime returns', async () => {
  for (const photos of [0, 2]) {
    const t = await month(photos)
    await legacyClear(t)
    expect((await f.request(t.path, t.owner.token, 'PATCH', { caption: 'Новая история', expectedVersion: 2 })).response.status).toBe(200)
    const result = await f.request(`${t.path}/discussion`, t.owner.token)
    expect(result.response.status).toBe(200)
    const summary = albumEntryDiscussionSummarySchema.parse(result.body)
    expect(summary.comments.count).toBe(0)
    expect(summary.reactionCounts).toEqual({})
    expect(summary.discussionGeneration).toBe(2)
    expect((await f.request(`${t.path}/comments`, t.owner.token, 'POST', { body: 'Старое обсуждение', discussionGeneration: 1 }, t.key)).response.status).toBe(409)
    await f.db.idempotencyRecord.deleteMany({ where: { actorUserId: t.owner.id, key: t.key } })
    expect((await f.request(`${t.path}/comments`, t.owner.token, 'POST', { body: 'Старое обсуждение', discussionGeneration: 2 }, t.key)).response.status).toBe(409)
    expect(await f.db.mediaAsset.count({ where: { id: { in: t.mediaIds }, deletedAt: null } })).toBe(photos)
  }
})

test('current all-null ordinary edit and refill preserve discussion and the preservation hint is transaction local', async () => {
  const t = await month()
  expect((await f.request(t.path, t.owner.token, 'PATCH', { expectedVersion: 1, title: null, caption: null, childQuote: null, category: null, date: { precision: 'unknown', value: null } })).response.status).toBe(200)
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).response.status).toBe(409)
  expect((await f.request(t.path, t.owner.token, 'PATCH', { expectedVersion: 2, caption: 'История после редактирования' })).response.status).toBe(200)
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).body).toMatchObject({ discussionGeneration: 1, comments: { count: 1 }, reactionCounts: { heart: 1 } })
  await legacyClear(t)
  expect((await f.db.albumEntry.findUniqueOrThrow({ where: { id: t.entry.id } })).discussionGeneration).toBe(2)
  expect(await f.db.albumEntryComment.count({ where: { entryId: t.entry.id, deletedAt: null } })).toBe(0)
})

test('legacy nonempty edits, source order changes and current source selection removal preserve discussion', async () => {
  const t = await month(2)
  await f.db.albumEntry.update({ where: { id: t.entry.id }, data: { caption: 'Обычная правка старого клиента', version: { increment: 1 } } })
  await f.db.albumEntry.update({ where: { id: t.entry.id }, data: { orderKey: 1000 } })
  await f.db.albumEntrySource.updateMany({ where: { entryId: t.entry.id, position: 0 }, data: { position: 3 } })
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).body).toMatchObject({ discussionGeneration: 1, comments: { count: 1 }, reactionCounts: { heart: 1 } })
  expect((await f.request(`${t.path}/sources`, t.owner.token, 'PUT', { expectedVersion: 1, sources: [] }, randomUUID())).response.status).toBe(200)
  expect((await f.request(`${t.path}/discussion`, t.owner.token)).body).toMatchObject({ discussionGeneration: 1, comments: { count: 1 }, reactionCounts: { heart: 1 } })
})
