import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { createTelegramAuthOnlyFixture, signedTelegramFixtureData, telegramFixtureSubject } from './test-support/telegram-auth-only-fixture'

const databaseUrl = requireIntegrationDatabaseUrl()
const botToken = '123456:telegram-integration-secret'

describe('Telegram authentication exchange', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    TELEGRAM_ENABLED: 'false',
    TELEGRAM_AUTH_BOT_TOKEN: botToken,
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
    const maxUser = await prisma.user.create({ data: { displayName: 'Same name',
      externalIdentities: { create: { provider: 'max', subject: '99281912' } } } })
    const initData = signedInitData({ id: 99281912, first_name: 'Александр' })
    const first = await exchange(initData)
    const firstBody = await first.json()
    const cookie = first.headers.get('set-cookie')?.split(';', 1)[0]

    expect(first.status).toBe(200)
    expect(cookie).toContain('web_app_demo_refresh=')
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')
    expect(firstBody).not.toHaveProperty('refreshToken')
    expect(firstBody.user).toMatchObject({ email: null, displayName: 'Александр' })
    expect(firstBody.user).not.toHaveProperty('externalIdentity')
    expect(firstBody.user.id).not.toBe(maxUser.id)
    const [bound] = await prisma.$queryRaw<Array<{
      sessionId: string
      externalIdentityId: string | null
      provider: string | null
      subject: string | null
    }>>`
      SELECT s.id AS "sessionId", s.external_identity_id AS "externalIdentityId", i.provider::text AS provider, i.subject
        FROM auth_sessions s
        LEFT JOIN external_identities i ON i.id = s.external_identity_id
       WHERE s.id = (
         SELECT r.session_id FROM telegram_auth_replays r ORDER BY r.created_at DESC LIMIT 1
       )
    `
    expect(bound).toMatchObject({ provider: 'telegram', subject: '99281912' })
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
    const refreshedBody = await refresh.json()
    expect(refreshedBody).toHaveProperty('accessToken')
    const [afterRefresh] = await prisma.$queryRaw<Array<{ externalIdentityId: string | null }>>`
      SELECT external_identity_id AS "externalIdentityId"
        FROM auth_sessions
       WHERE id = ${bound.sessionId}
    `
    expect(afterRefresh?.externalIdentityId).toBe(bound?.externalIdentityId)
    const logout = await app.request('/api/v1/auth/logout', { method: 'POST', headers: {
      Origin: 'http://localhost:5173', Cookie: refresh.headers.get('set-cookie')!.split(';')[0]!,
    } })
    expect(logout.status).toBe(204)
    expect((await app.request('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${refreshedBody.accessToken}` },
    })).status).toBe(401)
  })

  test('rejects forged Telegram data and keeps legacy public auth routes absent', async () => {
    const forged = await exchange(`${signedInitData({ id: 7, first_name: 'Test' })}x`)
    expect(forged.status).toBe(401)
    expect((await exchange(signedInitData({ id: 8, first_name: 'Expired' }, 1))).status).toBe(401)
    const unconfigured = createApp({ env: { ...env, TELEGRAM_AUTH_BOT_TOKEN: undefined }, prisma })
    expect((await unconfigured.request('/api/v1/auth/telegram', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ initData: signedInitData({ id: 9, first_name: 'Closed' }) }),
    })).status).toBe(401)

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

test('auth-only signed sessions retain provider separation and enforce real family photo/MAX-video access', async () => {
  const videoBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109])
  const fixture = await createTelegramAuthOnlyFixture('http://localhost:5173', videoBytes)
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: fixture.app.fetch })
  const request = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init)
  const exchange = (initData: string) => request('/api/v1/auth/telegram', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: JSON.stringify({ initData }) })
  let outsiderId: string | undefined
  try {
    const login = await exchange(signedTelegramFixtureData())
    expect(login.status).toBe(200)
    const body = await login.json() as { accessToken: string; user: { id: string } }
    expect(body.user.id).toBe(fixture.viewerId)
    expect(body.user.id).not.toBe(fixture.maxUserId)
    const headers = { Authorization: `Bearer ${body.accessToken}` }
    // A matching MAX subject grants no family access: only the explicit viewer membership
    // below admits this independent Telegram user.
    await fixture.runtime.prisma.familyMember.delete({ where: { familyId_userId: {
      familyId: fixture.familyId, userId: fixture.viewerId,
    } } })
    expect((await request(fixture.photoPath, { headers })).status).toBe(404)
    expect((await request(fixture.videoPath, { headers })).status).toBe(404)
    await fixture.runtime.prisma.familyMember.create({ data: {
      familyId: fixture.familyId, userId: fixture.viewerId, role: 'viewer',
    } })
    expect((await request(`/api/v1/families/${fixture.familyId}/invites`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ role: 'viewer' }),
    })).status).toBe(403)
    const feed = await request(`/api/v1/families/${fixture.familyId}/memories`, { headers })
    expect(feed.status).toBe(200)
    expect(JSON.stringify(await feed.json())).not.toContain('okcdn.ru')
    const photo = await request(fixture.photoPath, { headers })
    expect(photo.status).toBe(200)
    expect(photo.headers.get('content-type')).toBe('image/webp')
    expect((await photo.arrayBuffer()).byteLength).toBeGreaterThan(0)
    const playback = await request(`/api/v1/families/${fixture.familyId}/media/playback-session`, { method: 'POST', headers })
    expect(playback.status).toBe(204)
    const cookie = playback.headers.get('set-cookie')!.split(';')[0]!
    const range = await request(fixture.videoPath, { headers: { Cookie: cookie, Range: 'bytes=0-3' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toBe(`bytes 0-3/${videoBytes.byteLength}`)
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(videoBytes.slice(0, 4))
    expect((await request(fixture.videoPath, { method: 'HEAD', headers })).status).toBe(200)
    const outsider = await exchange(signedTelegramFixtureData(telegramFixtureSubject + 1))
    expect(outsider.status).toBe(200)
    const outsiderBody = await outsider.json() as { accessToken: string; user: { id: string } }
    outsiderId = outsiderBody.user.id
    for (const path of [fixture.photoPath, fixture.videoPath]) {
      expect((await request(path)).status).toBe(401)
      expect((await request(path, { headers: { Authorization: `Bearer ${outsiderBody.accessToken}` } })).status).toBe(404)
    }
    await fixture.runtime.prisma.familyMember.update({ where: { familyId_userId: {
      familyId: fixture.familyId, userId: fixture.viewerId,
    } }, data: { revokedAt: new Date() } })
    for (const path of [fixture.photoPath, fixture.videoPath]) {
      expect((await request(path, { headers })).status).toBe(404)
      expect((await request(path, { headers: { Cookie: cookie } })).status).toBe(404)
    }
  } finally {
    server.stop(true)
    if (outsiderId) await fixture.runtime.prisma.user.delete({ where: { id: outsiderId } })
    await fixture.close()
  }
})

function signedInitData(user: { id: number; first_name: string }, authDate = Math.floor(Date.now() / 1000)) {
  const fields = new URLSearchParams({
    auth_date: String(authDate),
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
