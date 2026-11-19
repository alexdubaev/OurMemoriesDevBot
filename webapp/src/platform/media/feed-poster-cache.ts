import type { AuthenticatedTransport } from '@/platform/api'

type ReadyImage = { url: string; size: number }
type IdleImage = ReadyImage & {
  transport: AuthenticatedTransport
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

function documentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

// The budget includes decoded pixels as well as the compressed Blob.
function createIdleImagePool(maxImages: number, maxBytes: number, retainMs: number) {
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
      if (!Number.isSafeInteger(image.size) || image.size <= 0 || image.size > maxBytes || documentHidden()) return false
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

export const idleFeedPosters = createIdleImagePool(3, 8 * 1024 * 1024, 10_000)
export const idleAlbumPreviews = createIdleImagePool(16, 12 * 1024 * 1024, 20_000)
export const { clear: clearIdleFeedPosters, forget: forgetIdleFeedPoster, keep: keepIdleFeedPoster, take: takeIdleFeedPoster } = idleFeedPosters
