import { createHmac } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const botToken = '123456:telegram-integration-secret'

maybeDescribe('Telegram authentication exchange', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_INBOX_ENCRYPTION_KEY: 'A'.repeat(43),
    TELEGRAM_BOT_EXPECTED_USERNAME: 'OurMemoriesDevBot',
    CORS_ORIGINS: 'http://localhost:5173',
  })
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.telegramAuthReplay.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('issues one HttpOnly application session and binds a replay to that session', async () => {
    const initData = signedInitData({ id: 99281912, first_name: 'Александр' })
    const first = await exchange(initData)
    const firstBody = await first.json()
    const cookie = first.headers.get('set-cookie')?.split(';', 1)[0]

    expect(first.status).toBe(200)
    expect(cookie).toContain('web_app_demo_refresh=')
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')
    expect(firstBody).not.toHaveProperty('refreshToken')
    expect(firstBody.user).toMatchObject({ email: null, displayName: 'Александр' })
    expect(await prisma.authSession.count()).toBe(1)

    const reorderedInitData = new URLSearchParams(
      [...new URLSearchParams(initData).entries()].reverse(),
    ).toString()
    const foreignReplay = await exchange(reorderedInitData)
    expect(foreignReplay.status).toBe(401)
    expect(await prisma.authSession.count()).toBe(1)

    const sameSessionReplay = await exchange(initData, cookie)
    expect(sameSessionReplay.status).toBe(200)
    expect(await prisma.authSession.count()).toBe(1)

    const refresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: cookie!,
      },
      body: '{}',
    })
    expect(refresh.status).toBe(200)
    expect(await refresh.json()).toHaveProperty('accessToken')
  })

  test('rejects forged Telegram data and keeps legacy public auth routes absent', async () => {
    const forged = await exchange(`${signedInitData({ id: 7, first_name: 'Test' })}x`)
    expect(forged.status).toBe(401)

    for (const path of [
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/password-reset/request',
      '/api/v1/auth/register',
      '/api/v1/auth/login',
    ]) {
      expect((await app.request(path, { method: 'POST' })).status).toBe(404)
    }
  })

  function exchange(initData: string, cookie?: string) {
    return app.request('/api/v1/auth/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ initData }),
    })
  }
})

function signedInitData(user: { id: number; first_name: string }) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(user),
  })
  const dataCheckString = [...fields.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return fields.toString()
}
