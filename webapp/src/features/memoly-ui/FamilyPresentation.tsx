/* eslint-disable typographyPolicy/use-typography-component -- faithful static HTML port keeps canonical semantic hierarchy. */
import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useEffect, useRef, useState } from 'react'

import { ChildHeader } from '@/components/ChildHeader'
import { WebpIcon } from '@/components/WebpIcon'
import { InlineError } from '@/features/feed'
import { ChildProfile, familyMemberName, feedChildSubtitle, InviteFlow, InviteReady, roleLabel } from '@/features/family'
import { AvatarLetter } from '@/features/session'
import { useMemolyTheme, type MemolyTheme } from '@/features/theme'
import type { HostBridge } from '@/platform/host-bridge'
import { SettingsSheet } from './SettingsSheet'
import { MemberProfile } from './MemberProfile'

export type FamilyMemberActions = { canEditAlias: boolean; canManageRole: boolean; canRemove: boolean }
export type FamilyPresentationProps = {
  familyResponse: FamilyResponse; hostBridge: Pick<HostBridge, 'onBack'>; invites: FamilyInviteDto[]; members: FamilyMemberDto[]; childAvatarUrl: string | null
  usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; inviteReady: { url: string; expiresAt: string; inviteeDisplayName?: string } | null
  copyState: 'idle' | 'copied' | 'failed'; busy: boolean; hasError?: boolean; inviteError?: boolean; canInvite: boolean; canEditChild: boolean; canLeaveFamily: boolean; childProfileOpen: boolean
  memberActions: Record<string, FamilyMemberActions>; onRefresh: () => void; onRefreshUsage: () => void; onEditChild: () => void; onChangeChildPhoto: () => void; onOpenChild: () => void; onCloseChild: () => void
  onCreateInvite: (input: { role: 'viewer' | 'full'; inviteeDisplayName?: string }) => Promise<void>; onCopyInvite: () => Promise<void>; onShareInvite: () => Promise<void>
  onCloseInvite: () => void; onRevokeInvite: (invite: FamilyInviteDto) => Promise<void>; onUpdateMember: (member: FamilyMemberDto, input: { familyDisplayName?: string | null; role?: 'full' | 'viewer' }) => Promise<void>
  onRemoveMember: (member: FamilyMemberDto) => Promise<void>; onLeaveFamily: () => Promise<void>
}
type FamilyView = 'overview' | 'member' | 'invite' | 'invite-ready' | 'invite-details'

