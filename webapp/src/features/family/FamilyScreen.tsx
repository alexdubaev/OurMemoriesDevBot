import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'
import { useEffect, useState } from 'react'

import { BottomNavigation } from '@/components/BottomNavigation'
import { FamilyPresentation, type FamilyMemberActions } from '@/features/memoly-ui'
import type { AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/host-bridge'
import { createInvite, leaveFamily, loadFamilyUsage, revokeInvite, updateFamilyMember } from './api'
import { useChildAvatar } from './useChildAvatar'

export function FamilyScreen({
  familyResponse,
  invites,
  members,
  transport,
  hostBridge,
  currentUserId,
  onEditChild,
  onFeed,
  onRefresh,
  createInviteLink,
}: {
  familyResponse: FamilyResponse
  invites: FamilyInviteDto[]
  members: FamilyMemberDto[]
  transport: AuthenticatedTransport
  hostBridge: Pick<HostBridge, 'onBack'>
  currentUserId: string
  onEditChild: () => void
  onFeed: () => void
  onRefresh: () => Promise<void>
  createInviteLink: (rawToken: string) => string | null
}) {
  const [error, setError] = useState<Error | null>(null)
  const [busy, setBusy] = useState(false)
  const [inviteReady, setInviteReady] = useState<{ url: string; expiresAt: string } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number | null } | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
  const current = members.find((member) => member.userId === currentUserId)
  const isOwner = current?.isOwner === true
  const child = familyResponse.child
  const canInvite = (isOwner || current?.role === 'full') && child?.isComplete === true
  const avatarUrl = useChildAvatar(transport, familyResponse.family.id, child?.avatarMediaId ?? null)

  const refreshUsage = () => void loadFamilyUsage(transport, familyResponse.family.id).then((next) => {
    setUsage(next)
    setUsageFailed(false)
  }).catch(() => setUsageFailed(true))

  useEffect(refreshUsage, [familyResponse.family.id, transport])

  async function run(action: () => Promise<unknown>, throwOnError = false) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await onRefresh()
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
      <div className="ml-shell mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-[calc(var(--layout-gutter)+var(--host-inset-left))] pt-[calc(var(--layout-gutter)+var(--host-inset-top))] pr-[calc(var(--layout-gutter)+var(--host-inset-right))] pb-[calc(var(--layout-bottom-nav)+var(--host-inset-bottom)+var(--layout-gutter))]">
        <FamilyPresentation
          busy={busy}
          canEditChild={isOwner}
          canInvite={canInvite}
          canLeaveFamily={Boolean(current && !isOwner)}
          childAvatarUrl={avatarUrl}
          copyState={copyState}
          familyResponse={familyResponse}
          hostBridge={hostBridge}
          hasError={Boolean(error)}
          inviteReady={inviteReady}
          invites={invites}
          memberActions={memberActions}
          members={members}
          onCloseInvite={() => { setInviteReady(null); setCopyState('idle') }}
          onCopyInvite={async () => {
            if (!inviteReady) return
            try {
              await navigator.clipboard.writeText(inviteReady.url)
              setCopyState('copied')
            } catch {
              setCopyState('failed')
            }
          }}
          onCreateInvite={async (input) => run(async () => {
            const invitation = await createInvite(transport, familyResponse.family.id, input)
            const url = createInviteLink(invitation.rawToken)
            if (!url) throw new Error('Не удалось создать ссылку приглашения.')
            setInviteReady({ url, expiresAt: invitation.expiresAt })
            setCopyState('idle')
          }, true)}
          onEditChild={onEditChild}
          onLeaveFamily={async () => {
            if (!current) return
            await run(() => leaveFamily(transport, familyResponse.family.id, currentUserId, current.version))
          }}
          onRefresh={() => { void onRefresh() }}
          onRefreshUsage={refreshUsage}
          onRemoveMember={async (member) => run(() => leaveFamily(
            transport, familyResponse.family.id, member.userId, member.version,
          ))}
          onRevokeInvite={async (invite) => run(() => revokeInvite(
            transport, familyResponse.family.id, invite.id,
          ))}
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
          ))}
          usage={usage}
          usageFailed={usageFailed}
        />
      </div>
      <BottomNavigation appearance="memoly" active="family" onFamily={() => undefined} onFeed={onFeed} role={current?.role === 'viewer' ? 'viewer' : 'full'} />
    </div>
  )
}
