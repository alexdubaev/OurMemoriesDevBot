import { afterEach, expect, test } from 'bun:test'
import { coordinateBrowserAuthMutation } from '../src/features/auth/browser-auth-coordinator'

const originalNavigator = globalThis.navigator
afterEach(() => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator }))

test('auth lock acquisition times out without running a late mutation', async () => {
  let grant!: () => void
  let callback!: () => Promise<unknown>
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: (_name: string, _options: LockOptions, operation: () => Promise<unknown>) => {
      callback = operation
      return new Promise((resolve, reject) => {
        grant = () => { void operation().then(resolve, reject) }
      })
    } } },
  })
  let mutations = 0
  const pending = coordinateBrowserAuthMutation(async () => { mutations += 1 }, { timeoutMs: 10 })
  await expect(pending).rejects.toThrow('Request timed out')
  grant()
  await callback().catch(() => undefined)
  expect(mutations).toBe(0)
})
type LockOptions = { mode?: string; signal?: AbortSignal }
