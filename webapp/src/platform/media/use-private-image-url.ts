import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { AvatarResourcePool, isImmutableMemberAvatarPath } from './avatar-resource-pool'
import { idleAlbumPreviews, idleFeedPhotos, idleFeedPosters } from './feed-poster-cache'
import { cachePrivateImageResponse, eligiblePrivateImage, markPrivateImageFresh, privateFamilyCacheGeneration, privateCacheIdentityGeneration, privateImageValidator, isActivePrivateCacheIdentity, readPrivateImage, readPrivateImageEntry, removePrivateImage, clearPrivateUserCache, privateFamilyAccessRevokedEvent, subscribePrivateCacheInvalidation } from '@/platform/persistence/private-cache'

// Idle pools hand a decoded image to the next tile of the same user, identity generation,
// family generation and scope (all in the pool key). The transport object is replaced on
// every access-token refresh, so it is not part of that identity.
const idlePoolOwner: AuthenticatedTransport = {
  request: () => Promise.reject(new Error('Idle image pool owner does not send requests')),
  raw: () => Promise.reject(new Error('Idle image pool owner does not send requests')),
}
const memberAvatarPool = new AvatarResourcePool<{ url: string; size: number }>((resource) => URL.revokeObjectURL(resource.url))
subscribePrivateCacheInvalidation((invalidation) => {
  const matches = (key: string) => {
    const [userId, familyId] = JSON.parse(key) as [string, string]
    if (invalidation.type === 'identity' || invalidation.type === 'all') return true
    if (invalidation.type === 'user') return userId === invalidation.userId
    return userId === invalidation.userId && familyId === invalidation.familyId
  }
  memberAvatarPool.invalidate(matches)
  idleFeedPosters.clear(matches)
  idleFeedPhotos.clear(matches)
  idleAlbumPreviews.clear(matches)
})

export function invalidatePrivateChildAvatar(userId: string, familyId: string, mediaId: string) {
  const path = `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=display`
  memberAvatarPool.invalidate((key) => {
    const [entryUserId, entryFamilyId, , , , entryPath] = JSON.parse(key) as [string, string, number, number, string, string]
    return entryUserId === userId && entryFamilyId === familyId && entryPath === path
  })
}

export type PrivateImageResourceState = { url: string | null; status: 'absent' | 'loading' | 'ready' | 'error' }

export function usePrivateImageUrl(userId: string, path: string | null, transport: AuthenticatedTransport | undefined, enabled = true, onSettled?: () => void, scopeKey = '') {
  return usePrivateImageResource(userId, path, transport, enabled, onSettled, scopeKey).url
}

