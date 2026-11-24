import { useContext, type Ref } from 'react'

import { Typography } from '@/components/typography'
import { LiquidNavbarSurface, type NimbusFx } from '@/components/ui/liquid-glass-navbar'
import { WebpIcon, type WebpIconName } from '@/components/WebpIcon'
import { UiVersionContext } from '@/features/ui-version'
import { useIsMobile } from '@/hooks/use-mobile'

import { useNavigationAppearance, type NavigationTab } from './navigation-appearance-context'

import './BottomNavigation.css'

const columns = { feed: 0, albums: 1, gifts: 3, family: 4 } satisfies Record<NavigationTab, number>

export type BottomNavigationProps = {
  active: NavigationTab
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
  const showIcons = useContext(UiVersionContext) === 'v2'
  const navAppearance = useNavigationAppearance()
  const mobile = useIsMobile()
  const style = showIcons && navAppearance?.style === 'glass' ? 'glass' : 'classic'
  const glass = mobile && style === 'glass'
  const moving = glass && navAppearance?.motion?.to === active ? navAppearance.motion : null

  function navigate(to: NavigationTab, onClick?: () => void) {
    if (!onClick) return
    navAppearance?.moveIndicator(active, to)
    onClick()
  }

  return (
    <nav
      aria-label="Основная навигация"
      className="astryx-nav"
      data-bottom-navigation-appearance={appearance}
      data-nav-style={style}
      data-slot="bottom-navigation"
      data-testid="bottom-navigation"
    >
      <Typography aria-hidden="true" as="span" className="astryx-nav-brand" variant="memoryScreen">memoLy</Typography>
      <LiquidNavbarSurface
        active={columns[active]}
        className="astryx-nav-list"
        enabled={glass}
        fromIndex={moving ? columns[moving.from] : undefined}
        onSettled={() => { if (moving) navAppearance?.finishMotion(moving) }}
      >
        <NavButton active={active === 'feed'} fx={moving?.to === 'feed' ? 'glow' : undefined} icon={showIcons ? 'home' : undefined} label="Лента" onClick={() => navigate('feed', onFeed)} position="home" />
        <NavButton active={active === 'albums'} fx={moving?.to === 'albums' ? 'spin' : undefined} icon={showIcons ? 'archive-box' : undefined} label="Альбомы" onClick={() => navigate('albums', onAlbums)} position="archive-box" />
        {role === 'full' ? (
          <button
            aria-label="Добавить"
            className="astryx-nav-item astryx-nav-add"
            data-liquid-nav-item
            data-nav-position="add"
            data-v2-add="true"
            disabled={!onAdd}
            onClick={onAdd}
            ref={addButtonRef}
            type="button"
          >
            {showIcons
              ? <span aria-hidden="true" className="astryx-nav-plus"><WebpIcon decorative name="plus" size={glass ? 18 : 20} /></span>
              : <Typography aria-hidden="true" as="span" className="astryx-nav-plus" variant="memoryNav">+</Typography>}
            <Typography as="span" className="nimbus-label" variant="memoryNav">Добавить</Typography>
          </button>
        ) : (
          <div
            aria-label="Режим просмотра"
            className="astryx-nav-item astryx-nav-viewer"
            data-liquid-nav-item
            data-nav-position="viewer"
            data-nav-viewer="true"
            role="img"
          >
            {showIcons ? <WebpIcon decorative name="lock" size={glass ? 18 : 20} /> : null}
            <Typography as="span" className="nimbus-label" variant="memoryNav">Просмотр</Typography>
          </div>
        )}
        <NavButton active={active === 'gifts'} fx={moving?.to === 'gifts' ? 'pop' : undefined} icon={showIcons ? 'gift' : undefined} label="Вишлист" onClick={() => navigate('gifts', onGifts)} position="gifts" />
        <NavButton active={active === 'family'} fx={moving?.to === 'family' ? 'wave' : undefined} icon={showIcons ? 'family' : undefined} label="Семья" onClick={() => navigate('family', onFamily)} position="family" />
      </LiquidNavbarSurface>
    </nav>
  )
}

function NavButton({ active, fx, icon, label, onClick, position }: {
  active: boolean
  fx?: NimbusFx
  icon?: WebpIconName
  label: string
  onClick?: () => void
  position: string
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className="astryx-nav-item"
      data-liquid-nav-item
      data-nav-position={position}
      data-v2-active={active ? 'true' : undefined}
      onClick={onClick}
      type="button"
    >
      {icon ? <span className="astryx-nav-icon nv-ico" data-fx={fx}><WebpIcon decorative name={icon} size={20} /></span> : null}
      <Typography as="span" className="nimbus-label" variant="memoryNav">{label}</Typography>
    </button>
  )
}
