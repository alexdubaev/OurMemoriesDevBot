import type { QueryClient } from '@tanstack/react-query'
import { familyHomeResponseSchema, familyMembersResponseSchema, familyResponseSchema, memoryPageSchema } from '@web-app-demo/contracts'

export const PRIVATE_CACHE_SCHEMA = 2
export const PRIVATE_CACHE_LIMIT_BYTES = 20 * 1024 * 1024
export const PRIVATE_CACHE_LIMIT_ENTRIES = 100
export const PRIVATE_CACHE_MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const PRIVATE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000
export const privateFamilyAccessRevokedEvent = 'memoly:private-family-access-revoked'
export type PrivateCacheInvalidation = { type: 'identity' } | { type: 'all' } | { type: 'user'; userId: string } | { type: 'family'; userId: string; familyId: string }
const privateCacheInvalidationListeners = new Set<(invalidation: PrivateCacheInvalidation) => void>()
const PRIVATE_QUERY_LIMIT_ENTRIES = 100
const PRIVATE_QUERY_LIMIT_BYTES = 2 * 1024 * 1024
const IDB_OPERATION_DEADLINE_MS = 3000

const DATABASE_NAME = 'memoly-private-cache'
const DATABASE_VERSION = 1
const STORE_NAME = 'entries'
const namespace = (userId: string) => `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}`
let activeIdentity: string | null = null
let identityGeneration = 0
let operationQueue = Promise.resolve()
const revokedFamilyCache = new Set<string>()
const familyCacheGeneration = new Map<string, number>()
const activeFamilyByUser = new Map<string, string>()
const activeFamilyEpochByUser = new Map<string, number | null>()
const familyCacheScopeKey = (userId: string, familyId: string) => `${userId}:${familyId}`

export function subscribePrivateCacheInvalidation(listener: (invalidation: PrivateCacheInvalidation) => void) {
  privateCacheInvalidationListeners.add(listener)
  return () => privateCacheInvalidationListeners.delete(listener)
}

function emitPrivateCacheInvalidation(invalidation: PrivateCacheInvalidation) {
  for (const listener of privateCacheInvalidationListeners) listener(invalidation)
}

export const persistentUiQueryKey = (userId: string) => ['session', 'persistent-ui', userId] as const

export type PersistentFamilyPresentation = {
  home: unknown | null
  family: unknown | null
  members: unknown[]
  screen: 'hub' | 'family' | 'feed'
  selectedFamilyId: string | null
  membershipEpoch: number | null
  filter: 'all' | 'photo' | 'video' | 'voice' | 'note'
  /** Feed child filter: a child id, `'untagged'` or `null` («Все»). Absent in screens saved before filters. */
  childFilter?: string | null
}

type QueryRecord = { queryKey: readonly unknown[]; data: unknown; updatedAt: number }
type PersistedState = { queries: QueryRecord[] }
type CacheEntry = {
  id: string
  userId: string
  schema: number
  kind: 'queries' | 'image'
  key: string
  familyId?: string
  data?: PersistedState
  // New image entries use byte buffers because WebKit can reject Blob values
  // when they are written to IndexedDB. `blob` remains for schema-1 entries.
  blob?: Blob
  imageBytes?: ArrayBuffer
  imageContentType?: string
  size: number
  lastAccess: number
}

export function activatePrivateCacheIdentity(userId: string | null) {
  emitPrivateCacheInvalidation({ type: 'identity' })
  activeIdentity = userId
  activeFamilyByUser.clear()
  activeFamilyEpochByUser.clear()
  identityGeneration += 1
  return identityGeneration
}

export function privateCacheIdentityGeneration() {
  return identityGeneration
}

export function isActivePrivateCacheIdentity(userId: string, generation: number) {
  return activeIdentity === userId && identityGeneration === generation
}

