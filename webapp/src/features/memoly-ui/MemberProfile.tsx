/* eslint-disable typographyPolicy/use-typography-component -- canonical member profile preserves its semantic HTML hierarchy. */
import type { FamilyMemberDto } from '@web-app-demo/contracts'
import { useEffect, useRef, useState } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { familyMemberName, roleLabel } from '@/features/family'
import { AvatarLetter } from '@/features/session'
import type { FamilyMemberActions } from './FamilyPresentation'
import { memberProfileChanges, memberProfileError, type MemberProfileChange } from './member-profile-model'
import './member-profile.css'

export function MemberProfile({ member, actions, busy, onBack, onRefresh, onSave, onRemove }: {
  member: FamilyMemberDto
  actions: FamilyMemberActions
  busy: boolean
  onBack: () => void
  onRefresh: () => void
  onSave: (member: FamilyMemberDto, input: MemberProfileChange) => Promise<void>
  onRemove: (member: FamilyMemberDto) => Promise<void>
}) {
  const [alias, setAlias] = useState(member.familyDisplayName ?? '')
  const [role, setRole] = useState<'full' | 'viewer'>(member.role)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)
  const pending = useRef(false)
  const removeDialog = useRef<HTMLDialogElement>(null)
  const displayName = familyMemberName(member)
  const changes = memberProfileChanges(member, actions, alias, role)
  const canSave = changes !== null && !busy

  useEffect(() => {
    const dialog = removeDialog.current
    if (!dialogOpen || !dialog) return
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [dialogOpen])

  async function save() {
    if (!canSave || pending.current) return
    if (!changes) return
    if (changes.familyDisplayName && changes.familyDisplayName.length > 64) { setError('Имя в семье должно быть не длиннее 64 символов.'); return }
    pending.current = true
    setError(null)
    try { await onSave(member, changes); setSaved(true) }
    catch (reason) {
      const failure = memberProfileError(reason, 'save')
      setConflict(failure.conflict)
      setError(failure.message)
      setSaved(false)
    }
    finally { pending.current = false }
  }

  async function remove() {
    if (!actions.canRemove || busy || pending.current) return
    pending.current = true
    setError(null)
    try { await onRemove(member); setDialogOpen(false); onBack() }
    catch (reason) {
      const failure = memberProfileError(reason, 'remove')
      setConflict(failure.conflict)
      setError(failure.message)
      setDialogOpen(false)
    }
    finally { pending.current = false }
  }

  return <section aria-label={member.isOwner ? 'Профиль владельца' : 'Профиль участника'} className="family-detail-screen member-profile-screen">
    <div className="family-titlebar member-profile-titlebar"><button aria-label="Назад к семье" className="family-round-btn family-back-btn" onClick={onBack} type="button"><WebpIcon decorative name="chevron" size={22} /></button><div className="family-page-title">{member.isOwner ? 'Профиль владельца' : 'Профиль участника'}</div><span /></div>
    <div className="member-profile-content">
      <section className="member-profile-hero"><div className="member-profile-avatar-wrap"><AvatarLetter className="member-profile-avatar" name={displayName} size="xl" /></div><h2>{displayName}</h2><p>Аккаунт: {member.displayName ?? 'Участник семьи'}</p><span className={`member-profile-role-badge${member.isOwner ? ' owner' : ''}`}>{roleLabel(member.role, member.isOwner)}</span></section>
      <h3 className="member-profile-section-title">Имя в семье</h3>
      <section className="member-profile-card member-profile-name-card"><div className="member-profile-field"><WebpIcon decorative name="user" size={18} /><input aria-label="Имя в семье" disabled={!actions.canEditAlias || busy} maxLength={64} onChange={(event) => { setAlias(event.target.value); setSaved(false) }} value={actions.canEditAlias ? alias : displayName} /></div></section>
      <h3 className="member-profile-section-title">Доступ</h3>
      <section className="member-profile-card">
        {member.isOwner ? <div className="member-owner-role"><WebpIcon decorative name="lock" size={21} /><div><strong>Владелец семьи</strong><small>Роль владельца изменить нельзя</small></div></div> : <div aria-label="Доступ" className="member-role-options" role="radiogroup">{(['full', 'viewer'] as const).map((option) => <label className="member-role-option" key={option}><input checked={role === option} disabled={!actions.canManageRole || busy} name={`member-role-${member.userId}`} onChange={() => { setRole(option); setSaved(false) }} type="radio" value={option} /><span aria-hidden="true" className="member-role-radio" /><span className="member-role-copy"><strong>{option === 'full' ? 'Полный доступ' : 'Просмотр'}</strong></span></label>)}</div>}
        <div className="member-profile-inline-divider" />
        <div className="member-profile-meta-row"><WebpIcon decorative name="calendar" size={17} /><div><strong>В семье с</strong><small>{new Date(member.joinedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</small></div></div>
      </section>
      {error ? <div className="member-profile-error" role="alert">{error}{conflict ? <button onClick={onRefresh} type="button">Обновить данные</button> : null}</div> : null}
      {saved ? <p aria-live="polite" className="member-profile-success">Изменения сохранены</p> : null}
      {(actions.canEditAlias || actions.canManageRole) ? <button className="member-profile-save" disabled={!canSave} onClick={() => void save()} type="button">{busy ? 'Сохраняем…' : 'Сохранить изменения'}</button> : null}
      {actions.canRemove ? <button className="member-profile-danger" disabled={busy} onClick={() => setDialogOpen(true)} type="button">Удалить из семьи</button> : null}
    </div>
    {dialogOpen ? <dialog aria-describedby="member-remove-description" aria-labelledby="member-remove-title" className="member-remove-modal" onCancel={() => setDialogOpen(false)} ref={removeDialog}><div aria-hidden="true" className="member-remove-icon"><WebpIcon decorative name="warning" size={25} /></div><h2 id="member-remove-title">Удалить участника из семьи?</h2><p id="member-remove-description">Он потеряет доступ к семейным воспоминаниям. Позже его можно будет пригласить снова.</p><div className="member-remove-actions"><button disabled={busy} onClick={() => setDialogOpen(false)} type="button">Отмена</button><button disabled={busy} onClick={() => void remove()} type="button">{busy ? 'Удаляем…' : 'Удалить'}</button></div></dialog> : null}
  </section>
}
