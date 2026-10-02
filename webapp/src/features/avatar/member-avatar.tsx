import { useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth'
import { AvatarLetter } from '@/features/session'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'

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
  const url = usePrivateImageUrl(accountId, avatarPath, transport, Boolean(accountId))
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return url && failedUrl !== url ? <img alt="" aria-hidden="true" className={className} onError={() => setFailedUrl(url)} src={url} /> : fallback
}
