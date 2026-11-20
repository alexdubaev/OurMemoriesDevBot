import { useLayoutEffect, useMemo, useRef } from 'react'
import type { AuthenticatedTransport } from '@/platform/api'

/**
 * A transport whose identity survives access-token refreshes. The session replaces its
 * transport object on every refresh; album requests built on this one (the albums API, gallery
 * paging, image tiles) keep running and always send through the newest session transport.
 */
export function useLatestTransport(transport: AuthenticatedTransport): AuthenticatedTransport {
  const latest = useRef(transport)
  useLayoutEffect(() => { latest.current = transport }, [transport])
  return useMemo<AuthenticatedTransport>(() => ({
    request: (path, schema, options) => latest.current.request(path, schema, options),
    raw: (path, options) => latest.current.raw(path, options),
  }), [])
}
