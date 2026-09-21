/* eslint-disable typographyPolicy/use-typography-component -- faithful static HTML port keeps canonical semantic hierarchy. */
import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useRef, useState } from 'react'

import { ChildHeader } from '@/components/ChildHeader'
import { WebpIcon } from '@/components/WebpIcon'
import { InlineError } from '@/features/feed'
import { familyMemberName, feedChildSubtitle, roleLabel } from '@/features/family'
import { AvatarLetter } from '@/features/session'
import { useMemolyTheme, type MemolyTheme } from '@/features/theme'
import type { HostBridge } from '@/platform/host-bridge'
import { SettingsSheet } from './SettingsSheet'

export type FamilyMemberActions = { canEditAlias: boolean; canManageRole: boolean; canRemove: boolean }
export type FamilyPresentationProps = {
  familyResponse: FamilyResponse; hostBridge: Pick<HostBridge, 'onBack'>; invites: FamilyInviteDto[]; members: FamilyMemberDto[]; childAvatarUrl: string | null
  usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; inviteReady: { url: string; expiresAt: string } | null
  copyState: 'idle' | 'copied' | 'failed'; busy: boolean; hasError?: boolean; canInvite: boolean; canEditChild: boolean; canLeaveFamily: boolean
  memberActions: Record<string, FamilyMemberActions>; onRefresh: () => void; onRefreshUsage: () => void; onEditChild: () => void
  onCreateInvite: (input: { role: 'viewer' | 'full'; inviteeDisplayName?: string }) => Promise<void>; onCopyInvite: () => Promise<void>; onShareInvite: () => Promise<void>
  onCloseInvite: () => void; onRevokeInvite: (invite: FamilyInviteDto) => Promise<void>; onUpdateMember: (member: FamilyMemberDto, input: { familyDisplayName?: string | null; role?: 'full' | 'viewer' }) => Promise<void>
  onRemoveMember: (member: FamilyMemberDto) => Promise<void>; onLeaveFamily: () => Promise<void>
}
type FamilyView = 'overview' | 'member' | 'invite' | 'invite-ready'

export function FamilyPresentation({ familyResponse, hostBridge, invites, members, childAvatarUrl, usage, usageFailed, inviteReady, copyState, busy, hasError = false, canInvite, canEditChild, canLeaveFamily, memberActions, onRefresh, onRefreshUsage, onEditChild, onCreateInvite, onCopyInvite, onShareInvite, onCloseInvite, onRevokeInvite, onUpdateMember, onRemoveMember, onLeaveFamily }: FamilyPresentationProps) {
  const [view, setView] = useState<FamilyView>('overview')
  const [selectedMember, setSelectedMember] = useState<FamilyMemberDto | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsTriggerRef = useRef<HTMLElement | null>(null)
  const { theme } = useMemolyTheme()
  const child = familyResponse.child
  const currentSelectedMember = selectedMember ? members.find((member) => member.userId === selectedMember.userId) ?? null : null
  const openSettings = () => { if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) settingsTriggerRef.current = document.activeElement; setView('overview'); setSelectedMember(null); setSettingsOpen(true) }
  const goOverview = () => { setView('overview'); setSelectedMember(null) }
  return <main className="ml-family-content family-screen" data-slot="family-presentation">
    <div className="family-shell">
      {view === 'overview' ? <FamilyOverview canEditChild={canEditChild} canInvite={canInvite} child={child} childAvatarUrl={childAvatarUrl} family={familyResponse.family} hasError={hasError} invites={invites} members={members} onEditChild={onEditChild} onInvite={() => setView('invite')} onOpenMember={(member) => { setSelectedMember(member); setView('member') }} onOpenSettings={openSettings} onRefresh={onRefresh} onRefreshUsage={onRefreshUsage} onRevokeInvite={onRevokeInvite} theme={theme} usage={usage} usageFailed={usageFailed} /> : null}
      {view === 'member' && currentSelectedMember ? <MemberDetail key={`${currentSelectedMember.userId}:${currentSelectedMember.role}:${currentSelectedMember.familyDisplayName ?? ''}`} actions={memberActions[currentSelectedMember.userId] ?? { canEditAlias: false, canManageRole: false, canRemove: false }} busy={busy} member={currentSelectedMember} onBack={goOverview} onRemove={onRemoveMember} onSave={onUpdateMember} /> : null}
      {view === 'invite' ? <InviteFlow busy={busy} hasError={hasError} onBack={goOverview} onCreate={async (role, inviteeDisplayName) => { try { await onCreateInvite({ role, inviteeDisplayName }); setView('invite-ready') } catch { /* FamilyScreen exposes the actionable error state. */ } }} onRefresh={onRefresh} /> : null}
      {view === 'invite-ready' && inviteReady ? <InviteReady busy={busy} copyState={copyState} invite={inviteReady} onBack={() => setView('invite')} onClose={() => { onCloseInvite(); goOverview() }} onCopy={onCopyInvite} onShare={onShareInvite} /> : null}
    </div>
    <SettingsSheet hostBridge={hostBridge} onOpenChange={setSettingsOpen} open={settingsOpen} returnFocusRef={settingsTriggerRef} />
    {canLeaveFamily && view === 'overview' ? <button className="family-leave-action" disabled={busy} onClick={() => { if (typeof window === 'undefined' || window.confirm('Выйти из семьи? Доступ к приватным материалам будет закрыт.')) void onLeaveFamily() }} type="button">Выйти из семьи</button> : null}
  </main>
}

