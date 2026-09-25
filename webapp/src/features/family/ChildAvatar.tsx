import { useState } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { AvatarLetter } from '@/features/session'
import { reportPrivateMediaDiagnostic } from '@/platform/media/private-media-diagnostics'
import { shouldShowChildAvatarImage } from './child-avatar-state'

type AvatarCrop = { x: number; y: number; width: number; height: number } | null
type ChildAvatarSize = 'family-card' | 'feed-header' | 'profile'

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
  const sizeClass = size === 'profile' ? 'child-avatar child-profile-avatar' : size === 'feed-header' ? 'size-[60px]' : 'size-11'

  if (!shouldShowChildAvatarImage({ avatarUrl, imageFailed: failedAvatarUrl === avatarUrl })) {
    return <AvatarLetter className={sizeClass} name={name} size={size === 'family-card' ? 'lg' : 'xl'} />
  }

  return (
    <Avatar className={sizeClass} data-slot="child-avatar" size="xl">
      <img
        alt={`Аватар ${name}`}
        className="size-full rounded-full object-cover"
        data-slot="child-avatar-image"
        onLoad={(event) => {
          const image = event.currentTarget
          const rect = image.getBoundingClientRect()
          const style = getComputedStyle(image)
          reportPrivateMediaDiagnostic('avatar-image-loaded', {
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            renderedWidth: Math.round(rect.width),
            renderedHeight: Math.round(rect.height),
            visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
          })
        }}
        onError={() => {
          reportPrivateMediaDiagnostic('avatar-image-error')
          setFailedAvatarUrl(avatarUrl)
        }}
        src={avatarUrl ?? undefined}
        style={avatarCrop ? {
          objectPosition: `${(avatarCrop.x + avatarCrop.width / 2) * 100}% ${(avatarCrop.y + avatarCrop.height / 2) * 100}%`,
          transform: `scale(${1 / Math.min(avatarCrop.width, avatarCrop.height)})`,
        } : undefined}
      />
    </Avatar>
  )
}
