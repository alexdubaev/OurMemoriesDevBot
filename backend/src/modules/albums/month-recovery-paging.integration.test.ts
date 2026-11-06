import { afterAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { albumSocialFixtures } from './infrastructure/album-social-test-fixtures'

requireIntegrationDatabaseUrl()
const f = albumSocialFixtures()
afterAll(f.cleanup)

test('legacy runtime pages a 2000-photo month and refuses lossy full replacement', async () => {
  const owner = await f.user(), family = await f.family(owner)
  const album = await f.db.album.create({ data: { familyId: family.id, childId: family.childId, kind: 'year', title: 'Recovery test', createActorId: owner.id, createOperation: 'synthetic:recovery', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64) } })
  const entry = await f.db.albumEntry.create({ data: { familyId: family.id, albumId: album.id, kind: 'month', monthNumber: 1, orderKey: 1 } })
  const rows = Array.from({ length: 2000 }, (_, position) => ({ mediaId: randomUUID(), position }))
  await f.db.mediaAsset.createMany({ data: rows.map(({ mediaId }) => ({ id: mediaId, familyId: family.id, uploaderId: owner.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo', originalKey: `synthetic/month-recovery/${mediaId}`, declaredMime: 'image/jpeg', verifiedMime: 'image/jpeg', byteSize: 3, sha256: 'b'.repeat(64), originalStatus: 'stored', renditionStatus: 'ready' })) })
  await f.db.albumPhoto.createMany({ data: rows.map(({ mediaId }) => ({ familyId: family.id, mediaId })) })
  await f.db.albumEntrySource.createMany({ data: rows.map(({ mediaId, position }) => ({ familyId: family.id, albumId: album.id, entryId: entry.id, albumPhotoMediaId: mediaId, memoryId: null, sourceKind: 'private_storage', kind: 'photo', sourceId: mediaId, position })) })
  await f.db.$executeRawUnsafe('ALTER TABLE album_entries ADD COLUMN IF NOT EXISTS month_cover_source_id UUID')
  const selectedCover = await f.db.albumEntrySource.findFirstOrThrow({ where: { entryId: entry.id, position: 1000 } })
  await f.db.$executeRaw`UPDATE album_entries SET month_cover_source_id=${selectedCover.id}::uuid WHERE id=${entry.id}::uuid AND album_id=${album.id}::uuid AND family_id=${family.id}::uuid`
  const legacyEntry = await f.db.albumEntry.create({ data: { familyId: family.id, albumId: album.id, kind: 'month', monthNumber: 2, orderKey: 2 } })
  await f.db.albumEntrySource.createMany({ data: rows.slice(0, 50).map(({ mediaId, position }) => ({ familyId: family.id, albumId: album.id, entryId: legacyEntry.id, albumPhotoMediaId: mediaId, memoryId: null, sourceKind: 'private_storage', kind: 'photo', sourceId: mediaId, position })) })
  const legacyCover = await f.db.albumEntrySource.findFirstOrThrow({ where: { entryId: legacyEntry.id, position: 30 } })
  await f.db.$executeRaw`UPDATE album_entries SET month_cover_source_id=${legacyCover.id}::uuid WHERE id=${legacyEntry.id}::uuid AND album_id=${album.id}::uuid AND family_id=${family.id}::uuid`
  const legacyDetail = await f.request(`/api/v1/families/${family.id}/albums/${album.id}/entries/${legacyEntry.id}`, owner.token)
  expect(legacyDetail.body.entry.sources).toHaveLength(50)
  expect(legacyDetail.body.entry.sources[0].id).toBe(legacyCover.id)
  expect(legacyDetail.body.entry.capabilities.edit).toBe(true)
  const root = `/api/v1/families/${family.id}/albums/${album.id}/entries/${entry.id}`
  const detail = await f.request(root, owner.token)
  expect(detail.response.status).toBe(200)
  expect(detail.body.entry.sourceCount).toBe(2000)
  expect(detail.body.entry.sources).toHaveLength(24)
  const rejected = await f.request(`${root}/sources`, owner.token, 'PUT', { expectedVersion: 1, sources: [] }, randomUUID())
  expect(rejected.response.status).toBe(409)
  let cursor: string | undefined, count = 0
  const seen = new Set<string>()
  do {
    const query = cursor ? `?limit=24&cursor=${encodeURIComponent(cursor)}` : '?limit=24'
    const page = await f.request(`${root}/month-sources${query}`, owner.token)
    expect(page.response.status).toBe(200)
    expect(page.body.items.length).toBeLessThanOrEqual(24)
    expect(page.body.total).toBe(2000)
    if (!cursor) expect(page.body.items[0].id).toBe(selectedCover.id)
    for (const source of page.body.items) { expect(seen.has(source.id)).toBe(false); seen.add(source.id) }
    count += page.body.items.length
    cursor = page.body.nextCursor ?? undefined
  } while (cursor)
  expect(count).toBe(2000)
  expect(seen.size).toBe(2000)
  expect(await f.db.albumEntrySource.count({ where: { entryId: entry.id } })).toBe(2000)
})
