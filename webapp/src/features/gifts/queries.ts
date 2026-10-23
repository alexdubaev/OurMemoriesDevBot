import { CancelledError, useQuery } from '@tanstack/react-query'

import type { AuthenticatedTransport } from '@/platform/api'
import {
  isActivePrivateCacheIdentity,
  privateCacheIdentityGeneration,
  privateFamilyCacheGeneration,
} from '@/platform/persistence/private-cache'

import { loadGifts } from './api'

export type GiftScope = { familyId: string; accountId: string; membershipEpoch: number | null }

/** `session` keys are never persisted to IndexedDB, so gifts stay in memory only. */
export const giftsQueryKeys = {
  all: ['session', 'gifts'] as const,
  list: (familyId: string, accountId: string, membershipEpoch: number | null) =>
    [...giftsQueryKeys.all, familyId, accountId, membershipEpoch] as const,
}

/** Refetches whenever the tab becomes active; the previous list stays while a reload fails. */
export function useGiftList(transport: AuthenticatedTransport, scope: GiftScope, active: boolean) {
  const identity = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(scope.accountId, scope.familyId)
  return useQuery({
    queryKey: giftsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch),
    enabled: active && Boolean(scope.accountId),
    staleTime: 0,
    gcTime: 0,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const { gifts } = await loadGifts(transport, scope.familyId, signal)
      // A response that lands after the account or family access changed must not be stored.
      if (!isActivePrivateCacheIdentity(scope.accountId, identity) ||
        privateFamilyCacheGeneration(scope.accountId, scope.familyId) !== familyGeneration) throw new CancelledError()
      return gifts
    },
  })
}
