import { afterEach, describe, expect, it, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { withControlledTimers } from './controlled-timers'
import { installFakeIndexedDb } from './indexeddb-fake'

import {
  PRIVATE_CACHE_SCHEMA,
  activatePrivateCacheIdentity,
  eligiblePrivateImage,
  isActivePrivateCacheIdentity,
  isPersistableQueryKey,
  privateCacheIdentityGeneration,
  privateFamilyCacheGeneration,
  removePrivateFamilyCache,
  subscribePrivateCacheInvalidation,
  allowPrivateFamilyCache,
  clearPrivateUserCache,
  restorePrivateQueryCache,
  cachePrivateImageResponse,
  persistPrivateQueryCache,
  readPrivateImage,
  validatePresentation,
} from '../src/platform/persistence/private-cache'

const familyId = '11111111-1111-4111-8111-111111111111'
const mediaId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const avatarId = '44444444-4444-4444-8444-444444444444'
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
const originalKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange')
afterEach(() => {
  for (const [name, original] of [['indexedDB', originalIndexedDb], ['IDBKeyRange', originalKeyRange]] as const) {
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  }
})

test('late IndexedDB open closes its connection after the bounded open has failed', async () => {
  await withControlledTimers(async (clock) => {
  let request!: IDBOpenDBRequest
  let closed = false
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open: () => {
      request = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null } as unknown as IDBOpenDBRequest
      return request
    } } as unknown as IDBFactory,
  })
  const generation = activatePrivateCacheIdentity('idb-user')
  const restore = restorePrivateQueryCache(new QueryClient(), 'idb-user', generation)
  const outcome = restore.then(() => null, (error: unknown) => error)
  await clock.runAll()
  const error = await outcome
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain('timed out')
  request.result = { close: () => { closed = true } } as IDBDatabase
  request.onsuccess?.(new Event('success') as unknown as Event)
  expect(closed).toBe(true)
  })
})

describe('warm private images', () => {
  function heldImageGet(userId: string, heldMode: IDBTransactionMode) {
    const started = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const database = installFakeIndexedDb((mode) => {
      if (mode !== heldMode) return
      started.resolve()
      return gate.promise
    })
    const path = `/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`
    const id = `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}:image:${path}`
    const lastAccess = Date.now() - 1_000
    database.seed({
      id, userId, familyId, schema: PRIVATE_CACHE_SCHEMA, kind: 'image', key: path, size: 1, lastAccess,
      imageBytes: new Uint8Array([42]).buffer, imageContentType: 'image/png',
    })
    activatePrivateCacheIdentity(userId)
    allowPrivateFamilyCache(userId, familyId, 1)
    return {
      start: started.promise,
      release: gate.resolve,
      read: () => readPrivateImage(userId, path),
      lastAccess,
      currentLastAccess: () => database.rows.get(id)?.lastAccess,
    }
  }

  it('returns the verified image while the recency write is pending', async () => {
    const userId = 'warm-image-user'
    const image = heldImageGet(userId, 'readwrite')
    const read = image.read()
    try {
      await image.start
      const result = await Promise.race([read, nextTurn()])
      expect(await result?.arrayBuffer()).toEqual(new Uint8Array([42]).buffer)
      expect(image.currentLastAccess()).toBe(image.lastAccess)
    } finally {
      image.release()
      await read
      await persistPrivateQueryCache(new QueryClient(), userId, privateCacheIdentityGeneration())
      activatePrivateCacheIdentity(null)
    }
    expect(image.currentLastAccess()).toBeGreaterThan(image.lastAccess)
  })

  it('does not update recency after the family membership epoch changes', async () => {
    const userId = 'warm-image-epoch-user'
    const image = heldImageGet(userId, 'readwrite')
    const read = image.read()
    try {
      await image.start
      allowPrivateFamilyCache(userId, familyId, 2)
    } finally {
      image.release()
      await read
      await persistPrivateQueryCache(new QueryClient(), userId, privateCacheIdentityGeneration())
      activatePrivateCacheIdentity(null)
    }
    expect(image.currentLastAccess()).toBe(image.lastAccess)
  })

  it('does not return a cached image after the account changes during lookup', async () => {
    const image = heldImageGet('warm-image-old-user', 'readonly')
    const read = image.read()
    try {
      await image.start
      activatePrivateCacheIdentity('warm-image-new-user')
    } finally {
      image.release()
    }
    try {
      expect(await read).toBeNull()
    } finally {
      activatePrivateCacheIdentity(null)
    }
  })
})

