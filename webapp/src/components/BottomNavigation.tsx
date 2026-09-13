import type { Ref } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import { cn } from '@/lib/utils'

export type BottomNavigationProps = {
  active: 'feed' | 'family'
  addButtonRef?: Ref<HTMLButtonElement>
  onAdd?: () => void
  onFamily: () => void
  onFeed: () => void
  role: 'full' | 'viewer'
}

export function BottomNavigation({
  active,
  addButtonRef,
  onAdd,
  onFamily,
  onFeed,
  role,
}: BottomNavigationProps) {
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card pb-[var(--host-inset-bottom)]"
      data-slot="bottom-navigation"
    >
      <div className="mx-auto grid h-[var(--layout-bottom-nav)] max-w-[var(--layout-max-width)] grid-cols-3 pl-[calc(8px+var(--host-inset-left))] pr-[calc(8px+var(--host-inset-right))]">
        <NavButton
          active={active === 'feed'}
          icon="home"
          label="Лента"
          onClick={onFeed}
        />
        {role === 'full' ? (
          <button
            aria-label="Добавить"
            className="group flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors duration-[var(--duration-standard)]"
            data-nav-position="add"
            onClick={onAdd}
            ref={addButtonRef}
            type="button"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-[var(--memory-accent-soft)] transition-transform duration-[var(--duration-standard)] group-active:scale-95">
              <WebpIcon decorative name="plus" size={24} state="active" />
            </span>
            <Typography variant="memoryNav">Добавить</Typography>
          </button>
        ) : (
          <div
            aria-label="Режим просмотра"
            className="flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-0.5 text-muted-foreground"
            data-nav-position="viewer"
            data-nav-viewer="true"
            role="img"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <WebpIcon decorative name="lock" size={20} />
            </span>
            <Typography variant="memoryNav">Просмотр</Typography>
          </div>
        )}
        <NavButton
          active={active === 'family'}
          icon="family"
          label="Семья"
          onClick={onFamily}
        />
      </div>
    </nav>
  )
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: 'family' | 'home'
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-0.5 transition-colors duration-[var(--duration-standard)]',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
      data-nav-position={icon}
      onClick={onClick}
      type="button"
    >
      <WebpIcon decorative name={icon} size={22} state={active ? 'active' : 'default'} />
      <Typography variant="memoryNav">{label}</Typography>
    </button>
  )
}