export function FamilyPresentation({ familyResponse, hostBridge, invites, members, childAvatarUrl, usage, usageFailed, inviteReady, copyState, busy, hasError = false, inviteError = false, canInvite, canEditChild, canLeaveFamily, childProfileOpen, memberActions, onRefresh, onRefreshUsage, onEditChild, onChangeChildPhoto, onOpenChild, onCloseChild, onCreateInvite, onCopyInvite, onShareInvite, onCloseInvite, onRevokeInvite, onUpdateMember, onRemoveMember, onLeaveFamily }: FamilyPresentationProps) {
  const [view, setView] = useState<FamilyView>('overview')
  const [selectedMember, setSelectedMember] = useState<FamilyMemberDto | null>(null)
  const [selectedInvite, setSelectedInvite] = useState<FamilyInviteDto | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ageDetailsOpen, setAgeDetailsOpen] = useState(false)
  const settingsTriggerRef = useRef<HTMLElement | null>(null)
  const { theme } = useMemolyTheme()
  const child = familyResponse.child
  const currentSelectedMember = selectedMember ? members.find((member) => member.userId === selectedMember.userId) ?? null : null
  const openSettings = () => { if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) settingsTriggerRef.current = document.activeElement; setView('overview'); setSelectedMember(null); setSettingsOpen(true) }
  const goOverview = () => { setView('overview'); setSelectedMember(null); setSelectedInvite(null) }
  useEffect(() => {
    if (view === 'overview' && !childProfileOpen) return undefined
    return hostBridge.onBack(() => {
      if (childProfileOpen) {
        if (ageDetailsOpen) setAgeDetailsOpen(false)
        else onCloseChild()
        return
      }
      if (view === 'invite-ready') onCloseInvite()
      goOverview()
    })
  }, [ageDetailsOpen, childProfileOpen, hostBridge, onCloseChild, onCloseInvite, view])
  return <main className={`ml-family-content family-screen${childProfileOpen ? ' child-screen' : ''}`} data-slot="family-presentation">
    <div className={childProfileOpen ? 'child-shell' : 'family-shell'}>
      {childProfileOpen && child ? <ChildProfile avatarUrl={childAvatarUrl} canEdit={canEditChild} child={child} familyTimezone={familyResponse.family.timezone} onBack={() => { if (ageDetailsOpen) setAgeDetailsOpen(false); else onCloseChild() }} onEdit={onEditChild} onChangePhoto={onChangeChildPhoto} onOpenAge={() => setAgeDetailsOpen(true)} showAgeDetails={ageDetailsOpen} /> : null}
      {!childProfileOpen && view === 'overview' ? <FamilyOverview canInvite={canInvite} child={child} childAvatarUrl={childAvatarUrl} family={familyResponse.family} hasError={hasError} invites={invites} members={members} onOpenChild={() => { setAgeDetailsOpen(false); onOpenChild() }} onInvite={() => setView('invite')} onOpenInvite={(invite) => { setSelectedInvite(invite); setView('invite-details') }} onOpenMember={(member) => { setSelectedMember(member); setView('member') }} onOpenSettings={openSettings} onRefresh={onRefresh} onRefreshUsage={onRefreshUsage} onRevokeInvite={onRevokeInvite} theme={theme} usage={usage} usageFailed={usageFailed} /> : null}
      {!childProfileOpen && view === 'member' && currentSelectedMember ? <MemberProfile key={`${currentSelectedMember.userId}:${currentSelectedMember.role}:${currentSelectedMember.familyDisplayName ?? ''}`} actions={memberActions[currentSelectedMember.userId] ?? { canEditAlias: false, canManageRole: false, canRemove: false }} busy={busy} member={currentSelectedMember} onBack={goOverview} onRefresh={onRefresh} onRemove={onRemoveMember} onSave={onUpdateMember} /> : null}
      {!childProfileOpen && view === 'invite-details' && selectedInvite ? <PendingInviteDetails busy={busy} invite={selectedInvite} onBack={goOverview} onRevoke={async (invite) => { await onRevokeInvite(invite); goOverview() }} /> : null}
      {!childProfileOpen && view === 'invite' ? <InviteFlow busy={busy} errorMessage={inviteError ? 'Не удалось создать приглашение. Попробуйте ещё раз.' : null} hasError={hasError} onBack={goOverview} onCreate={async (role, inviteeDisplayName) => { try { await onCreateInvite({ role, inviteeDisplayName }); setView('invite-ready') } catch { /* FamilyScreen exposes the actionable error state. */ } }} onRefresh={onRefresh} /> : null}
      {!childProfileOpen && view === 'invite-ready' && inviteReady ? <InviteReady busy={busy} copyState={copyState} invite={inviteReady} onBack={() => setView('invite')} onClose={() => { onCloseInvite(); goOverview() }} onCopy={onCopyInvite} onShare={onShareInvite} /> : null}
    </div>
    <SettingsSheet hostBridge={hostBridge} onOpenChange={setSettingsOpen} open={settingsOpen} returnFocusRef={settingsTriggerRef} />
    {canLeaveFamily && view === 'overview' && !childProfileOpen ? <button className="family-leave-action" disabled={busy} onClick={() => { if (typeof window === 'undefined' || window.confirm('Выйти из семьи? Доступ к приватным материалам будет закрыт.')) void onLeaveFamily() }} type="button">Выйти из семьи</button> : null}
  </main>
}

