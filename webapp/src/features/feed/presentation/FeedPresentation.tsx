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
  familyName?: string
  childAvatarUrl?: string | null
  children: ReactNode
  insets: TelegramInsets
  onAdd?: () => void
  onFamily: () => void
  onAllFamilies?: () => void
  onFeed: () => void
  onFilterChange: (filter: FeedFilter) => void
  onMore?: () => void
  role: 'full' | 'viewer'
  unreadCount?: number | null
  unreadState?: 'ready' | 'unavailable' | 'not_enabled'
  unreadOnly?: boolean
  onUnreadChange?: (unreadOnly: boolean) => void
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
        <Typography as="h1" className="sr-only" variant="memoryChild">Лента воспоминаний</Typography>
        {props.onAllFamilies ? <div className="family-context"><button className="family-context-back" onClick={props.onAllFamilies} type="button"><Typography as="span" variant="memoryMeta">‹ Все семьи</Typography></button><Typography as="span" className="family-context-title" title={props.familyName} variant="memoryMeta">{props.familyName}</Typography></div> : null}
        <ChildHeader childAvatarCrop={props.childAvatarCrop ?? null} childAvatarUrl={props.childAvatarUrl ?? null} childName={props.childName} childSubtitle={props.childSubtitle} mode="feed" theme={theme} />
        <div aria-label="Фильтры ленты" className="filters-wrap surface-inset" data-slot="memoly-filter-rail" role="group">
          <div className="filters">
            {filters.map((item) => <button aria-pressed={item.value === props.activeFilter} className={`filter ds-chip${item.value === props.activeFilter ? ' active' : ''}`} data-filter={item.value} key={item.value} onClick={() => props.onFilterChange(item.value)} type="button">{item.icon ? <WebpIcon decorative name={item.icon} size={18} /> : null}<Typography as="span" variant="memoryFilter">{item.label}</Typography></button>)}
          </div>
        </div>
        {(props.unreadOnly || props.unreadState === 'ready') && props.onUnreadChange ? (
          <div className="feed-unread-control" role="group" aria-label="Режим ленты">
            <button aria-pressed={!props.unreadOnly} className={!props.unreadOnly ? 'active' : ''} onClick={() => props.onUnreadChange?.(false)} type="button"><Typography as="span" variant="memoryFilter">Все воспоминания</Typography></button>
            <button aria-pressed={Boolean(props.unreadOnly)} className={props.unreadOnly ? 'active' : ''} onClick={() => props.onUnreadChange?.(true)} type="button"><Typography as="span" variant="memoryFilter">Непросмотренные{props.unreadState === 'ready' && props.unreadCount !== null && props.unreadCount !== undefined ? ` · ${props.unreadCount}` : ''}</Typography></button>
          </div>
        ) : null}
        <div className="feed-content">{children}</div>
      </main>
      <BottomNavigation appearance="memoly" active="feed" addButtonRef={props.addButtonRef} onAdd={props.onAdd} onFamily={props.onFamily} onFeed={props.onFeed} role={props.role} />
    </div>
  )
}
