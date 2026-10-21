import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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

export function usePrivateImageUrl(userId: string, path: string | null, transport: AuthenticatedTransport | undefined, enabled = true, onSettled?: () => void) {
  const identityGeneration = privateCacheIdentityGeneration()
  const [loaded, setLoaded] = useState<{ userId: string; path: string; url: string | null; identityGeneration: number; familyId?: string; familyGeneration?: number } | null>(null)
  const loadedRef = useRef(loaded)
  const lastRequest = useRef<{ userId: string; path: string; transport: AuthenticatedTransport } | null>(null)
  const ownedUrls = useRef(new Set<string>())
  const onSettledRef = useRef(onSettled)
  useLayoutEffect(() => { loadedRef.current = loaded }, [loaded])
  useEffect(() => { onSettledRef.current = onSettled }, [onSettled])
  useEffect(() => {
    const urls = ownedUrls.current
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [identityGeneration, path, userId])
  useEffect(() => {
    if (!userId || !path || !enabled || !transport) return
    if (isImmutableMemberAvatarPath(path)) {
      const eligible = eligiblePrivateImage(path)
      if (!eligible) return
      const familyId = eligible.familyId
      const familyGeneration = privateFamilyCacheGeneration(userId, familyId)
      const key = JSON.stringify([userId, familyId, identityGeneration, familyGeneration, path])
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
          setLoaded({ userId, path, url: result.url, identityGeneration, familyId, familyGeneration })
        } else {
          setLoaded({ userId, path, url: null, identityGeneration, familyId, familyGeneration })
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
    if (hasLoadedReadyUrl(loadedRef.current, userId, path, identityGeneration) && lastRequest.current?.userId === userId && lastRequest.current.path === path && lastRequest.current.transport === transport) return
    lastRequest.current = { userId, path, transport }
    const controller = new AbortController()
    const familyId = eligiblePrivateImage(path)?.familyId
    const familyGeneration = familyId ? privateFamilyCacheGeneration(userId, familyId) : undefined
    let cachedWasShown = false
    const isCurrent = () => !controller.signal.aborted && isActivePrivateCacheIdentity(userId, identityGeneration) &&
      (!familyId || privateFamilyCacheGeneration(userId, familyId) === familyGeneration)
    const hasPriorReadyUrl = () => hasLoadedReadyUrl(loadedRef.current, userId, path)
    const showBlob = async (blob: Blob) => {
      const url = URL.createObjectURL(blob)
      ownedUrls.current.add(url)
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        if (!isCurrent()) {
          revokeOwnedUrl(ownedUrls.current, url)
          return false
        }
      } catch (error) {
        revokeOwnedUrl(ownedUrls.current, url)
        throw error
      }
      setLoaded({ userId, path, url, identityGeneration, ...(familyId ? { familyId, familyGeneration } : {}) })
      return true
    }
    void (async () => {
      const readyUrlAlreadyShown = hasLoadedReadyUrl(loadedRef.current, userId, path, identityGeneration)
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
      ownedUrls.current.add(candidateUrl)
      try {
        const image = new Image()
        image.src = candidateUrl
        await image.decode()
      } catch (error) {
        revokeOwnedUrl(ownedUrls.current, candidateUrl)
        throw error
      }
      if (!isCurrent()) {
        revokeOwnedUrl(ownedUrls.current, candidateUrl)
        return
      }
      const keepWarmUrl = readyUrlAlreadyShown || cachedWasShown || hasPriorReadyUrl()
      if (!keepWarmUrl) {
        setLoaded({ userId, path, url: candidateUrl, identityGeneration, ...(familyId ? { familyId, familyGeneration } : {}) })
      } else {
        // Keep a warm URL stable while refreshing the persistent Blob. The fullscreen viewer can
        // borrow this URL, so replacing it here could revoke a URL still used by that viewer.
        revokeOwnedUrl(ownedUrls.current, candidateUrl)
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
        setLoaded({ userId, path, url: null, identityGeneration, ...(familyId ? { familyId, familyGeneration } : {}) })
      }
    })
    return () => {
      controller.abort()
    }
  }, [enabled, identityGeneration, path, transport, userId])
  const loadedIsCurrent = loaded?.userId === userId && loaded.path === path && loaded.identityGeneration === identityGeneration &&
    (!loaded.familyId || privateFamilyCacheGeneration(userId, loaded.familyId) === loaded.familyGeneration)
  return loadedIsCurrent ? loaded.url : null
}

function hasLoadedReadyUrl(loaded: { userId: string; path: string; url: string | null; identityGeneration: number; familyId?: string; familyGeneration?: number } | null, userId: string, path: string, identityGeneration = privateCacheIdentityGeneration()) {
  return loaded?.userId === userId && loaded.path === path && loaded.identityGeneration === identityGeneration && Boolean(loaded.url) &&
    (!loaded.familyId || privateFamilyCacheGeneration(userId, loaded.familyId) === loaded.familyGeneration)
}

function revokeOwnedUrl(ownedUrls: Set<string>, url: string) {
  ownedUrls.delete(url)
  URL.revokeObjectURL(url)
}
