import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import {
  PRIVATE_CACHE_LIMIT_BYTES,
  PRIVATE_CACHE_LIMIT_ENTRIES,
  PRIVATE_CACHE_MAX_IMAGE_BYTES,
  PRIVATE_CACHE_SCHEMA,
  activatePrivateCacheIdentity,
  allowPrivateFamilyCache,
  cachePrivateImageResponse,
  clearPrivateUserCache,
  markPrivateImageFresh,
  persistPrivateQueryCache,
  persistentUiQueryKey,
  privateFamilyCacheGeneration,
  privateImageValidator,
  readPrivateImage,
  readPrivateImageEntry,
  removePrivateFamilyCache,
  removePrivateImage,
  restorePrivateQueryCache,
} from '../src/platform/persistence/private-cache'
import { installFakeIndexedDb } from './indexeddb-fake'

const userId = 'storage-user'
const familyId = '11111111-1111-4111-8111-111111111111'
const otherFamilyId = '55555555-5555-4555-8555-555555555555'
const mediaId = (index: number) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`
const preview = (index: number, family = familyId) => `/api/v1/families/${family}/media/${mediaId(index)}/content?variant=preview`
const entryId = (path: string) => `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}:image:${path}`
const imageResponse = (bytes = 1024, etag?: string) => new Response(new Uint8Array(bytes).fill(7), {
  status: 200, headers: { 'content-type': 'image/webp', ...(etag ? { etag } : {}) },
})
const holdsBytes = (value: Record<string, unknown>) => Object.values(value).some((field) => field instanceof ArrayBuffer || ArrayBuffer.isView(field) || field instanceof Blob)

let database: ReturnType<typeof installFakeIndexedDb>
let generation = 0
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
const originalKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange')

beforeEach(() => {
  database = installFakeIndexedDb()
  generation = activatePrivateCacheIdentity(userId)
  allowPrivateFamilyCache(userId, familyId, 1)
})
afterEach(() => {
  activatePrivateCacheIdentity(null)
  for (const [name, original] of [['indexedDB', originalIndexedDb], ['IDBKeyRange', originalKeyRange]] as const) {
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  }
})

const store = (path: string, bytes = 1024, etag?: string) =>
  cachePrivateImageResponse(userId, path, imageResponse(bytes, etag), generation, privateFamilyCacheGeneration(userId, familyId))
/** Every cache mutation shares one queue: a query write queued now settles after all earlier work. */
const drain = () => persistPrivateQueryCache(new QueryClient(), userId, generation)

describe('private image cache capacity', () => {
  test('limits fit a large album: 500 entries, 40 MB per user, 2 MB per image', () => {
    expect(PRIVATE_CACHE_LIMIT_ENTRIES).toBe(500)
    expect(PRIVATE_CACHE_LIMIT_BYTES).toBe(40 * 1024 * 1024)
    expect(PRIVATE_CACHE_MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024)
  })

  test('300 previews of one user stay in the cache', async () => {
    for (let index = 0; index < 300; index += 1) expect(await store(preview(index), 2048)).toBe(true)
    await drain()
    let kept = 0
    for (let index = 0; index < 300; index += 1) if (await readPrivateImage(userId, preview(index))) kept += 1
    expect(kept).toBe(300)
  })
})

describe('private image cache work per operation', () => {
  test('a cache hit refreshes recency without rewriting the image bytes', async () => {
    await store(preview(1))
    await drain()
    const row = database.rows.get(entryId(preview(1)))!
    row.lastAccess = (row.lastAccess as number) - 60_000
    const before = row.lastAccess
    database.log.puts.length = 0

    const blob = await readPrivateImage(userId, preview(1))
    await drain()

    expect(blob?.size).toBe(1024)
    expect(database.rows.get(entryId(preview(1)))?.lastAccess).toBeGreaterThan(before)
    expect(database.log.puts.filter(({ value }) => holdsBytes(value))).toEqual([])
  })

  test('eviction after a batch of writes reads metadata only, not every image', async () => {
    for (let index = 0; index < 20; index += 1) await store(preview(index))
    await drain()
    database.log.cursorValues.length = 0

    await Promise.all(Array.from({ length: 20 }, (_, index) => store(preview(100 + index))))
    await drain()

    expect(database.log.cursorValues.filter(({ value }) => holdsBytes(value))).toEqual([])
    // One pass over 40 entries is 40 cursor steps; a pass per write would be ~600.
    expect(database.log.cursorValues.length).toBeLessThanOrEqual(80)
  })

  test('one IndexedDB connection serves every operation and reopens after the browser closes it', async () => {
    for (let index = 0; index < 5; index += 1) await store(preview(index))
    for (let index = 0; index < 5; index += 1) expect(await readPrivateImage(userId, preview(index))).not.toBeNull()
    await drain()
    expect(database.log.opens).toBe(1)

    database.closeConnections()
    expect(await readPrivateImage(userId, preview(2))).not.toBeNull()
    await drain()
    expect(database.log.opens).toBe(2)
  })
})

describe('private image validators', () => {
  test('the stored ETag is returned with the image and offered for a conditional request', async () => {
    await store(preview(1), 512, '"v1"')
    await drain()
    expect((await readPrivateImageEntry(userId, preview(1)))?.etag).toBe('"v1"')

    privateImageValidator(userId, preview(1))
    await drain()
    await Bun.sleep(0)
    expect(privateImageValidator(userId, preview(1))).toEqual({ cached: true, etag: '"v1"' })
    expect(privateImageValidator(userId, preview(2))).toEqual({ cached: false, etag: null })
  })

  test('confirming an unchanged image updates recency without writing bytes', async () => {
    await store(preview(1), 512, '"v1"')
    await drain()
    const row = database.rows.get(entryId(preview(1)))!
    row.lastAccess = (row.lastAccess as number) - 60_000
    const before = row.lastAccess
    database.log.puts.length = 0

    await markPrivateImageFresh(userId, preview(1), '"v1"')
    await drain()

    expect(database.rows.get(entryId(preview(1)))?.lastAccess).toBeGreaterThan(before)
    expect(database.log.puts.filter(({ value }) => holdsBytes(value))).toEqual([])
    expect((await readPrivateImageEntry(userId, preview(1)))?.etag).toBe('"v1"')
  })

  test('a confirmation from an old family generation changes nothing', async () => {
    await store(preview(1), 512, '"v1"')
    await drain()
    const before = database.rows.get(entryId(preview(1)))!.lastAccess
    const pending = markPrivateImageFresh(userId, preview(1), '"v2"')
    allowPrivateFamilyCache(userId, familyId, 2)
    await pending
    await drain()
    expect(database.rows.get(entryId(preview(1)))?.lastAccess).toBe(before)
  })
})

describe('private image validators at launch', () => {
  test('restoring the saved screens also indexes stored ETags, so lookups answer at once without another scan', async () => {
    await store(preview(1), 512, '"v1"')
    await store(preview(2), 512, '"v2"')
    await drain()
    generation = activatePrivateCacheIdentity(userId)
    allowPrivateFamilyCache(userId, familyId, 1)

    expect(await restorePrivateQueryCache(new QueryClient(), userId, generation)).toBe(true)
    database.log.cursorValues.length = 0

    expect(privateImageValidator(userId, preview(1))).toEqual({ cached: true, etag: '"v1"' })
    expect(privateImageValidator(userId, preview(2))).toEqual({ cached: true, etag: '"v2"' })
    expect(privateImageValidator(userId, preview(3))).toEqual({ cached: false, etag: null })
    await drain()
    await Bun.sleep(0)
    expect(database.log.cursorValues).toEqual([])
  })

  test('an identity switch during the restore scan leaves the next identity without a ready index or keys of the first user', async () => {
    await store(preview(1), 512, '"v1"')
    await drain()
    generation = activatePrivateCacheIdentity(userId)
    const otherUserId = 'storage-other-user'
    const log = database.log.cursorValues
    let switched = false
    log.push = (...values) => {
      if (!switched) {
        switched = true
        activatePrivateCacheIdentity(otherUserId)
      }
      return Array.prototype.push.apply(log, values)
    }

    expect(await restorePrivateQueryCache(new QueryClient(), userId, generation)).toBe(false)
    expect(switched).toBe(true)
    expect(privateImageValidator(otherUserId, preview(1))).toBeUndefined()

    activatePrivateCacheIdentity(userId)
    expect(privateImageValidator(userId, preview(1))).toBeUndefined()
  })
})

describe('private image removal keeps no bytes behind', () => {
  test('removing one image, a family or the user deletes the stored bytes too', async () => {
    await store(preview(1))
    await store(preview(2))
    await store(preview(3))
    await drain()
    const byteRows = () => [...database.store('imageBytes').keys()].length + [...database.rows.values()].filter(holdsBytes).length
    expect(byteRows()).toBe(3)

    await removePrivateImage(userId, preview(1))
    expect(await readPrivateImage(userId, preview(1))).toBeNull()
    expect(byteRows()).toBe(2)

    allowPrivateFamilyCache(userId, otherFamilyId, 1)
    await cachePrivateImageResponse(userId, preview(9, otherFamilyId), imageResponse(), generation, privateFamilyCacheGeneration(userId, otherFamilyId))
    await removePrivateFamilyCache(new QueryClient(), userId, familyId)
    expect(byteRows()).toBe(1)

    await clearPrivateUserCache(userId, generation)
    expect(byteRows()).toBe(0)
    expect(await readPrivateImage(userId, preview(9, otherFamilyId))).toBeNull()
  })
})

describe('private cache schema upgrade', () => {
  test('images and screens saved by the previous version survive the upgrade without byte rewrites', async () => {
    const legacy = preview(7)
    database.seed({
      id: entryId(legacy), userId, familyId, schema: PRIVATE_CACHE_SCHEMA, kind: 'image', key: legacy, size: 3,
      lastAccess: Date.now() - 60_000, imageBytes: new Uint8Array([1, 2, 3]).buffer, imageContentType: 'image/webp',
    })
    const blobOnly = preview(8)
    database.seed({
      id: entryId(blobOnly), userId, familyId, schema: PRIVATE_CACHE_SCHEMA, kind: 'image', key: blobOnly, size: 3,
      lastAccess: Date.now(), blob: new Blob([new Uint8Array([4, 5, 6])], { type: 'image/webp' }),
    })
    const presentation = { home: null, family: null, members: [], screen: 'hub', selectedFamilyId: null, membershipEpoch: null, filter: 'all' }
    database.seed({
      id: `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}:queries:state`, userId, schema: PRIVATE_CACHE_SCHEMA, kind: 'queries', key: 'state', size: 1,
      lastAccess: Date.now(), data: { queries: [{ queryKey: persistentUiQueryKey(userId), data: presentation, updatedAt: 1 }] },
    })

    const restored = new QueryClient()
    expect(await restorePrivateQueryCache(restored, userId, generation)).toBe(true)
    expect(restored.getQueryData(persistentUiQueryKey(userId))).toEqual({ ...presentation, childFilter: null })

    const image = await readPrivateImage(userId, legacy)
    expect([...new Uint8Array(await image!.arrayBuffer())]).toEqual([1, 2, 3])
    // A Blob row from before the byte-buffer format is either readable or cleanly removed.
    const blobImage = await readPrivateImage(userId, blobOnly).catch(() => 'failed' as const)
    expect(blobImage === null || blobImage instanceof Blob).toBe(true)

    database.log.puts.length = 0
    expect(await readPrivateImage(userId, legacy)).not.toBeNull()
    await drain()
    expect(database.log.puts.filter(({ value }) => holdsBytes(value))).toEqual([])
  })
})
