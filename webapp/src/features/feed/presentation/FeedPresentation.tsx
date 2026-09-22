import type { CSSProperties } from 'react'
import type { ReactNode, Ref } from 'react'

import { BottomNavigation } from '@/components/BottomNavigation'
import { Typography } from '@/components/typography'
import { WebpIcon, type WebpIconName } from '@/components/WebpIcon'
import { ChildHeader } from '@/components/ChildHeader'
import { useMemolyTheme } from '@/features/theme'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'

import './memoly-feed.css'

export type FeedFilter = 'all' | 'photo' | 'video' | 'voice' | 'note'

const filters: ReadonlyArray<{ icon?: WebpIconName; label: string; value: FeedFilter }> = [
  { label: 'Все', value: 'all' },
  { icon: 'photo', label: 'Фото', value: 'photo' },
  { icon: 'video', label: 'Видео', value: 'video' },
  { icon: 'voice', label: 'Голос', value: 'voice' },
  { icon: 'note', label: 'Заметки', value: 'note' },
]

export type FeedPresentationProps = {
  activeFilter: FeedFilter
  addButtonRef?: Ref<HTMLButtonElement>
  childAvatarCrop?: { x: number; y: number; width: number; height: number } | null
  childName: string
  childSubtitle: string
  childAvatarUrl?: string | null
  children: ReactNode
  insets: TelegramInsets
  onAdd?: () => void
  onFamily: () => void
  onFeed: () => void
  onFilterChange: (filter: FeedFilter) => void
  onMore?: () => void
  role: 'full' | 'viewer'
}

export function FeedPresentation(props: FeedPresentationProps) {
  const { children } = props
  const { theme } = useMemolyTheme()
  const style = {
    '--host-inset-top': `${props.insets.top}px`,
    '--host-inset-right': `${props.insets.right}px`,
    '--host-inset-bottom': `${props.insets.bottom}px`,
    '--host-inset-left': `${props.insets.left}px`,
  } as CSSProperties

  return (
    <div data-memoly-feed="true" style={style}>
      <main className="app" data-slot="feed-scroll">
        <ChildHeader childAvatarCrop={props.childAvatarCrop ?? null} childAvatarUrl={props.childAvatarUrl ?? null} childName={props.childName} childSubtitle={props.childSubtitle} mode="feed" theme={theme} />
        <div aria-label="Фильтры ленты" className="filters-wrap surface-inset" data-slot="memoly-filter-rail" role="group">
          <div className="filters">
            {filters.map((item) => <button aria-pressed={item.value === props.activeFilter} className={`filter${item.value === props.activeFilter ? ' active' : ''}`} data-filter={item.value} key={item.value} onClick={() => props.onFilterChange(item.value)} type="button">{item.icon ? <WebpIcon decorative name={item.icon} size={18} /> : null}<Typography as="span" variant="memoryFilter">{item.label}</Typography></button>)}
          </div>
        </div>
        <div className="feed-content">{children}</div>
      </main>
      <BottomNavigation appearance="memoly" active="feed" addButtonRef={props.addButtonRef} onAdd={props.onAdd} onFamily={props.onFamily} onFeed={props.onFeed} role={props.role} />
    </div>
  )
}