function FamilyOverview({ family, child, childAvatarUrl, members, invites, usage, usageFailed, canInvite, canEditChild, hasError, theme, onEditChild, onOpenSettings, onOpenMember, onInvite, onRefresh, onRefreshUsage, onRevokeInvite }: { family: FamilyResponse['family']; child: FamilyResponse['child']; childAvatarUrl: string | null; members: FamilyMemberDto[]; invites: FamilyInviteDto[]; usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; canInvite: boolean; canEditChild: boolean; hasError: boolean; theme: MemolyTheme; onEditChild: () => void; onOpenSettings: () => void; onOpenMember: (member: FamilyMemberDto) => void; onInvite: () => void; onRefresh: () => void; onRefreshUsage: () => void; onRevokeInvite: (invite: FamilyInviteDto) => Promise<void> }) {
  return <>
    <div className="family-child-header-stack">
      <ChildHeader childAvatarCrop={child?.avatarCrop ?? null} childAvatarUrl={childAvatarUrl} childName={child?.name ?? 'Ребёнок'} childSubtitle={child ? feedChildSubtitle(child.birthDate, family.timezone) : 'Профиль ребёнка'} mode="family" onOpenChild={canEditChild && child ? onEditChild : undefined} onOpenSettings={onOpenSettings} theme={theme} />
      <div className="family-child-quote family-child-quote--extension">«Наше маленькое большое счастье»</div>
    </div>
    {hasError ? <div className="family-error"><InlineError onRetry={onRefresh} /></div> : null}
    <div className="family-section-head">{family.name} <span className="family-count">{members.length}</span></div>
    <div className="family-list">{members.map((member) => <FamilyMemberRow key={member.userId} member={member} onOpen={onOpenMember} />)}</div>
    {canInvite ? <button className="family-invite-btn" onClick={onInvite} type="button"><span className="family-invite-plus">+</span><span>Пригласить родственника</span></button> : null}
    {members.length > 0 && child ? <div className="family-info-card"><span className="family-info-icon"><WebpIcon decorative name="family" size={24} /></span><div><strong>Делитесь моментами с самыми близкими</strong>Пригласите родных, чтобы вместе сохранять воспоминания о {child.name}.</div></div> : null}
    {canInvite ? <PendingInvites invites={invites} onRevoke={onRevokeInvite} /> : null}
    {usage ? <div className="family-usage"><strong>Семейный архив</strong><span>Использовано {formatBytes(usage.usedBytes)}{usage.quotaBytes ? ` из ${formatBytes(usage.quotaBytes)}` : ''}</span>{usage.quotaBytes ? <span aria-label="Использование архива" className="family-usage-bar"><i style={{ width: `${Math.min(100, usage.usedBytes / usage.quotaBytes * 100)}%` }} /></span> : null}</div> : null}
    {usageFailed ? <button className="family-inline-action" onClick={onRefreshUsage} type="button">Повторить загрузку объёма</button> : null}
  </>
}