export function allowPrivateFamilyCache(userId: string, familyId: string, membershipEpoch: number | null = null) {
  const previousFamilyId = activeFamilyByUser.get(userId)
  const key = familyCacheScopeKey(userId, familyId)
  const wasRevoked = revokedFamilyCache.has(key)
  if (previousFamilyId === familyId && activeFamilyEpochByUser.get(userId) === membershipEpoch && !wasRevoked) return
  if (previousFamilyId && previousFamilyId !== familyId) {
    const previousKey = familyCacheScopeKey(userId, previousFamilyId)
    familyCacheGeneration.set(previousKey, (familyCacheGeneration.get(previousKey) ?? 0) + 1)
    emitPrivateCacheInvalidation({ type: 'family', userId, familyId: previousFamilyId })
  }
  if (previousFamilyId === familyId) {
    familyCacheGeneration.set(key, (familyCacheGeneration.get(key) ?? 0) + 1)
    emitPrivateCacheInvalidation({ type: 'family', userId, familyId })
  }
  activeFamilyByUser.set(userId, familyId)
  activeFamilyEpochByUser.set(userId, membershipEpoch)
  revokedFamilyCache.delete(key)
  if (previousFamilyId !== familyId && (previousFamilyId !== undefined || wasRevoked)) {
    familyCacheGeneration.set(key, (familyCacheGeneration.get(key) ?? 0) + 1)
    emitPrivateCacheInvalidation({ type: 'family', userId, familyId })
  }
}

export function privateFamilyCacheGeneration(userId: string, familyId: string) {
  return familyCacheGeneration.get(familyCacheScopeKey(userId, familyId)) ?? 0
}

export async function restorePrivateQueryCache(queryClient: QueryClient, userId: string, generation: number, shouldContinue: () => boolean = () => true) {
  const state = await readEntry<PersistedState>(userId, 'queries', 'state')
  if (!shouldContinue() || !isActivePrivateCacheIdentity(userId, generation)) return false
  await discardOtherSchemas(userId)
  if (!shouldContinue() || !isActivePrivateCacheIdentity(userId, generation)) return false
  if (!state || estimateSize(state) > PRIVATE_QUERY_LIMIT_BYTES || !validatePersistedState(state, userId)) {
    if (state) await removeEntry(userId, 'queries', 'state')
    return true
  }
  for (const query of state.queries) {
    if (!shouldContinue() || !isActivePrivateCacheIdentity(userId, generation)) return false
    if (!isPersistableQueryKey(query.queryKey)) continue
    const data = query.queryKey[1] === 'persistent-ui' ? withRestorableChildFilter(query.data as PersistentFamilyPresentation) : query.data
    queryClient.setQueryData(query.queryKey, data, { updatedAt: 0 })
  }
  return isActivePrivateCacheIdentity(userId, generation)
}

export function persistPrivateQueryCache(queryClient: QueryClient, userId: string, generation: number) {
  if (!isActivePrivateCacheIdentity(userId, generation)) return Promise.resolve()
  const candidates: QueryRecord[] = queryClient.getQueryCache().getAll()
    .filter((query) => query.state.data !== undefined && isPersistableQueryKey(query.queryKey) &&
      !(query.queryKey[1] === 'feed' && typeof query.queryKey[2] === 'string' && revokedFamilyCache.has(familyCacheScopeKey(userId, query.queryKey[2]))))
    .map((query) => ({ queryKey: query.queryKey, data: trimFeedData(query.queryKey, query.state.data), updatedAt: query.state.dataUpdatedAt }))
  const presentation = candidates.find((query) => query.queryKey[1] === 'persistent-ui')
  const selectedFamilyId = (presentation?.data as PersistentFamilyPresentation | undefined)?.selectedFamilyId
  candidates.sort((left, right) => {
    const priority = (query: QueryRecord) => query.queryKey[1] === 'persistent-ui' ? 0
      : query.queryKey[1] === 'feed' && query.queryKey[2] === selectedFamilyId ? 1 : 2
    return priority(left) - priority(right) || right.updatedAt - left.updatedAt
  })
  const queries: QueryRecord[] = []
  for (const candidate of candidates) {
    if (queries.length >= PRIVATE_QUERY_LIMIT_ENTRIES) break
    if (estimateSize({ queries: [...queries, candidate] }) <= PRIVATE_QUERY_LIMIT_BYTES) queries.push(candidate)
  }
  const data: PersistedState = { queries }
  return writeEntry(userId, 'queries', 'state', data, undefined, generation)
}

