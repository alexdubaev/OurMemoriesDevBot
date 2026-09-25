import { useEffect, useState } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'
import { responseToPrivateImageObjectUrl } from '@/platform/media/private-image'

export function useChildAvatar(transport: AuthenticatedTransport, familyId: string, mediaId: string | null) {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!mediaId) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    void transport.raw(
      `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=display`,
      { signal: controller.signal },
    ).then(async (response) => {
      objectUrl = await responseToPrivateImageObjectUrl(response)
      if (controller.signal.aborted) URL.revokeObjectURL(objectUrl)
      else setLoaded({ key: `${familyId}:${mediaId}`, url: objectUrl })
    }).catch(() => undefined)
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [familyId, mediaId, transport])
  const key = mediaId ? `${familyId}:${mediaId}` : null
  return key && loaded?.key === key ? loaded.url : null
}
