import { useContext, type CSSProperties, type ImgHTMLAttributes } from 'react'

import { UiVersionContext } from '@/features/ui-version'

import { resolveAstryxIconMask } from './astryx-icon-manifest'
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
  monochrome?: boolean
  name: WebpIconName
  size?: number
  state?: WebpIconState
}

export function WebpIcon({
  decorative = false,
  label,
  monochrome = false,
  name,
  size = 24,
  state = 'default',
  style,
  ...props
}: WebpIconProps) {
  const uiVersion = useContext(UiVersionContext)
  const iconStyle = { '--webp-icon-size': `${size}px`, ...style } as CSSProperties

  if (uiVersion === 'v2') {
    const { maskImage, maskPosition, maskSize } = resolveAstryxIconMask(name)
    return <span
      {...props}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      data-slot="webp-icon"
      data-astryx-icon={name}
      role={decorative ? undefined : 'img'}
      style={{
        ...iconStyle,
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        backgroundColor: state === 'white' ? '#fff' : 'currentColor',
        maskImage,
        maskPosition,
        maskRepeat: 'no-repeat',
        maskSize,
        WebkitMaskImage: maskImage,
        WebkitMaskPosition: maskPosition,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: maskSize,
      }}
    />
  }

  const source2x = resolveWebpIconSource(name, state, 2)
  const source3x = resolveWebpIconSource(name, state, 3)
  const maskImage = `image-set(url("${source2x.src}") 2x, url("${source3x.src}") 3x)`

  if (monochrome) {
    return <span
      {...props}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      data-slot="webp-icon"
      role={decorative ? undefined : 'img'}
      style={{
        ...iconStyle,
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        maskImage,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskImage: `-webkit-${maskImage}`,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
      }}
    />
  }

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
