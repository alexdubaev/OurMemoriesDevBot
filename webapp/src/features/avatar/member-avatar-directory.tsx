import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import type { FamilyMemberDto } from '@web-app-demo/contracts'

import { familyMembersResponseSchema } from '@web-app-demo/contracts'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { privateFamilyAccessRevokedEvent } from '@/platform/persistence/private-cache'
import { memberAvatarUpdatedEvent } from './member-avatar-query'
import { memberAvatarDirectoryQueryKeys } from './member-avatar-directory-query'
import { MemberAvatarDirectoryContext } from './member-avatar-directory-context'

export function MemberAvatarDirectoryProvider({ accountId, familyId, membershipEpoch, seedMembers, transport, enabled = true, children }: {
  accountId: string
  familyId: string
  membershipEpoch: number
  seedMembers: FamilyMemberDto[]
  transport: AuthenticatedTransport
  enabled?: boolean
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => memberAvatarDirectoryQueryKeys.family(accountId, familyId, membershipEpoch), [accountId, familyId, membershipEpoch])
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => transport.request(
      `/api/v1/families/${encodeURIComponent(familyId)}/members`,
      familyMembersResponseSchema,
      { signal, timeoutMs: 15_000 },
    ),
    enabled,
    initialData: () => queryClient.getQueryData<{ items: FamilyMemberDto[] }>(queryKey) ?? { items: seedMembers },
    initialDataUpdatedAt: () => queryClient.getQueryState(queryKey)?.dataUpdatedAt || Date.now(),
    staleTime: 5_000,
    refetchOnMount: (current) => enabled && current.state.status !== 'error',
    retryOnMount: false,
    refetchOnWindowFocus: (current) => enabled && current.state.status !== 'error',
    refetchOnReconnect: (current) => enabled && current.state.status !== 'error',
    refetchInterval: (current) => {
      if (!enabled || isTerminalMemberDirectoryError(current.state.error)) return false
      if (current.state.status !== 'error') return 15_000
      return Math.min(60_000, 15_000 * (2 ** Math.max(0, current.state.errorUpdateCount - 1)))
    },
    refetchIntervalInBackground: false,
    retry: false,
  })

  useEffect(() => {
    if (!enabled || !query.error) return
    if (query.error instanceof ApiRequestError && [403, 404].includes(query.error.status)) {
      window.dispatchEvent(new CustomEvent(privateFamilyAccessRevokedEvent, { detail: { userId: accountId, familyId } }))
    }
  }, [accountId, enabled, familyId, query.error])

  useEffect(() => {
    const onAvatarUpdated = (event: Event) => {
      if ((event as CustomEvent<{ accountId?: string }>).detail?.accountId !== accountId || !enabled) return
      void queryClient.cancelQueries({ queryKey, exact: true }).then(() =>
        queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' }),
      )
    }
    window.addEventListener(memberAvatarUpdatedEvent, onAvatarUpdated)
    return () => window.removeEventListener(memberAvatarUpdatedEvent, onAvatarUpdated)
  }, [accountId, enabled, queryClient, queryKey])

  const membersById = useMemo(() => new Map((query.data?.items ?? seedMembers).map((member) => [member.userId, {
    userId: member.userId,
    avatarPath: member.avatarPath,
    avatarCrop: member.avatarCrop ?? null,
  }])), [query.data?.items, seedMembers])
  const resolve = useCallback((userId: string) => membersById.get(userId) ?? null, [membersById])
  const value = useMemo(() => ({ resolve }), [resolve])

  return <MemberAvatarDirectoryContext.Provider value={enabled ? value : null}>{children}</MemberAvatarDirectoryContext.Provider>
}

function isTerminalMemberDirectoryError(error: unknown) {
  return error instanceof ApiRequestError && [401, 403, 404].includes(error.status)
}
