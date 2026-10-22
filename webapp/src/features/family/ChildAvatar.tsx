import { useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { AvatarLetter } from '@/features/session'
import { shouldShowChildAvatarImage } from './child-avatar-state'
import { avatarCropStyle } from '@/features/avatar'

type AvatarCrop = { x: number; y: number; width: number; height: number } | null
type ChildAvatarSize = 'family-card' | 'feed-header' | 'profile'

export function ChildAvatar({
  avatarCrop,
  avatarUrl,
  status,
  name,
  size,
}: {
  avatarCrop: AvatarCrop
  avatarUrl: string | null
  status?: 'absent' | 'loading' | 'ready' | 'error'
  name: string
  size: ChildAvatarSize
}) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const sizeClass = size === 'profile' ? 'child-avatar child-profile-avatar' : size === 'feed-header' ? 'size-[60px]' : 'size-11'
  const resolvedStatus = status ?? (avatarUrl ? 'ready' : 'absent')

  if (resolvedStatus === 'loading') {
    return <span aria-label="Загружается фотография ребёнка" className={`${sizeClass} inline-block rounded-full border border-[var(--ui-v2-color-line)] bg-[var(--ui-v2-color-line)]`} data-avatar-state="loading" data-slot="child-avatar-loading" role="img" />
  }

  if (resolvedStatus === 'error' || (resolvedStatus === 'ready' && !shouldShowChildAvatarImage({ avatarUrl, imageFailed: failedAvatarUrl === avatarUrl }))) {
    return <span aria-label="Не удалось загрузить фотографию ребёнка" data-avatar-state="error" role="img" style={{ display: 'contents' }} title="Не удалось загрузить фотографию ребёнка"><AvatarLetter className={sizeClass} name={name} size={size === 'family-card' ? 'lg' : 'xl'} /></span>
  }

  if (resolvedStatus !== 'ready') {
    return <AvatarLetter className={sizeClass} name={name} size={size === 'family-card' ? 'lg' : 'xl'} />
  }

  return (
    <Avatar className={`${sizeClass} relative overflow-hidden`} data-slot="child-avatar" size="xl">
      <img
        alt={`Аватар ${name}`}
        className="size-full rounded-full object-cover"
        data-slot="child-avatar-image"
        onError={() => setFailedAvatarUrl(avatarUrl)}
        src={avatarUrl ?? undefined}
        style={avatarCropStyle(avatarCrop)}
      />
    </Avatar>
  )
}
