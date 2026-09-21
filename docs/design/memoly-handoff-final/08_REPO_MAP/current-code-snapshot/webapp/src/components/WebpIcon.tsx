import type { CSSProperties, ImgHTMLAttributes } from 'react'

import { resolveWebpIconSource } from './webp-icon-manifest'
import type { WebpIconName, WebpIconState } from './webp-icon-types'

export type { WebpIconName, WebpIconState } from './webp-icon-types'

type IconAccessibility =
  | { decorative: true; label?: never }
  | { decorative?: false; label: string }

export type WebpIconProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'alt' | 'height' | 'src' | 'srcSet' | 'width'
> & IconAccessibility & {
  name: WebpIconName
  size?: number
  state?: WebpIconState
}

export function WebpIcon({
  decorative = false,
  label,
  name,
  size = 24,
  state = 'default',
  style,
  ...props
}: WebpIconProps) {
  const source2x = resolveWebpIconSource(name, state, 2)
  const source3x = resolveWebpIconSource(name, state, 3)
  const iconStyle = { '--webp-icon-size': `${size}px`, ...style } as CSSProperties

  return (
    <img
      {...props}
      alt={decorative ? '' : label}
      aria-hidden={decorative ? true : undefined}
      data-slot="webp-icon"
      decoding="async"
      draggable={false}
      height={size}
      src={source2x.src}
      srcSet={`${source2x.src} 2x, ${source3x.src} 3x`}
      style={iconStyle}
      width={size}
    />
  )
}
