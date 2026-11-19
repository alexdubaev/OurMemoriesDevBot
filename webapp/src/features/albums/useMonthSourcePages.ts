import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '@/platform/api'
import type { AlbumOpenState } from './album-open-state'
import type { AlbumsApi } from './api'
import type { AlbumSource } from './model'

type Pages = { pages: AlbumSource[][]; nextCursor: string | null; loading: boolean; error: 'network' | 'stale' | null }

/** The caller keys the owning screen by month and version. */
export function useMonthSourcePages(api: AlbumsApi, albumId: string, entryId: string, kind: 'photo' | 'other' | 'all', enabled: boolean, photoVersion?: string, openState?: AlbumOpenState) {
  const [state, setState] = useState<Pages>(() => {
    const cached = enabled && photoVersion ? openState?.photoPage(albumId, entryId, photoVersion) : null
    return { pages: cached ? [cached.items] : [], nextCursor: cached?.nextCursor ?? null, loading: enabled, error: null }
  })
  const request = useRef<AbortController | null>(null)
  const lastCursor = useRef<string | undefined>(undefined)
  const load = useCallback(async (cursor?: string) => {
    if (!enabled || request.current) return
    const controller = new AbortController()
    request.current = controller
    lastCursor.current = cursor
    setState((old) => old.loading ? old : { ...old, loading: true, error: null })
    try {
      const response = await api.monthSources(albumId, entryId, kind, cursor, controller.signal)
      if (controller.signal.aborted) return
      if (!cursor && photoVersion) openState?.rememberPhotos(albumId, entryId, photoVersion, response)
      setState((old) => {
        const pages = cursor ? old.pages : []
        const seen = new Set(pages.flat().map(({ id }) => id))
        return { pages: [...pages, response.items.filter(({ id }) => !seen.has(id))], nextCursor: response.nextCursor, loading: false, error: null }
      })
    } catch (reason) {
      if (!controller.signal.aborted) {
        const missing = !cursor && reason instanceof ApiRequestError && reason.status === 404
        if (missing && photoVersion) openState?.rememberPhotos(albumId, entryId, photoVersion, null)
        setState((old) => ({
          pages: missing ? [] : old.pages,
          nextCursor: missing ? null : old.nextCursor,
          loading: false,
          error: reason instanceof ApiRequestError && reason.status === 409 ? 'stale' : 'network',
        }))
      }
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [api, albumId, entryId, kind, enabled, openState, photoVersion])
  useEffect(() => {
    void load()
    return () => { request.current?.abort(); request.current = null }
  }, [load])
  return {
    ...state,
    more: useCallback(() => { if (state.nextCursor) void load(state.nextCursor) }, [load, state.nextCursor]),
    retry: useCallback(() => { void load(lastCursor.current) }, [load]),
  }
}
