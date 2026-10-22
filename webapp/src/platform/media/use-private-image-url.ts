import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { AvatarResourcePool, isImmutableMemberAvatarPath } from './avatar-resource-pool'
import { cachePrivateImageResponse, eligiblePrivateImage, privateFamilyCacheGeneration, privateCacheIdentityGeneration, isActivePrivateCacheIdentity, readPrivateImage, removePrivateImage, clearPrivateUserCache, privateFamilyAccessRevokedEvent, subscribePrivateCacheInvalidation } from '@/platform/persistence/private-cache'

const memberAvatarPool = new AvatarResourcePool<{ url: string; size: number }>((resource) => URL.revokeObjectURL(resource.url))
subscribePrivateCacheInvalidation((invalidation) => {
  memberAvatarPool.invalidate((key) => {
    const [userId, familyId] = JSON.parse(key) as [string, string]
    if (invalidation.type === 'identity' || invalidation.type === 'all') return true
    if (invalidation.type === 'user') return userId === invalidation.userId
    return userId === invalidation.userId && familyId === invalidation.familyId
  })
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

export function usePrivateImageResource(userId: string, path: string | null, transport: AuthenticatedTransport | undefined, enabled = true, onSettled?: () => void, scopeKey = '', poolMode?: 'child-avatar'): PrivateImageResourceState {
  const identityGeneration = privateCacheIdentityGeneration()
  const eligible = path ? eligiblePrivateImage(path) : null
  const familyId = eligible?.familyId
  const familyGeneration = familyId ? privateFamilyCacheGeneration(userId, familyId) : undefined
  const usesAvatarPool = Boolean(path && eligible && (isImmutableMemberAvatarPath(path) || poolMode === 'child-avatar'))
  const poolKey = usesAvatarPool && familyId
    ? JSON.stringify([userId, familyId, identityGeneration, familyGeneration, scopeKey, path])
    : null
  const pooledSnapshot = useSyncExternalStore(
    useCallback((listener) => poolKey ? memberAvatarPool.subscribe(poolKey, listener) : () => undefined, [poolKey]),
    useCallback(() => poolKey ? memberAvatarPool.getSnapshot(poolKey) : memberAvatarPool.getSnapshot(''), [poolKey]),
    () => memberAvatarPool.getSnapshot(''),
  )
  const [invalidationRevision, setInvalidationRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ userId: string; path: string; url: string | null; identityGeneration: number; scopeKey: string; familyId?: string; familyGeneration?: number; poolKey?: string } | null>(null)
  const loadedRef = useRef(loaded)
  const lastRequest = useRef<{ userId: string; path: string; transport: AuthenticatedTransport; scopeKey: string } | null>(null)
  const ownedUrls = useRef(new Set<string>())
  const [ownedUrlSet, setOwnedUrlSet] = useState<Set<string>>(() => new Set())
  const ownUrl = useCallback((url: string) => {
    ownedUrls.current.add(url)
    setOwnedUrlSet((current) => new Set(current).add(url))
  }, [])
  const releaseUrl = useCallback((url: string) => {
    if (revokeOwnedUrl(ownedUrls.current, url)) setOwnedUrlSet((current) => {
      if (!current.has(url)) return current
      const next = new Set(current)
      next.delete(url)
      return next
    })
  }, [])
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
  useEffect(() => {
    const urls = ownedUrls.current
    return () => {
      urls.forEach((url) => releaseUrl(url))
      urls.clear()
    }
  }, [familyGeneration, identityGeneration, path, releaseUrl, scopeKey, userId])
  useEffect(() => {
    if (!userId || !path || !enabled || !transport) return
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
        const response = await transport.raw(path, { signal, headers: { 'X-Private-Media-Purpose': 'image' } })
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
    if (hasOwnedReadyUrl(loadedRef.current, ownedUrls.current, userId, path, identityGeneration, scopeKey) && lastRequest.current?.userId === userId && lastRequest.current.path === path && lastRequest.current.transport === transport && lastRequest.current.scopeKey === scopeKey) return
    lastRequest.current = { userId, path, transport, scopeKey }
    const controller = new AbortController()
    const requestFamilyId = eligiblePrivateImage(path)?.familyId
    const familyGeneration = requestFamilyId ? privateFamilyCacheGeneration(userId, requestFamilyId) : undefined
    let cachedWasShown = false
    const isCurrent = () => !controller.signal.aborted && isActivePrivateCacheIdentity(userId, identityGeneration) &&
      (!requestFamilyId || privateFamilyCacheGeneration(userId, requestFamilyId) === familyGeneration)
    const hasPriorReadyUrl = () => hasOwnedReadyUrl(loadedRef.current, ownedUrls.current, userId, path, identityGeneration, scopeKey)
    const showBlob = async (blob: Blob) => {
      const url = URL.createObjectURL(blob)
      ownUrl(url)
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        if (!isCurrent()) {
          releaseUrl(url)
          return false
        }
      } catch (error) {
        releaseUrl(url)
        throw error
      }
      setLoaded({ userId, path, url, identityGeneration, scopeKey, ...(requestFamilyId ? { familyId: requestFamilyId, familyGeneration } : {}) })
      return true
    }
    void (async () => {
      const readyUrlAlreadyShown = hasOwnedReadyUrl(loadedRef.current, ownedUrls.current, userId, path, identityGeneration, scopeKey)
      if (eligiblePrivateImage(path) && !readyUrlAlreadyShown) {
        const cached = await readPrivateImage(userId, path).catch(() => null)
        if (isCurrent() && cached) {
          try { cachedWasShown = await showBlob(cached) }
          catch { await removePrivateImage(userId, path).catch(() => undefined) }
        }
      }
      if (!isCurrent()) return
      const response = await transport.raw(path, { signal: controller.signal, headers: { 'X-Private-Media-Purpose': 'image' } })
      const blob = await response.clone().blob()
      if (!isCurrent()) return
      const candidateUrl = URL.createObjectURL(blob)
      ownUrl(candidateUrl)
      try {
        const image = new Image()
        image.src = candidateUrl
        await image.decode()
      } catch (error) {
        releaseUrl(candidateUrl)
        throw error
      }
      if (!isCurrent()) {
        releaseUrl(candidateUrl)
        return
      }
      const keepWarmUrl = readyUrlAlreadyShown || cachedWasShown || hasPriorReadyUrl()
      if (!keepWarmUrl) {
      setLoaded({ userId, path, url: candidateUrl, identityGeneration, scopeKey, ...(requestFamilyId ? { familyId: requestFamilyId, familyGeneration } : {}) })
      } else {
        // Keep a warm URL stable while refreshing the persistent Blob. The fullscreen viewer can
        // borrow this URL, so replacing it here could revoke a URL still used by that viewer.
        releaseUrl(candidateUrl)
      }
      if (eligiblePrivateImage(path)) await cachePrivateImageResponse(userId, path, response, identityGeneration, familyGeneration).catch(() => false)
      if (!isCurrent()) return
      onSettledRef.current?.()
    })().catch((error: unknown) => {
      if (!isCurrent()) return
      onSettledRef.current?.()
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
    }
  }, [enabled, familyGeneration, familyId, identityGeneration, invalidationRevision, ownUrl, path, poolKey, releaseUrl, scopeKey, transport, userId, usesAvatarPool])
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
