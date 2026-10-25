import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import { AvatarPhoto, MemberAvatarImage, type AvatarCrop, useMemberAvatarDirectory } from '@/features/avatar'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import { eligiblePrivateImage, privateCacheIdentityGeneration, privateFamilyCacheGeneration } from '@/platform/persistence/private-cache'
import type { AuthenticatedTransport } from '@/platform/api'

type AuthorAvatar = { id?: string | null; path: string | null | undefined }
type SharedAvatarContextValue = { scopeKey: string; familyId: string; urls: Map<string, string | null> }
const SharedAuthorAvatarContext = createContext<SharedAvatarContextValue | null>(null)

function uniqueEligibleAuthorAvatarPaths(authors: AuthorAvatar[], familyId: string, resolvePath: (author: AuthorAvatar) => string | null) {
  const unique = new Set<string>()
  for (const author of authors) {
    const path = resolvePath(author)
    if (!path || eligiblePrivateImage(path)?.familyId !== familyId) continue
    unique.add(path)
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
  const directory = useMemberAvatarDirectory()
  const resolvePath = useCallback((author: AuthorAvatar) => {
    if (!directory) return author.path ?? null
    if (!author.id) return null
    return directory.resolve(author.id)?.avatarPath ?? null
  }, [directory])
  const eligiblePaths = useMemo(() => uniqueEligibleAuthorAvatarPaths(authors, familyId, resolvePath), [authors, familyId, resolvePath])
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

export function FeedAuthorAvatar({ userId, avatarPath, avatarCrop, className, name, fallback }: {
  userId?: string | null
  avatarPath: string | null | undefined
  avatarCrop?: AvatarCrop | null
  className: string
  name: string
  fallback: ReactNode
}) {
  const avatarContext = useContext(SharedAuthorAvatarContext)
  const directory = useMemberAvatarDirectory()
  const directoryEntry = directory ? (userId ? directory.resolve(userId) : null) : undefined
  const resolvedPath = directoryEntry === undefined ? avatarPath : directoryEntry?.avatarPath ?? null
  const resolvedCrop = directoryEntry === undefined ? avatarCrop : directoryEntry?.avatarCrop ?? null
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (avatarContext === null) return <MemberAvatarImage userId={userId} avatarPath={avatarPath} avatarCrop={avatarCrop} className={className} name={name} fallback={fallback} />
  if (!resolvedPath || eligiblePrivateImage(resolvedPath)?.familyId !== avatarContext.familyId) return <>{fallback}</>
  const url = avatarContext.urls.get(`${avatarContext.scopeKey}:${resolvedPath}`)
  return url && failedUrl !== url
    ? <AvatarPhoto alt="" className={className} crop={resolvedCrop} onError={() => setFailedUrl(url)} src={url} />
    : <>{fallback}</>
}
