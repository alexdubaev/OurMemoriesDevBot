import type { QueryClient } from '@tanstack/react-query'
import { familyHomeResponseSchema, familyMembersResponseSchema, familyResponseSchema, memoryPageSchema } from '@web-app-demo/contracts'

export const PRIVATE_CACHE_SCHEMA = 2
// Sized for an album of several hundred previews (~30-80 KB each) next to feed images.
export const PRIVATE_CACHE_LIMIT_BYTES = 40 * 1024 * 1024
export const PRIVATE_CACHE_LIMIT_ENTRIES = 500
export const PRIVATE_CACHE_MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const PRIVATE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000
export const privateFamilyAccessRevokedEvent = 'memoly:private-family-access-revoked'
export type PrivateCacheInvalidation = { type: 'identity' } | { type: 'all' } | { type: 'user'; userId: string } | { type: 'family'; userId: string; familyId: string }
const privateCacheInvalidationListeners = new Set<(invalidation: PrivateCacheInvalidation) => void>()
const PRIVATE_QUERY_LIMIT_ENTRIES = 100
const PRIVATE_QUERY_LIMIT_BYTES = 2 * 1024 * 1024
const IDB_OPERATION_DEADLINE_MS = 3000

const DATABASE_NAME = 'memoly-private-cache'
// Version 2 keeps image bytes apart from their metadata, so recency updates, revalidation
// and eviction never load or rewrite an image.
const DATABASE_VERSION = 2
const STORE_NAME = 'entries'
const BYTES_STORE_NAME = 'imageBytes'
const CACHE_STORES = [STORE_NAME, BYTES_STORE_NAME]
const IMAGE_INDEX = 'imageUserId'
const namespace = (userId: string) => `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}`
let activeIdentity: string | null = null
let identityGeneration = 0
let operationQueue = Promise.resolve()
const revokedFamilyCache = new Set<string>()
const familyCacheGeneration = new Map<string, number>()
const activeFamilyByUser = new Map<string, string>()
const activeFamilyEpochByUser = new Map<string, number | null>()
const familyCacheScopeKey = (userId: string, familyId: string) => `${userId}:${familyId}`
type Connection = { factory: IDBFactory; database: Promise<IDBDatabase> }
let connection: Connection | null = null
type ValidatorIndex = { generation: number; etags: Map<string, string | null>; ready: boolean; loading: Promise<void> | null }
const imageValidators = new Map<string, ValidatorIndex>()
let pendingTouches = new Map<string, { userId: string; accessedAt: number; etag: string | null; isCurrent: () => boolean }>()
let touchFlush: Promise<void> | null = null
const pendingEvictions = new Map<string, Promise<void>>()
type StoredImage = { entry: CacheEntry; bytes: ArrayBuffer | null }
type ImageRead = { id: string; userId: string; resolve: (image: StoredImage | null) => void; reject: (error: unknown) => void }
let queuedImageReads: ImageRead[] = []

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
  screen: 'hub' | 'family' | 'feed' | 'gifts'
  selectedFamilyId: string | null
  membershipEpoch: number | null
  filter: 'all' | 'photo' | 'video' | 'voice' | 'note'
  /** Feed child filter: a child id, `'untagged'` or `null` («Все»). Absent in screens saved before filters. */
  childFilter?: string | null
}

type QueryRecord = { queryKey: readonly unknown[]; data: unknown; updatedAt: number }
type PersistedState = { queries: QueryRecord[] }
// Bytes are an ArrayBuffer because WebKit can reject Blob values written to IndexedDB.
type ImageBytes = { id: string; bytes: ArrayBuffer }
type CacheEntry = {
  id: string
  userId: string
  schema: number
  kind: 'queries' | 'image'
  key: string
  familyId?: string
  data?: PersistedState
  /** Set on image metadata only, so the image index never visits saved query state. */
  imageUserId?: string
  imageContentType?: string
  etag?: string | null
  // Rows from database version 1 kept the image inline (`blob` for schema-1 entries);
  // the upgrade moves byte buffers to the bytes store.
  blob?: Blob
  imageBytes?: ArrayBuffer
  size: number
  lastAccess: number
}

export function activatePrivateCacheIdentity(userId: string | null) {
  emitPrivateCacheInvalidation({ type: 'identity' })
  activeIdentity = userId
  activeFamilyByUser.clear()
  activeFamilyEpochByUser.clear()
  imageValidators.clear()
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
  return writeEntry(userId, 'state', data, generation)
}

