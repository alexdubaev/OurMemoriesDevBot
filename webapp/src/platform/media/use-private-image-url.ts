import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { cachePrivateImageResponse, eligiblePrivateImage, privateFamilyCacheGeneration, privateCacheIdentityGeneration, isActivePrivateCacheIdentity, readPrivateImage, removePrivateImage, clearPrivateUserCache, privateFamilyAccessRevokedEvent } from '@/platform/persistence/private-cache'

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
      if (eligiblePrivateImage(path)) await cachePrivateImageResponse(userId, path, response, identityGeneration, familyGeneration).catch(() => false)
      if (!isCurrent()) {
        revokeOwnedUrl(ownedUrls.current, candidateUrl)
        return
      }
      if (readyUrlAlreadyShown || cachedWasShown || hasPriorReadyUrl()) {
        // Keep a warm URL stable while refreshing the persistent Blob. The fullscreen viewer can
        // borrow this URL, so replacing it here could revoke a URL still used by that viewer.
        revokeOwnedUrl(ownedUrls.current, candidateUrl)
      } else {
        setLoaded({ userId, path, url: candidateUrl, identityGeneration, ...(familyId ? { familyId, familyGeneration } : {}) })
      }
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
