/* eslint-disable typographyPolicy/use-typography-component -- faithful static HTML port keeps canonical semantic hierarchy. */
import { useCallback, useEffect, useState, type RefObject } from 'react'

import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { WebpIcon } from '@/components/WebpIcon'
import { getMemolyThemeConfig, MEMOLY_THEMES, useMemolyTheme, type MemolyTheme } from '@/features/theme'
import type { HostBridge } from '@/platform/host-bridge'

type SettingsView = 'menu' | 'appearance' | 'help' | 'about'
export type SettingsSheetProps = { hostBridge: Pick<HostBridge, 'onBack'>; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef?: RefObject<HTMLElement | null> }

/** Canonical settings sheet. Controllers remain outside this presentation surface. */
export function SettingsSheet({ hostBridge, open, onOpenChange, returnFocusRef }: SettingsSheetProps) {
  const [view, setView] = useState<SettingsView>('menu')
  const { theme, setTheme } = useMemolyTheme()
  const title = view === 'appearance' ? 'Оформление' : view === 'help' ? 'Помощь и приватность' : view === 'about' ? 'О memoLy' : 'Настройки'
  const close = useCallback(() => { setView('menu'); onOpenChange(false) }, [onOpenChange])
  useEffect(() => { if (!open) return undefined; return hostBridge.onBack(close) }, [close, hostBridge, open])
  return <MemolyBottomSheet onOpenChange={(nextOpen) => { if (!nextOpen) setView('menu'); onOpenChange(nextOpen) }} open={open} returnFocusRef={returnFocusRef}>
    <div className="ml-settings-sheet" data-slot="memoly-settings-sheet">
      <DrawerTitle className={view === 'menu' ? 'sr-only' : 'ml-settings-title'}>{title}</DrawerTitle>
      <DrawerDescription className="sr-only">Настройки оформления и информация о приватности memoLy</DrawerDescription>
      {view === 'menu' ? <SettingsMenu onAbout={() => setView('about')} onAppearance={() => setView('appearance')} onHelp={() => setView('help')} theme={theme} /> : <div className="ml-settings-subview">
        <div className="ml-settings-heading"><button aria-label="Назад" className="ml-settings-back" onClick={() => setView('menu')} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button><span className="ml-settings-subview-title">{title}</span><button aria-label="Закрыть" className="ml-settings-close" onClick={close} type="button"><WebpIcon decorative name="close" size={20} /></button></div>
        {view === 'appearance' ? <AppearanceChoices selected={theme} onSelect={setTheme} /> : null}
        {view === 'help' ? <HelpPrivacy /> : null}
        {view === 'about' ? <AboutMemoLy /> : null}
      </div>}
    </div>
  </MemolyBottomSheet>
}

export function SettingsMenu({ onAbout, onAppearance, onHelp, theme }: { onAbout: () => void; onAppearance: () => void; onHelp: () => void; theme: MemolyTheme }) {
  return <div className="ml-settings-list ml-sheet-panel--list">
    <SettingsRow icon="star" onClick={onAppearance} title="Оформление" subtitle={theme === 'mint' ? 'Мята или тёплая розовая палитра' : `Текущая тема: ${getMemolyThemeConfig(theme).label}`} />
    <SettingsRow icon="info" onClick={onHelp} title="Помощь и приватность" subtitle="Ответы, приватность и поддержка" />
    <SettingsRow icon="gear" onClick={onAbout} title="О memoLy" subtitle="Информация о приложении" />
  </div>
}

function SettingsRow({ icon, onClick, subtitle, title }: { icon: 'gear' | 'info' | 'star'; onClick: () => void; subtitle: string; title: string }) {
  return <button className="ml-sheet-row" onClick={onClick} type="button"><span className="ml-sheet-row-icon"><WebpIcon decorative name={icon} size={22} /></span><span className="ml-sheet-row-copy"><strong>{title}</strong><small>{subtitle}</small></span><span className="ml-sheet-row-chevron"><WebpIcon decorative name="chevron" size={20} /></span></button>
}

function AppearanceChoices({ onSelect, selected }: { onSelect: (theme: MemolyTheme) => void; selected: MemolyTheme }) {
  return <div aria-label="Темы memoLy" className="ml-theme-choices" role="listbox"><p className="ml-settings-intro">Выберите палитру. Она сохранится на этом устройстве.</p><div className="ml-theme-grid">{MEMOLY_THEMES.map((theme) => { const config = getMemolyThemeConfig(theme); return <button aria-label={`Тема: ${config.label}`} aria-selected={theme === selected} className={`ml-theme-choice${theme === selected ? ' selected' : ''}`} data-theme-choice={theme} key={theme} onClick={() => onSelect(theme)} role="option" type="button"><span className="ml-theme-swatch" style={{ backgroundImage: `url(${config.headerArtUrl})` }} /><span>{config.label}</span></button> })}</div></div>
}

function HelpPrivacy() { return <div className="ml-settings-copy"><h2>Приватные воспоминания</h2><p>Фото, видео, голосовые и заметки доступны только участникам вашей семьи.</p><p>Роль просмотра позволяет открывать материалы и ставить лайки. Создание, изменение и удаление доступны только участникам с соответствующими правами.</p></div> }
function AboutMemoLy() { return <div className="ml-settings-copy"><h2>memoLy</h2><p>Приватный семейный архив воспоминаний о ребёнке.</p><p>В приложении можно хранить фотографии, видео, голосовые и текстовые заметки для своей семьи.</p></div> }
