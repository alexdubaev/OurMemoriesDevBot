import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { BottomNavigation } from '@/components/BottomNavigation'
import { FamilyPresentation, type FamilyMemberActions } from '@/features/memoly-ui'
import type { AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/host-bridge'
import { createInvite, leaveFamily, loadFamilyUsage, revokeInvite, updateFamily, updateFamilyMember } from './api'
import { createInviteResult } from './invite-result'
import { canManageFamilyMaxChannel, useFamilyMaxChannelStatus } from './useFamilyMaxChannelStatus'

type FamilyRefreshOptions = { failureMode?: 'global' | 'throw' }

export function FamilyScreen({
  active = true,
  familyResponse,
  childAvatar,
  invites,
  members,
  transport,
  hostBridge,
  currentUserId,
  onAdd,
  onAllFamilies,
  onEditChild,
  settingsRequest,
  onSettingsRequestHandled,
  onFeed,
  onRefresh,
  createInviteLink,
  canOpenInstall = false,
  installLabel,
  onOpenInstall = () => undefined,
}: {
  active?: boolean
  familyResponse: FamilyResponse
  childAvatar?: { url: string | null; status: 'absent' | 'loading' | 'ready' | 'error' }
  invites: FamilyInviteDto[]
  members: FamilyMemberDto[]
  transport: AuthenticatedTransport
  hostBridge: Pick<HostBridge, 'onBack'>
  currentUserId: string
  onAdd: () => void
  onAllFamilies?: () => void
  onEditChild: () => void
  settingsRequest?: number
  onSettingsRequestHandled?: () => void
  onFeed: () => void
  onRefresh: (options?: FamilyRefreshOptions) => Promise<void>
  createInviteLink: (rawToken: string) => string | null
  canOpenInstall?: boolean
  installLabel?: string
  onOpenInstall?: () => void
}) {
  const [error, setError] = useState<Error | null>(null)
  const [savedRefreshFailed, setSavedRefreshFailed] = useState(false)
  const [inviteError, setInviteError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [inviteReady, setInviteReady] = useState<{ url: string; expiresAt: string; inviteeDisplayName?: string } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [now, setNow] = useState(() => Date.now())
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number | null } | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
  const current = members.find((member) => member.userId === currentUserId)
  const isOwner = current?.isOwner === true
  const child = familyResponse.child
  const displayedChildAvatar = childAvatar ?? { url: null, status: child?.avatarMediaId ? 'loading' as const : 'absent' as const }
  const canInvite = (isOwner || current?.role === 'full') && child?.isComplete === true
  const maxChannel = useFamilyMaxChannelStatus(transport, familyResponse.family.id, currentUserId, current?.role ?? null)
  const canManageMaxChannel = canManageFamilyMaxChannel(current?.role ?? null, maxChannel.status)
  const activeInvites = useMemo(() => invites.filter((invite) => Date.parse(invite.expiresAt) > now), [invites, now])

  useEffect(() => {
    const refreshClock = () => setNow(Date.now())
    const nextExpiry = activeInvites.reduce<number | null>((next, invite) => {
      const expiry = Date.parse(invite.expiresAt)
      return next === null || expiry < next ? expiry : next
    }, null)
    const timer = nextExpiry === null ? null : window.setTimeout(refreshClock, Math.max(0, nextExpiry - Date.now()))
    document.addEventListener('visibilitychange', refreshClock)
    window.addEventListener('online', refreshClock)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', refreshClock)
      window.removeEventListener('online', refreshClock)
    }
  }, [activeInvites, now])

  const refreshUsage = useCallback(() => void loadFamilyUsage(transport, familyResponse.family.id).then((next) => {
    setUsage(next)
    setUsageFailed(false)
  }).catch(() => setUsageFailed(true)), [familyResponse.family.id, transport])

  useEffect(() => { if (active) refreshUsage() }, [active, refreshUsage])

  async function run(action: () => Promise<unknown>, throwOnError = false) {
    setBusy(true)
    setError(null)
    setSavedRefreshFailed(false)
    try {
      try {
        await action()
      } catch (reason) {
        setError(reason instanceof Error ? reason : new Error('Не удалось обновить семью.'))
        if (throwOnError) throw reason
        return
      }
      try {
        await onRefresh({ failureMode: 'throw' })
        setSavedRefreshFailed(false)
      } catch (reason) {
        const refreshError = new Error('Изменение сохранено, но данные семьи не удалось обновить.', { cause: reason })
        setError(refreshError)
        setSavedRefreshFailed(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const memberActions: Record<string, FamilyMemberActions> = Object.fromEntries(members.map((member) => [
    member.userId,
    {
      canEditAlias: !member.isOwner && (isOwner || current?.role === 'full'),
      canManageRole: isOwner && !member.isOwner,
      canRemove: isOwner && !member.isOwner,
    },
  ]))

  return (
    <div className="ml-page">
      <FamilyPresentation
          active={active}
          busy={busy}
          canEditChild={isOwner}
          canInvite={canInvite}
          canLeaveFamily={Boolean(current && !isOwner)}
        canManageFamily={isOwner}
        canOpenInstall={canOpenInstall}
        installLabel={installLabel}
        onOpenInstall={onOpenInstall}
          childAvatarUrl={displayedChildAvatar.url}
          childAvatarStatus={displayedChildAvatar.status}
          copyState={copyState}
          familyResponse={familyResponse}
          currentUserId={currentUserId}
          hostBridge={hostBridge}
          hasError={Boolean(error)}
          savedRefreshFailed={savedRefreshFailed}
          inviteError={inviteError}
          inviteReady={inviteReady}
          invites={activeInvites}
          memberActions={memberActions}
          members={members}
          maxChannelStatus={maxChannel.status}
          maxChannelLoading={maxChannel.loading}
          maxChannelError={maxChannel.error}
          canManageMaxChannel={canManageMaxChannel}
          onRetryMaxChannel={maxChannel.retry}
          onCloseInvite={() => { setInviteReady(null); setCopyState('idle') }}
          onAllFamilies={onAllFamilies}
          onCopyInvite={async () => {
            if (!inviteReady) return
            try {
              await navigator.clipboard.writeText(inviteReady.url)
              setCopyState('copied')
            } catch {
              setCopyState('failed')
            }
          }}
          onCreateInvite={async (input) => {
            setBusy(true)
            setError(null)
            setInviteError(false)
            try {
              const result = await createInviteResult({
                create: () => createInvite(transport, familyResponse.family.id, {
                  role: input.role,
                  inviteeDisplayName: input.inviteeDisplayName,
                }, input.idempotencyKey),
                refresh: async () => {
                  try {
                    await onRefresh({ failureMode: 'throw' })
                    setSavedRefreshFailed(false)
                  } catch (reason) {
                    setSavedRefreshFailed(true)
                    throw reason
                  }
                },
                toUrl: createInviteLink,
              })
              setInviteReady({ ...result, inviteeDisplayName: input.inviteeDisplayName })
              setCopyState('idle')
            } catch (reason) {
              setInviteError(true)
              throw reason
            } finally {
              setBusy(false)
            }
          }}
          onEditChild={onEditChild}
          settingsRequest={settingsRequest}
          onSettingsRequestHandled={onSettingsRequestHandled}
          onLeaveFamily={async () => {
            if (!current) return
            await run(() => leaveFamily(transport, familyResponse.family.id, currentUserId, current.version), true)
          }}
          onRefresh={() => { void onRefresh(savedRefreshFailed ? { failureMode: 'throw' } : undefined).then(() => { setSavedRefreshFailed(false); setError(null) }).catch(() => setSavedRefreshFailed(true)) }}
          onRefreshUsage={refreshUsage}
          onRemoveMember={async (member) => run(() => leaveFamily(
            transport, familyResponse.family.id, member.userId, member.version,
          ), true)}
          onRevokeInvite={async (invite) => run(() => revokeInvite(
            transport, familyResponse.family.id, invite.id,
          ), true)}
          onShareInvite={async () => {
            if (!inviteReady || !navigator.share) return
            try {
              await navigator.share({ url: inviteReady.url })
            } catch {
              // Sharing was cancelled or unavailable.
            }
          }}
          onUpdateMember={async (member, input) => run(() => updateFamilyMember(
            transport, familyResponse.family.id, member.userId, { ...input, expectedVersion: member.version },
          ), true)}
          onUpdateFamily={async (input) => run(() => updateFamily(transport, familyResponse.family.id, input), true)}
          usage={usage}
          usageFailed={usageFailed}
      />
      <BottomNavigation appearance="memoly" active="family" onAdd={onAdd} onFamily={() => undefined} onFeed={onFeed} role={current?.role === 'full' ? 'full' : 'viewer'} />
    </div>
  )
}
