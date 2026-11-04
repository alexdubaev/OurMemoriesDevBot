/* eslint-disable typographyPolicy/use-typography-component -- invitation screens preserve the canonical semantic HTML hierarchy. */
import type { InvitePreviewResponse } from '@web-app-demo/contracts'
import { useRef, useState, type CSSProperties, type FormEvent } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { BrandLogo } from '@/components/BrandLogo'
import { InlineError } from '@/features/feed'
import { inviteIssueMessage } from './model'
import './invitation-screens.css'

type Role = 'viewer' | 'full'

function roleDescription(role: Role) {
  return role === 'full'
    ? 'Можно добавлять, редактировать и удалять воспоминания семьи.'
    : 'Можно смотреть воспоминания и ставить лайки.'
}

// eslint-disable-next-line react-refresh/only-export-components -- tested invitation payload contract.
export function buildInvitePayload(role: Role, inviteeDisplayName: string) {
  return { role, inviteeDisplayName: inviteeDisplayName.trim() || undefined }
}

// eslint-disable-next-line react-refresh/only-export-components -- tested invitation submit contract.
export function submitInvite(busy: boolean, role: Role, inviteeDisplayName: string, onCreate: (role: Role, inviteeDisplayName?: string, idempotencyKey?: string) => Promise<void>, idempotencyKey?: string) {
  if (busy) return undefined
  const payload = buildInvitePayload(role, inviteeDisplayName)
  return onCreate(payload.role, payload.inviteeDisplayName, idempotencyKey)
}

function InvitationHeader({ title, onBack, backDisabled = false }: { title: string; onBack?: () => void; backDisabled?: boolean }) {
  return <div className="invitation-header">
    {onBack ? <button aria-label="Назад" className="invitation-back" disabled={backDisabled} onClick={onBack} type="button"><WebpIcon decorative name="chevron" size={22} /></button> : <span />}
    <h1>{title}</h1><span />
  </div>
}

export function InviteFlow({ busy, errorMessage, hasError, onBack, onCreate, onRefresh }: { busy: boolean; errorMessage?: string | null; hasError: boolean; onBack: () => void; onCreate: (role: Role, inviteeDisplayName?: string, idempotencyKey?: string) => Promise<void>; onRefresh: () => void }) {
  const [role, setRole] = useState<Role>('viewer')
  const [name, setName] = useState('')
  const submitting = useRef(false)
  const operation = useRef<{ payload: string; key: string } | null>(null)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || submitting.current) return
    submitting.current = true
    const payload = buildInvitePayload(role, name)
    const payloadKey = JSON.stringify(payload)
    if (operation.current?.payload !== payloadKey) operation.current = { payload: payloadKey, key: crypto.randomUUID() }
    void Promise.resolve(submitInvite(busy, role, name, onCreate, operation.current.key)).finally(() => { submitting.current = false })
  }
  return <section aria-label="Пригласить родственника" className="invitation-screen invitation-create">
    <InvitationHeader backDisabled={busy} onBack={() => { if (busy || submitting.current) return; operation.current = null; onBack() }} title="Пригласить родственника" />
    <p className="invitation-hint">Имя можно заполнить заранее или оставить пустым.</p>
    {errorMessage ? <p className="invitation-alert" role="alert">{errorMessage}</p> : hasError ? <div className="invitation-alert"><InlineError onRetry={onRefresh} /></div> : null}
    <form onSubmit={handleSubmit}>
      <section className="invitation-card" aria-labelledby="invitation-profile-title">
        <div className="invitation-card-heading"><h2 id="invitation-profile-title">Профиль родственника</h2><span>необязательно</span></div>
        <label className="invitation-name-label" htmlFor="invitee-display-name">Имя в семье</label>
        <input autoComplete="off" className="invitation-name-input" id="invitee-display-name" maxLength={64} onChange={(event) => setName(event.target.value)} placeholder="Например, Бабушка Оля" value={name} />
      </section>
      <h2 className="invitation-section-title">Доступ</h2>
      <div className="invitation-roles">
        <label className="invitation-role"><input checked={role === 'full'} disabled={busy} id="simpleRoleFull" name="invite-role" onChange={() => setRole('full')} type="radio" /><span className="invitation-role-icon"><WebpIcon decorative name="star" size={18} /></span><span><strong>Полный доступ</strong><small>{roleDescription('full')}</small></span></label>
        <label className="invitation-role"><input checked={role === 'viewer'} disabled={busy} id="simpleRoleView" name="invite-role" onChange={() => setRole('viewer')} type="radio" /><span className="invitation-role-icon"><WebpIcon decorative name="info" size={18} /></span><span><strong>Просмотр</strong><small>{roleDescription('viewer')}</small></span></label>
      </div>
      <button className="invitation-primary" disabled={busy} type="submit">{busy ? 'Создаём ссылку…' : 'Создать приглашение'}</button>
      <p className="invitation-note">Ссылка приватная. Семейные материалы станут доступны только после вступления.</p>
    </form>
  </section>
}

