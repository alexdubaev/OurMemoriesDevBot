import type { Ref } from 'react'

import { Typography } from '@/components/typography'

import './BottomNavigation.css'

export type BottomNavigationProps = {
  active: 'feed' | 'albums' | 'family' | 'gifts'
  addButtonRef?: Ref<HTMLButtonElement>
  appearance?: 'default' | 'memoly'
  onAdd?: () => void
  onFamily: () => void
  onAlbums?: () => void
  onFeed: () => void
  onGifts?: () => void
  role: 'full' | 'viewer'
}

export function BottomNavigation({
  active,
  addButtonRef,
  appearance = 'default',
  onAdd,
  onFamily,
  onAlbums,
  onFeed,
  onGifts,
  role,
}: BottomNavigationProps) {
  return (
    <nav
      aria-label="Основная навигация"
      className="astryx-nav"
      data-bottom-navigation-appearance={appearance}
      data-slot="bottom-navigation"
      data-testid="bottom-navigation"
    >
      <Typography aria-hidden="true" as="span" className="astryx-nav-brand" variant="memoryScreen">memoLy</Typography>
      <div className="astryx-nav-list">
        <NavButton active={active === 'feed'} label="Лента" onClick={onFeed} position="home" />
        <NavButton active={active === 'albums'} label="Альбомы" onClick={onAlbums} position="archive-box" />
        {role === 'full' ? (
          <button
            aria-label="Добавить"
            className="astryx-nav-item astryx-nav-add"
            data-nav-position="add"
            data-v2-add="true"
            disabled={!onAdd}
            onClick={onAdd}
            ref={addButtonRef}
            type="button"
          >
            <Typography aria-hidden="true" as="span" className="astryx-nav-plus" variant="memoryNav">+</Typography>
            <Typography as="span" variant="memoryNav">Добавить</Typography>
          </button>
        ) : (
          <div
            aria-label="Режим просмотра"
            className="astryx-nav-item astryx-nav-viewer"
            data-nav-position="viewer"
            data-nav-viewer="true"
            role="img"
          >
            <Typography as="span" variant="memoryNav">Просмотр</Typography>
          </div>
        )}
        <NavButton active={active === 'gifts'} label="Вишлист" onClick={onGifts} position="gifts" />
        <NavButton active={active === 'family'} label="Семья" onClick={onFamily} position="family" />
      </div>
    </nav>
  )
}

function NavButton({ active, label, onClick, position }: {
  active: boolean
  label: string
  onClick?: () => void
  position: string
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className="astryx-nav-item"
      data-nav-position={position}
      data-v2-active={active ? 'true' : undefined}
      onClick={onClick}
      type="button"
    >
      <Typography as="span" variant="memoryNav">{label}</Typography>
    </button>
  )
}
