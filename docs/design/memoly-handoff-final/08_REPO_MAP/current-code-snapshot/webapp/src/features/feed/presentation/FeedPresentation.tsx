import type { CSSProperties } from 'react'
import type { ReactNode, Ref } from 'react'

import { BrandLogo } from '@/components/BrandLogo'
import { BottomNavigation } from '@/components/BottomNavigation'
import { Typography } from '@/components/typography'
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
  const style = {
    '--host-inset-top': `${props.insets.top}px`,
    '--host-inset-right': `${props.insets.right}px`,
    '--host-inset-bottom': `${props.insets.bottom}px`,
    '--host-inset-left': `${props.insets.left}px`,
  } as CSSProperties

  return (
    <div className="memoly-feed-page" data-memoly-feed="true" style={style}>
      <div className="memoly-feed-shell" data-slot="feed-scroll">
        <header className="memoly-topbar">
          <button aria-label="Помощь и конфиденциальность" className="memoly-circle-button" onClick={props.onMore} type="button">
            <WebpIcon decorative name="gear" size={22} />
          </button>
          <BrandLogo className="memoly-logo" />
          <span aria-hidden="true" />
        </header>
        <section className="memoly-child-hero" data-slot="memoly-child-hero">
          <ChildAvatar avatarCrop={props.childAvatarCrop ?? null} avatarUrl={props.childAvatarUrl ?? null} name={props.childName} size="feed-header" />
          <span aria-hidden="true" className="memoly-heart-dot"><WebpIcon decorative name="heart-filled" size={14} state="active" /></span>
          <div className="memoly-child-copy">
            <Typography as="h1" variant="memoryHero">{props.childName}</Typography>
            <Typography as="p" tone="muted" variant="memoryCaption">{props.childSubtitle}</Typography>
            <span className="memoly-archive-pill"><WebpIcon decorative name="star" size={16} /><Typography as="span" variant="memoryMeta">Наши воспоминания</Typography></span>
          </div>
          <img alt="" aria-hidden="true" className="memoly-cloud-art" src="/assets/brand/memoly-cloud-stars.webp" />
        </section>
        <div aria-label="Фильтр воспоминаний" className="memoly-filters" data-slot="memoly-filter-rail" role="group">
          {filters.map((item) => <button aria-pressed={item.value === props.activeFilter} key={item.value} onClick={() => props.onFilterChange(item.value)} type="button">{item.icon ? <WebpIcon decorative name={item.icon} size={18} /> : null}<Typography as="span" variant="memoryFilter">{item.label}</Typography></button>)}
        </div>
        <main className="memoly-feed-content">{children}</main>
        <BottomNavigation appearance="memoly" active="feed" addButtonRef={props.addButtonRef} onAdd={props.onAdd} onFamily={props.onFamily} onFeed={props.onFeed} role={props.role} />
      </div>
    </div>
  )
}
