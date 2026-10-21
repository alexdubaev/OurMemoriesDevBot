import { setImmediate as yieldImmediate } from 'node:timers'

export async function withControlledTimers<T>(run: (clock: { runNext(): Promise<void>; runAll(): Promise<void> }) => Promise<T>): Promise<T> {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const originalDateNow = Date.now
  let now = 0
  let nextId = 1
  const scheduled = new Map<number, { due: number; callback: () => void }>()

  globalThis.setTimeout = ((callback: TimerHandler, delay = 0, ...args: unknown[]) => {
    const id = nextId++
    scheduled.set(id, {
      due: now + Math.max(0, Number(delay) || 0),
      callback: () => { if (typeof callback === 'function') callback(...args) },
    })
    return id as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => { scheduled.delete(id as unknown as number) }) as typeof clearTimeout
  Date.now = () => now

  const flushScheduledWork = () => new Promise<void>((resolve) => yieldImmediate(resolve))
  const runNext = async () => {
    let due = [...scheduled.entries()].sort((a, b) => a[1].due - b[1].due)[0]
    if (!due) {
      await flushScheduledWork()
      due = [...scheduled.entries()].sort((a, b) => a[1].due - b[1].due)[0]
    }
    if (!due) return false
    scheduled.delete(due[0])
    now = Math.max(now, due[1].due)
    due[1].callback()
    await flushScheduledWork()
    return true
  }
  const clock = {
    async runNext() { await runNext() },
    async runAll() {
      let callbacks = 0
      while (await runNext()) {
        callbacks += 1
        if (callbacks > 1000) throw new Error('Controlled timer queue did not settle')
      }
    },
  }

  try { return await run(clock) }
  finally {
    scheduled.clear()
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    Date.now = originalDateNow
  }
}
