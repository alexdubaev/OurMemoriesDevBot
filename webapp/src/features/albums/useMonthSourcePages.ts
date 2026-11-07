import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '@/platform/api'
import type { AlbumsApi } from './api'
import type { AlbumSource } from './model'

type Pages = { pages: AlbumSource[][]; nextCursor: string | null; loading: boolean; error: 'network' | 'stale' | null }

/** The caller keys the owning screen by month and version. */
export function useMonthSourcePages(api: AlbumsApi, albumId: string, entryId: string, kind: 'photo' | 'other' | 'all', enabled: boolean) {
  const [state, setState] = useState<Pages>({ pages: [], nextCursor: null, loading: enabled, error: null })
  const request = useRef<AbortController | null>(null)
  const load = useCallback(async (cursor?: string) => {
    if (!enabled || request.current) return
    const controller = new AbortController()
    request.current = controller
    if (cursor) setState((old) => ({ ...old, loading: true, error: null }))
    try {
      const response = await api.monthSources(albumId, entryId, kind, cursor, controller.signal)
      if (controller.signal.aborted) return
      setState((old) => {
        const pages = cursor ? old.pages : []
        const seen = new Set(pages.flat().map(({ id }) => id))
        return { pages: [...pages, response.items.filter(({ id }) => !seen.has(id))], nextCursor: response.nextCursor, loading: false, error: null }
      })
    } catch (reason) {
      if (!controller.signal.aborted) setState((old) => ({ ...old, loading: false, error: reason instanceof ApiRequestError && reason.status === 409 ? 'stale' : 'network' }))
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [api, albumId, entryId, kind, enabled])
  useEffect(() => {
    void load()
    return () => { request.current?.abort(); request.current = null }
  }, [load])
  return {
    ...state,
    more: useCallback(() => { if (state.nextCursor) void load(state.nextCursor) }, [load, state.nextCursor]),
    retry: useCallback(() => { void load(state.nextCursor ?? undefined) }, [load, state.nextCursor]),
  }
}
