export type BrowserAuthCoordinator = <T>(mutation: () => Promise<T>, options?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<T>

const browserAuthLockName = 'web_app_demo:auth-cookie-mutation'

export const coordinateBrowserAuthMutation: BrowserAuthCoordinator = async (mutation, { timeoutMs, signal } = {}) => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return mutation()
  if (timeoutMs === undefined && !signal) return locks.request(browserAuthLockName, { mode: 'exclusive' }, mutation)

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let acquired = false
  let resolveAcquired!: () => void
  let rejectAcquired!: (error: Error) => void
  const acquiredPromise = new Promise<void>((resolve, reject) => {
    resolveAcquired = resolve
    rejectAcquired = reject
  })
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      if (!acquired) {
        const error = new Error('Request timed out')
        error.name = 'TimeoutError'
        controller.abort(error)
        rejectAcquired(error)
      }
    }, timeoutMs)
  }
  const abortFromCaller = () => {
    if (acquired) return
    const reason = signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
    controller.abort(reason)
    rejectAcquired(reason)
  }
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })

  try {
    const request = locks.request(browserAuthLockName, { mode: 'exclusive', signal: controller.signal }, async () => {
      controller.signal.throwIfAborted()
      acquired = true
      if (timer !== undefined) clearTimeout(timer)
      resolveAcquired()
      return mutation()
    })
    void request.catch((error: unknown) => {
      rejectAcquired(error instanceof Error ? error : new Error('Auth lock request failed'))
    })
    await acquiredPromise
    return await request
  } catch (error) {
    if (timer !== undefined) clearTimeout(timer)
    throw error
  } finally {
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
