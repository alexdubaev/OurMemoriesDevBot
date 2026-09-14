import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { loadEnv } from './env'
import { startMaxIfEnabled } from './max-startup'
import type { createMaxApi, createMaxModule } from './modules/max'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
}
const maxSettings = {
  MAX_ENABLED: 'true', MAX_BOT_TOKEN: 'max:test-only-token', MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot', MAX_INBOX_ENCRYPTION_KEY: 'A'.repeat(43),
  MAX_WEBHOOK_URL: 'https://api.example.com/webhooks/max', MAX_WEBHOOK_SECRET: 'M'.repeat(43), MAX_MINI_APP_URL: 'https://app.example.com',
}

function runtime(settings: Record<string, string>) {
  let closeCalls = 0
  const value = { env: loadEnv({ ...base, ...settings }), close: async () => { closeCalls += 1 } }
  return { runtime: value as unknown as BackendRuntime, get closeCalls() { return closeCalls } }
}

describe('optional MAX startup', () => {
  test('disabled makes no API or module calls', async () => {
    const harness = runtime({ MAX_ENABLED: 'false' })
    let apiCalls = 0; let moduleCalls = 0
    await expect(startMaxIfEnabled({ runtime: harness.runtime, createApi: () => { apiCalls += 1; return {} as never }, createModule: () => { moduleCalls += 1; return {} as never } })).resolves.toBeNull()
    expect(apiCalls).toBe(0); expect(moduleCalls).toBe(0); expect(harness.closeCalls).toBe(0)
  })

  test('verifies identity before constructing the module', async () => {
    const harness = runtime(maxSettings); const calls: string[] = []; const module = {} as ReturnType<typeof createMaxModule>
    let moduleOptions: Parameters<typeof createMaxModule>[0] | undefined
    await expect(startMaxIfEnabled({
      runtime: harness.runtime,
      createApi: () => ({ getMe: async () => { calls.push('getMe'); return { userId: 1, username: 'OurMemoriesMaxBot', isBot: true } } } as ReturnType<typeof createMaxApi>),
      createModule: (options) => { calls.push('module'); moduleOptions = options; return module },
    })).resolves.toBe(module)
    expect(calls).toEqual(['getMe', 'module'])
    expect(moduleOptions?.identity).toEqual({ userId: 1, username: 'OurMemoriesMaxBot', isBot: true })
  })

  test('closes and rejects identity mismatch without constructing module', async () => {
    const harness = runtime(maxSettings); let moduleCalls = 0
    await expect(startMaxIfEnabled({ runtime: harness.runtime, createApi: () => ({ getMe: async () => ({ userId: 1, username: 'OtherBot', isBot: true }) } as ReturnType<typeof createMaxApi>), createModule: () => { moduleCalls += 1; return {} as never } })).rejects.toThrow()
    expect(moduleCalls).toBe(0); expect(harness.closeCalls).toBe(1)
  })
})
