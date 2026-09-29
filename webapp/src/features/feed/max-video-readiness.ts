import { backendMediaPathSchema, type MaxVideoReadiness } from '@web-app-demo/contracts'

const maxVideoContentPath = /^\/api\/v1\/families\/[0-9a-f-]{36}\/media\/max-videos\/[0-9a-f-]{36}\/content$/i
const MAX_CONCURRENT_READINESS_CHECKS = 3
const MAX_SUCCESSFUL_CHECKS = 12
const MAX_FAILED_CHECKS = 4

export function maxVideoReadinessPath(playbackPath: string): string | null {
  if (!backendMediaPathSchema.safeParse(playbackPath).success || !maxVideoContentPath.test(playbackPath)) return null
  return playbackPath.replace(/\/content$/, '/readiness')
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
