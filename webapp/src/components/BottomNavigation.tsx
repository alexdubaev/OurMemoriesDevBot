import type { Ref } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import { cn } from '@/lib/utils'

export type BottomNavigationProps = {
  active: 'feed' | 'family'
  addButtonRef?: Ref<HTMLButtonElement>
  appearance?: 'default' | 'memoly'
  onAdd?: () => void
  onFamily: () => void
  onFeed: () => void
  role: 'full' | 'viewer'
}

export function BottomNavigation({
  active,
  addButtonRef,
  appearance = 'default',
  onAdd,
  onFamily,
  onFeed,
  role,
}: BottomNavigationProps) {
  return (
    <nav
      aria-label="Основная навигация"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 pb-[var(--host-inset-bottom)]',
        appearance === 'memoly' ? 'border-0 bg-transparent shadow-none' : 'border-t bg-card',
        appearance === 'memoly' && 'memoly-bottom-nav',
      )}
      data-bottom-navigation-appearance={appearance}
      data-slot="bottom-navigation"
      data-testid="bottom-navigation"
    >
      <div className={cn(
        'mx-auto grid h-[var(--layout-bottom-nav)] max-w-[var(--layout-max-width)] grid-cols-3 pl-[calc(8px+var(--host-inset-left))] pr-[calc(8px+var(--host-inset-right))]',
        appearance === 'memoly' && 'memoly-bottom-nav-grid',
      )}>
        <NavButton
          active={active === 'feed'}
          icon="home"
          label="Лента"
          onClick={onFeed}
        />
        {role === 'full' ? (
          <button
            aria-label="Добавить"
            className={cn(
              'group flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors duration-[var(--duration-standard)]',
              appearance === 'memoly' && 'memoly-nav-add',
            )}
            data-nav-position="add"
            disabled={!onAdd}
            onClick={onAdd}
            ref={addButtonRef}
            type="button"
          >
            <span className={cn(
              'flex size-12 items-center justify-center rounded-full bg-[var(--memory-accent-soft)] transition-transform duration-[var(--duration-standard)] group-active:scale-95',
              appearance === 'memoly' && 'memoly-nav-add-circle',
            )}>
              <WebpIcon decorative monochrome name="plus" size={29} state="active" />
            </span>
            <Typography variant="memoryNav">Добавить</Typography>
          </button>
        ) : (
          <div
            aria-label="Режим просмотра"
            className={cn(
              'flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-0.5 text-muted-foreground',
              appearance === 'memoly' && 'memoly-nav-viewer',
            )}
            data-nav-position="viewer"
            data-nav-viewer="true"
            role="img"
          >
            <WebpIcon decorative monochrome name="lock" size={23} />
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
      <WebpIcon decorative monochrome name={icon} size={23} state={active ? 'active' : 'default'} />
      <Typography variant="memoryNav">{label}</Typography>
    </button>
  )
}