export async function clearPrivateUserCache(userId: string, expectedGeneration?: number) {
  const generation = expectedGeneration ?? identityGeneration
  if (expectedGeneration !== undefined && !isActivePrivateCacheIdentity(userId, expectedGeneration)) return
  emitPrivateCacheInvalidation({ type: 'user', userId })
  activeFamilyByUser.delete(userId)
  activeFamilyEpochByUser.delete(userId)
  imageValidators.delete(userId)
  await enqueue(async () => {
    if (expectedGeneration !== undefined && !isActivePrivateCacheIdentity(userId, expectedGeneration)) return
    await withDatabase(async (db) => {
      const transaction = db.transaction(CACHE_STORES, 'readwrite')
      const bytes = transaction.objectStore(BYTES_STORE_NAME)
      const request = transaction.objectStore(STORE_NAME).index('userId').openCursor(IDBKeyRange.only(userId))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if (expectedGeneration === undefined || isActivePrivateCacheIdentity(userId, generation)) {
          const entry = cursor.value as CacheEntry
          cursor.delete()
          if (entry.kind === 'image') bytes.delete(entry.id)
        }
        cursor.continue()
      }
      await transactionDone(transaction)
    })
  })
}

export async function clearAllPrivateCache() {
  emitPrivateCacheInvalidation({ type: 'all' })
  activeFamilyByUser.clear()
  activeFamilyEpochByUser.clear()
  imageValidators.clear()
  await enqueue(async () => {
    if (typeof indexedDB === 'undefined') return
    await withDatabase(async (db) => {
      const transaction = db.transaction(CACHE_STORES, 'readwrite')
      for (const name of CACHE_STORES) transaction.objectStore(name).clear()
      await transactionDone(transaction)
    })
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
    (['feed', 'comments', 'child-albums', 'gifts'].includes(queryKey[1] as string) || queryKey[1] === 'member-avatar-directory') && queryKey[2] === familyId
  queryClient.removeQueries({ predicate: matchesFamilyPrivateQuery })
}

export async function removePrivateFamilyImages(userId: string, familyId: string) {
  const familyPrefix = `/api/v1/families/${familyId}/`
  const validators = imageValidators.get(userId)
  for (const key of validators?.etags.keys() ?? []) if (key.startsWith(familyPrefix)) validators!.etags.delete(key)
  await enqueue(() => withDatabase(async (db) => {
    const transaction = db.transaction(CACHE_STORES, 'readwrite')
    const bytes = transaction.objectStore(BYTES_STORE_NAME)
    const request = transaction.objectStore(STORE_NAME).index(IMAGE_INDEX).openCursor(IDBKeyRange.only(userId))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const entry = cursor.value as CacheEntry
      if (entry.schema === PRIVATE_CACHE_SCHEMA && entry.kind === 'image' && entry.familyId === familyId) {
        cursor.delete()
        bytes.delete(entry.id)
      }
      cursor.continue()
    }
    await transactionDone(transaction)
  }))
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

/** The stored image and the ETag it was served with, or null when there is no valid copy. */
export async function readPrivateImageEntry(userId: string, path: string): Promise<{ blob: Blob; etag: string | null } | null> {
  const eligible = eligiblePrivateImage(path)
  if (!eligible || typeof indexedDB === 'undefined') return null
  const { familyId, key } = eligible
  const isCurrent = currentFamilyCheck(userId, familyId)
  if (!isCurrent()) return null
  const stored = await readImage(userId, key)
  if (!isCurrent()) return null
  const entry = stored?.entry
  const blob = entry && stored.bytes && typeof entry.imageContentType === 'string' ? new Blob([stored.bytes], { type: entry.imageContentType }) : null
  const accessedAt = Date.now()
  if (!entry || !blob || blob.size > PRIVATE_CACHE_MAX_IMAGE_BYTES || entry.size > PRIVATE_CACHE_MAX_IMAGE_BYTES || accessedAt - entry.lastAccess > PRIVATE_CACHE_MAX_AGE_MS) {
    if (entry) await removeEntry(userId, 'image', key)
    return null
  }
  const etag = entry.etag ?? null
  rememberValidator(userId, key, etag)
  // Recency maintenance shares the write queue with every private cache mutation.
  // A valid image can be displayed while its recency update waits in that queue.
  void touchImage(userId, key, accessedAt, null, isCurrent).catch(() => undefined)
  return { blob, etag }
}

export async function readPrivateImage(userId: string, path: string) {
  return (await readPrivateImageEntry(userId, path))?.blob ?? null
}

/**
 * Records that the server confirmed the stored copy (304 or the same ETag): the entry becomes
 * the most recent one and keeps its bytes as they are.
 */
export async function markPrivateImageFresh(userId: string, path: string, etag: string | null) {
  const eligible = eligiblePrivateImage(path)
  if (!eligible || typeof indexedDB === 'undefined') return
  const isCurrent = currentFamilyCheck(userId, eligible.familyId)
  if (!isCurrent()) return
  await touchImage(userId, eligible.key, Date.now(), etag, isCurrent)
}

/**
 * What this tab knows about the stored copy without reading it: `undefined` until the index of
 * stored images has loaded, then whether a copy exists and the ETag to revalidate it with.
 */
export function privateImageValidator(userId: string, path: string): { cached: boolean; etag: string | null } | undefined {
  const eligible = eligiblePrivateImage(path)
  if (!eligible || typeof indexedDB === 'undefined' || activeIdentity !== userId) return undefined
  const index = validatorIndex(userId)
  if (!index.ready) index.loading ??= loadValidators(userId, index)
  if (index.etags.has(eligible.key)) return { cached: true, etag: index.etags.get(eligible.key) ?? null }
  return index.ready ? { cached: false, etag: null } : undefined
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
  await writeImage(userId, eligible.key, imageBytes, contentType!, response.headers.get('etag'), eligible.familyId, generation, familyGeneration)
  await scheduleEviction(userId)
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

export function validatePresentation(value: unknown): value is PersistentFamilyPresentation {
  if (!value || typeof value !== 'object') return false
  const presentation = value as PersistentFamilyPresentation
  if (presentation.home !== null && !familyHomeResponseSchema.safeParse(presentation.home).success) return false
  if (presentation.family !== null && !familyResponseSchema.safeParse(presentation.family).success) return false
  if (!Array.isArray(presentation.members) || !familyMembersResponseSchema.safeParse({ items: presentation.members }).success ||
      !['hub', 'family', 'feed', 'gifts'].includes(presentation.screen) ||
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

function currentFamilyCheck(userId: string, familyId: string) {
  const generation = identityGeneration
  const familyGeneration = privateFamilyCacheGeneration(userId, familyId)
  const familyScopeKey = familyCacheScopeKey(userId, familyId)
  return () => isActivePrivateCacheIdentity(userId, generation) &&
    !revokedFamilyCache.has(familyScopeKey) && privateFamilyCacheGeneration(userId, familyId) === familyGeneration
}

async function discardOtherSchemas(userId: string) {
  await enqueue(() => withDatabase(async (db) => {
    const transaction = db.transaction(CACHE_STORES, 'readwrite')
    const bytes = transaction.objectStore(BYTES_STORE_NAME)
    const request = transaction.objectStore(STORE_NAME).index('userId').openCursor(IDBKeyRange.only(userId))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const entry = cursor.value as CacheEntry
      if (entry.schema !== PRIVATE_CACHE_SCHEMA) {
        cursor.delete()
        if (entry.kind === 'image') bytes.delete(entry.id)
      }
      cursor.continue()
    }
    await transactionDone(transaction)
  }))
}

/** Concurrent writes share one queued eviction pass per user. */
function scheduleEviction(userId: string) {
  const pending = pendingEvictions.get(userId)
  if (pending) return pending
  const pass = enqueue(async () => {
    pendingEvictions.delete(userId)
    await evictPrivateImages(userId)
  })
  pendingEvictions.set(userId, pass)
  return pass
}

async function evictPrivateImages(userId: string) {
  await withDatabase(async (db) => {
    // The image index holds metadata rows only, so the scan never loads image bytes.
    const images = (await readImageMetadata(db, userId)).filter((entry) => entry.schema === PRIVATE_CACHE_SCHEMA)
    images.sort((a, b) => a.lastAccess - b.lastAccess)
    let totalBytes = images.reduce((sum, entry) => sum + entry.size, 0)
    const evicted: CacheEntry[] = []
    while (images.length > PRIVATE_CACHE_LIMIT_ENTRIES || totalBytes > PRIVATE_CACHE_LIMIT_BYTES) {
      const oldest = images.shift()
      if (!oldest) break
      totalBytes -= oldest.size
      evicted.push(oldest)
    }
    if (!evicted.length) return
    const write = db.transaction(CACHE_STORES, 'readwrite')
    const metadata = write.objectStore(STORE_NAME)
    const bytes = write.objectStore(BYTES_STORE_NAME)
    for (const entry of evicted) {
      metadata.delete(entry.id)
      bytes.delete(entry.id)
      forgetValidator(userId, entry.key)
    }
    await transactionDone(write)
  })
}

async function readImageMetadata(db: IDBDatabase, userId: string) {
  const transaction = db.transaction(STORE_NAME, 'readonly')
  const entries: CacheEntry[] = []
  const request = transaction.objectStore(STORE_NAME).index(IMAGE_INDEX).openCursor(IDBKeyRange.only(userId))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    const entry = cursor.value as CacheEntry
    if (entry.kind === 'image') entries.push(entry)
    cursor.continue()
  }
  await transactionDone(transaction)
  return entries
}

/**
 * Queues a metadata-only recency update. Updates that arrive before the queue reaches them
 * are written together in one transaction.
 */
function touchImage(userId: string, key: string, accessedAt: number, etag: string | null, isCurrent: () => boolean) {
  const id = entryId(userId, 'image', key)
  const previous = pendingTouches.get(id)
  pendingTouches.set(id, { userId, accessedAt: Math.max(accessedAt, previous?.accessedAt ?? 0), etag: etag ?? previous?.etag ?? null, isCurrent })
  if (etag !== null && isCurrent()) rememberValidator(userId, key, etag)
  touchFlush ??= enqueue(async () => {
    touchFlush = null
    const touches = [...pendingTouches].filter(([, touch]) => touch.isCurrent())
    pendingTouches = new Map()
    if (!touches.length) return
    await withDatabase(async (db) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      for (const [touchId, touch] of touches) {
        const request = store.get(touchId)
        request.onsuccess = () => {
          const entry = request.result as CacheEntry | undefined
          if (!touch.isCurrent() || entry?.schema !== PRIVATE_CACHE_SCHEMA || entry.userId !== touch.userId || entry.kind !== 'image') return
          const etagChanged = touch.etag !== null && touch.etag !== entry.etag
          if (entry.lastAccess >= touch.accessedAt && !etagChanged) return
          store.put({ ...entry, lastAccess: Math.max(entry.lastAccess, touch.accessedAt), ...(etagChanged ? { etag: touch.etag } : {}) } satisfies CacheEntry)
        }
      }
      await transactionDone(transaction)
    })
  })
  return touchFlush
}

async function removeEntry(userId: string, kind: CacheEntry['kind'], key: string) {
  if (kind === 'image') forgetValidator(userId, key)
  await enqueue(() => withDatabase(async (db) => {
    const id = entryId(userId, kind, key)
    const transaction = db.transaction(kind === 'image' ? CACHE_STORES : [STORE_NAME], 'readwrite')
    transaction.objectStore(STORE_NAME).delete(id)
    if (kind === 'image') transaction.objectStore(BYTES_STORE_NAME).delete(id)
    await transactionDone(transaction)
  }))
}

async function readEntry<T>(userId: string, kind: CacheEntry['kind'], key: string): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return null
  return withDatabase(async (db) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const result = await requestDone(transaction.objectStore(STORE_NAME).get(entryId(userId, kind, key))) as CacheEntry | undefined
    if (!result || result.schema !== PRIVATE_CACHE_SCHEMA || result.userId !== userId) return null
    return result.data as T ?? null
  })
}

