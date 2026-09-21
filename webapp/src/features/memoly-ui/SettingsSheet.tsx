import { useCallback, useEffect, useState, type RefObject } from 'react'

import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import {
  getMemolyThemeConfig,
  MEMOLY_THEMES,
  useMemolyTheme,
  type MemolyTheme,
} from '@/features/theme'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import type { HostBridge } from '@/platform/host-bridge'

type SettingsView = 'menu' | 'appearance' | 'help' | 'about'

export type SettingsSheetProps = {
  hostBridge: Pick<HostBridge, 'onBack'>
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

/** Family-only settings surface. Product capabilities remain owned by controllers. */
export function SettingsSheet({ hostBridge, open, onOpenChange, returnFocusRef }: SettingsSheetProps) {
  const [view, setView] = useState<SettingsView>('menu')
  const { theme, setTheme } = useMemolyTheme()

  const title = view === 'menu'
    ? 'Настройки'
    : view === 'appearance'
      ? 'Оформление'
      : view === 'help'
        ? 'Помощь и приватность'
        : 'О memoLy'
  const close = useCallback(() => {
    setView('menu')
    onOpenChange(false)
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return undefined
    return hostBridge.onBack(close)
  }, [close, hostBridge, open])

  return (
    <MemolyBottomSheet onOpenChange={(nextOpen) => { if (!nextOpen) setView('menu'); onOpenChange(nextOpen) }} open={open} returnFocusRef={returnFocusRef}>
      <div className="ml-settings-sheet" data-slot="memoly-settings-sheet">
        <div className="ml-settings-heading">
          {view !== 'menu' ? (
            <button aria-label="Назад" className="ml-settings-back" onClick={() => setView('menu')} type="button">
              <WebpIcon decorative name="chevron" size={22} />
            </button>
          ) : <span aria-hidden="true" className="ml-settings-heading-spacer" />}
          <DrawerTitle className="min-w-0 flex-1 text-center">
            <Typography as="span" variant="memoryEmptyTitle">{title}</Typography>
          </DrawerTitle>
          <button aria-label="Закрыть" className="ml-settings-close" onClick={close} type="button">
            <WebpIcon decorative name="close" size={20} />
          </button>
        </div>

        <DrawerDescription className="sr-only">
          Настройки оформления и информация о приватности memoLy
        </DrawerDescription>

        {view === 'menu' ? <SettingsMenu onAbout={() => setView('about')} onAppearance={() => setView('appearance')} onHelp={() => setView('help')} theme={theme} /> : null}

        {view === 'appearance' ? <AppearanceChoices selected={theme} onSelect={setTheme} /> : null}
        {view === 'help' ? <HelpPrivacy /> : null}
        {view === 'about' ? <AboutMemoLy /> : null}
      </div>
    </MemolyBottomSheet>
  )
}

export function SettingsMenu({ onAbout, onAppearance, onHelp, theme }: { onAbout: () => void; onAppearance: () => void; onHelp: () => void; theme: MemolyTheme }) {
  return (
    <div className="ml-settings-list">
      <SettingsRow icon="star" onClick={onAppearance} title="Оформление" subtitle={`Текущая тема: ${getMemolyThemeConfig(theme).label}`} />
      <SettingsRow icon="info" onClick={onHelp} title="Помощь и приватность" subtitle="Ответы, приватность и поддержка" />
      <SettingsRow icon="gear" onClick={onAbout} title="О memoLy" subtitle="Информация о приложении" />
    </div>
  )
}

function SettingsRow({ icon, onClick, subtitle, title }: { icon: 'gear' | 'info' | 'star'; onClick: () => void; subtitle: string; title: string }) {
  return (
    <button className="ml-settings-row" onClick={onClick} type="button">
      <span className="ml-settings-row-icon"><WebpIcon decorative name={icon} size={22} /></span>
      <span className="ml-settings-row-copy">
        <Typography as="strong" variant="memoryBodyMedium">{title}</Typography>
        <Typography as="small" tone="muted" variant="memoryMeta">{subtitle}</Typography>
      </span>
      <WebpIcon decorative className="ml-settings-row-chevron" name="chevron" size={20} />
    </button>
  )
}

function AppearanceChoices({ onSelect, selected }: { onSelect: (theme: MemolyTheme) => void; selected: MemolyTheme }) {
  return (
    <div aria-label="Темы memoLy" className="ml-theme-choices" role="listbox">
      <Typography className="ml-settings-intro" tone="muted" variant="memoryMeta">Выберите палитру. Она сохранится на этом устройстве.</Typography>
      <div className="ml-theme-grid">
        {MEMOLY_THEMES.map((theme) => {
          const config = getMemolyThemeConfig(theme)
          return (
            <button
              aria-label={`Тема: ${config.label}`}
              aria-selected={theme === selected}
              className={`ml-theme-choice${theme === selected ? ' selected' : ''}`}
              data-theme-choice={theme}
              key={theme}
              onClick={() => onSelect(theme)}
              role="option"
              type="button"
            >
              <span className="ml-theme-swatch" style={{ backgroundImage: `url(${config.headerArtUrl})` }} />
              <Typography as="span" variant="memoryMeta">{config.label}</Typography>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function HelpPrivacy() {
  return (
    <div className="ml-settings-copy">
      <Typography as="h2" variant="memoryDialog">Приватные воспоминания</Typography>
      <Typography className="mt-2" tone="muted" variant="memoryBody">Фото, видео, голосовые и заметки доступны только участникам вашей семьи.</Typography>
      <Typography className="mt-4" tone="muted" variant="memoryBody">Роль просмотра позволяет открывать материалы и ставить лайки. Создание, изменение и удаление доступны только участникам с соответствующими правами.</Typography>
    </div>
  )
}

function AboutMemoLy() {
  return (
    <div className="ml-settings-copy">
      <Typography as="h2" variant="memoryDialog">memoLy</Typography>
      <Typography className="mt-2" tone="muted" variant="memoryBody">Приватный семейный архив воспоминаний о ребёнке.</Typography>
      <Typography className="mt-4" tone="muted" variant="memoryBody">В приложении можно хранить фотографии, видео, голосовые и текстовые заметки для своей семьи.</Typography>
    </div>
  )
}
