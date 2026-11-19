import type { AlbumDto } from '@web-app-demo/contracts'
import type { AlbumsApi } from './api'

export type AlbumEntryPage = Awaited<ReturnType<AlbumsApi['entries']>>

const RECENT_MS = 20_000
const MAX_PAGES = 4
const MAX_PREFETCHES = 2

type RecentPage = { version: number; expiresAt: number; page: AlbumEntryPage }
type Prefetch = { version: number; expiresAt: number; result: Promise<AlbumEntryPage | null> }

function canPreload(album: AlbumDto) {
  return album.kind === 'year' || album.kind === 'workshop'
}

/** Short-lived views for the lifetime of one mounted album access scope. */
export function createAlbumOpenState() {
  const recent = new Map<string, RecentPage>()
  const prefetches = new Map<string, Prefetch>()
  const started = new Set<string>()

  function remember(album: AlbumDto, page: AlbumEntryPage) {
    if (!canPreload(album)) return
    recent.delete(album.id)
    recent.set(album.id, { version: page.items[0]?.aggregateVersion ?? album.version, expiresAt: Date.now() + RECENT_MS, page })
    if (recent.size > MAX_PAGES) recent.delete(recent.keys().next().value!)
  }

  return {
    remember,
    peek(album: AlbumDto) {
      const view = recent.get(album.id)
      return view?.version === album.version && view.expiresAt > Date.now() ? view.page : null
    },
    consumePrefetch(album: AlbumDto) {
      const prefetch = prefetches.get(album.id)
      prefetches.delete(album.id)
      return prefetch?.version === album.version && prefetch.expiresAt > Date.now() ? prefetch.result : null
    },
    preload(albums: AlbumDto[], read: (album: AlbumDto) => Promise<AlbumEntryPage>, isCurrent: () => boolean) {
      for (const album of albums) {
        if (started.size >= MAX_PREFETCHES || !isCurrent()) break
        if (!canPreload(album) || started.has(album.id)) continue
        started.add(album.id)
        const result = read(album).then((page) => {
          if (isCurrent() && prefetches.get(album.id)?.result === result) remember(album, page)
          return page
        }, () => null)
        prefetches.set(album.id, { version: album.version, expiresAt: Date.now() + RECENT_MS, result })
      }
    },
    invalidate(albumId: string) {
      prefetches.delete(albumId)
      recent.delete(albumId)
    },
    clear() {
      prefetches.clear()
      recent.clear()
      started.clear()
    },
  }
}
