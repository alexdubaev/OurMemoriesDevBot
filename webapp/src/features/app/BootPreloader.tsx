import type { CSSProperties } from 'react'

import { Typography } from '@/components/typography'

export function BootPreloader({ style }: { style?: CSSProperties }) {
  return (
    <main className="mx-auto flex min-h-screen min-h-dvh max-w-[var(--layout-max-width)] flex-col bg-background px-7 py-10" data-slot="app-loading" style={style}>
      <div className="flex flex-1 flex-col items-center justify-center pb-[max(5rem,var(--host-inset-bottom))] text-center">
        <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-accent/20">
          <span className="size-5 animate-pulse rounded-full bg-accent" />
        </span>
        <Typography className="mt-6" variant="memoryHero">Наши воспоминания</Typography>
        <div aria-busy="true" aria-label="Подготавливаем приложение" className="mt-4 flex items-center gap-1.5" role="status">
          <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:-160ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:-80ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
        </div>
      </div>
    </main>
  )
}
