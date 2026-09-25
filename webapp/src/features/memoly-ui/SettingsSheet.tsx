/* eslint-disable typographyPolicy/use-typography-component -- faithful static HTML port keeps canonical semantic hierarchy. */
import { useCallback, useEffect, useState, type RefObject } from 'react'

import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { WebpIcon } from '@/components/WebpIcon'
import { getMemolyThemeConfig, MEMOLY_THEMES, useMemolyTheme, type MemolyTheme } from '@/features/theme'
import type { HostBridge } from '@/platform/host-bridge'

type SettingsView = 'menu' | 'appearance' | 'help' | 'about'
export type SettingsSheetProps = { hostBridge: Pick<HostBridge, 'onBack'>; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef?: RefObject<HTMLElement | null>; canManageFamily: boolean; onFamilySettings: () => void; onArchive: () => void }

/** Canonical settings sheet. Controllers remain outside this presentation surface. */
export function SettingsSheet({ hostBridge, open, onOpenChange, returnFocusRef, canManageFamily, onFamilySettings, onArchive }: SettingsSheetProps) {
  const [view, setView] = useState<SettingsView>('menu')
  const { theme, setTheme } = useMemolyTheme()
  const title = view === 'appearance' ? 'Оформление' : view === 'help' ? 'Помощь и приватность' : view === 'about' ? 'О memoLy' : 'Настройки'
  const close = useCallback(() => { setView('menu'); onOpenChange(false) }, [onOpenChange])
  useEffect(() => { if (!open) return undefined; return hostBridge.onBack(() => { if (view !== 'menu') setView('menu'); else close() }) }, [close, hostBridge, open, view])
  return <MemolyBottomSheet onOpenChange={(nextOpen) => { if (!nextOpen) setView('menu'); onOpenChange(nextOpen) }} open={open} returnFocusRef={returnFocusRef}>
    <div className="ml-settings-sheet" data-slot="memoly-settings-sheet" data-view={view}>
      <DrawerTitle className="sr-only">{title}</DrawerTitle>
      <DrawerDescription className="sr-only">Настройки оформления и информация о приватности memoLy</DrawerDescription>
      {view === 'menu' ? <SettingsMenu canManageFamily={canManageFamily} onAbout={() => setView('about')} onAppearance={() => setView('appearance')} onArchive={() => { close(); onArchive() }} onFamilySettings={() => { close(); onFamilySettings() }} onHelp={() => setView('help')} theme={theme} /> : <div className="ml-settings-subview">
        <div className="ml-settings-heading"><button aria-label="Назад" className="ml-settings-back" onClick={() => setView('menu')} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button><span className="ml-settings-subview-title">{title}</span><span aria-hidden="true" className="ml-settings-heading-spacer" /></div>
        {view === 'appearance' ? <AppearanceChoices selected={theme} onSelect={setTheme} /> : null}
        {view === 'help' ? <HelpPrivacy /> : null}
        {view === 'about' ? <AboutMemoLy /> : null}
      </div>}
    </div>
  </MemolyBottomSheet>
}

export function SettingsMenu({ onAbout, onAppearance, onHelp, onFamilySettings, onArchive, canManageFamily, theme }: { onAbout: () => void; onAppearance: () => void; onHelp: () => void; onFamilySettings: () => void; onArchive: () => void; canManageFamily: boolean; theme: MemolyTheme }) {
  return <div className="ml-settings-list ml-sheet-panel--list">
    <SettingsRow icon="star" onClick={onAppearance} title="Оформление" subtitle={theme === 'mint' ? 'Мята или тёплая розовая палитра' : `Текущая тема: ${getMemolyThemeConfig(theme).label}`} />
    <SettingsRow icon="info" onClick={onHelp} title="Помощь и приватность" subtitle="Ответы, приватность и поддержка" />
    <SettingsRow icon="family" onClick={onArchive} title="Семейный архив" subtitle="Использование приватного хранилища" />
    {canManageFamily ? <SettingsRow icon="edit" onClick={onFamilySettings} title="Настройки семьи" subtitle="Название и часовой пояс" /> : null}
    <SettingsRow icon="gear" onClick={onAbout} title="О memoLy" subtitle="Информация о приложении" />
  </div>
}

function SettingsRow({ icon, onClick, subtitle, title }: { icon: 'gear' | 'info' | 'star' | 'family' | 'edit'; onClick: () => void; subtitle: string; title: string }) {
  return <button className="ml-sheet-row" onClick={onClick} type="button"><span className="ml-sheet-row-icon"><WebpIcon decorative name={icon} size={22} /></span><span className="ml-sheet-row-copy"><strong>{title}</strong><small>{subtitle}</small></span><span className="ml-sheet-row-chevron"><WebpIcon decorative name="chevron" size={20} /></span></button>
}

const THEME_DESCRIPTIONS: Record<MemolyTheme, string> = {
  mint: 'Мята · крем · мягкий шалфей', rose: 'Пыльная роза · крем · тёплый персик',
  sky: 'Голубой · крем · лимон', lavender: 'Лаванда · крем · шалфей',
  apricot: 'Абрикос · крем · мята', sand: 'Олива · песок · глина',
}

export function AppearanceChoices({ onSelect, selected }: { onSelect: (theme: MemolyTheme) => void; selected: MemolyTheme }) {
  return <div className="ml-theme-choices"><div className="ml-appearance-hero"><span aria-hidden="true" className="ml-appearance-hero-icon"><span /></span><h2>Выберите настроение</h2><p>Тема меняет только акценты: хедер ребёнка, нижнее меню, активный фильтр и реакции. Основной интерфейс остаётся светлым.</p></div><div aria-label="Темы memoLy" className="ml-theme-grid" role="group">{MEMOLY_THEMES.map((theme) => { const config = getMemolyThemeConfig(theme); return <button aria-pressed={theme === selected} className={`ml-theme-choice${theme === selected ? ' selected' : ''}`} data-theme-choice={theme} key={theme} onClick={() => onSelect(theme)} type="button"><span aria-hidden="true" className={`ml-theme-swatch ml-theme-swatch--${theme}`} /><span className="ml-theme-choice-copy"><strong>{config.label}</strong><small>{THEME_DESCRIPTIONS[theme]}</small></span><span aria-hidden="true" className="ml-theme-radio-mark" /></button> })}</div><p className="ml-theme-note">Основной фон, карточки и поля одинаковы во всех темах. Оформление не зависит от пола ребёнка.</p></div>
}

function HelpPrivacy() { return <div className="ml-settings-copy"><h2>Приватные воспоминания</h2><p>Фото, видео, голосовые и заметки доступны только участникам вашей семьи.</p><p>Роль просмотра позволяет открывать материалы и ставить лайки. Создание, изменение и удаление доступны только участникам с соответствующими правами.</p></div> }
function AboutMemoLy() { return <div className="ml-settings-copy"><h2>memoLy</h2><p>Приватный семейный архив воспоминаний о ребёнке.</p><p>В приложении можно хранить фотографии, видео, голосовые и текстовые заметки для своей семьи.</p></div> }