function FamilyOverview({ family, child, childAvatarUrl, members, invites, usage, usageFailed, canInvite, hasError, theme, onOpenChild, onOpenSettings, onOpenInvite, onOpenMember, onInvite, onRefresh, onRefreshUsage, onRevokeInvite }: { family: FamilyResponse['family']; child: FamilyResponse['child']; members: FamilyMemberDto[]; invites: FamilyInviteDto[]; usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; canInvite: boolean; hasError: boolean; theme: MemolyTheme; childAvatarUrl: string | null; onOpenInvite: (invite: FamilyInviteDto) => void; onOpenChild: () => void; onOpenSettings: () => void; onOpenMember: (member: FamilyMemberDto) => void; onInvite: () => void; onRefresh: () => void; onRefreshUsage: () => void; onRevokeInvite: (invite: FamilyInviteDto) => Promise<void> }) {
  return <>
    <div className="family-child-header-stack">
      <ChildHeader childAvatarCrop={child?.avatarCrop ?? null} childAvatarUrl={childAvatarUrl} childName={child?.name ?? 'Ребёнок'} childSubtitle={child ? feedChildSubtitle(child.birthDate, family.timezone) : 'Профиль ребёнка'} mode="family" onOpenChild={child ? onOpenChild : undefined} onOpenSettings={onOpenSettings} theme={theme} />
      <div className="family-child-quote family-child-quote--extension">«Наше маленькое большое счастье»</div>
    </div>
    {hasError ? <div className="family-error"><InlineError onRetry={onRefresh} /></div> : null}
    <div className="family-section-head">{family.name} <span className="family-count">{members.length}</span></div>
    <div className="family-list">{members.map((member) => <FamilyMemberRow key={member.userId} member={member} onOpen={onOpenMember} />)}</div>
    {canInvite ? <button className="family-invite-btn" onClick={onInvite} type="button"><span className="family-invite-plus">+</span><span>Пригласить родственника</span></button> : null}
    {members.length > 0 && child ? <div className="family-info-card"><span className="family-info-icon"><WebpIcon decorative name="family" size={24} /></span><div><strong>Делитесь моментами с самыми близкими</strong>Пригласите родных, чтобы вместе сохранять воспоминания о {child.name}.</div></div> : null}
    {canInvite ? <PendingInvites invites={invites} onOpen={onOpenInvite} onRevoke={onRevokeInvite} /> : null}
    {usage ? <div className="family-usage"><strong>Семейный архив</strong><span>Использовано {formatBytes(usage.usedBytes)}{usage.quotaBytes ? ` из ${formatBytes(usage.quotaBytes)}` : ''}</span>{usage.quotaBytes ? <span aria-label="Использование архива" className="family-usage-bar"><i style={{ width: `${Math.min(100, usage.usedBytes / usage.quotaBytes * 100)}%` }} /></span> : null}</div> : null}
    {usageFailed ? <button className="family-inline-action" onClick={onRefreshUsage} type="button">Повторить загрузку объёма</button> : null}
  </>
}

function FamilyMemberRow({ member, onOpen }: { member: FamilyMemberDto; onOpen: (member: FamilyMemberDto) => void }) {
  const displayName = familyMemberName(member)
  const alias = member.familyDisplayName && member.familyDisplayName !== member.displayName ? member.displayName : null
  return <button aria-label={`Открыть участника: ${displayName}`} className="family-member-row" onClick={() => onOpen(member)} type="button"><AvatarLetter className="family-member-avatar" name={displayName} size="lg" /><span className="family-member-copy"><strong>{displayName}</strong>{alias ? <span>{alias}</span> : null}</span><span className={`family-role${member.role === 'viewer' && !member.isOwner ? ' viewer' : ''}`}>{roleLabel(member.role, member.isOwner)}</span><span aria-hidden="true" className="family-row-more">•••</span></button>
}

function PendingInvites({ invites, onOpen, onRevoke }: { invites: FamilyInviteDto[]; onOpen: (invite: FamilyInviteDto) => void; onRevoke: (invite: FamilyInviteDto) => Promise<void> }) {
  if (invites.length === 0) return null
  return <section className="family-pending"><h3>Ожидают приглашение</h3>{invites.map((invite) => { const name = invite.inviteeDisplayName ?? 'Новое приглашение'; return <div className="family-pending-row" key={invite.id}><button aria-label={`Открыть приглашение: ${name}`} className="family-pending-open" onClick={() => onOpen(invite)} type="button"><span><strong>{name}</strong><small>{invite.role === 'full' ? 'Полный доступ' : 'Просмотр'} · до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}</small></span><span aria-hidden="true">›</span></button><button onClick={() => void onRevoke(invite)} type="button">Отозвать</button></div> })}</section>
}

function PendingInviteDetails({ busy, invite, onBack, onRevoke }: { busy: boolean; invite: FamilyInviteDto; onBack: () => void; onRevoke: (invite: FamilyInviteDto) => Promise<void> }) {
  const name = invite.inviteeDisplayName ?? 'Новое приглашение'
  return <section aria-label="Детали приглашения" className="family-detail-screen"><div className="family-titlebar"><button aria-label="Назад к семье" className="family-round-btn family-back-btn" onClick={onBack} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button><div className="family-page-title">Приглашение</div><span aria-hidden="true" className="family-more">•••</span></div><div className="family-profile"><AvatarLetter className="family-profile-avatar" name={name} size="xl" /><div className="family-profile-name">{name}</div><div className="family-profile-kin">Ожидает приглашение</div><span className={`family-profile-role${invite.role === 'viewer' ? ' viewer' : ''}`}>{roleLabel(invite.role, false)}</span></div><div className="family-member-actions"><h3>Приглашение</h3><div className="family-permission">Действует до {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}</div><button className="family-remove-action" disabled={busy} onClick={() => void onRevoke(invite)} type="button">Отозвать</button></div></section>
}

function formatBytes(value: number) { if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`; return `${(value / 1024 / 1024).toFixed(1)} МБ` }
