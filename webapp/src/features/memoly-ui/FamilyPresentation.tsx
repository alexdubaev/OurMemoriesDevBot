/* eslint-disable typographyPolicy/use-typography-component -- faithful static HTML port keeps canonical semantic hierarchy. */
import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ChildHeader } from '@/components/ChildHeader'
import { WebpIcon } from '@/components/WebpIcon'
import { InlineError } from '@/features/feed'
import { ChildProfile, familyMemberName, feedChildSubtitle, InviteFlow, InviteReady, roleLabel } from '@/features/family'
import { MemberAvatarImage } from '@/features/avatar'
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
import './family-management.css'

export type FamilyMemberActions = { canEditAlias: boolean; canManageRole: boolean; canRemove: boolean }
export type FamilyPresentationProps = {
  active?: boolean
  familyResponse: FamilyResponse; hostBridge: Pick<HostBridge, 'onBack'>; invites: FamilyInviteDto[]; members: FamilyMemberDto[]; childAvatarUrl: string | null
  currentUserId: string
  maxChannelStatus: import('@web-app-demo/contracts').FamilyMaxChannelStatus | null; maxChannelLoading: boolean; maxChannelError: boolean; canManageMaxChannel: boolean; onRetryMaxChannel: () => void
  usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; inviteReady: { url: string; expiresAt: string; inviteeDisplayName?: string } | null
  copyState: 'idle' | 'copied' | 'failed'; busy: boolean; hasError?: boolean; inviteError?: boolean; savedRefreshFailed?: boolean; canInvite: boolean; canEditChild: boolean; canLeaveFamily: boolean; canManageFamily: boolean; childProfileOpen: boolean
  memberActions: Record<string, FamilyMemberActions>; onRefresh: () => void; onRefreshUsage: () => void; onEditChild: () => void; onChangeChildPhoto: () => void; onOpenChild: () => void; onCloseChild: () => void
  onCreateInvite: (input: { role: 'viewer' | 'full'; inviteeDisplayName?: string; idempotencyKey?: string }) => Promise<void>; onCopyInvite: () => Promise<void>; onShareInvite: () => Promise<void>
  onCloseInvite: () => void; onRevokeInvite: (invite: FamilyInviteDto) => Promise<void>; onUpdateMember: (member: FamilyMemberDto, input: { familyDisplayName?: string | null; role?: 'full' | 'viewer' }) => Promise<void>
  onAllFamilies?: () => void
  onRemoveMember: (member: FamilyMemberDto) => Promise<void>; onLeaveFamily: () => Promise<void>
  onUpdateFamily: (input: FamilySettingsChange) => Promise<void>
  canOpenInstall: boolean; installLabel?: string; onOpenInstall: () => void
  settingsRequest?: number
  onSettingsRequestHandled?: () => void
}
type FamilyView = 'overview' | 'member' | 'invite' | 'invite-ready' | 'family-settings' | 'archive' | 'invites' | 'leave-confirm'

