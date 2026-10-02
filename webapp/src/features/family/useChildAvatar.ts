import { useContext } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'
import { AuthContext } from '@/features/auth'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'

export function useChildAvatar(transport: AuthenticatedTransport, familyId: string, mediaId: string | null) {
  const auth = useContext(AuthContext)
  const path = mediaId
    ? `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=display`
    : null
  return usePrivateImageUrl(auth?.user?.id ?? '', path, transport)
}