export async function clearPrivateUserCache(userId: string, expectedGeneration?: number) {
  const generation = expectedGeneration ?? identityGeneration
  if (expectedGeneration !== undefined && !isActivePrivateCacheIdentity(userId, expectedGeneration)) return
  emitPrivateCacheInvalidation({ type: 'user', userId })
  activeFamilyByUser.delete(userId)
  activeFamilyEpochByUser.delete(userId)
  await enqueue(async () => {
    if (expectedGeneration !== undefined && !isActivePrivateCacheIdentity(userId, expectedGeneration)) return
    const db = await openDatabase()
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const index = transaction.objectStore(STORE_NAME).index('userId')
      const request = index.openCursor(IDBKeyRange.only(userId))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if (expectedGeneration === undefined || isActivePrivateCacheIdentity(userId, generation)) cursor.delete()
        cursor.continue()
      }
      await transactionDone(transaction)
    } finally { db.close() }
  })
}

export async function clearAllPrivateCache() {
  emitPrivateCacheInvalidation({ type: 'all' })
  activeFamilyByUser.clear()
  activeFamilyEpochByUser.clear()
  await enqueue(async () => {
    if (typeof indexedDB === 'undefined') return
    const db = await openDatabase()
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
      await transactionDone(transaction)
    } finally { db.close() }
  })
}

export async function removePrivateFamilyCache(queryClient: QueryClient, userId: string, familyId: string) {
  const scopeKey = familyCacheScopeKey(userId, familyId)
  revokedFamilyCache.add(scopeKey)
  familyCacheGeneration.set(scopeKey, (familyCacheGeneration.get(scopeKey) ?? 0) + 1)
  if (activeFamilyByUser.get(userId) === familyId) {
    activeFamilyByUser.delete(userId)
    activeFamilyEpochByUser.delete(userId)
  }
  emitPrivateCacheInvalidation({ type: 'family', userId, familyId })
  await removePrivateFamilyQueries(queryClient, familyId)
  queryClient.setQueryData<PersistentFamilyPresentation>(persistentUiQueryKey(userId), (current) => {
    if (!current) return current
    const home = current.home && typeof current.home === 'object'
      ? { ...(current.home as Record<string, unknown>), items: Array.isArray((current.home as { items?: unknown }).items)
        ? ((current.home as { items: Array<{ familyId?: string }> }).items).filter((item) => item.familyId !== familyId)
        : (current.home as { items?: unknown }).items }
      : current.home
    const selected = current.selectedFamilyId === familyId
    return {
      ...current,
      home,
      ...(selected ? { family: null, members: [], screen: 'hub' as const, selectedFamilyId: null, membershipEpoch: null } : {}),
    }
  })
  await removePrivateFamilyImages(userId, familyId)
  await persistPrivateQueryCache(queryClient, userId, identityGeneration)
}

export async function removePrivateFamilyQueries(queryClient: QueryClient, familyId: string) {
  const matchesFamilyPrivateQuery = ({ queryKey }: { queryKey: readonly unknown[] }) => queryKey[0] === 'session' &&
    ['feed', 'comments', 'child-albums'].includes(queryKey[1] as string) && queryKey[2] === familyId
  queryClient.removeQueries({ predicate: matchesFamilyPrivateQuery })
}

export async function removePrivateFamilyImages(userId: string, familyId: string) {
  await enqueue(async () => {
    const db = await openDatabase()
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.index('userId').openCursor(IDBKeyRange.only(userId))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const entry = cursor.value as CacheEntry
        if (entry.schema === PRIVATE_CACHE_SCHEMA && entry.kind === 'image' && entry.familyId === familyId) cursor.delete()
        cursor.continue()
      }
      await transactionDone(transaction)
    } finally { db.close() }
  })
}

export async function removePrivateImage(userId: string, path: string) {
  const eligible = eligiblePrivateImage(path)
  if (eligible) await removeEntry(userId, 'image', eligible.key)
}

