import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from './runtime'
import { loadEnv } from './env'
import { startTelegramIfEnabled } from './telegram-startup'
import type { createTelegramApi, createTelegramModule } from './modules/telegram'

type TelegramApi = ReturnType<typeof createTelegramApi>

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '12345678901234567890123456789012',
}

const telegramSettings = {
  TELEGRAM_ENABLED: 'true',
  TELEGRAM_BOT_TOKEN: '123456:adapter-secret',
  TELEGRAM_INBOX_ENCRYPTION_KEY: 'A'.repeat(43),
}

const maxSettings = {
  MAX_ENABLED: 'true',
  MAX_BOT_TOKEN: 'max:adapter-secret',
  MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
  MAX_WEBHOOK_URL: 'https://api.example.com/webhooks/max',
  MAX_WEBHOOK_SECRET: 'M'.repeat(43),
  MAX_MINI_APP_URL: 'https://app.example.com',
}

function createRuntime(envInput: Record<string, string | undefined>) {
  let closeCalls = 0
  const runtime = {
    env: loadEnv(envInput),
    close: async () => {
      closeCalls += 1
    },
  } as unknown as BackendRuntime

  return {
    runtime,
    get closeCalls() {
      return closeCalls
    },
  }
}

describe('optional Telegram startup', () => {
  test('does not verify identity or create a module when Telegram is disabled', async () => {
    const harness = createRuntime({ ...base, ...maxSettings, TELEGRAM_ENABLED: 'false' })
    let verifyCalls = 0
    let moduleCalls = 0

    const telegram = await startTelegramIfEnabled({
      runtime: harness.runtime,
      verifyIdentity: async () => {
        verifyCalls += 1
        return { id: 1n, username: 'OurMemoriesDevBot' }
      },
      createApi: () => ({}) as TelegramApi,
      createModule: () => {
        moduleCalls += 1
        return {} as never
      },
    })

    expect(telegram).toBeNull()
    expect(verifyCalls).toBe(0)
    expect(moduleCalls).toBe(0)
    expect(harness.closeCalls).toBe(0)
  })

  test('verifies identity before creating the enabled Telegram module', async () => {
    const harness = createRuntime({ ...base, ...telegramSettings })
    const calls: string[] = []
    const module = {} as ReturnType<typeof createTelegramModule>

    const telegram = await startTelegramIfEnabled({
      runtime: harness.runtime,
      verifyIdentity: async ({ token, expectedUsername }) => {
        calls.push(`verify:${token}:${expectedUsername}`)
        return { id: 42n, username: expectedUsername }
      },
      createApi: (token, maxBytes) => {
        calls.push(`api:${token}:${maxBytes}`)
        return {} as TelegramApi
      },
      createModule: ({ botId }) => {
        calls.push(`module:${botId}`)
        return module
      },
    })

    expect(telegram).toBe(module)
    expect(calls).toEqual([
      'verify:123456:adapter-secret:OurMemoriesDevBot',
      'api:123456:adapter-secret:20000000',
      'module:42',
    ])
  })

  test('closes the runtime and rethrows when enabled Telegram identity verification fails', async () => {
    const harness = createRuntime({ ...base, ...telegramSettings })
    const failure = new Error('identity verification failed')
    let moduleCalls = 0

    await expect(startTelegramIfEnabled({
      runtime: harness.runtime,
      verifyIdentity: async () => {
        throw failure
      },
      createApi: () => ({}) as TelegramApi,
      createModule: () => {
        moduleCalls += 1
        return {} as never
      },
    })).rejects.toBe(failure)

    expect(moduleCalls).toBe(0)
    expect(harness.closeCalls).toBe(1)
  })
})
