import { useEffect, useRef, useState } from 'react'

import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { cachePrivateImageResponse, eligiblePrivateImage, privateFamilyCacheGeneration, privateCacheIdentityGeneration, isActivePrivateCacheIdentity, readPrivateImage, removePrivateImage, clearPrivateUserCache, privateFamilyAccessRevokedEvent } from '@/platform/persistence/private-cache'

export function usePrivateImageUrl(userId: string, path: string | null, transport: AuthenticatedTransport | undefined, enabled = true, onSettled?: () => void) {
  const [loaded, setLoaded] = useState<{ userId: string; path: string; url: string | null; familyId?: string; familyGeneration?: number } | null>(null)
  const onSettledRef = useRef(onSettled)
  useEffect(() => { onSettledRef.current = onSettled }, [onSettled])
  useEffect(() => {
    if (!userId || !path || !enabled || !transport) return
    const controller = new AbortController()
    const urls: string[] = []
    const identityGeneration = privateCacheIdentityGeneration()
    const familyId = eligiblePrivateImage(path)?.familyId
    const familyGeneration = familyId ? privateFamilyCacheGeneration(userId, familyId) : undefined
    let cachedWasShown = false
    const isCurrent = () => !controller.signal.aborted && isActivePrivateCacheIdentity(userId, identityGeneration) &&
      (!familyId || privateFamilyCacheGeneration(userId, familyId) === familyGeneration)
    const showBlob = (blob: Blob) => {
      const url = URL.createObjectURL(blob)
      urls.push(url)
      setLoaded({ userId, path, url, ...(familyId ? { familyId, familyGeneration } : {}) })
    }
    void (async () => {
      if (eligiblePrivateImage(path)) {
        const cached = await readPrivateImage(userId, path).catch(() => null)
        if (isCurrent() && cached) {
          cachedWasShown = true
          showBlob(cached)
        }
      }
      if (!isCurrent()) return
      const response = await transport.raw(path, { signal: controller.signal, headers: { 'X-Private-Media-Purpose': 'image' } })
      const blob = await response.clone().blob()
      if (!isCurrent()) return
      if (eligiblePrivateImage(path)) await cachePrivateImageResponse(userId, path, response, identityGeneration, familyGeneration).catch(() => false)
      if (!isCurrent()) return
      showBlob(blob)
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
      if (!cachedWasShown || error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
        urls.forEach((url) => URL.revokeObjectURL(url))
        setLoaded({ userId, path, url: null, ...(familyId ? { familyId, familyGeneration } : {}) })
      }
    })
    return () => {
      controller.abort()
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [enabled, path, transport, userId])
  const loadedIsCurrent = loaded?.userId === userId && loaded.path === path &&
    (!loaded.familyId || privateFamilyCacheGeneration(userId, loaded.familyId) === loaded.familyGeneration)
  return enabled && loadedIsCurrent ? loaded.url : null
}