export function eligiblePrivateImage(path: string) {
  if (!path.startsWith('/api/v1/families/')) return null
  const parsed = new URL(path, typeof location === 'undefined' ? 'https://memoly.invalid' : location.origin)
  const mediaMatch = /^\/api\/v1\/families\/([0-9a-f-]{36})\/media\/([0-9a-f-]{36})\/content$/i.exec(parsed.pathname)
  if (mediaMatch) {
    if (parsed.searchParams.size !== 1 || parsed.searchParams.getAll('variant').length !== 1) return null
    const variant = parsed.searchParams.get('variant')
    if (variant !== 'display' && variant !== 'preview') return null
    return { familyId: mediaMatch[1]!, key: `${parsed.pathname}?variant=${variant}` }
  }
  const avatarMatch = /^\/api\/v1\/families\/([0-9a-f-]{36})\/media\/avatars\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/content$/i.exec(parsed.pathname)
  if (avatarMatch && parsed.searchParams.size === 0) return { familyId: avatarMatch[1]!, key: parsed.pathname }
  const posterMatch = /^\/api\/v1\/families\/([0-9a-f-]{36})\/media\/max-videos\/([0-9a-f-]{36})\/poster$/i.exec(parsed.pathname)
  if (posterMatch && parsed.searchParams.size === 0) return { familyId: posterMatch[1]!, key: parsed.pathname }
  const channelAvatarMatch = /^\/api\/v1\/families\/([0-9a-f-]{36})\/media\/max-channels\/-?[0-9]{1,19}\/avatar$/i.exec(parsed.pathname)
  if (channelAvatarMatch && parsed.searchParams.size === 0) return { familyId: channelAvatarMatch[1]!, key: parsed.pathname }
  return null
}

export async function readPrivateImage(userId: string, path: string) {
  const eligible = eligiblePrivateImage(path)
  if (!eligible || typeof indexedDB === 'undefined') return null
  const entry = await readEntryWithMetadata(userId, 'image', eligible.key)
  const blob = entry?.blob instanceof Blob
    ? entry.blob
    : entry?.imageBytes instanceof ArrayBuffer && typeof entry.imageContentType === 'string'
      ? new Blob([entry.imageBytes], { type: entry.imageContentType })
      : null
  if (!entry || !blob || blob.size > PRIVATE_CACHE_MAX_IMAGE_BYTES || entry.size > PRIVATE_CACHE_MAX_IMAGE_BYTES || Date.now() - entry.lastAccess > PRIVATE_CACHE_MAX_AGE_MS) {
    if (entry) await removeEntry(userId, 'image', eligible.key)
    return null
  }
  await touchEntry(userId, 'image', eligible.key)
  return blob
}

export async function cachePrivateImageResponse(userId: string, path: string, response: Response, generation = identityGeneration, capturedFamilyGeneration?: number) {
  const eligible = eligiblePrivateImage(path)
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  const lengthHeader = response.headers.get('content-length')
  const declaredSize = lengthHeader ? Number(lengthHeader) : null
  if (!eligible || response.status !== 200 || !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic'].includes(contentType ?? '') ||
      (declaredSize !== null && (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > PRIVATE_CACHE_MAX_IMAGE_BYTES))) return false
  const imageBytes = await response.clone().arrayBuffer()
  if (imageBytes.byteLength === 0 || imageBytes.byteLength > PRIVATE_CACHE_MAX_IMAGE_BYTES) return false
  const key = familyCacheScopeKey(userId, eligible.familyId)
  if (revokedFamilyCache.has(key)) return false
  const familyGeneration = capturedFamilyGeneration ?? familyCacheGeneration.get(key) ?? 0
  if (!isActivePrivateCacheIdentity(userId, generation) || privateFamilyCacheGeneration(userId, eligible.familyId) !== familyGeneration) return false
  await writeEntry(userId, 'image', eligible.key, imageBytes, eligible.familyId, generation, familyGeneration, contentType!)
  await evictPrivateImages(userId)
  return true
}

export function isPersistableQueryKey(key: readonly unknown[]) {
  return key[0] === 'session' && (
    (key[1] === 'persistent-ui' && typeof key[2] === 'string') ||
    (key[1] === 'feed' && typeof key[2] === 'string' && key[3] === 'all' && key[4] === false && key.length === 9 && key[8] === null)
  )
}

function validatePersistedState(state: PersistedState, userId: string) {
  if (!Array.isArray(state.queries) || state.queries.length > 100) return false
  for (const record of state.queries) {
    if (!record || !isPersistableQueryKey(record.queryKey)) return false
    if (record.queryKey[1] === 'persistent-ui') {
      if (record.queryKey[2] !== userId || !validatePresentation(record.data)) return false
      continue
    }
    const value = record.data as { pages?: unknown[]; pageParams?: unknown[] } | null
    if (!value || !Array.isArray(value.pages) || !Array.isArray(value.pageParams) || value.pages.length > 3 ||
      value.pages.some((page) => !memoryPageSchema.safeParse(page).success)) return false
  }
  return true
}

