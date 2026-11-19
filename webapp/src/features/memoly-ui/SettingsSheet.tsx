/* eslint-disable typographyPolicy/use-typography-component -- faithful static HTML port keeps canonical semantic hierarchy. */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { DiagnosticsReportAction } from '@/platform/diagnostics/DiagnosticsReportAction'
import { getMemolyThemeConfig, MEMOLY_THEMES, useMemolyTheme, type MemolyTheme } from '@/features/theme'
import type { HostBridge } from '@/platform/host-bridge'

type SettingsView = 'menu' | 'appearance' | 'help' | 'about'
export type SettingsSheetProps = { hostBridge: Pick<HostBridge, 'onBack'>; open: boolean; onOpenChange: (open: boolean) => void; returnFocusRef?: RefObject<HTMLElement | null>; canManageFamily: boolean; canOpenInstall?: boolean; installLabel?: string; onOpenInstall?: () => void; onFamilySettings: () => void; onArchive: () => void }

/** Canonical settings sheet. Controllers remain outside this presentation surface. */
export function SettingsSheet({ hostBridge, open, onOpenChange, returnFocusRef, canManageFamily, canOpenInstall = false, installLabel = 'Установить memoLy', onOpenInstall, onFamilySettings, onArchive }: SettingsSheetProps) {
  const [view, setView] = useState<SettingsView>('menu')
  const { theme, setTheme } = useMemolyTheme()
  const title = view === 'appearance' ? 'Оформление' : view === 'help' ? 'Помощь и приватность' : view === 'about' ? 'О memoLy' : 'Настройки'
  const close = useCallback(() => { setView('menu'); onOpenChange(false) }, [onOpenChange])
  useEffect(() => { if (!open) return undefined; return hostBridge.onBack(() => { if (view !== 'menu') setView('menu'); else close() }) }, [close, hostBridge, open, view])
  return <MemolyBottomSheet onOpenChange={(nextOpen) => { if (!nextOpen) setView('menu'); onOpenChange(nextOpen) }} open={open} returnFocusRef={returnFocusRef}>
    <div className="ml-settings-sheet" data-slot="memoly-settings-sheet" data-view={view}>
      <DrawerTitle className={view === 'menu' ? 'astryx-settings-title' : 'sr-only'}>{title}</DrawerTitle>
      <DrawerDescription className="sr-only">Настройки оформления и информация о приватности memoLy</DrawerDescription>
      {view === 'menu' ? <SettingsMenu canManageFamily={canManageFamily} canOpenInstall={canOpenInstall} installLabel={installLabel} onOpenInstall={() => { close(); onOpenInstall?.() }} onAbout={() => setView('about')} onAppearance={() => setView('appearance')} onArchive={() => { close(); onArchive() }} onFamilySettings={() => { close(); onFamilySettings() }} onHelp={() => setView('help')} theme={theme} /> : <div className="ml-settings-subview">
        <div className="ml-settings-heading"><button aria-label="Назад" className="ml-settings-back" onClick={() => setView('menu')} type="button">‹</button><span className="ml-settings-subview-title">{title}</span><span aria-hidden="true" className="ml-settings-heading-spacer" /></div>
        {view === 'appearance' ? <AppearanceChoices selected={theme} onSelect={setTheme} /> : null}
        {view === 'help' ? <HelpPrivacy /> : null}
        {view === 'about' ? <AboutMemoLy /> : null}
      </div>}
    </div>
  </MemolyBottomSheet>
}

export function SettingsMenu({ onAbout, onAppearance, onHelp, onFamilySettings, onArchive, onOpenInstall, canOpenInstall = false, installLabel = 'Установить memoLy', canManageFamily, theme }: { onAbout: () => void; onAppearance: () => void; onHelp: () => void; onFamilySettings: () => void; onArchive: () => void; onOpenInstall?: () => void; canOpenInstall?: boolean; installLabel?: string; canManageFamily: boolean; theme: MemolyTheme }) {
  return <div className="ml-settings-list ml-sheet-panel--list">
    <SettingsRow icon="palette" onClick={onAppearance} title="Оформление" subtitle={`Цвет аватаров: ${getMemolyThemeConfig(theme).label}`} />
    <SettingsRow icon="help-circle" onClick={onHelp} title="Помощь и приватность" subtitle="Ответы, приватность и поддержка" />
    <SettingsRow icon="archive-box" onClick={onArchive} title="Семейный архив" subtitle="Использование приватного хранилища" />
    {canManageFamily ? <SettingsRow icon="pencil" onClick={onFamilySettings} title="Настройки семьи" subtitle="Название и часовой пояс" /> : null}
    <ShareBotAction />
    <SettingsRow icon="circle-info" onClick={onAbout} title="О memoLy" subtitle="Информация о приложении" />
    {canOpenInstall ? <SettingsRow icon="circle-info" onClick={onOpenInstall ?? (() => undefined)} title={installLabel} subtitle="Открыть приложение в браузере или установить" /> : null}
  </div>
}

