import { useState, type ReactNode } from 'react'

import { useAuth } from '@/features/auth'
import { AvatarLetter } from '@/features/session'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import type { AvatarCrop } from './avatar-crop'
import { AvatarPhoto } from './AvatarPhoto'
import { useMemberAvatarDirectoryEntry } from './member-avatar-directory-context'

export function MemberAvatarImage({ userId, avatarPath, avatarCrop, className, name, size = 'lg', fallback }: {
  userId?: string | null
  avatarPath: string | null | undefined
  avatarCrop?: AvatarCrop | null
  className: string
  name: string
  size?: 'default' | 'sm' | 'lg' | 'xl'
  fallback?: ReactNode
}) {
  const directoryEntry = useMemberAvatarDirectoryEntry(userId)
  const resolvedPath = directoryEntry === undefined ? avatarPath : directoryEntry?.avatarPath ?? null
  const resolvedCrop = directoryEntry === undefined ? avatarCrop : directoryEntry?.avatarCrop ?? null
  const initials = fallback ?? <AvatarLetter className={className} name={name} size={size} />
  if (!resolvedPath) return initials
  return <ProtectedMemberImage avatarPath={resolvedPath} avatarCrop={resolvedCrop} className={className} fallback={initials} />
}

function ProtectedMemberImage({ avatarPath, avatarCrop, className, fallback }: { avatarPath: string; avatarCrop?: AvatarCrop | null; className: string; fallback: ReactNode }) {
  const { transport, user } = useAuth()
  const accountId = user?.id ?? ''
  const url = usePrivateImageUrl(accountId, avatarPath, transport, Boolean(accountId))
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return url && failedUrl !== url ? <AvatarPhoto alt="" className={className} crop={avatarCrop} onError={() => setFailedUrl(url)} src={url} /> : fallback
}
