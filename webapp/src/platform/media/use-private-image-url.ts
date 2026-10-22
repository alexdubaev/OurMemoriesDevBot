import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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

export type PrivateImageResourceState = { url: string | null; status: 'absent' | 'loading' | 'ready' | 'error' }

export function usePrivateImageUrl(userId: string, path: string | null, transport: AuthenticatedTransport | undefined, enabled = true, onSettled?: () => void, scopeKey = '') {
  return usePrivateImageResource(userId, path, transport, enabled, onSettled, scopeKey).url
}

export function usePrivateImageResource(userId: string, path: string | null, transport: AuthenticatedTransport | undefined, enabled = true, onSettled?: () => void, scopeKey = ''): PrivateImageResourceState {
  const identityGeneration = privateCacheIdentityGeneration()
  const eligible = path ? eligiblePrivateImage(path) : null
  const familyId = eligible?.familyId
  const familyGeneration = familyId ? privateFamilyCacheGeneration(userId, familyId) : undefined
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
    if (isImmutableMemberAvatarPath(path)) {
      const eligible = eligiblePrivateImage(path)
      if (!eligible) return
      const familyId = eligible.familyId
      const familyGeneration = privateFamilyCacheGeneration(userId, familyId)
      const key = JSON.stringify([userId, familyId, identityGeneration, familyGeneration, scopeKey, path])
      let settled = false
      const release = memberAvatarPool.acquire(key, async (signal) => {
        const isCurrent = () => !signal.aborted && isActivePrivateCacheIdentity(userId, identityGeneration) &&
          privateFamilyCacheGeneration(userId, familyId) === familyGeneration
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
        if (result.url) {
          setLoaded({ userId, path, url: result.url, identityGeneration, scopeKey, familyId, familyGeneration, poolKey: key })
        } else {
          setLoaded({ userId, path, url: null, identityGeneration, scopeKey, familyId, familyGeneration })
          const error = result.error
          if (error instanceof ApiRequestError && error.status === 401) void clearPrivateUserCache(userId, identityGeneration).catch(() => undefined)
          if (error instanceof ApiRequestError && error.status === 403) {
            window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId, familyId } }))
          }
          if (error instanceof ApiRequestError && [401, 404].includes(error.status)) void removePrivateImage(userId, path).catch(() => undefined)
        }
        if (!settled) {
          settled = true
          onSettledRef.current?.()
        }
      })
      return release
    }
    if (hasOwnedReadyUrl(loadedRef.current, ownedUrls.current, userId, path, identityGeneration, scopeKey) && lastRequest.current?.userId === userId && lastRequest.current.path === path && lastRequest.current.transport === transport && lastRequest.current.scopeKey === scopeKey) return
    lastRequest.current = { userId, path, transport, scopeKey }
    const controller = new AbortController()
    const familyId = eligiblePrivateImage(path)?.familyId
    const familyGeneration = familyId ? privateFamilyCacheGeneration(userId, familyId) : undefined
    let cachedWasShown = false
    const isCurrent = () => !controller.signal.aborted && isActivePrivateCacheIdentity(userId, identityGeneration) &&
      (!familyId || privateFamilyCacheGeneration(userId, familyId) === familyGeneration)
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
      setLoaded({ userId, path, url, identityGeneration, scopeKey, ...(familyId ? { familyId, familyGeneration } : {}) })
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
        setLoaded({ userId, path, url: candidateUrl, identityGeneration, scopeKey, ...(familyId ? { familyId, familyGeneration } : {}) })
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
      if (familyId && error instanceof ApiRequestError && error.status === 403) {
        window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId, familyId } }))
      }
      if (eligiblePrivateImage(path) && error instanceof ApiRequestError && [401, 404].includes(error.status)) {
        void removePrivateImage(userId, path).catch(() => undefined)
      }
      if ((!cachedWasShown && !hasPriorReadyUrl()) || error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
        setLoaded({ userId, path, url: null, identityGeneration, scopeKey, ...(familyId ? { familyId, familyGeneration } : {}) })
      }
    })
    return () => {
      controller.abort()
    }
  }, [enabled, familyGeneration, identityGeneration, invalidationRevision, ownUrl, path, releaseUrl, scopeKey, transport, userId])
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
