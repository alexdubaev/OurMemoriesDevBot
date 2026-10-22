import { useContext } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'
import { AuthContext } from '@/features/auth'
import { usePrivateImageResource } from '@/platform/media/use-private-image-url'

export function useChildAvatar(transport: AuthenticatedTransport, familyId: string, mediaId: string | null, options: { childId?: string | null; membershipEpoch?: number | null; enabled?: boolean } = {}) {
  const auth = useContext(AuthContext)
  const path = mediaId
    ? `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=display`
    : null
  const scopeKey = JSON.stringify([familyId, options.childId ?? null, options.membershipEpoch ?? null, mediaId])
  return usePrivateImageResource(auth?.user?.id ?? '', path, transport, options.enabled ?? true, undefined, scopeKey)
}
