import type { ReactNode } from 'react'
import { avatarCropStyle } from './avatar-crop'
import type { AvatarCrop } from './avatar-crop'

export function AvatarPhoto({ src, crop, className, alt = '', fallback, onError }: {
  src: string | null | undefined
  crop?: AvatarCrop | null
  className: string
  alt?: string
  fallback?: ReactNode
  onError?: () => void
}) {
  if (!src) return fallback ?? null
  return <span className={className} style={{ display: 'block', overflow: 'hidden', position: 'relative' }}><img alt={alt} className="size-full object-cover" onError={onError} src={src} style={avatarCropStyle(crop)} /></span>
}