type InviteProvider = 'max' | 'telegram'
type InviteActionStatus = 'idle' | 'copied' | 'failed' | 'shared' | 'cancelled'
type InviteActions = Record<InviteProvider, { copyState: InviteActionStatus; shareState: InviteActionStatus }>

// eslint-disable-next-line react-refresh/only-export-components -- pure share fallback is tested independently.
export async function shareInviteWithFallback(url: string, share?: (url: string) => Promise<void>, copy?: (url: string) => Promise<void>): Promise<'shared' | 'copied' | 'failed' | 'cancelled'> {
  if (share) {
    try {
      await share(url)
      return 'shared'
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    if (!copy) return 'failed'
    await copy(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export function InviteReady({ invite, busy, actions, onBack, onClose, onCopy, onShare }: { invite: { maxUrl: string | null; telegramUrl: string; expiresAt: string; inviteeDisplayName?: string }; busy: boolean; actions: InviteActions; onBack: () => void; onClose: () => void; onCopy: (provider: InviteProvider) => Promise<void>; onShare: (provider: InviteProvider) => Promise<void> }) {
  return <section aria-label="Ссылка готова" className="invitation-screen invitation-ready">
    <InvitationHeader onBack={onBack} title="Ссылка готова" />
    <div className="invitation-result-symbol" aria-hidden="true"><WebpIcon decorative name="lock" size={40} /></div>
    <h2>Приглашение готово!</h2>
    <p className="invitation-result-copy">Это одно приглашение для одного родственника. Выберите ссылку для приложения, которым ему удобнее пользоваться. Срок действия — до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}.</p>
    {invite.inviteeDisplayName ? <div className="invitation-recipient"><span className="invitation-recipient-avatar" aria-hidden="true">{invite.inviteeDisplayName.charAt(0).toLocaleUpperCase('ru-RU')}</span><span><strong>{invite.inviteeDisplayName}</strong><small>Имя в семье после вступления</small></span></div> : null}
    <InviteLinkActions actions={actions.max} busy={busy} label="MAX" onCopy={() => onCopy('max')} onShare={() => onShare('max')} url={invite.maxUrl} />
    <InviteLinkActions actions={actions.telegram} busy={busy} label="Telegram" onCopy={() => onCopy('telegram')} onShare={() => onShare('telegram')} url={invite.telegramUrl} />
    <button className="invitation-secondary" onClick={onClose} type="button">Готово</button>
  </section>
}

function InviteLinkActions({ label, url, actions, busy, onCopy, onShare }: { label: string; url: string | null; actions: InviteActions[InviteProvider]; busy: boolean; onCopy: () => Promise<void>; onShare: () => Promise<void> }) {
  const unavailable = !url || busy
  return <section aria-label={`Пригласить через ${label}`} className="invitation-provider">
    <h3>Пригласить через {label}</h3>
    {url ? <div className="invitation-linkbox"><input aria-label={`Ссылка приглашения ${label}`} onFocus={(event) => event.currentTarget.select()} readOnly value={url} /><button disabled={unavailable} onClick={() => void onCopy()} type="button">Скопировать</button></div> : <p className="invitation-alert" role="alert">Ссылка MAX недоступна: проверьте настройки бота.</p>}
    {actions.copyState === 'copied' ? <p className="invitation-feedback" role="status">Ссылка {label} скопирована</p> : null}
    {actions.copyState === 'failed' ? <p className="invitation-alert" role="alert">Не удалось скопировать ссылку {label}. Выделите её в поле выше.</p> : null}
    {url ? <button className="invitation-share" disabled={unavailable} onClick={() => void onShare()} type="button">Поделиться ссылкой {label}</button> : null}
    {actions.shareState === 'shared' ? <p className="invitation-feedback" role="status">Открыто меню отправки {label}</p> : null}
    {actions.shareState === 'copied' ? <p className="invitation-feedback" role="status">Меню отправки недоступно. Ссылка {label} скопирована</p> : null}
    {actions.shareState === 'cancelled' ? <p className="invitation-feedback" role="status">Отправка отменена</p> : null}
    {actions.shareState === 'failed' ? <p className="invitation-alert" role="alert">Не удалось отправить или скопировать ссылку {label}. Выделите её в поле выше.</p> : null}
  </section>
}

export function IncomingInvite({ preview, style, onAccept }: { preview: InvitePreviewResponse; style: CSSProperties; onAccept: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const accepting = useRef(false)
  const acceptButton = useRef<HTMLButtonElement>(null)
  return <main className="invitation-screen invitation-incoming" style={style}>
    <BrandLogo className="invitation-brand" />
    <div className="invitation-result-symbol" aria-hidden="true"><WebpIcon decorative name="family" size={40} /></div>
    <h2>Вас приглашают в семью</h2>
    <p className="invitation-incoming-summary">«{preview.family.name}» · доступ: <strong>{preview.role === 'full' ? 'Полный' : 'Просмотр'}</strong></p>
    <p className="invitation-role-explanation">{roleDescription(preview.role)}</p>
    <p className="invitation-incoming-privacy">До вступления семейные фотографии и другие закрытые материалы не показываются.</p>
    <p className="invitation-expiry">Ссылка действует до {new Date(preview.expiresAt).toLocaleString('ru-RU')}</p>
    {failed ? <p className="invitation-alert" role="alert">Не удалось присоединиться. Проверьте приглашение и повторите.</p> : null}
    <button ref={acceptButton} className="invitation-primary" disabled={busy} onClick={() => { if (accepting.current) return; accepting.current = true; setBusy(true); setFailed(false); void onAccept().catch(() => setFailed(true)).finally(() => { accepting.current = false; setBusy(false) }) }} type="button">{busy ? 'Присоединяемся…' : 'Присоединиться'}</button>
  </main>
}

const terminalCodes = new Set(['OTHER_FAMILY', 'ALREADY_IN_FAMILY', 'INVITE_EXPIRED', 'INVITE_REVOKED', 'INVITE_USED', 'NOT_FOUND'])

export function IncomingInviteIssue({ code, onRetry, onMyFamilies, style }: { code: string; onRetry: () => Promise<void>; onMyFamilies: () => void; style: CSSProperties }) {
  const [busy, setBusy] = useState(false)
  const title = code === 'INVITE_EXPIRED' ? 'Ссылка устарела' : code === 'INVITE_REVOKED' ? 'Приглашение отозвано' : code === 'OTHER_FAMILY' || code === 'ALREADY_IN_FAMILY' ? 'Вы уже в семье' : 'Приглашение недоступно'
  return <main className="invitation-screen invitation-incoming" style={style}><BrandLogo className="invitation-brand" /><div className="invitation-result-symbol" aria-hidden="true"><WebpIcon decorative name="lock" size={40} /></div><h2>{title}</h2><p className="invitation-result-copy">{inviteIssueMessage(code)}</p>{!terminalCodes.has(code) ? <button className="invitation-primary" disabled={busy} onClick={() => { setBusy(true); void onRetry().finally(() => setBusy(false)) }} type="button">{busy ? 'Проверяем…' : 'Повторить'}</button> : null}<button className="invitation-secondary" onClick={onMyFamilies} type="button">Мои семьи</button></main>
}
