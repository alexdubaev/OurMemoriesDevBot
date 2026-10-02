import { useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth'
import { AvatarLetter } from '@/features/session'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import type { AvatarCrop } from './avatar-crop'
import { AvatarPhoto } from './AvatarPhoto'

export function MemberAvatarImage({ avatarPath, avatarCrop, className, name, size = 'lg', fallback }: {
  avatarPath: string | null | undefined
  avatarCrop?: AvatarCrop | null
  className: string
  name: string
  size?: 'default' | 'sm' | 'lg' | 'xl'
  fallback?: ReactNode
}) {
  const initials = fallback ?? <AvatarLetter className={className} name={name} size={size} />
  if (!avatarPath) return initials
  return <ProtectedMemberImage avatarPath={avatarPath} avatarCrop={avatarCrop} className={className} fallback={initials} />
}

function ProtectedMemberImage({ avatarPath, avatarCrop, className, fallback }: { avatarPath: string; avatarCrop?: AvatarCrop | null; className: string; fallback: ReactNode }) {
  const { transport, user } = useAuth()
  const accountId = user?.id ?? ''
  const url = usePrivateImageUrl(accountId, avatarPath, transport, Boolean(accountId))
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return url && failedUrl !== url ? <AvatarPhoto alt="" className={className} crop={avatarCrop} onError={() => setFailedUrl(url)} src={url} /> : fallback
}