function FamilyMemberRow({ member, onOpen }: { member: FamilyMemberDto; onOpen: (member: FamilyMemberDto) => void }) {
  const displayName = familyMemberName(member)
  const alias = member.familyDisplayName && member.familyDisplayName !== member.displayName ? member.displayName : null
  return <button aria-label={`Открыть участника: ${displayName}`} className="family-member-row" onClick={() => onOpen(member)} type="button"><AvatarLetter className="family-member-avatar" name={displayName} size="lg" /><span className="family-member-copy"><strong>{displayName}</strong>{alias ? <span>{alias}</span> : null}</span><span className={`family-role${member.role === 'viewer' && !member.isOwner ? ' viewer' : ''}`}>{roleLabel(member.role, member.isOwner)}</span><span aria-hidden="true" className="family-row-more">•••</span></button>
}

function MemberDetail({ member, actions, busy, onBack, onSave, onRemove }: { member: FamilyMemberDto; actions: FamilyMemberActions; busy: boolean; onBack: () => void; onSave: FamilyPresentationProps['onUpdateMember']; onRemove: FamilyPresentationProps['onRemoveMember'] }) {
  const displayName = familyMemberName(member)
  const [alias, setAlias] = useState(member.familyDisplayName ?? '')
  const viewer = member.role === 'viewer' && !member.isOwner
  return <section aria-label="Участник семьи" className="family-detail-screen">
    <div className="family-titlebar"><button aria-label="Назад к семье" className="family-round-btn family-back-btn" onClick={onBack} type="button"><WebpIcon decorative name="chevron" size={22} /></button><div className="family-page-title">Участник семьи</div><span aria-hidden="true" className="family-more">•••</span></div>
    <div className="family-profile"><AvatarLetter className="family-profile-avatar" name={displayName} size="xl" /><div className="family-profile-name">{displayName}</div>{member.familyDisplayName && member.familyDisplayName !== member.displayName ? <div className="family-profile-kin">{member.displayName}</div> : null}<span className={`family-profile-role${viewer ? ' viewer' : ''}`}>{roleLabel(member.role, member.isOwner)}</span></div>
    <div className="family-permissions"><h3>Доступ</h3>{(member.isOwner || !viewer) ? <><Permission>Добавлять воспоминания</Permission><Permission>Редактировать и удалять свои</Permission>{member.isOwner ? <Permission>Управлять участниками</Permission> : null}{member.isOwner ? <Permission>Изменять настройки семьи</Permission> : null}</> : <><Permission>Только просмотр контента семьи</Permission><Permission>Смотреть семейную ленту</Permission><Permission>Ставить лайки</Permission></>}</div>
    {(actions.canEditAlias || actions.canManageRole || actions.canRemove) ? <div className="family-member-actions"><h3>Действия</h3>{actions.canEditAlias ? <label className="family-action-field">Имя в семье<input aria-label={`Имя в семье: ${displayName}`} maxLength={64} onChange={(event) => setAlias(event.target.value)} value={alias} /><button disabled={busy} onClick={() => void onSave(member, { familyDisplayName: alias || null })} type="button">Сохранить</button></label> : null}{actions.canManageRole ? <div className="family-role-actions"><span>Роль</span><button aria-pressed={member.role === 'viewer'} disabled={busy} onClick={() => void onSave(member, { role: 'viewer' })} type="button">Просмотр</button><button aria-pressed={member.role === 'full'} disabled={busy} onClick={() => void onSave(member, { role: 'full' })} type="button">Полный доступ</button></div> : null}{actions.canRemove ? <button className="family-remove-action" disabled={busy} onClick={() => { if (typeof window === 'undefined' || window.confirm(`Удалить «${displayName}» из семьи?`)) void onRemove(member) }} type="button">Удалить участника</button> : null}</div> : null}
  </section>
}

function Permission({ children }: { children: string }) { return <div className="family-permission"><span className="family-check">✓</span>{children}</div> }

