import { useEffect, useState } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'

export function useChildAvatar(transport: AuthenticatedTransport, familyId: string, mediaId: string | null) {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!mediaId) return
    let cancelled = false
    let objectUrl: string | null = null
    void transport.raw(
      `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=display`,
    ).then(async (response) => {
      if (!response.ok) return
      objectUrl = URL.createObjectURL(await response.blob())
      if (cancelled) return
      setLoaded({ key: mediaId, url: objectUrl })
    }).catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [familyId, mediaId, transport])
  return mediaId && loaded?.key === mediaId ? loaded.url : null
}
