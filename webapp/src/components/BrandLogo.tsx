import type { ImgHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const source = '/assets/brand/memoly-logo.webp'
const width = 1154
const height = 325

export function BrandLogo({ className, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'height' | 'src' | 'width'>) {
  return (
    <img
      {...props}
      alt="memoLy"
      className={cn('block h-auto', className)}
      data-slot="app-brand"
      decoding="async"
      draggable={false}
      height={height}
      src={source}
      width={width}
    />
  )
}
