import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import {
  PRIVATE_CACHE_SCHEMA,
  activatePrivateCacheIdentity,
  persistPrivateQueryCache,
  persistentUiQueryKey,
  restorePrivateQueryCache,
  type PersistentFamilyPresentation,
} from '../src/platform/persistence/private-cache'
import { installFakeIndexedDb } from './indexeddb-fake'

const userId = '019c0000-0000-7000-8000-0000000000f1'
const familyId = '019c0000-0000-7000-8000-000000000001'
const ownerId = '019c0000-0000-7000-8000-0000000000f2'
const crop = { x: 0, y: 0, width: 1, height: 1 }
const avatarIds = ['019c0000-0000-7000-8000-0000000000b1', '019c0000-0000-7000-8000-0000000000b2']

const child = (id: string, name: string, avatar: string, birthDate: string) => ({
  id, name, birthDate, sex: 'girl' as const, avatarMediaId: avatar, avatarCrop: crop, version: 2, isComplete: true,
})
const first = child('019c0000-0000-7000-8000-0000000000a1', 'Лиля', avatarIds[0]!, '2022-03-04')
const second = child('019c0000-0000-7000-8000-0000000000a2', 'Миша', avatarIds[1]!, '2024-05-06')

function presentation(family: unknown): PersistentFamilyPresentation {
  return { home: null, family, members: [], screen: 'family', selectedFamilyId: familyId, membershipEpoch: 3, filter: 'all' }
}
const familyWithChildren = { family: { id: familyId, name: 'Семья', timezone: 'Europe/Moscow', ownerUserId: ownerId }, child: first, children: [first, second] }

let database: ReturnType<typeof installFakeIndexedDb>
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
const originalKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange')
beforeEach(() => { database = installFakeIndexedDb() })
afterEach(() => {
  for (const [name, original] of [['indexedDB', originalIndexedDb], ['IDBKeyRange', originalKeyRange]] as const) {
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  }
  activatePrivateCacheIdentity(null)
})

describe('private cache with children', () => {
  test('a saved family with its children list survives a restart', async () => {
    const generation = activatePrivateCacheIdentity(userId)
    const before = new QueryClient()
    before.setQueryData(persistentUiQueryKey(userId), presentation(familyWithChildren))
    await persistPrivateQueryCache(before, userId, generation)

    const after = new QueryClient()
    expect(await restorePrivateQueryCache(after, userId, generation)).toBe(true)
    const restored = after.getQueryData<PersistentFamilyPresentation>(persistentUiQueryKey(userId))
    expect((restored?.family as typeof familyWithChildren).children?.map((item) => item.name)).toEqual(['Лиля', 'Миша'])
  })

  test('an entry saved under the previous schema is discarded without failing the restore', async () => {
    const generation = activatePrivateCacheIdentity(userId)
    const legacyFamily = { family: familyWithChildren.family, child: first }
    database.seed({
      id: `memoLy:1:${userId}:queries:state`, userId, schema: 1, kind: 'queries', key: 'state', size: 1, lastAccess: Date.now(),
      data: { queries: [{ queryKey: persistentUiQueryKey(userId), data: presentation(legacyFamily), updatedAt: 1 }] },
    })

    const queryClient = new QueryClient()
    expect(await restorePrivateQueryCache(queryClient, userId, generation)).toBe(true)
    expect(queryClient.getQueryData(persistentUiQueryKey(userId))).toBeUndefined()
    expect(database.ids().filter((id) => id.startsWith('memoLy:1:'))).toEqual([])
  })

  test('a saved family whose children list is malformed is dropped, not half-restored', async () => {
    const generation = activatePrivateCacheIdentity(userId)
    const broken = { ...familyWithChildren, children: [{ ...second, version: 'x' }] }
    database.seed({
      id: `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}:queries:state`, userId, schema: PRIVATE_CACHE_SCHEMA, kind: 'queries', key: 'state', size: 1, lastAccess: Date.now(),
      data: { queries: [{ queryKey: persistentUiQueryKey(userId), data: presentation(broken), updatedAt: 1 }] },
    })

    const queryClient = new QueryClient()
    expect(await restorePrivateQueryCache(queryClient, userId, generation)).toBe(true)
    expect(queryClient.getQueryData(persistentUiQueryKey(userId))).toBeUndefined()
  })
})

describe('saved child filter', () => {
  const restoreWith = async (saved: PersistentFamilyPresentation) => {
    const generation = activatePrivateCacheIdentity(userId)
    const before = new QueryClient()
    before.setQueryData(persistentUiQueryKey(userId), saved)
    await persistPrivateQueryCache(before, userId, generation)
    const after = new QueryClient()
    expect(await restorePrivateQueryCache(after, userId, generation)).toBe(true)
    return after.getQueryData<PersistentFamilyPresentation>(persistentUiQueryKey(userId))
  }

  test('a selected child survives a restart', async () => {
    const restored = await restoreWith({ ...presentation(familyWithChildren), screen: 'feed', childFilter: second.id })
    expect(restored?.childFilter).toBe(second.id)
  })

  test('«Без отметки» survives a restart', async () => {
    const restored = await restoreWith({ ...presentation(familyWithChildren), childFilter: 'untagged' })
    expect(restored?.childFilter).toBe('untagged')
  })

  test('a removed child falls back to «Все» without dropping the rest of the saved screen', async () => {
    const restored = await restoreWith({ ...presentation(familyWithChildren), screen: 'feed', childFilter: '019c0000-0000-7000-8000-0000000000a9' })
    expect(restored?.childFilter).toBeNull()
    expect(restored?.screen).toBe('feed')
    expect(restored?.selectedFamilyId).toBe(familyId)
    expect((restored?.family as typeof familyWithChildren).children.map((item) => item.name)).toEqual(['Лиля', 'Миша'])
  })

  test('a screen saved before filters existed restores with «Все»', async () => {
    const restored = await restoreWith(presentation(familyWithChildren))
    expect(restored?.childFilter).toBeNull()
    expect(restored?.selectedFamilyId).toBe(familyId)
  })

  test('a filter for a family that has only one child falls back to «Все»', async () => {
    const oneChild = { family: familyWithChildren.family, child: first, children: [first] }
    const restored = await restoreWith({ ...presentation(oneChild), childFilter: first.id })
    expect(restored?.childFilter).toBeNull()
  })
})
