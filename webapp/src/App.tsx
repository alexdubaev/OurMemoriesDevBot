import type { CSSProperties } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { FeedSkeleton } from '@/features/feed'
import type { HostBridge } from '@/platform/telegram'

export type AppProps = {
  hostBridge: HostBridge
}

export default function App({ hostBridge }: AppProps) {
  if (!hostBridge.isAvailable) {
    return (
      <main className="mx-auto flex min-h-screen min-h-dvh max-w-[var(--layout-max-width)] flex-col px-7 py-10">
        <Typography variant="memoryHero">Наши воспоминания</Typography>
        <div className="flex flex-1 flex-col items-center justify-center pb-20 text-center">
          <span className="flex size-18 items-center justify-center rounded-full bg-accent">
            <WebpIcon decorative name="info" size={32} state="active" />
          </span>
          <Typography className="mt-7 max-w-80" variant="memoryDialog">
            Откройте приложение в Telegram
          </Typography>
          <Typography className="mt-4 max-w-84" tone="muted" variant="memoryBody">
            В этой тестовой версии вход работает через нашего бота.
          </Typography>
          <Button
            aria-label="Открыть бота"
            asChild
            className="mt-7 min-h-[var(--layout-primary-height)] w-full rounded-[var(--radius-field)]"
          >
            <a href="https://t.me/OurMemoriesDevBot">
              <Typography variant="memoryButton">Открыть бота</Typography>
            </a>
          </Button>
        </div>
      </main>
    )
  }

  const insets = hostBridge.getInsets()
  const style = {
    '--host-inset-bottom': `${insets.bottom}px`,
    '--host-inset-left': `${insets.left}px`,
    '--host-inset-right': `${insets.right}px`,
    '--host-inset-top': `${insets.top}px`,
  } as CSSProperties

  return (
    <main
      className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-[calc(var(--layout-gutter)+var(--host-inset-left))] pt-[calc(var(--layout-gutter)+var(--host-inset-top))] pr-[calc(var(--layout-gutter)+var(--host-inset-right))] pb-[calc(var(--layout-gutter)+var(--host-inset-bottom))]"
      data-slot="app-loading"
      style={style}
    >
      <Typography className="mb-6 py-2" variant="memoryScreen">Наши воспоминания</Typography>
      <FeedSkeleton />
    </main>
  )
}
