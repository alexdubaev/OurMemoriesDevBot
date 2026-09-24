/* eslint-disable typographyPolicy/use-typography-component -- canonical invites list retains semantic text elements. */
import type { FamilyInviteDto } from '@web-app-demo/contracts'
import { useRef, useState } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { ManagementTopbar } from './FamilySettingsPage'
import './family-management.css'

export function FamilyInvitesPage({ invites, busy, onBack, onInvite, onRevoke }: {
  invites: FamilyInviteDto[]
  busy: boolean
  onBack: () => void
  onInvite: () => void
  onRevoke: (invite: FamilyInviteDto) => Promise<void>
}) {
  const [selected, setSelected] = useState<FamilyInviteDto | null>(null)
  const [error, setError] = useState(false)
  const pending = useRef(false)

  async function revoke() {
    if (!selected || busy || pending.current) return
    pending.current = true
    try { await onRevoke(selected); setSelected(null); setError(false) }
    catch { setError(true) }
    finally { pending.current = false }
  }

  const heading = selected ? 'Приглашение' : 'Активные приглашения'
  return <section aria-label={heading} className="family-management-page" data-slot="family-invites-page">
    <ManagementTopbar onBack={selected ? () => { setSelected(null); setError(false) } : onBack} title={heading} />
    {selected ? <div className="family-management-center"><span className="family-management-center-icon"><WebpIcon decorative name="warning" size={34} /></span><h2>{error ? 'Не удалось отозвать приглашение' : 'Отозвать приглашение?'}</h2><p>{error ? 'Проверьте соединение. Ссылка пока может оставаться активной.' : `Ссылка для «${selected.inviteeDisplayName ?? 'родственника'}» сразу перестанет работать.`}</p><button className="family-management-danger" disabled={busy} onClick={() => void revoke()} type="button">{busy ? 'Отзываем…' : error ? 'Повторить' : 'Отозвать'}</button><button className="family-management-secondary" disabled={busy} onClick={() => { setSelected(null); setError(false) }} type="button">{error ? 'Назад' : 'Отмена'}</button></div> : invites.length ? <><div className="family-management-list">{invites.map((invite) => <div className="family-management-invite-row" key={invite.id}><div><strong>{invite.inviteeDisplayName ?? 'Новое приглашение'}</strong><small>{invite.role === 'full' ? 'Полный доступ' : 'Просмотр'} · до {new Date(invite.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</small></div><button disabled={busy} onClick={() => setSelected(invite)} type="button">Отозвать</button></div>)}</div><p className="family-management-footnote">Ссылка перестанет работать сразу после отзыва.</p></> : <div className="family-management-center"><span className="family-management-center-icon"><WebpIcon decorative name="info" size={34} /></span><h2>Нет активных приглашений</h2><p>Созданные ссылки появятся здесь, пока родственник не присоединится или ссылка не истечёт.</p><button className="family-management-primary" onClick={onInvite} type="button">Пригласить родственника</button></div>}
  </section>
}