export function usePrivateImageResource(userId: string, path: string | null, transport: AuthenticatedTransport | undefined, enabled = true, onSettled?: () => void, scopeKey = '', poolMode?: 'child-avatar' | 'feed-poster' | 'feed-photo' | 'album-preview'): PrivateImageResourceState {
  const identityGeneration = privateCacheIdentityGeneration()
  const eligible = path ? eligiblePrivateImage(path) : null
  const familyId = eligible?.familyId
  const familyGeneration = familyId ? privateFamilyCacheGeneration(userId, familyId) : undefined
  const usesAvatarPool = Boolean(path && eligible && (isImmutableMemberAvatarPath(path) || poolMode === 'child-avatar'))
  const poolKey = usesAvatarPool && familyId
    ? JSON.stringify([userId, familyId, identityGeneration, familyGeneration, scopeKey, path])
    : null
  const idlePool = poolMode === 'album-preview' ? idleAlbumPreviews : poolMode === 'feed-poster' ? idleFeedPosters : poolMode === 'feed-photo' ? idleFeedPhotos : null
  const idleKey = idlePool && scopeKey && familyId && !usesAvatarPool
    ? JSON.stringify([userId, familyId, identityGeneration, familyGeneration, scopeKey, path])
    : null
  const hasTransport = Boolean(transport)
  // The effects read the current transport from this ref: a refreshed token replaces the
  // transport object but must not restart image loading.
  const transportRef = useRef(transport)
  useLayoutEffect(() => { transportRef.current = transport }, [transport])
  const idleTransport = idleKey && hasTransport ? idlePoolOwner : undefined
  const pooledSnapshot = useSyncExternalStore(
    useCallback((listener) => poolKey ? memberAvatarPool.subscribe(poolKey, listener) : () => undefined, [poolKey]),
    useCallback(() => poolKey ? memberAvatarPool.getSnapshot(poolKey) : memberAvatarPool.getSnapshot(''), [poolKey]),
    () => memberAvatarPool.getSnapshot(''),
  )
  const [invalidationRevision, setInvalidationRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ userId: string; path: string; url: string | null; identityGeneration: number; scopeKey: string; familyId?: string; familyGeneration?: number; poolKey?: string; idleBytes?: number } | null>(null)
  const loadedRef = useRef(loaded)
  const lastRequest = useRef<{ userId: string; path: string; scopeKey: string } | null>(null)
  const requestController = useRef<AbortController | null>(null)
  const ownedUrls = useRef(new Set<string>())
  const [ownedUrlSet, setOwnedUrlSet] = useState<Set<string>>(() => new Set())
  const ownUrl = useCallback((url: string) => {
    ownedUrls.current.add(url)
    setOwnedUrlSet((current) => new Set(current).add(url))
  }, [])
  const forgetUrl = useCallback((url: string) => {
    setOwnedUrlSet((current) => {
      if (!current.has(url)) return current
      const next = new Set(current)
      next.delete(url)
      return next
    })
  }, [])
  const releaseUrl = useCallback((url: string) => {
    if (revokeOwnedUrl(ownedUrls.current, url)) forgetUrl(url)
  }, [forgetUrl])
  const onSettledRef = useRef(onSettled)
  useLayoutEffect(() => { loadedRef.current = loaded }, [loaded])
  useEffect(() => { onSettledRef.current = onSettled }, [onSettled])
  useEffect(() => {
    const unsubscribe = subscribePrivateCacheInvalidation((invalidation) => {
    if (invalidation.type === 'identity' || invalidation.type === 'all' ||
      (invalidation.type === 'user' && invalidation.userId === userId) ||
      (invalidation.type === 'family' && invalidation.userId === userId && invalidation.familyId === familyId)) {
      setInvalidationRevision((current) => current + 1)
    }
    })
    return () => { unsubscribe() }
  }, [familyId, userId])
  useLayoutEffect(() => {
    const urls = ownedUrls.current
    if (idleKey && path && idleTransport && isActivePrivateCacheIdentity(userId, identityGeneration)) {
      const cached = idlePool?.take(idleKey, idleTransport)
      if (cached) {
        urls.add(cached.url)
        loadedRef.current = { userId, path, url: cached.url, identityGeneration, scopeKey, familyId, familyGeneration, idleBytes: cached.size }
        setOwnedUrlSet(new Set(ownedUrls.current))
        setLoaded(loadedRef.current)
      }
    }
    return () => {
      // Cancel in-flight work before handing off or releasing URL ownership.
      requestController.current?.abort()
      const current = loadedRef.current
      if (idleKey && path && idleTransport && current?.url && current.idleBytes &&
        isActivePrivateCacheIdentity(userId, identityGeneration) &&
        hasOwnedReadyUrl(current, urls, userId, path, identityGeneration, scopeKey) &&
        idlePool?.keep(idleKey, idleTransport, { url: current.url, size: current.idleBytes })) {
        urls.delete(current.url)
        forgetUrl(current.url)
      }
      urls.forEach((url) => releaseUrl(url))
      urls.clear()
    }
  }, [familyGeneration, familyId, forgetUrl, identityGeneration, path, idleKey, idlePool, idleTransport, releaseUrl, scopeKey, userId])
  useEffect(() => {
    if (!userId || !path || !enabled || !hasTransport) return
    if (usesAvatarPool && poolKey) {
      if (!familyId) return
      const poolFamilyId = familyId
      const familyGeneration = privateFamilyCacheGeneration(userId, poolFamilyId)
      const release = memberAvatarPool.acquire(poolKey, async (signal) => {
        const isCurrent = () => !signal.aborted && isActivePrivateCacheIdentity(userId, identityGeneration) &&
          privateFamilyCacheGeneration(userId, poolFamilyId) === familyGeneration
        const decode = async (blob: Blob) => {
          const url = URL.createObjectURL(blob)
          try {
            const image = new Image()
            image.src = url
            await image.decode()
            if (!isCurrent()) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
            return { url, size: blob.size }
          } catch (error) {
            URL.revokeObjectURL(url)
            throw error
          }
        }
        const cached = await readPrivateImage(userId, path).catch(() => null)
        if (!isCurrent()) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
        if (cached) {
          try { return await decode(cached) }
          catch { await removePrivateImage(userId, path).catch(() => undefined) }
        }
        if (!isCurrent()) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
        const response = await transportRef.current!.raw(path, { signal, headers: { 'X-Private-Media-Purpose': 'image' } })
        const blob = await response.clone().blob()
        if (!isCurrent()) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
        const resource = await decode(blob)
        void cachePrivateImageResponse(userId, path, response, identityGeneration, familyGeneration).catch(() => false)
        return resource
      }, (result) => {
        if (result.status !== 'loading') onSettledRef.current?.()
      }, (error) => {
        if (error instanceof ApiRequestError && error.status === 401) void clearPrivateUserCache(userId, identityGeneration).catch(() => undefined)
        if (error instanceof ApiRequestError && error.status === 403) {
          window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId, familyId: poolFamilyId } }))
        }
        if (error instanceof ApiRequestError && [401, 404].includes(error.status)) void removePrivateImage(userId, path).catch(() => undefined)
      })
      return release
    }
    if (hasOwnedReadyUrl(loadedRef.current, ownedUrls.current, userId, path, identityGeneration, scopeKey) && lastRequest.current?.userId === userId && lastRequest.current.path === path && lastRequest.current.scopeKey === scopeKey) return
    lastRequest.current = { userId, path, scopeKey }
    const controller = new AbortController()
    requestController.current = controller
    const requestFamilyId = eligiblePrivateImage(path)?.familyId
    const familyGeneration = requestFamilyId ? privateFamilyCacheGeneration(userId, requestFamilyId) : undefined
    let cachedWasShown = false
    // Set once the server refuses access: a stored copy that is still being read must not appear.
    let denied = false
    // The cache and the network may both decode a copy; the first one to finish is shown.
    let shown: 'cache' | 'network' | null = null
    const isCurrent = () => !controller.signal.aborted && isActivePrivateCacheIdentity(userId, identityGeneration) &&
      (!requestFamilyId || privateFamilyCacheGeneration(userId, requestFamilyId) === familyGeneration)
    const hasPriorReadyUrl = () => hasOwnedReadyUrl(loadedRef.current, ownedUrls.current, userId, path, identityGeneration, scopeKey)
    const showBlob = async (blob: Blob, source: 'cache' | 'network') => {
      const url = URL.createObjectURL(blob)
      ownUrl(url)
      let idleBytes: number | undefined
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        if (idleKey) idleBytes = blob.size
        if (!isCurrent() || denied || shown) {
          releaseUrl(url)
          return false
        }
      } catch (error) {
        releaseUrl(url)
        throw error
      }
      shown = source
      setLoaded({ userId, path, url, identityGeneration, scopeKey, idleBytes, ...(requestFamilyId ? { familyId: requestFamilyId, familyGeneration } : {}) })
      return true
    }
    // Whether the stored copy reached the screen; a network failure waits for it before showing an error.
    let storedCopyOutcome: Promise<boolean> = Promise.resolve(false)
    const request = (validator: string | null) => transportRef.current!.raw(path, {
      signal: controller.signal,
      headers: { 'X-Private-Media-Purpose': 'image', ...(validator ? { 'If-None-Match': validator } : {}) },
    })
    void (async () => {
      const readyUrlAlreadyShown = hasOwnedReadyUrl(loadedRef.current, ownedUrls.current, userId, path, identityGeneration, scopeKey)
      const cacheable = Boolean(eligiblePrivateImage(path))
      // `undefined` until this tab has indexed the stored images; then it says whether a copy
      // exists and which ETag the server can confirm with a 304.
      const validator = cacheable ? privateImageValidator(userId, path) : undefined
      const validatorEtag = validator?.etag ?? null
      // The stored copy and the network check start together: a cached tile does not wait for
      // the network, and a tile without a copy does not wait for IndexedDB.
      const stored = cacheable && !readyUrlAlreadyShown && validator?.cached !== false
        ? readPrivateImageEntry(userId, path).catch(() => null)
        : Promise.resolve(null)
      const shownFromCache = stored.then(async (entry) => {
        if (!entry || !isCurrent() || denied || shown || hasPriorReadyUrl()) return false
        try { cachedWasShown = await showBlob(entry.blob, 'cache') }
        catch { await removePrivateImage(userId, path).catch(() => undefined) }
        return cachedWasShown
      })
      storedCopyOutcome = shownFromCache.catch(() => false)
      const storedCopyShown = async () => readyUrlAlreadyShown || await shownFromCache || hasPriorReadyUrl()
      let response: Response | null
      try {
        response = await request(validatorEtag)
      } catch (error) {
        if (!(error instanceof ApiRequestError && error.status === 304)) throw error
        response = null
      }
      if (!isCurrent()) return
      if (!response) {
        if (await storedCopyShown()) {
          // 304: the stored copy is current. Only its recency changes; the bytes stay as they are.
          void markPrivateImageFresh(userId, path, validatorEtag).catch(() => undefined)
          if (isCurrent()) onSettledRef.current?.()
          return
        }
        if (!isCurrent()) return
        // The copy the validator described is gone: fetch the body once without a validator.
        response = await request(null)
        if (!isCurrent()) return
      }
      const responseEtag = response.headers.get('etag')
      if (cacheable && responseEtag && responseEtag === validatorEtag && await storedCopyShown()) {
        // Same ETag as the stored copy: skip the body instead of downloading and rewriting it.
        void response.body?.cancel().catch(() => undefined)
        void markPrivateImageFresh(userId, path, responseEtag).catch(() => undefined)
        if (isCurrent()) onSettledRef.current?.()
        return
      }
      if (!isCurrent()) return
      // A viewer may already be using the ready URL, or the stored copy is already on screen:
      // then only the stored bytes are refreshed, without a URL the UI would discard.
      if (!readyUrlAlreadyShown && !shown && !hasPriorReadyUrl()) {
        const blob = await response.clone().blob()
        if (!isCurrent()) return
        await showBlob(blob, 'network')
        if (!isCurrent()) return
      }
      if (cacheable) {
        const storedEtag = (await stored)?.etag ?? null
        if (responseEtag && storedEtag === responseEtag) {
          void response.body?.cancel().catch(() => undefined)
          void markPrivateImageFresh(userId, path, responseEtag).catch(() => undefined)
        } else {
          await cachePrivateImageResponse(userId, path, response, identityGeneration, familyGeneration).catch(() => false)
        }
      }
      if (!isCurrent()) return
      onSettledRef.current?.()
    })().catch(async (error: unknown) => {
      if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) denied = true
      // Offline, timeout or 5xx: a stored copy that is still being read is shown instead of an error.
      else await storedCopyOutcome
      if (!isCurrent()) return
      onSettledRef.current?.()
      if (idleKey && error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
        idlePool?.forget(idleKey)
        const url = loadedRef.current?.url
        if (url) releaseUrl(url)
      }
      if (error instanceof ApiRequestError && error.status === 401) void clearPrivateUserCache(userId).catch(() => undefined)
      if (requestFamilyId && error instanceof ApiRequestError && error.status === 403) {
        window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId, familyId: requestFamilyId } }))
      }
      if (eligiblePrivateImage(path) && error instanceof ApiRequestError && [401, 404].includes(error.status)) {
        void removePrivateImage(userId, path).catch(() => undefined)
      }
      if ((!cachedWasShown && !hasPriorReadyUrl()) || error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
        setLoaded({ userId, path, url: null, identityGeneration, scopeKey, ...(requestFamilyId ? { familyId: requestFamilyId, familyGeneration } : {}) })
      }
    })
    return () => {
      controller.abort()
      if (requestController.current === controller) requestController.current = null
    }
  }, [enabled, familyGeneration, familyId, hasTransport, identityGeneration, invalidationRevision, ownUrl, path, poolKey, idleKey, idlePool, releaseUrl, scopeKey, userId, usesAvatarPool])
  if (usesAvatarPool) {
    const current = Boolean(enabled && userId && transport && poolKey && familyId &&
      isActivePrivateCacheIdentity(userId, identityGeneration) &&
      privateFamilyCacheGeneration(userId, familyId) === familyGeneration)
    if (!current) return { url: null, status: path ? 'loading' : 'absent' }
    return {
      url: pooledSnapshot.status === 'ready' ? pooledSnapshot.url : null,
      status: pooledSnapshot.status,
    }
  }
  const loadedIsCurrent = loaded?.userId === userId && loaded.path === path && loaded.identityGeneration === identityGeneration && loaded.scopeKey === scopeKey &&
    (!loaded.url || loaded.poolKey || ownedUrlSet.has(loaded.url)) &&
    (!loaded.familyId || privateFamilyCacheGeneration(userId, loaded.familyId) === loaded.familyGeneration)
  const url = loadedIsCurrent ? loaded.url : null
  const status = !path ? 'absent' : !enabled || !transport || !userId ? 'loading' : loadedIsCurrent ? url ? 'ready' : 'error' : 'loading'
  return { url, status }
}