export function InviteFlow({ busy, hasError, onBack, onCreate, onRefresh }: { busy: boolean; hasError: boolean; onBack: () => void; onCreate: (role: 'viewer' | 'full', inviteeDisplayName?: string) => Promise<void>; onRefresh: () => void }) {
  const [role, setRole] = useState<'viewer' | 'full'>('viewer')
  const [inviteeDisplayName, setInviteeDisplayName] = useState('')
  return <section aria-label="Пригласить родственника" className="invite-simple-shell"><div className="invite-simple-titlebar"><button aria-label="Назад к семье" className="invite-round" onClick={onBack} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button><div className="invite-simple-title">Пригласить родственника</div><span /></div><div className="invite-hero"><div className="invite-icon-raised"><WebpIcon decorative name="lock" size={46} /></div><h2>Пригласить в семью</h2><p>Создайте ссылку. Родственнику достаточно открыть её — никаких логинов и паролей.</p></div>{hasError ? <div className="family-error invite-error"><InlineError onRetry={onRefresh} /></div> : null}<label className="invite-alias-field" htmlFor="invitee-display-name">Имя в семье (необязательно)<input id="invitee-display-name" maxLength={64} onChange={(event) => setInviteeDisplayName(event.target.value)} value={inviteeDisplayName} /></label><div className="invite-role-heading">Выберите роль</div><div className="invite-roles"><input checked={role === 'full'} id="simpleRoleFull" name="simpleInviteRole" onChange={() => setRole('full')} type="radio" /><label className="invite-role" htmlFor="simpleRoleFull"><span className="invite-role-radio" /><span className="invite-role-icon"><WebpIcon decorative name="star" size={25} /></span><span className="invite-role-copy"><strong>Полный доступ</strong><span>Может добавлять воспоминания, редактировать и удалять свои публикации</span></span></label><input checked={role === 'viewer'} id="simpleRoleView" name="simpleInviteRole" onChange={() => setRole('viewer')} type="radio" /><label className="invite-role" htmlFor="simpleRoleView"><span className="invite-role-radio" /><span className="invite-role-icon"><WebpIcon decorative name="info" size={25} /></span><span className="invite-role-copy"><strong>Просмотр</strong><span>Может смотреть воспоминания и ставить лайки</span></span></label></div><button className="invite-primary" disabled={busy} onClick={() => void onCreate(role, inviteeDisplayName.trim() || undefined)} type="button">Создать ссылку</button><div className="invite-privacy"><WebpIcon decorative name="lock" size={22} /><span>Ссылка приватная. До успешного вступления memoLy не показывает семейные фотографии и другие закрытые материалы.</span></div></section>
}

function InviteReady({ invite, busy, copyState, onBack, onClose, onCopy, onShare }: { invite: { url: string; expiresAt: string }; busy: boolean; copyState: FamilyPresentationProps['copyState']; onBack: () => void; onClose: () => void; onCopy: () => Promise<void>; onShare: () => Promise<void> }) {
  return <section aria-label="Ссылка готова" className="invite-simple-shell"><div className="invite-simple-titlebar"><button aria-label="Назад к приглашению" className="invite-round" onClick={onBack} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button><div className="invite-simple-title">Ссылка готова</div><span /></div><div className="invite-hero"><div className="invite-icon-raised"><WebpIcon decorative name="lock" size={46} /></div><h2>Приглашение готово!</h2><p>Отправьте эту ссылку родственнику. Срок действия — {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}.</p></div><div className="invite-linkbox"><input aria-label="Ссылка приглашения" readOnly value={invite.url} /><button aria-label="Скопировать ссылку" className="invite-copy" disabled={busy} onClick={() => void onCopy()} type="button">Копировать</button></div><button className="invite-primary" disabled={busy} onClick={() => void onShare()} type="button">Поделиться ссылкой</button>{copyState === 'copied' ? <div className="invite-copy-toast" role="status">Ссылка скопирована.</div> : null}{copyState === 'failed' ? <div className="invite-copy-toast" role="alert">Скопируйте ссылку вручную из поля выше.</div> : null}<button className="invite-secondary" onClick={onClose} type="button">Готово</button></section>
}

function PendingInvites({ invites, onRevoke }: { invites: FamilyInviteDto[]; onRevoke: (invite: FamilyInviteDto) => Promise<void> }) {
  if (invites.length === 0) return null
  return <section className="family-pending"><h3>Ожидают приглашение</h3>{invites.map((invite) => <div className="family-pending-row" key={invite.id}><span><strong>{invite.inviteeDisplayName ?? 'Новое приглашение'}</strong><small>{invite.role === 'full' ? 'Полный доступ' : 'Просмотр'} · до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}</small></span><button onClick={() => void onRevoke(invite)} type="button">Отозвать</button></div>)}</section>
}

function formatBytes(value: number) { if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`; return `${(value / 1024 / 1024).toFixed(1)} МБ` }