/**
 * Image reads requested before the next macrotask (one effect pass, one IntersectionObserver
 * delivery) share one readonly transaction: WebKit spends 100-600 ms per transaction while an
 * album opens, not per request.
 */
function readImage(userId: string, key: string): Promise<StoredImage | null> {
  return new Promise((resolve, reject) => {
    queuedImageReads.push({ id: entryId(userId, 'image', key), userId, resolve, reject })
    if (queuedImageReads.length === 1) setTimeout(flushImageReads, 0)
  })
}

function flushImageReads() {
  const reads = queuedImageReads
  queuedImageReads = []
  void withDatabase((db) => readImagesTogether(db, reads))
    .catch((error: unknown) => { for (const read of reads) read.reject(error) })
}

/**
 * Each read settles as soon as its own two requests answer. A failed request misses only its
 * image (the error is handled, so the transaction goes on), and whatever is still unanswered at
 * the deadline fails then, the same bound a single read had.
 */
function readImagesTogether(db: IDBDatabase, reads: ImageRead[]) {
  // A closed connection throws here, before any read settles, so `withDatabase` may retry.
  const transaction = db.transaction(CACHE_STORES, 'readonly')
  const metadata = transaction.objectStore(STORE_NAME)
  const bytes = transaction.objectStore(BYTES_STORE_NAME)
  return new Promise<void>((done) => {
    let open = reads.length
    const failers: Array<(error: Error) => void> = []
    const finish = () => {
      clearTimeout(timer)
      done()
    }
    const timer = setTimeout(() => {
      for (const fail of failers) fail(new Error('Private cache operation timed out'))
      try { transaction.abort() } catch { /* a finished transaction cannot be aborted */ }
      done()
    }, IDB_OPERATION_DEADLINE_MS)
    transaction.onabort = () => {
      for (const fail of failers) fail(transaction.error ?? new Error('Private cache transaction aborted'))
    }
    for (const read of reads) {
      let settled = false
      let entry: CacheEntry | undefined
      let stored: ImageBytes | undefined
      let answered = 0
      const settle = (result: { image: StoredImage | null } | { error: Error }) => {
        if (settled) return
        settled = true
        if ('error' in result) read.reject(result.error)
        else read.resolve(result.image)
        open -= 1
        if (open === 0) finish()
      }
      failers.push((error) => settle({ error }))
      const answer = () => {
        answered += 1
        if (answered < 2) return
        settle({ image: entry?.schema === PRIVATE_CACHE_SCHEMA && entry.userId === read.userId && entry.kind === 'image'
          ? { entry, bytes: stored?.bytes instanceof ArrayBuffer ? stored.bytes : null }
          : null })
      }
      const onError = (request: IDBRequest) => (event: Event) => {
        event.preventDefault()
        settle({ error: request.error ?? new Error('Private cache request failed') })
      }
      const metadataRequest = metadata.get(read.id)
      metadataRequest.onsuccess = () => { entry = metadataRequest.result as CacheEntry | undefined; answer() }
      metadataRequest.onerror = onError(metadataRequest)
      const bytesRequest = bytes.get(read.id)
      bytesRequest.onsuccess = () => { stored = bytesRequest.result as ImageBytes | undefined; answer() }
      bytesRequest.onerror = onError(bytesRequest)
    }
  })
}

