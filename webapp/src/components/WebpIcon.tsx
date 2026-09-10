import type { CSSProperties, ImgHTMLAttributes } from 'react'

import type { WebpIconName } from './webp-icon-types'

export type { WebpIconName } from './webp-icon-types'
export type WebpIconState = 'active' | 'default'

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
  const path = `/assets/icons/${name}-${state}`
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
      src={`${path}@2x.webp`}
      srcSet={`${path}@2x.webp 2x, ${path}@3x.webp 3x`}
      style={iconStyle}
      width={size}
    />
  )
}