describe('private cache boundaries', () => {
  it('accepts only same-origin image variants, member avatars and MAX posters', () => {
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`)).toEqual({
      familyId, key: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`,
    })
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=original`)).toBeNull()
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=preview&download=1`)).toBeNull()
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/avatars/${memberId}/${avatarId}/content`)).toEqual({
      familyId, key: `/api/v1/families/${familyId}/media/avatars/${memberId}/${avatarId}/content`,
    })
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/max-videos/${mediaId}/poster`)).toEqual({
      familyId, key: `/api/v1/families/${familyId}/media/max-videos/${mediaId}/poster`,
    })
    expect(eligiblePrivateImage('https://cdn.example/private.jpg')).toBeNull()
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/max-videos/${mediaId}/content`)).toBeNull()
  })

  it('persists only explicit feed and presentation query shapes', () => {
    expect(isPersistableQueryKey(['session', 'persistent-ui', 'user-id'])).toBe(true)
    expect(isPersistableQueryKey(['session', 'feed', 'family-id', 'all', false, 'account', 3, 0, null])).toBe(true)
    // The list key before the child filter existed is no longer a persisted shape.
    expect(isPersistableQueryKey(['session', 'feed', 'family-id', 'all', false, 'account', 3, 0])).toBe(false)
    expect(isPersistableQueryKey(['session', 'feed', 'family-id', 'all', false, 'account', 3, 0, 'child-id'])).toBe(false)
    expect(isPersistableQueryKey(['session', 'feed', 'family-id', 'video', false, 'account', 3, 0, null])).toBe(false)
    expect(isPersistableQueryKey(['session', 'member-avatar', 'user-id', 'avatar'])).toBe(false)
    expect(isPersistableQueryKey(['session', 'auth', 'me'])).toBe(false)
  })

  it('restores every navigation screen including gifts and rejects unknown ones', () => {
    const presentation = {
      home: null, family: null, members: [], screen: 'hub', selectedFamilyId: null, membershipEpoch: null, filter: 'all',
    }
    for (const screen of ['hub', 'family', 'feed', 'gifts']) {
      expect(validatePresentation({ ...presentation, screen })).toBe(true)
    }
    expect(validatePresentation({ ...presentation, screen: 'wishlist' })).toBe(false)
    expect(validatePresentation({ ...presentation, screen: undefined })).toBe(false)
  })

  it('invalidates old work when the authenticated identity changes', () => {
    const previousGeneration = privateCacheIdentityGeneration()
    const generation = activatePrivateCacheIdentity('user-a')
    expect(generation).toBeGreaterThan(previousGeneration)
    expect(isActivePrivateCacheIdentity('user-a', generation)).toBe(true)
    activatePrivateCacheIdentity('user-b')
    expect(isActivePrivateCacheIdentity('user-a', generation)).toBe(false)
    expect(isActivePrivateCacheIdentity('user-b', generation)).toBe(false)
  })

  it('refuses an in-flight private image response after family access switches', async () => {
    activatePrivateCacheIdentity('user-a')
    const identityGeneration = privateCacheIdentityGeneration()
    const nextFamilyId = '55555555-5555-4555-8555-555555555555'
    allowPrivateFamilyCache('user-a', familyId)
    const familyAGeneration = privateFamilyCacheGeneration('user-a', familyId)
    let releaseBody!: () => void
    const body = new ReadableStream<Uint8Array>({ start(controller) { releaseBody = () => { controller.enqueue(new Uint8Array([1])); controller.close() } } })
    const staleResponse = cachePrivateImageResponse(
      'user-a',
      `/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`,
      new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }),
      identityGeneration,
      familyAGeneration,
    )
    allowPrivateFamilyCache('user-a', nextFamilyId)
    releaseBody()
    expect(await staleResponse).toBe(false)
    activatePrivateCacheIdentity(null)
  })

  it('keeps a confirmed same-family grant warm but invalidates epoch changes, revocation and switches', async () => {
    const userId = 'same-family-confirmation-user'
    const otherFamilyId = '55555555-5555-4555-8555-555555555555'
    activatePrivateCacheIdentity(userId)
    const invalidations: string[] = []
    const unsubscribe = subscribePrivateCacheInvalidation((invalidation) => {
      if (invalidation.type === 'family' && invalidation.userId === userId) invalidations.push(invalidation.familyId)
    })

    allowPrivateFamilyCache(userId, familyId, 7)
    const firstGeneration = privateFamilyCacheGeneration(userId, familyId)
    invalidations.length = 0
    allowPrivateFamilyCache(userId, familyId, 7)
    expect(privateFamilyCacheGeneration(userId, familyId)).toBe(firstGeneration)
    expect(invalidations).toEqual([])

    allowPrivateFamilyCache(userId, familyId, 8)
    const epochGeneration = privateFamilyCacheGeneration(userId, familyId)
    expect(epochGeneration).toBe(firstGeneration + 1)
    expect(invalidations).toEqual([familyId])

    const queryClient = new QueryClient()
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: () => { throw new Error('test-only IndexedDB unavailable') } } as unknown as IDBFactory,
    })
    await removePrivateFamilyCache(queryClient, userId, familyId).catch(() => undefined)
    const revokedGeneration = privateFamilyCacheGeneration(userId, familyId)
    allowPrivateFamilyCache(userId, familyId, 8)
    expect(privateFamilyCacheGeneration(userId, familyId)).toBe(revokedGeneration + 1)
    expect(invalidations.slice(-2)).toEqual([familyId, familyId])

    const activeGeneration = privateFamilyCacheGeneration(userId, familyId)
    allowPrivateFamilyCache(userId, otherFamilyId, 1)
    expect(privateFamilyCacheGeneration(userId, familyId)).toBe(activeGeneration + 1)
    expect(invalidations.at(-2)).toBe(familyId)
    unsubscribe()
    activatePrivateCacheIdentity(null)
  })

  it('does not invalidate a new identity for a stale expected-generation clear', async () => {
    const oldGeneration = activatePrivateCacheIdentity('user-a')
    activatePrivateCacheIdentity('user-b')
    const invalidations: string[] = []
    const unsubscribe = subscribePrivateCacheInvalidation((invalidation) => {
      if (invalidation.type === 'user') invalidations.push(invalidation.userId)
    })
    await clearPrivateUserCache('user-a', oldGeneration)
    unsubscribe()
    expect(invalidations).toEqual([])
    activatePrivateCacheIdentity(null)
  })
})
