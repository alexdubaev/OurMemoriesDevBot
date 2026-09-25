import { useEffect, useState } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'
import { responseToPrivateImageObjectUrl } from '@/platform/media/private-image'
import { privateMediaDiagnosticHeaders, reportPrivateMediaDiagnostic } from '@/platform/media/private-media-diagnostics'

export function useChildAvatar(transport: AuthenticatedTransport, familyId: string, mediaId: string | null) {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!mediaId) {
      reportPrivateMediaDiagnostic('avatar-media-id-missing')
      return
    }
    const controller = new AbortController()
    let objectUrl: string | null = null
    void transport.raw(
      `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=display`,
      { signal: controller.signal, headers: privateMediaDiagnosticHeaders() },
    ).then(async (response) => {
      reportPrivateMediaDiagnostic('avatar-response', {
        status: response.status,
        contentType: response.headers.get('content-type'),
        byteSize: Number(response.headers.get('content-length')) || 0,
      })
      objectUrl = await responseToPrivateImageObjectUrl(response)
      reportPrivateMediaDiagnostic('avatar-blob-created')
      if (controller.signal.aborted) URL.revokeObjectURL(objectUrl)
      else setLoaded({ key: `${familyId}:${mediaId}`, url: objectUrl })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) reportPrivateMediaDiagnostic('avatar-fetch-error', {
        status: typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 0,
        code: typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN',
      })
    })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [familyId, mediaId, transport])
  const key = mediaId ? `${familyId}:${mediaId}` : null
  return key && loaded?.key === key ? loaded.url : null
}
