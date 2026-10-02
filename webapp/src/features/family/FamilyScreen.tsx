import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useCallback, useEffect, useState } from 'react'

import { BottomNavigation } from '@/components/BottomNavigation'
import { FamilyPresentation, type FamilyMemberActions } from '@/features/memoly-ui'
import type { AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/host-bridge'
import { createInvite, leaveFamily, loadFamilyUsage, revokeInvite, updateFamily, updateFamilyMember } from './api'
import { createInviteResult } from './invite-result'
import { useChildAvatar } from './useChildAvatar'
import { canManageFamilyMaxChannel, useFamilyMaxChannelStatus } from './useFamilyMaxChannelStatus'

type FamilyRefreshOptions = { failureMode?: 'global' | 'throw' }

export function FamilyScreen({
  active = true,
  childProfileOpen,
  familyResponse,
  invites,
  members,
  transport,
  hostBridge,
  currentUserId,
  onAdd,
  onAllFamilies,
  onEditChild,
  onChangeChildPhoto,
  onOpenChild,
  onCloseChild,
  onFeed,
  onRefresh,
  createInviteLink,
  canOpenInstall = false,
  installLabel,
  onOpenInstall = () => undefined,
}: {
  active?: boolean
  childProfileOpen: boolean
  familyResponse: FamilyResponse
  invites: FamilyInviteDto[]
  members: FamilyMemberDto[]
  transport: AuthenticatedTransport
  hostBridge: Pick<HostBridge, 'onBack'>
  currentUserId: string
  onAdd: () => void
  onAllFamilies?: () => void
  onEditChild: () => void
  onChangeChildPhoto: () => void
  onOpenChild: () => void
  onCloseChild: () => void
  onFeed: () => void
  onRefresh: (options?: FamilyRefreshOptions) => Promise<void>
  createInviteLink: (rawToken: string) => string | null
  canOpenInstall?: boolean
  installLabel?: string
  onOpenInstall?: () => void
}) {
  const [error, setError] = useState<Error | null>(null)
  const [inviteError, setInviteError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [inviteReady, setInviteReady] = useState<{ url: string; expiresAt: string; inviteeDisplayName?: string } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number | null } | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
  const current = members.find((member) => member.userId === currentUserId)
  const isOwner = current?.isOwner === true
  const child = familyResponse.child
  const canInvite = (isOwner || current?.role === 'full') && child?.isComplete === true
  const maxChannel = useFamilyMaxChannelStatus(transport, familyResponse.family.id, currentUserId, current?.role ?? null)
  const canManageMaxChannel = canManageFamilyMaxChannel(current?.role ?? null, maxChannel.status)
  const avatarUrl = useChildAvatar(transport, familyResponse.family.id, child?.avatarMediaId ?? null)

  const refreshUsage = useCallback(() => void loadFamilyUsage(transport, familyResponse.family.id).then((next) => {
    setUsage(next)
    setUsageFailed(false)
  }).catch(() => setUsageFailed(true)), [familyResponse.family.id, transport])

  useEffect(() => { if (active) refreshUsage() }, [active, refreshUsage])

  async function run(action: () => Promise<unknown>, throwOnError = false) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onRefresh({ failureMode: 'throw' })
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error('Не удалось обновить семью.'))
      if (throwOnError) throw reason
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
          childProfileOpen={childProfileOpen}
          childAvatarUrl={avatarUrl}
          copyState={copyState}
          familyResponse={familyResponse}
          currentUserId={currentUserId}
          hostBridge={hostBridge}
          hasError={Boolean(error)}
          inviteError={inviteError}
          inviteReady={inviteReady}
          invites={invites}
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
                create: () => createInvite(transport, familyResponse.family.id, input),
                refresh: () => onRefresh({ failureMode: 'throw' }),
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
          onChangeChildPhoto={onChangeChildPhoto}
          onOpenChild={onOpenChild}
          onCloseChild={onCloseChild}
          onLeaveFamily={async () => {
            if (!current) return
            await run(() => leaveFamily(transport, familyResponse.family.id, currentUserId, current.version), true)
          }}
          onRefresh={() => { void onRefresh() }}
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
      <BottomNavigation appearance="memoly" active="family" onAdd={onAdd} onFamily={onCloseChild} onFeed={onFeed} role={current?.role === 'full' ? 'full' : 'viewer'} />
    </div>
  )
}
