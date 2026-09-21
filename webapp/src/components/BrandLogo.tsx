import type { ImgHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const source = '/assets/brand/memoly-logo-correct.webp'
const width = 1200
const height = 400

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