function validatePresentation(value: unknown): value is PersistentFamilyPresentation {
  if (!value || typeof value !== 'object') return false
  const presentation = value as PersistentFamilyPresentation
  if (presentation.home !== null && !familyHomeResponseSchema.safeParse(presentation.home).success) return false
  if (presentation.family !== null && !familyResponseSchema.safeParse(presentation.family).success) return false
  if (!Array.isArray(presentation.members) || !familyMembersResponseSchema.safeParse({ items: presentation.members }).success ||
      !['hub', 'family', 'feed'].includes(presentation.screen) ||
      !['all', 'photo', 'video', 'voice', 'note'].includes(presentation.filter) ||
      !(presentation.selectedFamilyId === null || typeof presentation.selectedFamilyId === 'string') ||
      !(presentation.membershipEpoch === null || Number.isSafeInteger(presentation.membershipEpoch))) return false
  return true
}

/** A child filter the saved family no longer supports becomes «Все»; the rest of the screen stays. */
function withRestorableChildFilter(presentation: PersistentFamilyPresentation): PersistentFamilyPresentation {
  const family = presentation.family as { child?: { id: string } | null; children?: Array<{ id: string }> } | null
  const children = family ? family.children ?? (family.child ? [family.child] : []) : []
  const saved = presentation.childFilter
  const childFilter = children.length >= 2 && typeof saved === 'string' && (saved === 'untagged' || children.some((child) => child.id === saved))
    ? saved
    : null
  return { ...presentation, childFilter }
}

async function discardOtherSchemas(userId: string) {
  await enqueue(async () => {
    const db = await openDatabase()
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const request = transaction.objectStore(STORE_NAME).index('userId').openCursor(IDBKeyRange.only(userId))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if ((cursor.value as CacheEntry).schema !== PRIVATE_CACHE_SCHEMA) cursor.delete()
        cursor.continue()
      }
      await transactionDone(transaction)
    } finally { db.close() }
  })
}

async function evictPrivateImages(userId: string) {
  await enqueue(async () => {
    const db = await openDatabase()
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const entries: CacheEntry[] = []
      const request = transaction.objectStore(STORE_NAME).index('userId').openCursor(IDBKeyRange.only(userId))
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return resolve()
          const entry = cursor.value as CacheEntry
          if (entry.schema === PRIVATE_CACHE_SCHEMA && entry.kind === 'image') entries.push(entry)
          cursor.continue()
        }
        request.onerror = () => reject(request.error ?? new Error('Unable to scan private images'))
      })
      entries.sort((a, b) => a.lastAccess - b.lastAccess)
      let totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0)
      const evicted: string[] = []
      while (entries.length > PRIVATE_CACHE_LIMIT_ENTRIES || totalBytes > PRIVATE_CACHE_LIMIT_BYTES) {
        const oldest = entries.shift()
        if (!oldest) break
        totalBytes -= oldest.size
        evicted.push(oldest.id)
      }
      await transactionDone(transaction)
      if (evicted.length) {
        const write = db.transaction(STORE_NAME, 'readwrite')
        const store = write.objectStore(STORE_NAME)
        for (const id of evicted) store.delete(id)
        await transactionDone(write)
      }
    } finally { db.close() }
  })
}

async function touchEntry(userId: string, kind: CacheEntry['kind'], key: string) {
  const id = entryId(userId, kind, key)
  await enqueue(async () => {
    const db = await openDatabase()
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(id)
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, lastAccess: Date.now() }) }
      await transactionDone(transaction)
    } finally { db.close() }
  })
}

async function removeEntry(userId: string, kind: CacheEntry['kind'], key: string) {
  await enqueue(async () => {
    const db = await openDatabase()
    try { const transaction = db.transaction(STORE_NAME, 'readwrite'); transaction.objectStore(STORE_NAME).delete(entryId(userId, kind, key)); await transactionDone(transaction) }
    finally { db.close() }
  })
}

async function readEntry<T>(userId: string, kind: CacheEntry['kind'], key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDatabase()
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const result = await requestDone(transaction.objectStore(STORE_NAME).get(entryId(userId, kind, key))) as CacheEntry | undefined
    if (!result || result.schema !== PRIVATE_CACHE_SCHEMA || result.userId !== userId) return null
    return (kind === 'image' ? result.blob : result.data) as T ?? null
  } finally { db.close() }
}

