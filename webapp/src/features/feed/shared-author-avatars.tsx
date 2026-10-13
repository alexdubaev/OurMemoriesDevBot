import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import { MemberAvatarImage } from '@/features/avatar'
import { AvatarPhoto } from '@/features/avatar/AvatarPhoto'
import type { AvatarCrop } from '@/features/avatar/avatar-crop'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import { eligiblePrivateImage, privateCacheIdentityGeneration, privateFamilyCacheGeneration } from '@/platform/persistence/private-cache'
import type { AuthenticatedTransport } from '@/platform/api'

type AuthorAvatar = { path: string | null | undefined }
type SharedAvatarContextValue = { scopeKey: string; familyId: string; urls: Map<string, string | null> }
const SharedAuthorAvatarContext = createContext<SharedAvatarContextValue | null>(null)

function uniqueEligibleAuthorAvatarPaths(authors: AuthorAvatar[], familyId: string) {
  const unique = new Set<string>()
  for (const author of authors) {
    if (!author.path || eligiblePrivateImage(author.path)?.familyId !== familyId) continue
    unique.add(author.path)
  }
  return [...unique]
}

function sharedAuthorAvatarScopeKey(userId: string, familyId: string, membershipEpoch: number, identityGeneration: number, familyGeneration: number) {
  return `${userId}:${familyId}:${membershipEpoch}:${identityGeneration}:${familyGeneration}`
}

export function FeedSharedAuthorAvatars({ children, authors, userId, familyId, membershipEpoch, transport, enabled }: {
  children: ReactNode
  authors: AuthorAvatar[]
  userId: string
  familyId: string
  membershipEpoch: number
  transport: AuthenticatedTransport
  enabled: boolean
}) {
  const identityGeneration = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(userId, familyId)
  const scopeKey = sharedAuthorAvatarScopeKey(userId, familyId, membershipEpoch, identityGeneration, familyGeneration)
  const eligiblePaths = useMemo(() => uniqueEligibleAuthorAvatarPaths(authors, familyId), [authors, familyId])
  const [urls, setUrls] = useState<Map<string, string | null>>(() => new Map())
  const setUrl = useCallback((key: string, url: string | null) => {
    setUrls((current) => {
      if (url === null) {
        if (!current.has(key)) return current
        const next = new Map(current)
        next.delete(key)
        return next
      }
      if (current.get(key) === url) return current
      return new Map(current).set(key, url)
    })
  }, [])

  return <SharedAuthorAvatarContext.Provider value={{ scopeKey, familyId, urls }}>
    {enabled ? eligiblePaths.map((path) => {
      const mapKey = `${scopeKey}:${path}`
      return <SharedAuthorAvatarLoader key={mapKey} mapKey={mapKey} path={path} transport={transport} userId={userId} onChange={setUrl} />
    }) : null}
    {children}
  </SharedAuthorAvatarContext.Provider>
}

function SharedAuthorAvatarLoader({ mapKey, path, transport, userId, onChange }: {
  mapKey: string
  path: string
  transport: AuthenticatedTransport
  userId: string
  onChange: (key: string, url: string | null) => void
}) {
  const url = usePrivateImageUrl(userId, path, transport)
  useLayoutEffect(() => {
    onChange(mapKey, url)
    return () => onChange(mapKey, null)
  }, [mapKey, onChange, url])
  return null
}

export function FeedAuthorAvatar({ avatarPath, avatarCrop, className, name, fallback }: {
  avatarPath: string | null | undefined
  avatarCrop?: AvatarCrop | null
  className: string
  name: string
  fallback: ReactNode
}) {
  const avatarContext = useContext(SharedAuthorAvatarContext)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (avatarContext === null) return <MemberAvatarImage avatarPath={avatarPath} avatarCrop={avatarCrop} className={className} name={name} fallback={fallback} />
  if (!avatarPath || eligiblePrivateImage(avatarPath)?.familyId !== avatarContext.familyId) return <>{fallback}</>
  const url = avatarContext.urls.get(`${avatarContext.scopeKey}:${avatarPath}`)
  return url && failedUrl !== url
    ? <AvatarPhoto alt="" className={className} crop={avatarCrop} onError={() => setFailedUrl(url)} src={url} />
    : <>{fallback}</>
}
