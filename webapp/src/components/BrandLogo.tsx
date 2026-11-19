import type { HTMLAttributes } from 'react'

import { Typography } from '@/components/typography'
import { cn } from '@/lib/utils'

export function BrandLogo({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <Typography {...props} as="span" className={cn('memoly-wordmark', className)} data-slot="app-brand" variant="memoryScreen">memoLy</Typography>
}