export function FamilyPresentation({ active = true, familyResponse, hostBridge, invites, members, currentUserId, childAvatarUrl, usage, usageFailed, inviteReady, copyState, busy, hasError = false, inviteError = false, savedRefreshFailed = false, canInvite, canEditChild, canLeaveFamily, canManageFamily, childProfileOpen, memberActions, maxChannelStatus, maxChannelLoading, maxChannelError, canManageMaxChannel, onRetryMaxChannel, onRefresh, onRefreshUsage, onEditChild, onChangeChildPhoto, onOpenChild, onCloseChild, onAllFamilies, onCreateInvite, onCopyInvite, onShareInvite, onCloseInvite, onRevokeInvite, onUpdateMember, onRemoveMember, onLeaveFamily, onUpdateFamily, canOpenInstall, installLabel, onOpenInstall, settingsRequest, onSettingsRequestHandled }: FamilyPresentationProps) {
  const [view, setView] = useState<FamilyView>('overview')
  const [selectedMember, setSelectedMember] = useState<FamilyMemberDto | null>(null)
  const [inviteReturnView, setInviteReturnView] = useState<'overview' | 'invites'>('overview')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ageDetailsOpen, setAgeDetailsOpen] = useState(false)
  const [selfNameOverride, setSelfNameOverride] = useState<SelfNameOverride | null>(null)
  const settingsTriggerRef = useRef<HTMLElement | null>(null)
  const consumedSettingsRequest = useRef(0)
  const { theme } = useMemolyTheme()
  useEffect(() => {
    if (active) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Close the portal as soon as its kept-alive surface becomes inactive.
    setSettingsOpen(false)
    setAgeDetailsOpen(false)
  }, [active])
  const child = familyResponse.child
  const liveSelf = members.find((member) => member.userId === currentUserId)
  const presentedMembers = presentSelfNameOverride(members, currentUserId, selfNameOverride)
  const currentSelectedMember = selectedMember ? presentedMembers.find((member) => member.userId === selectedMember.userId) ?? null : null
  useEffect(() => {
    // The member query is external state. Release the optimistic row name only once it confirms this save.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (serverConfirmsSelfName(members, currentUserId, selfNameOverride)) setSelfNameOverride(null)
  }, [currentUserId, members, selfNameOverride])
  const openSettings = useCallback((requestTrigger?: HTMLElement | null) => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      const activeTrigger = document.activeElement.closest('[data-navigation-surface="family"]') ? document.activeElement : null
      settingsTriggerRef.current = requestTrigger ?? activeTrigger
    }
    setView('overview')
    setSelectedMember(null)
    setSettingsOpen(true)
  }, [])
  useEffect(() => {
    if (!settingsRequest) {
      consumedSettingsRequest.current = 0
      return
    }
    if (!active || settingsRequest <= consumedSettingsRequest.current) return
    consumedSettingsRequest.current = settingsRequest
    const trigger = document.querySelector<HTMLElement>('[data-navigation-surface="family"] .ui-v2-settings')
    openSettings(trigger)
    onSettingsRequestHandled?.()
  }, [active, onSettingsRequestHandled, openSettings, settingsRequest])
  const goOverview = () => { setView('overview'); setSelectedMember(null) }
  const goInviteSource = () => setView(inviteReturnView)
  useEffect(() => {
    if (!active || view === 'overview' && !childProfileOpen) return undefined
    return hostBridge.onBack(() => {
      if (view === 'invite' && busy) return
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
  }, [active, ageDetailsOpen, busy, childProfileOpen, hostBridge, inviteReturnView, onCloseChild, onCloseInvite, view])
  return <main className={`ml-family-content family-screen${childProfileOpen ? ' child-screen' : ''}`} data-slot="family-presentation">
    <h1 className="sr-only">{childProfileOpen ? 'Профиль ребёнка' : 'Семья'}</h1>
    {savedRefreshFailed ? <div className="family-error" role="alert"><p>Изменение сохранено, но данные семьи не удалось обновить. Повторите только обновление данных.</p><button onClick={onRefresh} type="button">Обновить данные</button></div> : null}
    <div className={childProfileOpen ? 'child-shell' : view === 'overview' ? 'family-overview-host' : 'family-shell'}>
      {childProfileOpen && child ? <ChildProfile avatarUrl={childAvatarUrl} canEdit={canEditChild} child={child} familyTimezone={familyResponse.family.timezone} onBack={() => { if (ageDetailsOpen) setAgeDetailsOpen(false); else onCloseChild() }} onEdit={onEditChild} onChangePhoto={onChangeChildPhoto} onOpenAge={() => setAgeDetailsOpen(true)} showAgeDetails={ageDetailsOpen} /> : null}
      {!childProfileOpen && view === 'overview' ? <FamilyOverview canInvite={canInvite} canManageMaxChannel={canManageMaxChannel} currentUserId={currentUserId} maxChannelError={maxChannelError} maxChannelLoading={maxChannelLoading} maxChannelStatus={maxChannelStatus} onRetryMaxChannel={onRetryMaxChannel} child={child} childAvatarUrl={childAvatarUrl} family={familyResponse.family} hasError={hasError} invites={invites} members={presentedMembers} onAllFamilies={onAllFamilies} onOpenChild={() => { setAgeDetailsOpen(false); onOpenChild() }} onInvite={() => { setInviteReturnView('overview'); setView('invite') }} onOpenInvites={() => setView('invites')} onOpenMember={(member) => { setSelectedMember(member); setView('member') }} onOpenSettings={openSettings} onRefresh={onRefresh} onRefreshUsage={onRefreshUsage} theme={theme} usage={usage} usageFailed={usageFailed} /> : null}
      {!childProfileOpen && view === 'member' && currentSelectedMember ? <MemberProfile key={`${currentSelectedMember.userId}:${currentSelectedMember.role}:${currentSelectedMember.familyDisplayName ?? ''}`} actions={memberActions[currentSelectedMember.userId] ?? { canEditAlias: false, canManageRole: false, canRemove: false }} busy={busy} currentUserId={currentUserId} member={currentSelectedMember} onAccountNameSaved={(name) => setSelfNameOverride({ value: name, baseline: liveSelf?.displayName ?? null })} onBack={goOverview} onRefresh={onRefresh} onRemove={onRemoveMember} onSave={onUpdateMember} /> : null}
      {!childProfileOpen && view === 'family-settings' && canManageFamily ? <FamilySettingsPage key={`${familyResponse.family.name}:${familyResponse.family.timezone}`} busy={busy} family={familyResponse.family} onBack={() => { goOverview(); setSettingsOpen(true) }} onRefresh={onRefresh} onSave={onUpdateFamily} /> : null}
      {!childProfileOpen && view === 'archive' ? <FamilyArchivePage onBack={() => { goOverview(); setSettingsOpen(true) }} onRefresh={onRefreshUsage} usage={usage} usageFailed={usageFailed} /> : null}
      {!childProfileOpen && view === 'invites' && canInvite ? <FamilyInvitesPage busy={busy} invites={invites} onBack={goOverview} onInvite={() => { setInviteReturnView('invites'); setView('invite') }} onRevoke={onRevokeInvite} /> : null}
      {!childProfileOpen && view === 'leave-confirm' && canLeaveFamily ? <FamilyLeavePage busy={busy} onBack={goOverview} onLeave={onLeaveFamily} /> : null}
      {!childProfileOpen && view === 'invite' ? <InviteFlow busy={busy} errorMessage={inviteError ? 'Не удалось создать приглашение. Попробуйте ещё раз.' : null} hasError={hasError} onBack={goInviteSource} onCreate={async (role, inviteeDisplayName, idempotencyKey) => { try { await onCreateInvite({ role, inviteeDisplayName, idempotencyKey }); setView('invite-ready') } catch { /* FamilyScreen exposes the actionable error state. */ } }} onRefresh={onRefresh} /> : null}
      {!childProfileOpen && view === 'invite-ready' && inviteReady ? <InviteReady busy={busy} copyState={copyState} invite={inviteReady} onBack={() => setView('invite')} onClose={() => { onCloseInvite(); goInviteSource() }} onCopy={onCopyInvite} onShare={onShareInvite} /> : null}
    </div>
    <SettingsSheet canManageFamily={canManageFamily} canOpenInstall={canOpenInstall} installLabel={installLabel} hostBridge={hostBridge} onArchive={() => setView('archive')} onFamilySettings={() => setView('family-settings')} onOpenChange={setSettingsOpen} onOpenInstall={onOpenInstall} open={active && settingsOpen} returnFocusRef={active ? settingsTriggerRef : undefined} />
    {canLeaveFamily && view === 'overview' && !childProfileOpen ? <button className="family-leave-action" disabled={busy} onClick={() => setView('leave-confirm')} type="button">Выйти из семьи</button> : null}
  </main>
}

function FamilyOverview({ family, child, childAvatarUrl, members, invites, usage, usageFailed, canInvite, hasError, theme, currentUserId, canManageMaxChannel, maxChannelStatus, maxChannelLoading, maxChannelError, onRetryMaxChannel, onAllFamilies, onOpenChild, onOpenSettings, onOpenInvites, onOpenMember, onInvite, onRefresh, onRefreshUsage }: { family: FamilyResponse['family']; child: FamilyResponse['child']; members: FamilyMemberDto[]; invites: FamilyInviteDto[]; currentUserId: string; usage: { usedBytes: number; quotaBytes: number | null } | null; usageFailed: boolean; canInvite: boolean; hasError: boolean; theme: MemolyTheme; childAvatarUrl: string | null; maxChannelStatus: import('@web-app-demo/contracts').FamilyMaxChannelStatus | null; maxChannelLoading: boolean; maxChannelError: boolean; canManageMaxChannel: boolean; onRetryMaxChannel: () => void; onAllFamilies?: () => void; onOpenChild: () => void; onOpenSettings: () => void; onOpenMember: (member: FamilyMemberDto) => void; onOpenInvites: () => void; onInvite: () => void; onRefresh: () => void; onRefreshUsage: () => void }) {
  return <>
    <ChildHeader childAvatarCrop={child?.avatarCrop ?? null} childAvatarUrl={childAvatarUrl} childName={child?.name ?? 'Ребёнок'} childSubtitle={child ? feedChildSubtitle(child.birthDate, family.timezone) : 'Профиль ребёнка'} mode="family" onAllFamilies={onAllFamilies} onOpenChild={child ? onOpenChild : undefined} onOpenSettings={onOpenSettings} theme={theme} />
    <div className="family-shell family-overview-body">
    {hasError ? <div className="family-error"><InlineError onRetry={onRefresh} /></div> : null}
    <div className="family-section-head"><h2>Ваши близкие</h2><span className="family-count">{formatMemberCount(members.length)}</span></div>
    <div className="family-list">{members.map((member) => <FamilyMemberRow key={member.userId} currentUserId={currentUserId} member={member} onOpen={onOpenMember} />)}</div>
    {canInvite ? <button className="family-invite-btn" onClick={onInvite} type="button"><span className="family-invite-plus">+</span><span>Пригласить родственника</span></button> : null}
    <FamilyMaxChannelCard canManage={canManageMaxChannel} error={maxChannelError} loading={maxChannelLoading} onRetry={onRetryMaxChannel} status={maxChannelStatus} />
    <p className="family-overview-privacy-note">Фото, видео и истории видны только участникам семьи.</p>
    {canInvite ? <button className="family-management-invites-link" onClick={onOpenInvites} type="button"><span><WebpIcon decorative name="info" size={22} /></span><span><strong>Активные приглашения</strong><small>{invites.length === 0 ? 'Нет активных ссылок' : `${invites.length} ${invites.length === 1 ? 'ссылка ожидает' : 'ссылки ожидают'} вступления`}</small></span>{invites.length > 0 ? <b>{invites.length}</b> : null}<span aria-hidden="true">›</span></button> : null}
    {usage ? <div className="family-usage"><strong>Семейный архив</strong><span>Использовано {formatBytes(usage.usedBytes)}{usage.quotaBytes ? ` из ${formatBytes(usage.quotaBytes)}` : ''}</span>{usage.quotaBytes ? <span aria-hidden="true" className="family-usage-bar"><i style={{ width: `${Math.min(100, usage.usedBytes / usage.quotaBytes * 100)}%` }} /></span> : null}</div> : null}
    {usageFailed ? <button className="family-inline-action" onClick={onRefreshUsage} type="button">Повторить загрузку объёма</button> : null}
    </div>
  </>
}

export function FamilyMaxChannelCard({ status, loading, error, canManage, onRetry }: { status: import('@web-app-demo/contracts').FamilyMaxChannelStatus | null; loading: boolean; error: boolean; canManage: boolean; onRetry: () => void }) {
  return <section aria-labelledby="family-max-channel-title" className="family-max-channel" data-slot="family-max-channel">
    <h2 id="family-max-channel-title">Семейный канал MAX</h2>
    <div className="family-max-channel-row"><img alt="" className="family-max-channel-logo" height="33" src="/assets/ui-v2/brand/max-colored-66.webp" srcSet="/assets/ui-v2/brand/max-colored-66.webp 2x, /assets/ui-v2/brand/max-colored-99.webp 3x" width="33" />{loading ? <p role="status">Загружаем состояние канала…</p> : error ? <div><p role="alert">Не удалось загрузить состояние канала.</p><button onClick={onRetry} type="button">Повторить</button></div> : status?.state === 'connected' ? <p><strong>{status.title || 'Канал'}</strong><span>Подключён</span></p> : status?.state === 'unconfigured' ? <p>{canManage ? 'Добавьте memoLy-бота администратором вашего канала' : 'Канал пока не подключён'}</p> : status?.state === 'disconnected' ? <p>Бот удалён из канала</p> : status?.state === 'permission_problem' ? <p>{canManage ? 'Нужно вернуть права администратора' : 'Нужно вернуть права администратора'}</p> : <div><p role="alert">Не удалось загрузить состояние канала.</p><button onClick={onRetry} type="button">Повторить</button></div>}</div>
  </section>
}

function FamilyMemberRow({ member, currentUserId, onOpen }: { member: FamilyMemberDto; currentUserId: string; onOpen: (member: FamilyMemberDto) => void }) {
  const displayName = familyMemberName(member)
  const isCurrentUser = member.userId === currentUserId
  const accountName = member.displayName && member.displayName !== displayName ? member.displayName : null
  return <button aria-label={`Открыть участника: ${displayName}`} className="family-member-row" onClick={() => onOpen(member)} type="button"><MemberAvatarImage avatarPath={member.avatarPath} avatarCrop={member.avatarCrop} className="family-member-avatar" name={displayName} size="lg" /><span className="family-member-copy"><strong>{displayName}</strong>{isCurrentUser ? <span>Вы</span> : accountName ? <span>{accountName}</span> : null}</span><span className={`family-role${member.role === 'viewer' && !member.isOwner ? ' viewer' : ''}`}>{roleLabel(member.role, member.isOwner)}</span></button>
}

function formatBytes(value: number) { if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`; return `${(value / 1024 / 1024).toFixed(1)} МБ` }
function formatMemberCount(count: number) { const lastTwo = count % 100; const last = count % 10; const noun = lastTwo >= 11 && lastTwo <= 14 ? 'человек' : last === 1 ? 'человек' : last >= 2 && last <= 4 ? 'человека' : 'человек'; return `${count} ${noun}` }
