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
import { FamilySettingsPage } from './FamilySettingsPage'
import { FamilyArchivePage } from './FamilyArchivePage'
import { FamilyInvitesPage } from './FamilyInvitesPage'
import { FamilyLeavePage } from './FamilyLeavePage'
import type { FamilySettingsChange } from './family-settings-model'
import { presentSelfNameOverride, serverConfirmsSelfName, type SelfNameOverride } from './member-profile-model'

export type FamilyMemberActions = { canEditAlias: boolean; canManageRole: boolean; canRemove: boolean }
export type FamilyPresentationProps = {
  familyResponse: FamilyResponse; hostBridge: Pick<HostBridge, 'onBack'>; invites: FamilyInviteDto[]; members: FamilyMemberDto[]; childAvatarUrl: string | null
  currentUserId: string
  usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; inviteReady: { url: string; expiresAt: string; inviteeDisplayName?: string } | null
  copyState: 'idle' | 'copied' | 'failed'; busy: boolean; hasError?: boolean; inviteError?: boolean; canInvite: boolean; canEditChild: boolean; canLeaveFamily: boolean; canManageFamily: boolean; childProfileOpen: boolean
  memberActions: Record<string, FamilyMemberActions>; onRefresh: () => void; onRefreshUsage: () => void; onEditChild: () => void; onChangeChildPhoto: () => void; onOpenChild: () => void; onCloseChild: () => void
  onCreateInvite: (input: { role: 'viewer' | 'full'; inviteeDisplayName?: string }) => Promise<void>; onCopyInvite: () => Promise<void>; onShareInvite: () => Promise<void>
  onCloseInvite: () => void; onRevokeInvite: (invite: FamilyInviteDto) => Promise<void>; onUpdateMember: (member: FamilyMemberDto, input: { familyDisplayName?: string | null; role?: 'full' | 'viewer' }) => Promise<void>
  onRemoveMember: (member: FamilyMemberDto) => Promise<void>; onLeaveFamily: () => Promise<void>
  onUpdateFamily: (input: FamilySettingsChange) => Promise<void>
}
type FamilyView = 'overview' | 'member' | 'invite' | 'invite-ready' | 'family-settings' | 'archive' | 'invites' | 'leave-confirm'

