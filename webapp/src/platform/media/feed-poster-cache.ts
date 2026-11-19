import type { AuthenticatedTransport } from '@/platform/api'

const MAX_POSTERS = 3
const MAX_BYTES = 8 * 1024 * 1024
const RETAIN_MS = 10_000

type FeedPoster = { url: string; size: number }
type CachedPoster = FeedPoster & {
  transport: AuthenticatedTransport
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

// Only already-ready feed video posters can be handed back to a remount.
// The budget includes the decoded pixels, not just the compressed file.
const idlePosters = new Map<string, CachedPoster>()

export function keepIdleFeedPoster(key: string, transport: AuthenticatedTransport, poster: FeedPoster) {
  if (!Number.isSafeInteger(poster.size) || poster.size <= 0 || poster.size > MAX_BYTES || documentHidden()) return false
  forgetIdleFeedPoster(key)
  idlePosters.set(key, {
    ...poster,
    transport,
    expiresAt: Date.now() + RETAIN_MS,
    timer: setTimeout(() => forgetIdleFeedPoster(key), RETAIN_MS),
  })
  let total = [...idlePosters.values()].reduce((bytes, entry) => bytes + entry.size, 0)
  for (const [id, entry] of idlePosters) {
    if (idlePosters.size <= MAX_POSTERS && total <= MAX_BYTES) break
    total -= entry.size
    forgetIdleFeedPoster(id)
  }
  return true
}

export function takeIdleFeedPoster(key: string, transport: AuthenticatedTransport): FeedPoster | null {
  const cached = idlePosters.get(key)
  if (!cached) return null
  if (cached.transport !== transport || cached.expiresAt <= Date.now() || documentHidden()) {
    forgetIdleFeedPoster(key)
    return null
  }
  clearTimeout(cached.timer)
  idlePosters.delete(key)
  return cached
}

export function forgetIdleFeedPoster(key: string) {
  const cached = idlePosters.get(key)
  if (!cached) return
  clearTimeout(cached.timer)
  idlePosters.delete(key)
  URL.revokeObjectURL(cached.url)
}

export function clearIdleFeedPosters(matches: (key: string) => boolean = () => true) {
  for (const key of idlePosters.keys()) if (matches(key)) forgetIdleFeedPoster(key)
}

function documentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (documentHidden()) clearIdleFeedPosters()
  })
}
