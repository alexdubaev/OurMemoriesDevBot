import type { CSSProperties } from 'react'
import type { ReactNode } from 'react'

import { BrandLogo } from '@/components/BrandLogo'
import { BottomNavigation } from '@/components/BottomNavigation'
import { WebpIcon, type WebpIconName } from '@/components/WebpIcon'
import { ChildAvatar } from '@/features/family'
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
  childAvatarCrop?: { x: number; y: number; width: number; height: number } | null
  childName: string
  childSubtitle: string
  childAvatarUrl?: string | null
  children: ReactNode
  insets: TelegramInsets
  onFamily: () => void
  onFeed: () => void
  onFilterChange: (filter: FeedFilter) => void
  onMore?: () => void
  role: 'full' | 'viewer'
}

export function FeedPresentation(props: FeedPresentationProps) {
  const style = {
    '--host-inset-top': `${props.insets.top}px`,
    '--host-inset-right': `${props.insets.right}px`,
    '--host-inset-bottom': `${props.insets.bottom}px`,
    '--host-inset-left': `${props.insets.left}px`,
  } as CSSProperties

  return (
    <div className="memoly-feed-page" data-memoly-feed="true" style={style}>
      <div className="memoly-feed-shell">
        <header className="memoly-topbar">
          <button aria-label="Помощь и конфиденциальность" className="memoly-circle-button" onClick={props.onMore} type="button">
            <WebpIcon decorative name="gear" size={22} />
          </button>
          <BrandLogo className="memoly-logo" />
          <span aria-hidden="true" />
        </header>
        <section className="memoly-child-hero" data-slot="memoly-child-hero">
          <ChildAvatar avatarCrop={props.childAvatarCrop ?? null} avatarUrl={props.childAvatarUrl ?? null} name={props.childName} size="feed-header" />
          <div className="memoly-child-copy">
            <h1>{props.childName}</h1>
            <p>{props.childSubtitle}</p>
            <span className="memoly-archive-pill"><WebpIcon decorative name="star" size={16} />Наши воспоминания</span>
          </div>
          <img alt="" aria-hidden="true" className="memoly-cloud-art" src="/assets/brand/memoly-cloud-stars.webp" />
        </section>
        <div aria-label="Фильтр воспоминаний" className="memoly-filters" data-slot="memoly-filter-rail" role="group">
          {filters.map((item) => <button aria-pressed={item.value === props.activeFilter} key={item.value} onClick={() => props.onFilterChange(item.value)} type="button">{item.icon ? <WebpIcon decorative name={item.icon} size={18} /> : null}{item.label}</button>)}
        </div>
        <main className="memoly-feed-content">{props.children}</main>
        <BottomNavigation appearance="memoly" active="feed" onFamily={props.onFamily} onFeed={props.onFeed} role={props.role} />
      </div>
    </div>
  )
}
