import { expect, test } from 'bun:test'

import { loadEnv } from './env'
import { createBackendRuntime } from './runtime'
import { startTelegramIfEnabled } from './telegram-startup'

const base = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/auth_only_test',
  JWT_SECRET: '0123456789abcdef'.repeat(4),
  TELEGRAM_ENABLED: 'false',
}
const token = '123456:synthetic-auth-only-token'

test('auth-only configuration retains its token without starting Telegram or requiring inbox keys', async () => {
  const runtime = createBackendRuntime({ ...base, TELEGRAM_AUTH_BOT_TOKEN: token })
  try {
    expect(runtime.env).toHaveProperty('TELEGRAM_AUTH_BOT_TOKEN', token)
    expect(runtime.env.TELEGRAM_ENABLED).toBe(false)
    expect(runtime.env.TELEGRAM_BOT_TOKEN).toBeUndefined()
    expect(runtime.env.TELEGRAM_INBOX_ENCRYPTION_KEY).toBeUndefined()
    let calls = 0
    const telegram = await startTelegramIfEnabled({ runtime, verifyIdentity: async () => {
      calls += 1
      throw new Error('Auth-only must not call getMe')
    } })
    expect(telegram).toBeNull()
    expect(calls).toBe(0)
  } finally {
    await runtime.close()
  }
})

test('different auth and message bot tokens are rejected without including either value', () => {
  let error: unknown
  try {
    loadEnv({ ...base, TELEGRAM_ENABLED: 'true', TELEGRAM_AUTH_BOT_TOKEN: token,
      TELEGRAM_BOT_TOKEN: 'different-synthetic-token', TELEGRAM_INBOX_ENCRYPTION_KEY: 'A'.repeat(43) })
  } catch (caught) { error = caught }
  expect(error).toBeDefined()
  expect(String(error)).toContain('TELEGRAM_AUTH_BOT_TOKEN')
  expect(String(error)).not.toContain(token)
  expect(String(error)).not.toContain('different-synthetic-token')
})

test('legacy message token still requires message mode and matching dual tokens are supported', () => {
  expect(() => loadEnv({ ...base, TELEGRAM_BOT_TOKEN: token })).toThrow('TELEGRAM_ENABLED=false')
  expect(() => loadEnv({ ...base, TELEGRAM_ENABLED: 'true', TELEGRAM_AUTH_BOT_TOKEN: token })).toThrow('TELEGRAM_BOT_TOKEN is required')
  expect(loadEnv({ ...base, TELEGRAM_ENABLED: 'true', TELEGRAM_AUTH_BOT_TOKEN: token,
    TELEGRAM_BOT_TOKEN: token, TELEGRAM_INBOX_ENCRYPTION_KEY: 'A'.repeat(43) }).TELEGRAM_ENABLED).toBe(true)
})