async function readEntryWithMetadata(userId: string, kind: CacheEntry['kind'], key: string): Promise<CacheEntry | null> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const result = await requestDone(transaction.objectStore(STORE_NAME).get(entryId(userId, kind, key))) as CacheEntry | undefined
    return result?.schema === PRIVATE_CACHE_SCHEMA && result.userId === userId ? result : null
  } finally { db.close() }
}

async function writeEntry(userId: string, kind: CacheEntry['kind'], key: string, value: PersistedState | Blob | ArrayBuffer, familyId?: string, generation?: number, familyGeneration?: number, imageContentType?: string) {
  if (typeof indexedDB === 'undefined') return
  const expectedGeneration = generation ?? identityGeneration
  await enqueue(async () => {
    if (!isActivePrivateCacheIdentity(userId, expectedGeneration)) return
    if (kind === 'image' && familyId) {
      const scopeKey = familyCacheScopeKey(userId, familyId)
      if (revokedFamilyCache.has(scopeKey) || privateFamilyCacheGeneration(userId, familyId) !== familyGeneration) return
    }
    const db = await openDatabase()
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      if (!isActivePrivateCacheIdentity(userId, expectedGeneration)) { transaction.abort(); return }
      if (kind === 'image' && familyId) {
        const scopeKey = familyCacheScopeKey(userId, familyId)
        if (revokedFamilyCache.has(scopeKey) || privateFamilyCacheGeneration(userId, familyId) !== familyGeneration) { transaction.abort(); return }
      }
      const blob = value instanceof Blob ? value : undefined
      const imageBytes = value instanceof ArrayBuffer ? value : undefined
      const data = blob || imageBytes ? undefined : value as PersistedState
      transaction.objectStore(STORE_NAME).put({
        id: entryId(userId, kind, key), userId, schema: PRIVATE_CACHE_SCHEMA, kind, key,
        ...(familyId ? { familyId } : {}), ...(data ? { data } : {}), ...(blob ? { blob } : {}),
        ...(imageBytes ? { imageBytes, imageContentType } : {}),
        size: blob?.size ?? imageBytes?.byteLength ?? estimateSize(data), lastAccess: Date.now(),
      } satisfies CacheEntry)
      await transactionDone(transaction)
    } finally { db.close() }
  })
}

function entryId(userId: string, kind: CacheEntry['kind'], key: string) {
  return `${namespace(userId)}:${kind}:${key}`
}

function trimFeedData(queryKey: readonly unknown[], data: unknown) {
  if (queryKey[1] !== 'feed' || !data || typeof data !== 'object') return data
  const feed = data as { pages?: unknown[]; pageParams?: unknown[] }
  if (!Array.isArray(feed.pages)) return data
  return { ...feed, pages: feed.pages.slice(0, 3), pageParams: feed.pageParams?.slice(0, 3) ?? [] }
}

function estimateSize(value: unknown) {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength }
  catch { return 0 }
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = operationQueue.then(operation, operation)
  operationQueue = next.then(() => undefined, () => undefined)
  return next
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('Private cache operation timed out'))
    }, IDB_OPERATION_DEADLINE_MS)
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!store.indexNames.contains('userId')) store.createIndex('userId', 'userId', { unique: false })
    }
    request.onsuccess = () => {
      if (settled) { request.result.close(); return }
      settled = true
      clearTimeout(timer)
      resolve(request.result)
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(request.error ?? new Error('Unable to open private cache'))
    }
    request.onblocked = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('Private cache database upgrade is blocked'))
    }
  })
}

function requestDone<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(request.result)
    }
    const timer = setTimeout(() => {
      const source = request.source
      const transaction = source && 'transaction' in source ? source.transaction : undefined
      try { transaction?.abort() } catch { /* a completed transaction cannot be aborted */ }
      finish(new Error('Private cache operation timed out'))
    }, IDB_OPERATION_DEADLINE_MS)
    request.onsuccess = () => finish()
    request.onerror = () => finish(request.error ?? new Error('Private cache request failed'))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      try { transaction.abort() } catch { /* a completed transaction cannot be aborted */ }
      finish(new Error('Private cache operation timed out'))
    }, IDB_OPERATION_DEADLINE_MS)
    transaction.oncomplete = () => finish()
    transaction.onabort = () => finish(transaction.error ?? new Error('Private cache transaction aborted'))
    transaction.onerror = () => finish(transaction.error ?? new Error('Private cache transaction failed'))
  })
}
