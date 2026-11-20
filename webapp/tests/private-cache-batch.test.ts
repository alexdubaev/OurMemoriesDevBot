import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import {
  PRIVATE_CACHE_MAX_IMAGE_BYTES,
  PRIVATE_CACHE_SCHEMA,
  activatePrivateCacheIdentity,
  allowPrivateFamilyCache,
  cachePrivateImageResponse,
  persistPrivateQueryCache,
  privateFamilyCacheGeneration,
  readPrivateImageEntry,
  subscribePrivateCacheInvalidation,
} from '../src/platform/persistence/private-cache'
import { withControlledTimers } from './controlled-timers'
import { installFakeIndexedDb } from './indexeddb-fake'

const userId = 'batch-user'
const familyId = '11111111-1111-4111-8111-111111111111'
const otherFamilyId = '55555555-5555-4555-8555-555555555555'
const mediaId = (index: number) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`
const preview = (index: number, family = familyId) => `/api/v1/families/${family}/media/${mediaId(index)}/content?variant=preview`
const entryId = (path: string) => `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}:image:${path}`

let database: ReturnType<typeof installFakeIndexedDb>
let generation = 0
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
const originalKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange')

function install(hook?: Parameters<typeof installFakeIndexedDb>[0]) {
  database = installFakeIndexedDb(hook)
  generation = activatePrivateCacheIdentity(userId)
  allowPrivateFamilyCache(userId, familyId, 1)
}

beforeEach(() => install())
afterEach(() => {
  activatePrivateCacheIdentity(null)
  for (const [name, original] of [['indexedDB', originalIndexedDb], ['IDBKeyRange', originalKeyRange]] as const) {
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  }
})

/** Stores an image whose every byte equals `index`, so each read can be matched to its image. */
const store = (index: number, family = familyId) => cachePrivateImageResponse(
  userId, preview(index, family),
  new Response(new Uint8Array(64).fill(index), { status: 200, headers: { 'content-type': 'image/webp', etag: `"e${index}"` } }),
  generation, privateFamilyCacheGeneration(userId, family),
)
const drain = () => persistPrivateQueryCache(new QueryClient(), userId, generation)
const firstByte = async (result: { blob: Blob } | null | 'failed') => result && result !== 'failed' ? new Uint8Array(await result.blob.arrayBuffer())[0] : result
const imageReads = () => database.log.transactions.filter(({ mode, stores }) => mode === 'readonly' && stores.includes('imageBytes'))

describe('reads that arrive together share one IndexedDB transaction', () => {
  test('24 simultaneous reads use one readonly transaction and keep every result', async () => {
    for (let index = 1; index <= 21; index += 1) await store(index)
    await drain()
    // Rows the write path would refuse, placed directly as an older app or a damaged store left them.
    const oversize = preview(30)
    const untyped = preview(31)
    for (const [path, row] of [
      [oversize, { size: PRIVATE_CACHE_MAX_IMAGE_BYTES + 1, imageContentType: 'image/webp' }],
      [untyped, { size: 64 }],
    ] as const) {
      database.rows.set(entryId(path), {
        id: entryId(path), userId, imageUserId: userId, familyId, schema: PRIVATE_CACHE_SCHEMA, kind: 'image', key: path,
        lastAccess: Date.now(), etag: null, ...row,
      })
      database.store('imageBytes').set(entryId(path), { id: entryId(path), bytes: new Uint8Array(64).buffer })
    }
    database.log.transactions.length = 0

    const hits = Array.from({ length: 21 }, (_, offset) => readPrivateImageEntry(userId, preview(offset + 1)))
    const miss = readPrivateImageEntry(userId, preview(40))
    const tooLarge = readPrivateImageEntry(userId, oversize)
    const withoutType = readPrivateImageEntry(userId, untyped)
    const results = await Promise.all(hits)

    expect(imageReads()).toHaveLength(1)
    expect(await Promise.all(results.map(firstByte))).toEqual(Array.from({ length: 21 }, (_, offset) => offset + 1))
    expect(results.map((result) => result?.etag)).toEqual(Array.from({ length: 21 }, (_, offset) => `"e${offset + 1}"`))
    expect(await miss).toBeNull()
    expect(await tooLarge).toBeNull()
    expect(await withoutType).toBeNull()
    await drain()
    // Invalid rows are removed exactly as a single read removes them.
    expect(database.rows.has(entryId(oversize))).toBe(false)
    expect(database.rows.has(entryId(untyped))).toBe(false)
    expect(await readPrivateImageEntry(userId, `/api/v1/families/${familyId}/media/${mediaId(1)}/content?variant=original`)).toBeNull()
  })

  test('a failed read misses the cache while the reads beside it keep their images', async () => {
    const failing = entryId(preview(3))
    install((_mode, request) => request.store === 'imageBytes' && request.id === failing ? Promise.reject(new Error('test read failure')) : undefined)
    for (let index = 1; index <= 6; index += 1) await store(index)
    await drain()
    database.log.transactions.length = 0

    const reads = Array.from({ length: 6 }, (_, offset) => readPrivateImageEntry(userId, preview(offset + 1)).catch(() => 'failed' as const))
    const results = await Promise.all(reads)

    expect(imageReads()).toHaveLength(1)
    expect(results[2] === null || results[2] === 'failed').toBe(true)
    expect(await Promise.all(results.map((result, index) => index === 2 ? null : firstByte(result)))).toEqual([1, 2, null, 4, 5, 6])
  })

  test('a read that never answers ends at the deadline without holding back the others', async () => {
    const stalled = entryId(preview(2))
    const never = new Promise<void>(() => undefined)
    install((_mode, request) => request.store === 'imageBytes' && request.id === stalled ? never : undefined)
    for (let index = 1; index <= 4; index += 1) await store(index)
    await drain()
    database.log.transactions.length = 0

    await withControlledTimers(async (clock) => {
      const settledAt: number[] = []
      const reads = Array.from({ length: 4 }, (_, offset) => readPrivateImageEntry(userId, preview(offset + 1))
        .catch(() => 'failed' as const)
        .finally(() => { settledAt[offset] = Date.now() }))
      await clock.runAll()
      const results = await Promise.all(reads)

      expect(imageReads()).toHaveLength(1)
      expect(results[1] === null || results[1] === 'failed').toBe(true)
      expect(await Promise.all([0, 2, 3].map((index) => firstByte(results[index]!)))).toEqual([1, 3, 4])
      // The answered reads settle at once; only the stalled one waits for the 3 s deadline.
      expect([settledAt[0], settledAt[2], settledAt[3]]).toEqual([0, 0, 0])
      expect(settledAt[1]).toBeLessThanOrEqual(3_000)
    })
  })
})

describe('choosing the same family again', () => {
  test('keeps the cache generation and stored images; a switch, revocation or new identity still invalidates', async () => {
    await store(1)
    await drain()
    const invalidations: string[] = []
    const unsubscribe = subscribePrivateCacheInvalidation((invalidation) => {
      invalidations.push(invalidation.type === 'family' ? `family:${invalidation.familyId}` : invalidation.type)
    })
    const before = privateFamilyCacheGeneration(userId, familyId)

    // Hub, then the same family with the same membership.
    allowPrivateFamilyCache(userId, familyId, 1)
    allowPrivateFamilyCache(userId, familyId, 1)
    expect(privateFamilyCacheGeneration(userId, familyId)).toBe(before)
    expect(invalidations).toEqual([])
    expect(await firstByte(await readPrivateImageEntry(userId, preview(1)))).toBe(1)

    allowPrivateFamilyCache(userId, otherFamilyId, 1)
    expect(privateFamilyCacheGeneration(userId, familyId)).toBe(before + 1)
    expect(invalidations[0]).toBe(`family:${familyId}`)

    activatePrivateCacheIdentity(userId)
    expect(invalidations.at(-1)).toBe('identity')
    unsubscribe()
  })
})
