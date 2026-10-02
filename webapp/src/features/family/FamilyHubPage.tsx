/* eslint-disable typographyPolicy/use-typography-component -- Scoped Family Hub typography follows the frozen reference dimensions. */
import type { CSSProperties } from 'react'
import type { FamilyHomeResponse } from '@web-app-demo/contracts'

import { BrandLogo } from '@/components/BrandLogo'
import { WebpIcon } from '@/components/WebpIcon'
import { ChildAvatar } from './ChildAvatar'
import { roleLabel } from './model'
import { useChildAvatar } from './useChildAvatar'
import { getMemolyThemeConfig, useMemolyTheme } from '@/features/theme'
import type { AuthenticatedTransport } from '@/platform/api'

import './family-hub.css'

type FamilySummary = FamilyHomeResponse['items'][number]

export function FamilySummaryCard({ family, onSelect, transport, disabled = false }: {
  family: FamilySummary
  onSelect: (familyId: string) => void
  transport: AuthenticatedTransport
  disabled?: boolean
}) {
  const avatarUrl = useChildAvatar(transport, family.familyId, family.childAvatarMediaId)
  const unread = family.unreadState === 'ready' ? family.unreadCount : null
  const countLabel = unread === null
    ? family.unreadState === 'unavailable' ? 'Счётчик временно недоступен' : 'Счётчик пока не включён'
    : `${unread} непросмотренных воспоминаний`
  return <button
    aria-label={`${family.name}${family.displaySubtitle ? `, ${family.displaySubtitle}` : ''}, ${roleLabel(family.role, family.isOwner)}. ${countLabel}`}
    className="family-hub-card"
    disabled={disabled}
    onClick={() => onSelect(family.familyId)}
    type="button"
  >
    <span aria-hidden="true" className="family-hub-avatar"><ChildAvatar avatarCrop={family.childAvatarCrop ?? null} avatarUrl={avatarUrl} name={family.name.split(/\s+/).at(-1) ?? family.name} size="family-card" /></span>
      <span className="family-hub-card-copy">
        <strong className="family-hub-card-name">{family.name}</strong>
        {family.displaySubtitle ? <span className="family-hub-card-subtitle">{family.displaySubtitle}</span> : null}
        <span className="family-hub-card-role">{family.setupStatus === 'needs_child' ? 'Завершить настройку' : roleLabel(family.role, family.isOwner)}</span>
        {family.unreadState === 'not_enabled' ? <span className="family-hub-card-unread-state">Счётчик пока не включён</span> : null}
    </span>
    <span className="family-hub-card-side">
      {unread !== null && unread > 0 ? <span className="family-hub-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span> : null}
      {family.unreadState === 'unavailable' ? <span className="family-hub-count-unknown" aria-hidden="true">—</span> : null}
      <WebpIcon decorative name="chevron" size={18} />
    </span>
  </button>
}

export function FamilyHubPage({ home, loading, error, notice, busy, loadingMore, onRetry, onLoadMore, onCreate, onSelect, transport }: {
  home: FamilyHomeResponse | null
  loading: boolean
  error: string | null
  notice: string | null
  busy: boolean
  loadingMore: boolean
  onRetry: () => void
  onLoadMore: () => void
  onCreate: () => void
  onSelect: (familyId: string) => void
  transport: AuthenticatedTransport
}) {
  const { theme } = useMemolyTheme()
  const style = { '--family-hub-theme-art': `url(${getMemolyThemeConfig(theme).headerArtUrl})` } as CSSProperties
  const own = home?.items.filter((family) => family.isOwner) ?? []
  const invited = home?.items.filter((family) => !family.isOwner) ?? []
  const empty = !loading && !error && home?.items.length === 0
  const countUnavailable = home?.items.some((family) => family.unreadState === 'unavailable')

  return <div className="family-hub-page" data-slot="family-hub" style={style}>
    <div aria-hidden="true" className="family-hub-art"><div className="family-hub-picture" /></div>
    <main aria-busy={loading || busy} className="family-hub-shell">
      <div className="family-hub-brand"><BrandLogo className="family-hub-logo" /><span>Маленькие моменты<br />большое счастье</span></div>
      <header className="family-hub-intro"><h1>Мои семьи</h1><p>Выберите семейный альбом</p></header>
      {notice ? <div className="family-hub-notice" role="status">{notice}</div> : null}
      {countUnavailable ? <div className="family-hub-notice" role="status">Счётчик новых воспоминаний временно недоступен. Семьи можно открыть.</div> : null}
      {loading ? <div aria-label="Загружаем семьи" className="family-hub-skeleton" role="status"><span /><span /><span /></div> : null}
      {error ? <div className="family-hub-state" role="alert"><h2>Не удалось загрузить семьи</h2><p>{error}</p><button onClick={onRetry} type="button">Повторить</button></div> : null}
      {empty ? <div className="family-hub-state family-hub-state-empty"><div aria-hidden="true" className="family-hub-state-icon"><WebpIcon decorative monochrome name="family" size={28} /></div><h2>Пока здесь нет семей</h2><p>Создайте свой семейный альбом или откройте приглашение от близких.</p>{home?.canCreateOwnFamily ? <button className="family-hub-create-primary" disabled={busy} onClick={onCreate} type="button">＋ &nbsp; Создать свою семью</button> : null}</div> : null}
      {own.length > 0 ? <section className="family-hub-section"><h2>Моя семья</h2><div className="family-hub-cards">{own.map((family) => <FamilySummaryCard disabled={busy} family={family} key={family.familyId} onSelect={onSelect} transport={transport} />)}</div></section> : null}
      {invited.length > 0 ? <section className="family-hub-section"><h2>Семьи близких</h2><div className="family-hub-cards">{invited.map((family) => <FamilySummaryCard disabled={busy} family={family} key={family.familyId} onSelect={onSelect} transport={transport} />)}</div></section> : null}
      {home?.nextCursor ? <button className="family-hub-more" disabled={loadingMore} onClick={onLoadMore} type="button">{loadingMore ? 'Загружаем…' : 'Показать ещё семьи'}</button> : null}
      {home && home.items.length > 0 && home.canCreateOwnFamily ? <button className="family-hub-create" disabled={busy} onClick={onCreate} type="button"><span aria-hidden="true">＋</span>{busy ? 'Создаём семью…' : 'Создать свою семью'}</button> : null}
      {home && home.items.length > 0 ? <p className="family-hub-count-hint">Цифра рядом — новые воспоминания для вас</p> : null}
      <footer className="family-hub-footer"><p>Близкие рядом, даже на расстоянии</p></footer>
    </main>
  </div>
}
