import type { ReactNode } from 'react'

import { Typography } from '@/components/typography'

export function DateHeading({ children }: { children: ReactNode }) {
  return (
    <Typography data-slot="date-heading" variant="memoryDate">
      {children}
    </Typography>
  )
}
