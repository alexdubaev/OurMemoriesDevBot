import type { AuthenticatedTransport } from '@/platform/api'
import { PRIVATE_CACHE_MAX_IMAGE_BYTES } from '@/platform/persistence/private-cache'

type ReadyImage = { url: string; size: number }
type IdleImage = ReadyImage & {
  transport: AuthenticatedTransport
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

function documentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

// The budget counts the compressed Blob only: an idle blob URL without an <img> holds no
// decoded pixels. A single image larger than the private cache allows is never kept.
function createIdleImagePool(maxImages: number, maxBytes: number, retainMs: number) {
  const maxImageBytes = Math.min(maxBytes, PRIVATE_CACHE_MAX_IMAGE_BYTES)
  const idle = new Map<string, IdleImage>()
  const forget = (key: string) => {
    const image = idle.get(key)
    if (!image) return
    clearTimeout(image.timer)
    idle.delete(key)
    URL.revokeObjectURL(image.url)
  }
  const clear = (matches: (key: string) => boolean = () => true) => {
    for (const key of idle.keys()) if (matches(key)) forget(key)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (documentHidden()) clear()
    })
  }

  return {
    clear,
    forget,
    keep(key: string, transport: AuthenticatedTransport, image: ReadyImage) {
      if (!Number.isSafeInteger(image.size) || image.size <= 0 || image.size > maxImageBytes || documentHidden()) return false
      forget(key)
      idle.set(key, {
        ...image,
        transport,
        expiresAt: Date.now() + retainMs,
        timer: setTimeout(() => forget(key), retainMs),
      })
      let total = [...idle.values()].reduce((bytes, entry) => bytes + entry.size, 0)
      for (const [id, entry] of idle) {
        if (idle.size <= maxImages && total <= maxBytes) break
        total -= entry.size
        forget(id)
      }
      return true
    },
    take(key: string, transport: AuthenticatedTransport): ReadyImage | null {
      const cached = idle.get(key)
      if (!cached) return null
      if (cached.transport !== transport || cached.expiresAt <= Date.now() || documentHidden()) {
        forget(key)
        return null
      }
      clearTimeout(cached.timer)
      idle.delete(key)
      return cached
    },
  }
}

const MB = 1024 * 1024
// Hub round trips, album -> entry -> back and carousel slides remount tiles; three minutes
// covers those trips. Every pool is emptied when the page is hidden or the cache identity,
// user or family changes.
export const idleFeedPosters = createIdleImagePool(24, 16 * MB, 180_000)
// WebKit may keep decoded pixels of an idle blob URL that was drawn, so counts stay modest.
export const idleFeedPhotos = createIdleImagePool(60, 24 * MB, 180_000)
export const idleAlbumPreviews = createIdleImagePool(120, 24 * MB, 180_000)
export const { clear: clearIdleFeedPosters, forget: forgetIdleFeedPoster, keep: keepIdleFeedPoster, take: takeIdleFeedPoster } = idleFeedPosters
