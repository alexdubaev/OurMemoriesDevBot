import type { CSSProperties, ReactNode, Ref } from 'react'

import { BottomNavigation } from '@/components/BottomNavigation'
import { BrandLogo } from '@/components/BrandLogo'
import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import { ChildAvatar } from '@/features/family'
import { cn } from '@/lib/utils'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'
import type { FeedFilter } from '../presentation'

const filters: ReadonlyArray<{ label: string; value: FeedFilter }> = [
  { label: 'Все', value: 'all' },
  { label: 'Фото', value: 'photo' },
  { label: 'Видео', value: 'video' },
  { label: 'Голос', value: 'voice' },
  { label: 'Заметки', value: 'note' },
]

export type FeedShellProps = {
  activeFilter: FeedFilter
  addButtonRef?: Ref<HTMLButtonElement>
  childName: string
  childSubtitle: string
  childAvatarCrop?: { x: number; y: number; width: number; height: number } | null
  childAvatarUrl?: string | null
  children: ReactNode
  insets: TelegramInsets
  onAdd?: () => void
  onFamily?: () => void
  onFeed?: () => void
  onFilterChange: (filter: FeedFilter) => void
  onMore?: () => void
  role: 'full' | 'viewer'
}

export function FeedShell({
  activeFilter,
  addButtonRef,
  childName,
  childSubtitle,
  childAvatarCrop = null,
  childAvatarUrl = null,
  children,
  insets,
  onAdd,
  onFamily = noop,
  onFeed = noop,
  onFilterChange,
  onMore = noop,
  role,
}: FeedShellProps) {
  const insetsStyle = {
    '--host-inset-bottom': `${insets.bottom}px`,
    '--host-inset-left': `${insets.left}px`,
    '--host-inset-right': `${insets.right}px`,
    '--host-inset-top': `${insets.top}px`,
  } as CSSProperties

  return (
    <div className="min-h-screen min-h-dvh bg-background" data-slot="feed-shell" style={insetsStyle}>
      <main
        className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-[calc(var(--layout-gutter)+var(--host-inset-left))] pt-[calc(var(--layout-gutter)+var(--host-inset-top))] pr-[calc(var(--layout-gutter)+var(--host-inset-right))] pb-[calc(var(--layout-bottom-nav)+var(--host-inset-bottom)+var(--layout-gutter))]"
        data-slot="feed-scroll"
      >
        <header>
          <div className="flex min-h-11 min-w-0 items-center justify-between gap-2">
            <BrandLogo className="min-w-0 w-[148px]" />
            <button
              aria-label="Помощь и конфиденциальность"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground"
              onClick={onMore}
              type="button"
            >
              <WebpIcon decorative name="more" size={24} />
            </button>
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-3.5" data-slot="child-profile">
            <ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} name={childName} size="feed-header" />
            <div className="min-w-0 flex-1 self-center">
              <Typography
                className="line-clamp-2 break-words"
                data-slot="child-name"
                variant="memoryChild"
              >
                {childName}
              </Typography>
              <Typography tone="muted" variant="memoryMeta">{childSubtitle}</Typography>
            </div>
          </div>
          <div
            aria-label="Фильтр воспоминаний"
            className="-mx-1 mt-4 flex min-h-11 gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="group"
          >
            {filters.map((filter) => {
              const selected = filter.value === activeFilter
              return (
                <button
                  aria-pressed={selected}
                  className={cn(
                    'flex min-h-11 shrink-0 items-center rounded-[var(--radius-pill)] px-3 transition-colors duration-[var(--duration-standard)]',
                    selected
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-card text-muted-foreground',
                  )}
                  key={filter.value}
                  onClick={() => onFilterChange(filter.value)}
                  type="button"
                >
                  <Typography variant="memoryFilter">{filter.label}</Typography>
                </button>
              )
            })}
          </div>
        </header>
        <div className="mt-5 flex flex-col gap-3">{children}</div>
      </main>
      <BottomNavigation
        active="feed"
        addButtonRef={addButtonRef}
        onAdd={onAdd}
        onFamily={onFamily}
        onFeed={onFeed}
        role={role}
      />
    </div>
  )
}

function noop() {}
