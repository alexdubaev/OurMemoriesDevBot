import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth'
import { AvatarLetter } from '@/features/session'
import { memberAvatarQueryOptions } from './member-avatar-query'

export function MemberAvatarImage({ avatarPath, className, name, size = 'lg', fallback }: {
  avatarPath: string | null | undefined
  className: string
  name: string
  size?: 'default' | 'sm' | 'lg' | 'xl'
  fallback?: ReactNode
}) {
  const initials = fallback ?? <AvatarLetter className={className} name={name} size={size} />
  if (!avatarPath) return initials
  return <ProtectedMemberImage avatarPath={avatarPath} className={className} fallback={initials} />
}

function ProtectedMemberImage({ avatarPath, className, fallback }: { avatarPath: string; className: string; fallback: ReactNode }) {
  const { transport, user } = useAuth()
  const accountId = user?.id ?? ''
  const query = useQuery({ ...memberAvatarQueryOptions(transport, accountId, avatarPath), enabled: Boolean(accountId) })
  const blob = query.data
  const [loaded, setLoaded] = useState<{ accountId: string; avatarPath: string; blob: Blob; url: string } | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob || !accountId) return
    const url = URL.createObjectURL(blob)
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setLoaded({ accountId, avatarPath, blob, url }) })
    return () => { cancelled = true; URL.revokeObjectURL(url) }
  }, [accountId, avatarPath, blob])

  const url = loaded?.accountId === accountId && loaded.avatarPath === avatarPath && loaded.blob === blob && failedUrl !== loaded.url
    ? loaded.url : null
  return url ? <img alt="" aria-hidden="true" className={className} onError={() => setFailedUrl(url)} src={url} /> : fallback
}
