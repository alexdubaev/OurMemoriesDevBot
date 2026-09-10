import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function MemoryCardFrame({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cn(
        'overflow-hidden rounded-[var(--radius-card)] bg-card text-card-foreground shadow-[var(--shadow-card)]',
        className,
      )}
      data-slot="memory-card-frame"
      {...props}
    />
  )
}
