import { describe, expect, test } from 'bun:test'

import { createApp } from '../../../app'
import type { DbClient } from '../../../db'
import { loadEnv } from '../../../env'

const base = {
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '0123456789abcdef'.repeat(4),
  CORS_ORIGINS: 'https://web.example.com',
  ACCESS_TOKEN_TTL_SECONDS: '60',
  TRUST_PROXY: 'true',
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
  COOKIE_SECURE: 'true',
}
const env = loadEnv(base)

describe('public Block 01 auth routes', () => {
  test('limits Telegram exchange bodies before signature work', async () => {
    const app = createApp({ env: { ...env, AUTH_BODY_LIMIT_BYTES: 32 }, prisma: {} as DbClient })
    const response = await telegramRequest(app, { initData: 'x'.repeat(64) })
    expect(response.status).toBe(413)
  })

  test('rate limits repeated Telegram exchanges by the configured client address', async () => {
    const app = createApp({ env: { ...env, AUTH_RATE_LIMIT_MAX: 1 }, prisma: {} as DbClient })
    const request = () => telegramRequest(app, { initData: 'invalid' }, {
      'X-Forwarded-For': '10.10.0.8',
      'Do-Connecting-Ip': '203.0.113.10',
    })

    expect((await request()).status).toBe(401)
    const limited = await request()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })

  test('rejects secure cookie writes from an untrusted origin before auth work', async () => {
    const app = createApp({ env, prisma: {} as DbClient })
    const response = await telegramRequest(app, { initData: 'invalid' }, {
      Origin: 'https://attacker.example',
    })
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
  })

  test('production physically exposes neither dev login nor legacy password routes', async () => {
    const production = loadEnv({
      ...base,
      NODE_ENV: 'production',
      TELEGRAM_BOT_TOKEN: '123456:production-secret',
      PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_REGION: 'ru-central1',
      PRIVATE_STORAGE_BUCKET: 'uploads',
      PRIVATE_STORAGE_ENDPOINT: 'https://storage.example.com',
      PRIVATE_STORAGE_ACCESS_KEY_ID: 'access-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'secret-key',
      PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
    })
    const app = createApp({ env: production, prisma: {} as DbClient })

    for (const path of [
      '/api/v1/auth/dev-login',
      '/api/v1/auth/register',
      '/api/v1/auth/login',
      '/api/v1/auth/password-reset/request',
      '/api/auth/register',
      '/api/auth/login',
    ]) {
      expect((await app.request(path, { method: 'POST' })).status).toBe(404)
    }
  })
})

function telegramRequest(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request('/api/v1/auth/telegram', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://web.example.com',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}