async function writeEntry(userId: string, key: string, data: PersistedState, generation?: number) {
  if (typeof indexedDB === 'undefined') return
  const expectedGeneration = generation ?? identityGeneration
  await enqueue(async () => {
    if (!isActivePrivateCacheIdentity(userId, expectedGeneration)) return
    await withDatabase(async (db) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      if (!isActivePrivateCacheIdentity(userId, expectedGeneration)) { transaction.abort(); return }
      transaction.objectStore(STORE_NAME).put({
        id: entryId(userId, 'queries', key), userId, schema: PRIVATE_CACHE_SCHEMA, kind: 'queries', key, data,
        size: estimateSize(data), lastAccess: Date.now(),
      } satisfies CacheEntry)
      await transactionDone(transaction)
    })
  })
}

async function writeImage(userId: string, key: string, bytes: ArrayBuffer, contentType: string, etag: string | null, familyId: string, generation: number, familyGeneration: number) {
  if (typeof indexedDB === 'undefined') return
  const scopeKey = familyCacheScopeKey(userId, familyId)
  const isCurrent = () => isActivePrivateCacheIdentity(userId, generation) &&
    !revokedFamilyCache.has(scopeKey) && privateFamilyCacheGeneration(userId, familyId) === familyGeneration
  await enqueue(async () => {
    if (!isCurrent()) return
    await withDatabase(async (db) => {
      const transaction = db.transaction(CACHE_STORES, 'readwrite')
      if (!isCurrent()) { transaction.abort(); return }
      const id = entryId(userId, 'image', key)
      transaction.objectStore(STORE_NAME).put({
        id, userId, imageUserId: userId, schema: PRIVATE_CACHE_SCHEMA, kind: 'image', key, familyId,
        imageContentType: contentType, etag, size: bytes.byteLength, lastAccess: Date.now(),
      } satisfies CacheEntry)
      transaction.objectStore(BYTES_STORE_NAME).put({ id, bytes } satisfies ImageBytes)
      await transactionDone(transaction)
      if (isCurrent()) rememberValidator(userId, key, etag)
    })
  })
}