function SettingsRow({ icon, onClick, subtitle, title, disabled = false }: { icon: 'palette' | 'help-circle' | 'archive-box' | 'pencil' | 'circle-info' | 'channel'; onClick: () => void; subtitle: string; title: string; disabled?: boolean }) {
  return <button className="ml-sheet-row" data-settings-row={icon} disabled={disabled} onClick={onClick} type="button"><span className="ml-sheet-row-copy"><strong>{title}</strong><small>{subtitle}</small></span><span aria-hidden="true" className="ml-sheet-row-chevron">›</span></button>
}

function ShareBotAction() {
  const [status, setStatus] = useState<'idle' | 'shared' | 'copied' | 'cancelled' | 'failed' | 'unavailable'>('idle')
  const [busy, setBusy] = useState(false)
  const sharing = useRef(false)
  const username = import.meta.env.VITE_MAX_BOT_USERNAME
  const url = typeof username === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(username) ? `https://max.ru/${username}` : null
  const share = async () => {
    if (sharing.current) return
    if (!url) { setStatus('unavailable'); return }
    sharing.current = true
    setBusy(true)
    setStatus('idle')
    try {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: 'memoLy', url })
          setStatus('shared')
          return
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') { setStatus('cancelled'); return }
        }
      }
      try { await navigator.clipboard.writeText(url); setStatus('copied') }
      catch { setStatus('failed') }
    } finally {
      sharing.current = false
      setBusy(false)
    }
  }
  return <>
    <SettingsRow disabled={busy} icon="channel" onClick={() => void share()} title="Поделиться ботом" subtitle="Без доступа к вашей семье" />
    {status === 'shared' ? <p className="invitation-feedback" role="status">Ссылка на бота отправлена</p> : null}
    {status === 'copied' ? <p className="invitation-feedback" role="status">Ссылка на бота скопирована</p> : null}
    {status === 'cancelled' ? <p className="invitation-feedback" role="status">Отправка отменена</p> : null}
    {status === 'unavailable' ? <p className="invitation-alert" role="alert">Ссылка на бота пока недоступна.</p> : null}
    {status === 'failed' && url ? <div className="ml-settings-copy"><p role="alert">Не удалось отправить или скопировать ссылку. Скопируйте её вручную.</p><input aria-label="Ссылка на бота" className="w-full rounded-xl border p-3 select-text" onFocus={(event) => event.currentTarget.select()} readOnly value={url} /></div> : null}
  </>
}

export function AppearanceChoices({ onSelect, selected }: { onSelect: (theme: MemolyTheme) => void; selected: MemolyTheme }) {
  return <div className="ml-theme-choices astryx-theme-choices">
    <p>Цвет фона аватаров без фотографии</p>
    <div aria-label="Цвет фона аватаров" className="ml-theme-grid" role="group">
      {MEMOLY_THEMES.map((theme) => (
        <button aria-pressed={theme === selected} className="ml-theme-choice" data-theme-choice={theme} key={theme} onClick={() => onSelect(theme)} type="button">
          <span aria-hidden="true" className="astryx-theme-swatch" data-memoly-theme={theme} />
          <span className="ml-theme-choice-copy"><strong>{getMemolyThemeConfig(theme).label}</strong></span>
          <span aria-hidden="true" className="ml-theme-radio-mark" />
        </button>
      ))}
    </div>
  </div>
}

function HelpPrivacy() { return <div className="ml-settings-copy"><h2>Приватные воспоминания</h2><p>Фото, видео, голосовые и заметки доступны только участникам вашей семьи.</p><p>Роль просмотра позволяет открывать материалы и ставить лайки. Создание, изменение и удаление доступны только участникам с соответствующими правами.</p><p>Служебная аналитика записывает факт активности учётной записи и семьи, а также поверхность приложения: MAX Mini App, PWA или браузер. Эти записи хранятся 100 дней. Этот механизм не собирает содержимое воспоминаний, IP-адрес или user-agent.</p></div> }
function AboutMemoLy() { return <div className="ml-settings-copy"><h2>memoLy</h2><p>Приватный семейный архив воспоминаний о ребёнке.</p><p>В приложении можно хранить фотографии, видео, голосовые и текстовые заметки для своей семьи.</p><DiagnosticsReportAction /></div> }