export function FamilyPresentation({ familyResponse, hostBridge, invites, members, currentUserId, childAvatarUrl, usage, usageFailed, inviteReady, copyState, busy, hasError = false, inviteError = false, canInvite, canEditChild, canLeaveFamily, canManageFamily, childProfileOpen, memberActions, onRefresh, onRefreshUsage, onEditChild, onChangeChildPhoto, onOpenChild, onCloseChild, onCreateInvite, onCopyInvite, onShareInvite, onCloseInvite, onRevokeInvite, onUpdateMember, onRemoveMember, onLeaveFamily, onUpdateFamily }: FamilyPresentationProps) {
  const [view, setView] = useState<FamilyView>('overview')
  const [selectedMember, setSelectedMember] = useState<FamilyMemberDto | null>(null)
  const [inviteReturnView, setInviteReturnView] = useState<'overview' | 'invites'>('overview')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ageDetailsOpen, setAgeDetailsOpen] = useState(false)
  const [selfNameOverride, setSelfNameOverride] = useState<SelfNameOverride | null>(null)
  const settingsTriggerRef = useRef<HTMLElement | null>(null)
  const { theme } = useMemolyTheme()
  const child = familyResponse.child
  const liveSelf = members.find((member) => member.userId === currentUserId)
  const presentedMembers = presentSelfNameOverride(members, currentUserId, selfNameOverride)
  const currentSelectedMember = selectedMember ? presentedMembers.find((member) => member.userId === selectedMember.userId) ?? null : null
  useEffect(() => {
    // The member query is external state. Release the optimistic row name only once it confirms this save.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (serverConfirmsSelfName(members, currentUserId, selfNameOverride)) setSelfNameOverride(null)
  }, [currentUserId, members, selfNameOverride])
  const openSettings = () => { if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) settingsTriggerRef.current = document.activeElement; setView('overview'); setSelectedMember(null); setSettingsOpen(true) }
  const goOverview = () => { setView('overview'); setSelectedMember(null) }
  const goInviteSource = () => setView(inviteReturnView)
  useEffect(() => {
    if (view === 'overview' && !childProfileOpen) return undefined
    return hostBridge.onBack(() => {
      if (childProfileOpen) {
        if (ageDetailsOpen) setAgeDetailsOpen(false)
        else onCloseChild()
        return
      }
      if (view === 'invite-ready') onCloseInvite()
      if (view === 'invite' || view === 'invite-ready') setView(inviteReturnView)
      else if (view === 'family-settings' || view === 'archive') { goOverview(); setSettingsOpen(true) }
      else goOverview()
    })
  }, [ageDetailsOpen, childProfileOpen, hostBridge, inviteReturnView, onCloseChild, onCloseInvite, view])
  return <main className={`ml-family-content family-screen${childProfileOpen ? ' child-screen' : ''}`} data-slot="family-presentation">
    <h1 className="sr-only">{childProfileOpen ? 'Профиль ребёнка' : 'Семья'}</h1>
    <div className={childProfileOpen ? 'child-shell' : 'family-shell'}>
      {childProfileOpen && child ? <ChildProfile avatarUrl={childAvatarUrl} canEdit={canEditChild} child={child} familyTimezone={familyResponse.family.timezone} onBack={() => { if (ageDetailsOpen) setAgeDetailsOpen(false); else onCloseChild() }} onEdit={onEditChild} onChangePhoto={onChangeChildPhoto} onOpenAge={() => setAgeDetailsOpen(true)} showAgeDetails={ageDetailsOpen} /> : null}
      {!childProfileOpen && view === 'overview' ? <FamilyOverview canInvite={canInvite} child={child} childAvatarUrl={childAvatarUrl} family={familyResponse.family} hasError={hasError} invites={invites} members={presentedMembers} onOpenChild={() => { setAgeDetailsOpen(false); onOpenChild() }} onInvite={() => { setInviteReturnView('overview'); setView('invite') }} onOpenInvites={() => setView('invites')} onOpenMember={(member) => { setSelectedMember(member); setView('member') }} onOpenSettings={openSettings} onRefresh={onRefresh} onRefreshUsage={onRefreshUsage} theme={theme} usage={usage} usageFailed={usageFailed} /> : null}
      {!childProfileOpen && view === 'member' && currentSelectedMember ? <MemberProfile key={`${currentSelectedMember.userId}:${currentSelectedMember.role}:${currentSelectedMember.familyDisplayName ?? ''}`} actions={memberActions[currentSelectedMember.userId] ?? { canEditAlias: false, canManageRole: false, canRemove: false }} busy={busy} currentUserId={currentUserId} member={currentSelectedMember} onAccountNameSaved={(name) => setSelfNameOverride({ value: name, baseline: liveSelf?.displayName ?? null })} onBack={goOverview} onRefresh={onRefresh} onRemove={onRemoveMember} onSave={onUpdateMember} /> : null}
      {!childProfileOpen && view === 'family-settings' && canManageFamily ? <FamilySettingsPage key={`${familyResponse.family.name}:${familyResponse.family.timezone}`} busy={busy} family={familyResponse.family} onBack={() => { goOverview(); setSettingsOpen(true) }} onRefresh={onRefresh} onSave={onUpdateFamily} /> : null}
      {!childProfileOpen && view === 'archive' ? <FamilyArchivePage onBack={() => { goOverview(); setSettingsOpen(true) }} onRefresh={onRefreshUsage} usage={usage} usageFailed={usageFailed} /> : null}
      {!childProfileOpen && view === 'invites' && canInvite ? <FamilyInvitesPage busy={busy} invites={invites} onBack={goOverview} onInvite={() => { setInviteReturnView('invites'); setView('invite') }} onRevoke={onRevokeInvite} /> : null}
      {!childProfileOpen && view === 'leave-confirm' && canLeaveFamily ? <FamilyLeavePage busy={busy} onBack={goOverview} onLeave={onLeaveFamily} /> : null}
      {!childProfileOpen && view === 'invite' ? <InviteFlow busy={busy} errorMessage={inviteError ? 'Не удалось создать приглашение. Попробуйте ещё раз.' : null} hasError={hasError} onBack={goInviteSource} onCreate={async (role, inviteeDisplayName) => { try { await onCreateInvite({ role, inviteeDisplayName }); setView('invite-ready') } catch { /* FamilyScreen exposes the actionable error state. */ } }} onRefresh={onRefresh} /> : null}
      {!childProfileOpen && view === 'invite-ready' && inviteReady ? <InviteReady busy={busy} copyState={copyState} invite={inviteReady} onBack={() => setView('invite')} onClose={() => { onCloseInvite(); goInviteSource() }} onCopy={onCopyInvite} onShare={onShareInvite} /> : null}
    </div>
    <SettingsSheet canManageFamily={canManageFamily} hostBridge={hostBridge} onArchive={() => setView('archive')} onFamilySettings={() => setView('family-settings')} onOpenChange={setSettingsOpen} open={settingsOpen} returnFocusRef={settingsTriggerRef} />
    {canLeaveFamily && view === 'overview' && !childProfileOpen ? <button className="family-leave-action" disabled={busy} onClick={() => setView('leave-confirm')} type="button">Выйти из семьи</button> : null}
  </main>
}

