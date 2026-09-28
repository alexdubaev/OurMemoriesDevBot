import { queryOptions, type QueryClient } from '@tanstack/react-query'

import { sessionQueryKeys } from '@/features/auth'
import type { AuthenticatedTransport } from '@/platform/api'

export const memberAvatarQueryKeys = {
  all: [...sessionQueryKeys.all, 'member-avatar'] as const,
  path: (accountId: string, avatarPath: string) => [...memberAvatarQueryKeys.all, accountId, avatarPath] as const,
}

export const memberAvatarUpdatedEvent = 'member-avatar-updated'

export async function reconcileMemberAvatarCache(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: memberAvatarQueryKeys.all })
  await queryClient.invalidateQueries({ queryKey: [...sessionQueryKeys.all, 'feed'] })
}

export function memberAvatarQueryOptions(transport: AuthenticatedTransport, accountId: string, avatarPath: string) {
  return queryOptions({
    queryKey: memberAvatarQueryKeys.path(accountId, avatarPath),
    queryFn: async ({ signal }) => {
      const response = await transport.raw(avatarPath, { signal })
      if (!response.ok) throw new Error(`Avatar request failed: ${response.status}`)
      return response.blob()
    },
    staleTime: Infinity,
    retry: false,
  })
}
