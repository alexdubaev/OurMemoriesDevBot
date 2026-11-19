import type { AlbumDto } from '@web-app-demo/contracts'
import type { AlbumsApi } from './api'

export type AlbumEntryPage = Awaited<ReturnType<AlbumsApi['entries']>>
type PhotoPage = Awaited<ReturnType<AlbumsApi['monthSources']>>

const PREFETCH_MS = 20_000
const MAX_PAGES = 4
const MAX_PREFETCHES = 2

type RecentPage = { version: number; page: AlbumEntryPage }
type Prefetch = { version: number; expiresAt: number; result: Promise<AlbumEntryPage | null> }

function canPreload(album: AlbumDto) {
  return album.kind === 'year' || album.kind === 'workshop'
}

/** Bounded views for one mounted album access scope. Reads still revalidate on open. */
export function createAlbumOpenState() {
  const recent = new Map<string, RecentPage>()
  const photos = new Map<string, { albumId: string; key: string; page: PhotoPage }>()
  const prefetches = new Map<string, Prefetch>()

  function remember(album: AlbumDto, page: AlbumEntryPage) {
    if (!canPreload(album)) return
    recent.delete(album.id)
    recent.set(album.id, { version: page.items[0]?.aggregateVersion ?? album.version, page })
    if (recent.size > MAX_PAGES) recent.delete(recent.keys().next().value!)
  }

  return {
    remember,
    peek(album: AlbumDto) {
      const view = recent.get(album.id)
      if (view?.version !== album.version) return null
      recent.delete(album.id)
      recent.set(album.id, view)
      return view.page
    },
    photoPage(albumId: string, entryId: string, key: string) {
      const photo = photos.get(entryId)
      return photo?.albumId === albumId && photo.key === key ? photo.page : null
    },
    rememberPhotos(albumId: string, entryId: string, key: string, page: PhotoPage | null) {
      photos.delete(entryId)
      if (!page) return
      photos.set(entryId, { albumId, key, page })
      if (photos.size > MAX_PAGES) photos.delete(photos.keys().next().value!)
    },
    consumePrefetch(album: AlbumDto) {
      const prefetch = prefetches.get(album.id)
      prefetches.delete(album.id)
      return prefetch?.version === album.version && prefetch.expiresAt > Date.now() ? prefetch.result : null
    },
    preload(albums: AlbumDto[], read: (album: AlbumDto) => Promise<AlbumEntryPage>, isCurrent: () => boolean) {
      const now = Date.now()
      for (const [id, prefetch] of prefetches) if (prefetch.expiresAt <= now) prefetches.delete(id)
      for (const album of albums) {
        if (prefetches.size >= MAX_PREFETCHES || !isCurrent()) break
        if (!canPreload(album) || recent.get(album.id)?.version === album.version || prefetches.has(album.id)) continue
        const result = read(album).then((page) => {
          if (isCurrent() && prefetches.get(album.id)?.result === result) remember(album, page)
          return page
        }, () => {
          if (prefetches.get(album.id)?.result === result) prefetches.delete(album.id)
          return null
        })
        prefetches.set(album.id, { version: album.version, expiresAt: now + PREFETCH_MS, result })
      }
    },
    invalidate(albumId: string) {
      prefetches.delete(albumId)
      recent.delete(albumId)
      for (const [id, photo] of photos) if (photo.albumId === albumId) photos.delete(id)
    },
    clear() {
      prefetches.clear()
      recent.clear()
      photos.clear()
    },
  }
}

export type AlbumOpenState = ReturnType<typeof createAlbumOpenState>
