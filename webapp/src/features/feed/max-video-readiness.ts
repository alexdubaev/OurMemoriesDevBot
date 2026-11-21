import { backendMediaPathSchema, type MaxVideoPosterReadiness, type MaxVideoReadiness } from '@web-app-demo/contracts'

const maxVideoContentPath = /^\/api\/v1\/families\/[0-9a-f-]{36}\/media\/max-videos\/[0-9a-f-]{36}\/content$/i
const MAX_CONCURRENT_READINESS_CHECKS = 3
const MAX_SUCCESSFUL_CHECKS = 12
const MAX_FAILED_CHECKS = 4

export function maxVideoReadinessPath(playbackPath: string): string | null {
  if (!backendMediaPathSchema.safeParse(playbackPath).success || !maxVideoContentPath.test(playbackPath)) return null
  return playbackPath.replace(/\/content$/, '/readiness')
}

export function maxVideoPosterPath(playbackPath: string): string | null {
  if (!backendMediaPathSchema.safeParse(playbackPath).success || !maxVideoContentPath.test(playbackPath)) return null
  return playbackPath.replace(/\/content$/, '/poster')
}

export function maxVideoPosterReadinessPath(playbackPath: string): string | null {
  if (!backendMediaPathSchema.safeParse(playbackPath).success || !maxVideoContentPath.test(playbackPath)) return null
  return playbackPath.replace(/\/content$/, '/poster-readiness')
}

export function maxVideoPosterReadinessInterval(state: { data?: MaxVideoPosterReadiness; dataUpdateCount: number; errorUpdateCount: number }) {
  if (state.data && state.data.state !== 'pending') return false
  if (state.errorUpdateCount > 0) return Math.min(5_000 * 2 ** Math.min(state.errorUpdateCount, 4), 60_000)
  return Math.min(5_000 * 2 ** Math.min(state.dataUpdateCount, 4), 60_000)
}

export function maxVideoReadinessInterval(state: { data?: MaxVideoReadiness; dataUpdateCount: number; errorUpdateCount: number }) {
  if (state.data && !state.data.recheckable) return false
  if (state.dataUpdateCount >= MAX_SUCCESSFUL_CHECKS || state.errorUpdateCount >= MAX_FAILED_CHECKS) return false
  return 5_000 * 2 ** Math.min(state.errorUpdateCount, 3)
}

let activeChecks = 0
const waitingChecks: Array<() => void> = []

export async function withMaxVideoReadinessSlot<T>(signal: AbortSignal, check: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  if (activeChecks < MAX_CONCURRENT_READINESS_CHECKS) activeChecks += 1
  else await new Promise<void>((resolve, reject) => {
    const release = () => { signal.removeEventListener('abort', abort); resolve() }
    const abort = () => {
      const index = waitingChecks.indexOf(release)
      if (index >= 0) waitingChecks.splice(index, 1)
      reject(signal.reason)
    }
    waitingChecks.push(release)
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    signal.throwIfAborted()
    return await check()
  } finally {
    const next = waitingChecks.shift()
    if (next) next()
    else activeChecks -= 1
  }
}

/** A final answer does not change again; it is kept this long after its last slide leaves. */
export const MAX_VIDEO_FINAL_READINESS_GC_MS = 30 * 60_000
const DEFAULT_READINESS_GC_MS = 5 * 60_000
// Only a ready poster is final: a failed one may still be produced by a later server retry.
const posterReadinessFinal = (data: MaxVideoPosterReadiness | undefined) => data?.state === 'ready'
const readinessFinal = (data: MaxVideoReadiness | undefined) => Boolean(data && !data.recheckable)

/**
 * Cache policy for a poster readiness query. A pending answer stays stale, so every activation
 * of the slide checks again; a ready answer is never refetched by a swipe.
 */
export function maxVideoPosterReadinessCache(cached: MaxVideoPosterReadiness | undefined) {
  return {
    staleTime: (query: { state: { data?: MaxVideoPosterReadiness } }) => posterReadinessFinal(query.state.data) ? Infinity : 0,
    gcTime: posterReadinessFinal(cached) ? MAX_VIDEO_FINAL_READINESS_GC_MS : DEFAULT_READINESS_GC_MS,
  }
}

/** Cache policy for a video readiness query: recheckable answers stay stale, final ones are kept. */
export function maxVideoReadinessCache(cached: MaxVideoReadiness | undefined) {
  return {
    staleTime: (query: { state: { data?: MaxVideoReadiness } }) => readinessFinal(query.state.data) ? Infinity : 0,
    gcTime: readinessFinal(cached) ? MAX_VIDEO_FINAL_READINESS_GC_MS : DEFAULT_READINESS_GC_MS,
  }
}
