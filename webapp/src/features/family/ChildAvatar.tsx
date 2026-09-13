import { useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { AvatarLetter } from '@/features/session'
import { shouldShowChildAvatarImage } from './child-avatar-state'

type AvatarCrop = { x: number; y: number; width: number; height: number } | null
type ChildAvatarSize = 'family-card' | 'feed-header'

export function ChildAvatar({
  avatarCrop,
  avatarUrl,
  name,
  size,
}: {
  avatarCrop: AvatarCrop
  avatarUrl: string | null
  name: string
  size: ChildAvatarSize
}) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const sizeClass = size === 'feed-header' ? 'size-[60px]' : 'size-11'

  if (!shouldShowChildAvatarImage({ avatarUrl, imageFailed: failedAvatarUrl === avatarUrl })) {
    return <AvatarLetter className={sizeClass} name={name} size={size === 'feed-header' ? 'xl' : 'lg'} />
  }

  return (
    <Avatar className={sizeClass} data-slot="child-avatar" size="xl">
      <img
        alt={`Аватар ${name}`}
        className="size-full rounded-full object-cover"
        data-slot="child-avatar-image"
        onError={() => setFailedAvatarUrl(avatarUrl)}
        src={avatarUrl ?? undefined}
        style={avatarCrop ? {
          objectPosition: `${(avatarCrop.x + avatarCrop.width / 2) * 100}% ${(avatarCrop.y + avatarCrop.height / 2) * 100}%`,
          transform: `scale(${1 / Math.min(avatarCrop.width, avatarCrop.height)})`,
        } : undefined}
      />
    </Avatar>
  )
}