function entryId(userId: string, kind: CacheEntry['kind'], key: string) {
  return `${namespace(userId)}:${kind}:${key}`
}

function validatorIndex(userId: string) {
  let index = imageValidators.get(userId)
  if (!index || index.generation !== identityGeneration) {
    index = { generation: identityGeneration, etags: new Map(), ready: false, loading: null }
    imageValidators.set(userId, index)
  }
  return index
}

function rememberValidator(userId: string, key: string, etag: string | null) {
  if (activeIdentity === userId) validatorIndex(userId).etags.set(key, etag)
}

function forgetValidator(userId: string, key: string) {
  imageValidators.get(userId)?.etags.delete(key)
}

async function loadValidators(userId: string, index: ValidatorIndex) {
  try {
    const entries = await withDatabase((db) => readImageMetadata(db, userId))
    if (imageValidators.get(userId) !== index) return
    for (const entry of entries) {
      if (entry.schema === PRIVATE_CACHE_SCHEMA && entry.userId === userId && !index.etags.has(entry.key)) index.etags.set(entry.key, entry.etag ?? null)
    }
    index.ready = true
  } catch {
    // Without the index an image is revalidated without a validator; a later lookup retries.
    index.loading = null
  }
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

/** One connection per IndexedDB factory, reopened after the browser closes it or another tab upgrades. */
function openConnection(): Promise<IDBDatabase> {
  const factory = indexedDB
  if (connection?.factory === factory) return connection.database
  const current: Connection = { factory, database: openDatabase(factory) }
  connection = current
  const forget = () => { if (connection === current) connection = null }
  current.database.then((db) => {
    db.onclose = forget
    db.onversionchange = () => {
      forget()
      db.close()
    }
  }, forget)
  return current.database
}

async function withDatabase<T>(work: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openConnection()
  try {
    return await work(db)
  } catch (error) {
    // A connection closed under us cannot start transactions: open a fresh one once.
    if (!(error instanceof DOMException && error.name === 'InvalidStateError')) throw error
    if (connection && await connection.database.catch(() => null) === db) connection = null
    return work(await openConnection())
  }
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('Private cache operation timed out'))
    }, IDB_OPERATION_DEADLINE_MS)
    request.onupgradeneeded = (event) => {
      const db = request.result
      const transaction = request.transaction!
      const entries = db.objectStoreNames.contains(STORE_NAME)
        ? transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!entries.indexNames.contains('userId')) entries.createIndex('userId', 'userId', { unique: false })
      if (!entries.indexNames.contains(IMAGE_INDEX)) entries.createIndex(IMAGE_INDEX, 'imageUserId', { unique: false })
      if (!db.objectStoreNames.contains(BYTES_STORE_NAME)) db.createObjectStore(BYTES_STORE_NAME, { keyPath: 'id' })
      if (event.oldVersion > 0 && event.oldVersion < 2) moveInlineImages(entries, transaction.objectStore(BYTES_STORE_NAME))
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

/**
 * Version 1 kept image bytes inside each entry. The upgrade moves current byte buffers to
 * their own store and drops older Blob rows: they are a cache, not data.
 */
function moveInlineImages(entries: IDBObjectStore, bytes: IDBObjectStore) {
  const request = entries.openCursor()
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    const entry = cursor.value as CacheEntry
    if (entry.kind === 'image') {
      const imageBytes = entry.imageBytes
      if (entry.schema === PRIVATE_CACHE_SCHEMA && imageBytes instanceof ArrayBuffer && typeof entry.imageContentType === 'string' &&
          imageBytes.byteLength > 0 && imageBytes.byteLength <= PRIVATE_CACHE_MAX_IMAGE_BYTES) {
        const metadata: CacheEntry = { ...entry, imageUserId: entry.userId, etag: null }
        delete metadata.imageBytes
        delete metadata.blob
        bytes.put({ id: entry.id, bytes: imageBytes } satisfies ImageBytes)
        cursor.update(metadata)
      } else {
        cursor.delete()
      }
    }
    cursor.continue()
  }
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