function hasLoadedReadyUrl(loaded: { userId: string; path: string; url: string | null; identityGeneration: number; scopeKey: string; familyId?: string; familyGeneration?: number } | null, userId: string, path: string, identityGeneration = privateCacheIdentityGeneration(), scopeKey = '') {
  return loaded?.userId === userId && loaded.path === path && loaded.identityGeneration === identityGeneration && loaded.scopeKey === scopeKey && Boolean(loaded.url) &&
    (!loaded.familyId || privateFamilyCacheGeneration(userId, loaded.familyId) === loaded.familyGeneration)
}

function hasOwnedReadyUrl(loaded: { userId: string; path: string; url: string | null; identityGeneration: number; scopeKey: string; familyId?: string; familyGeneration?: number; poolKey?: string } | null, ownedUrls: Set<string>, userId: string, path: string, identityGeneration: number, scopeKey: string) {
  return hasLoadedReadyUrl(loaded, userId, path, identityGeneration, scopeKey) && Boolean(loaded?.url && (loaded.poolKey || ownedUrls.has(loaded.url)))
}

function revokeOwnedUrl(ownedUrls: Set<string>, url: string) {
  if (!ownedUrls.has(url)) return false
  ownedUrls.delete(url)
  URL.revokeObjectURL(url)
  return true
}
