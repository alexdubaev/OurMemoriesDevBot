import type { CSSProperties } from 'react'
import type { ReactNode, Ref } from 'react'

import { BottomNavigation } from '@/components/BottomNavigation'
import { Typography } from '@/components/typography'
import { ChildHeader } from '@/components/ChildHeader'
import { useMemolyTheme } from '@/features/theme'
import type { TelegramInsets } from '@/platform/telegram/host-bridge'

import './memoly-feed.css'

export type FeedFilter = 'all' | 'photo' | 'video' | 'voice' | 'note'

function unreadCountAnnouncement(count: number) {
  const remainder10 = count % 10
  const remainder100 = count % 100
  const noun = remainder10 === 1 && remainder100 !== 11
    ? 'непросмотренное воспоминание'
    : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
      ? 'непросмотренных воспоминания'
      : 'непросмотренных воспоминаний'
  return `Показать ${count} ${noun}`
}

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
        <ChildHeader childAvatarCrop={props.childAvatarCrop ?? null} childAvatarUrl={props.childAvatarUrl ?? null} childName={props.childName} childSubtitle={props.childSubtitle} mode="feed" onAllFamilies={props.onAllFamilies} theme={theme} />
        <div className="feed-rest">
        {props.unreadState !== 'not_enabled' && props.onUnreadChange && props.unreadOnly ? (
          <div className="feed-unread-mode">
            <Typography as="span" className="feed-unread-label" variant="memoryMeta">{props.unreadState === 'ready' && props.unreadCount !== null && props.unreadCount !== undefined ? `Непросмотренные · ${props.unreadCount}` : 'Непросмотренные'}</Typography>
            <button aria-label="Выйти из режима непросмотренных" onClick={() => props.onUnreadChange?.(false)} type="button"><Typography as="span" className="feed-unread-label" variant="memoryMeta">×</Typography></button>
          </div>
        ) : props.unreadState === 'ready' && (props.unreadCount ?? 0) > 0 && props.onUnreadChange ? (
          <button aria-label={unreadCountAnnouncement(props.unreadCount!)} className="feed-unread-action" onClick={() => props.onUnreadChange?.(true)} type="button"><Typography as="span" className="feed-unread-label" variant="memoryFilter">{props.unreadCount} {props.unreadCount === 1 ? 'новое' : 'новых'}</Typography></button>
        ) : null}
        <div className="feed-content">{children}</div>
        </div>
      </main>
      <BottomNavigation appearance="memoly" active="feed" addButtonRef={props.addButtonRef} onAdd={props.onAdd} onFamily={props.onFamily} onFeed={props.onFeed} role={props.role} />
    </div>
  )
}
