import { createHmac } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const maxBotToken = '987654:max-integration-secret'
const telegramBotToken = '123456:telegram-integration-secret'

maybeDescribe('MAX authentication exchange', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    MAX_ENABLED: 'true',
    MAX_BOT_TOKEN: maxBotToken,
    MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
    MAX_WEBHOOK_URL: 'https://api.example.com/webhooks/max',
    MAX_WEBHOOK_SECRET: 'M'.repeat(43),
    MAX_MINI_APP_URL: 'https://app.example.com',
    TELEGRAM_BOT_TOKEN: telegramBotToken,
    TELEGRAM_INBOX_ENCRYPTION_KEY: 'A'.repeat(43),
    TELEGRAM_BOT_EXPECTED_USERNAME: 'OurMemoriesDevBot',
    CORS_ORIGINS: 'http://localhost:5173',
  })
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.maxAuthReplay.deleteMany()
    await prisma.telegramAuthReplay.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('issues a session, binds replay to that session, and reuses an existing MAX identity', async () => {
    const initData = signedMaxInitData({ id: 31415926, first_name: 'Max' }, 'first-query')
    const first = await exchangeMax(initData)
    const firstBody = await first.json()
    const cookie = first.headers.get('set-cookie')?.split(';', 1)[0]

    expect(first.status).toBe(200)
    expect(cookie).toContain('web_app_demo_refresh=')
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')
    expect(firstBody).not.toHaveProperty('refreshToken')
    expect(firstBody.user).toMatchObject({ email: null, displayName: 'Max' })
    expect(await prisma.authSession.count()).toBe(1)
    expect(await prisma.maxAuthReplay.count()).toBe(1)

    const reordered = new URLSearchParams(
      [...new URLSearchParams(initData).entries()].reverse(),
    ).toString()
    expect((await exchangeMax(reordered)).status).toBe(401)
    expect((await exchangeMax(initData, cookie)).status).toBe(200)
    expect(await prisma.authSession.count()).toBe(1)

    const second = await exchangeMax(
      signedMaxInitData({ id: 31415926, first_name: 'Max' }, 'second-query'),
    )
    expect(second.status).toBe(200)
    expect(await prisma.externalIdentity.count({ where: { provider: 'max', subject: '31415926' } })).toBe(1)
    expect(await prisma.authSession.count()).toBe(2)
  })

  test('keeps the same numeric subject isolated between Telegram and MAX', async () => {
    const max = await exchangeMax(signedMaxInitData({ id: 27182818, first_name: 'Max' }, 'max-query'))
    const telegram = await exchangeTelegram(signedTelegramInitData({ id: 27182818, first_name: 'Telegram' }))

    expect(max.status).toBe(200)
    expect(telegram.status).toBe(200)
    expect(await prisma.externalIdentity.count({ where: { subject: '27182818' } })).toBe(2)
    expect(await prisma.user.count()).toBe(2)
  })

  function exchangeMax(initData: string, cookie?: string) {
    return app.request('/api/v1/auth/max', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({ initData }),
    })
  }

  function exchangeTelegram(initData: string) {
    return app.request('/api/v1/auth/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ initData }),
    })
  }
})

function signedMaxInitData(user: { id: number; first_name: string }, queryId: string) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: queryId,
    user: JSON.stringify(user),
  })
  const launchParams = [...fields.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  fields.set('hash', createHmac('sha256', secretKey).update(launchParams).digest('hex'))
  return fields.toString()
}

function signedTelegramInitData(user: { id: number; first_name: string }) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'telegram-query',
    user: JSON.stringify(user),
  })
  const launchParams = [...fields.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(telegramBotToken).digest()
  fields.set('hash', createHmac('sha256', secretKey).update(launchParams).digest('hex'))
  return fields.toString()
}