function FamilyOverview({ family, child, childAvatarUrl, members, invites, usage, usageFailed, canInvite, hasError, theme, onOpenChild, onOpenSettings, onOpenInvites, onOpenMember, onInvite, onRefresh, onRefreshUsage }: { family: FamilyResponse['family']; child: FamilyResponse['child']; members: FamilyMemberDto[]; invites: FamilyInviteDto[]; usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; canInvite: boolean; hasError: boolean; theme: MemolyTheme; childAvatarUrl: string | null; onOpenChild: () => void; onOpenSettings: () => void; onOpenMember: (member: FamilyMemberDto) => void; onOpenInvites: () => void; onInvite: () => void; onRefresh: () => void; onRefreshUsage: () => void }) {
  return <>
    <ChildHeader childAvatarCrop={child?.avatarCrop ?? null} childAvatarUrl={childAvatarUrl} childName={child?.name ?? 'Ребёнок'} childSubtitle={child ? feedChildSubtitle(child.birthDate, family.timezone) : 'Профиль ребёнка'} mode="family" onOpenChild={child ? onOpenChild : undefined} onOpenSettings={onOpenSettings} theme={theme} />
    {hasError ? <div className="family-error"><InlineError onRetry={onRefresh} /></div> : null}
    <div className="family-section-head">{family.name} <span className="family-count">{members.length}</span></div>
    <div className="family-list">{members.map((member) => <FamilyMemberRow key={member.userId} member={member} onOpen={onOpenMember} />)}</div>
    {canInvite ? <button className="family-invite-btn" onClick={onInvite} type="button"><span className="family-invite-plus">+</span><span>Пригласить родственника</span></button> : null}
    {members.length > 0 && child ? <div className="family-info-card"><span className="family-info-icon"><WebpIcon decorative name="family" size={24} /></span><div><strong>Делитесь моментами с самыми близкими</strong>Пригласите родных, чтобы вместе сохранять воспоминания о {child.name}.</div></div> : null}
    {canInvite ? <button className="family-management-invites-link" onClick={onOpenInvites} type="button"><span><WebpIcon decorative name="info" size={22} /></span><span><strong>Активные приглашения</strong><small>{invites.length === 0 ? 'Нет активных ссылок' : `${invites.length} ${invites.length === 1 ? 'ссылка ожидает' : 'ссылки ожидают'} вступления`}</small></span>{invites.length > 0 ? <b>{invites.length}</b> : null}<span aria-hidden="true">›</span></button> : null}
    {usage ? <div className="family-usage"><strong>Семейный архив</strong><span>Использовано {formatBytes(usage.usedBytes)}{usage.quotaBytes ? ` из ${formatBytes(usage.quotaBytes)}` : ''}</span>{usage.quotaBytes ? <span aria-hidden="true" className="family-usage-bar"><i style={{ width: `${Math.min(100, usage.usedBytes / usage.quotaBytes * 100)}%` }} /></span> : null}</div> : null}
    {usageFailed ? <button className="family-inline-action" onClick={onRefreshUsage} type="button">Повторить загрузку объёма</button> : null}
  </>
}

function FamilyMemberRow({ member, onOpen }: { member: FamilyMemberDto; onOpen: (member: FamilyMemberDto) => void }) {
  const displayName = familyMemberName(member)
  const alias = member.familyDisplayName && member.familyDisplayName !== member.displayName ? member.displayName : null
  return <button aria-label={`Открыть участника: ${displayName}`} className="family-member-row" onClick={() => onOpen(member)} type="button"><AvatarLetter className="family-member-avatar" name={displayName} size="lg" /><span className="family-member-copy"><strong>{displayName}</strong>{alias ? <span>{alias}</span> : null}</span><span className={`family-role${member.role === 'viewer' && !member.isOwner ? ' viewer' : ''}`}>{roleLabel(member.role, member.isOwner)}</span><span aria-hidden="true" className="family-row-more">•••</span></button>
}

function formatBytes(value: number) { if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`; return `${(value / 1024 / 1024).toFixed(1)} МБ` }
