import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { acquireUserAuthenticationAuthorityLock, createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { pngFixture } from '../../storage/storage-contract'
import { createPrivateStorage } from '../../storage'

const databaseUrl = process.env.TEST_DATABASE_URL
const maxBotToken = '987654:f12-session-replacement-secret'
const origin = 'https://app.example.com'
const storageRoot = resolve('.scratch', `f12-session-replacement-storage-${randomUUID()}`)

if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for this owned integration test')
const testDbUrl = new URL(databaseUrl)
if (
  testDbUrl.hostname !== '127.0.0.1' ||
  testDbUrl.port !== '56570' ||
  testDbUrl.username !== 'memoly_f12' ||
  testDbUrl.pathname !== '/memoly_f12_sessions_20261017_a91f_test' ||
  testDbUrl.searchParams.get('schema') !== 'public' ||
  process.env.DATABASE_URL !== databaseUrl
) throw new Error('F12 test requires its exact owned loopback database URL')

describe('MAX browser session replacement', () => {
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    MAX_ENABLED: 'true',
    MAX_BOT_TOKEN: maxBotToken,
    MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
    MAX_WEBHOOK_URL: 'https://api.example.com/webhooks/max',
    MAX_WEBHOOK_SECRET: 'M'.repeat(43),
    MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
    MAX_MINI_APP_URL: 'https://app.example.com',
    COOKIE_SECURE: 'true',
    CORS_ORIGINS: origin,
    PRIVATE_STORAGE_DRIVER: 'filesystem',
    PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
    PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '1000000',
  })
  const prisma = createPrisma(databaseUrl!)
  const storage = createPrivateStorage(env)
  const app = createApp({ env, prisma, privateStorage: storage })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('MAX identity B replaces the proven A browser session and invalidates its playback cookie', async () => {
    await mkdir(storageRoot, { recursive: true })
    const suffix = randomUUID()
    const aId = Date.now()
    const aInitData = signedMaxInitData({ id: aId, first_name: `F12-A-${suffix}` }, `a-${suffix}`)
    const a = await exchange(aInitData)
    expect(a.response.status).toBe(200)
    await prisma.pilotAdmission.create({ data: { provider: 'max', subject: String(aId) } })
    const aCookie = cookiePair(a.response)
    const initialAccessToken = a.body.accessToken as string
    const independentInitData = signedMaxInitData({ id: aId, first_name: `F12-A-${suffix}` }, `a-independent-${suffix}`)
    const independent = await exchange(independentInitData)
    expect(independent.response.status).toBe(200)
    const aFreshInitData = signedMaxInitData({ id: aId, first_name: `F12-A-${suffix}` }, `a-fresh-${suffix}`)
    const aFresh = await exchange(aFreshInitData, aCookie)
    expect(aFresh.response.status).toBe(200)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${initialAccessToken}` } })).status).toBe(401)
    const aCurrentCookie = cookiePair(aFresh.response)
    const aAccessToken = aFresh.body.accessToken as string
    const staleInitData = signedMaxInitData({ id: aId + 10, first_name: `F12 stale ${suffix}` }, `stale-${suffix}`)
    const staleReplacement = await exchange(staleInitData, aCookie)
    expect(staleReplacement.response.status).toBe(401)
    expect(staleReplacement.response.headers.get('set-cookie')).toBeNull()
    const replay = await exchange(aFreshInitData, aCurrentCookie)
    expect(replay.response.status).toBe(200)
    expect(replay.response.headers.get('set-cookie')).toBeNull()
    const invalid = await exchange('auth_date=0&query_id=invalid&user=%7B%7D&hash=bad', aCurrentCookie)
    expect(invalid.response.status).toBe(401)
    expect(invalid.response.headers.get('set-cookie')).toBeNull()
    const afterInvalid = await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${aAccessToken}` } })
    expect(afterInvalid.status).toBe(200)
    const wrongOrigin = await exchange(aFreshInitData, aCurrentCookie, 'https://untrusted.example')
    expect(wrongOrigin.response.status).toBe(403)
    expect(wrongOrigin.response.headers.get('set-cookie')).toBeNull()

    const familyResponse = await app.request('/api/v1/families', {
      method: 'POST',
      headers: { Authorization: `Bearer ${aAccessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ name: `F12 ${suffix}`, timezone: 'Europe/Moscow' }),
    })
    expect(familyResponse.status).toBe(201)
    const family = await familyResponse.json() as any

    const reservedResponse = await app.request(`/api/v1/families/${family.family.id}/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aAccessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength }),
    })
    expect(reservedResponse.status).toBe(201)
    const reserved = await reservedResponse.json() as any
    const upload = await app.request(reserved.upload.url, {
      method: 'PUT', headers: reserved.upload.headers, body: pngFixture as unknown as BodyInit,
    })
    expect(upload.status).toBe(200)
    const finalized = await app.request(`/api/v1/families/${family.family.id}/uploads/${reserved.upload.uploadId}/finalize`, {
      method: 'POST', headers: { Authorization: `Bearer ${aAccessToken}`, 'Idempotency-Key': randomUUID() },
    })
    expect(finalized.status).toBe(200)
    const asset = (await finalized.json() as any).asset
    const childAvatarReservation = await app.request(`/api/v1/families/${family.family.id}/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aAccessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ purpose: 'child_avatar', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength }),
    })
    expect(childAvatarReservation.status).toBe(201)
    const childAvatarUpload = await childAvatarReservation.json() as any
    expect((await app.request(childAvatarUpload.upload.url, {
      method: 'PUT', headers: childAvatarUpload.upload.headers, body: pngFixture as unknown as BodyInit,
    })).status).toBe(200)
    const childAvatarFinalized = await app.request(`/api/v1/families/${family.family.id}/uploads/${childAvatarUpload.upload.uploadId}/finalize`, {
      method: 'POST', headers: { Authorization: `Bearer ${aAccessToken}`, 'Idempotency-Key': randomUUID() },
    })
    expect(childAvatarFinalized.status).toBe(200)
    const completedChild = await app.request(`/api/v1/families/${family.family.id}/child`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${aAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `F12 child ${suffix}`, birthDate: '2024-01-01', sex: 'girl', avatarMediaId: (await childAvatarFinalized.json() as any).asset.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null }),
    })
    expect(completedChild.status).toBe(200)
    const child = (await completedChild.json() as any).child
    const memory = await app.request(`/api/v1/families/${family.family.id}/memories`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aAccessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ kind: 'photo', childId: child.id, body: '', occurredAt: new Date().toISOString(), mediaIds: [asset.id] }),
    })
    expect(memory.status).toBe(201)

    const playbackSession = await app.request(`/api/v1/families/${family.family.id}/media/playback-session`, {
      method: 'POST', headers: { Authorization: `Bearer ${aAccessToken}` },
    })
    expect(playbackSession.status).toBe(204)
    const mediaCookie = playbackSession.headers.get('set-cookie')?.split(';', 1)[0]
    expect(mediaCookie).toMatch(/^our_memories_media_access=/)
    const playbackPath = `/api/v1/families/${family.family.id}/media/${asset.id}/content?variant=original`
    const playbackBefore = await app.request(playbackPath, { headers: { Cookie: mediaCookie! } })
    expect(playbackBefore.status).toBe(200)
    await playbackBefore.arrayBuffer()
    const independentPlaybackSession = await app.request(`/api/v1/families/${family.family.id}/media/playback-session`, {
      method: 'POST', headers: { Authorization: `Bearer ${independent.body.accessToken}` },
    })
    expect(independentPlaybackSession.status).toBe(204)
    const independentMediaCookie = independentPlaybackSession.headers.get('set-cookie')?.split(';', 1)[0]
    expect(independentMediaCookie).toMatch(/^our_memories_media_access=/)

    const refresh = await app.request('/api/v1/auth/refresh', {
      method: 'POST', headers: { Origin: origin, Cookie: aCurrentCookie, 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(refresh.status).toBe(200)
    const bInitData = signedMaxInitData({ id: Date.now() + 1, first_name: `F12-B-${suffix}` }, `b-${suffix}`)
    const b = await exchange(bInitData, aCurrentCookie)
    expect(b.response.status).toBe(200)
    const oldPlayback = await app.request(playbackPath, { headers: { Cookie: mediaCookie! } })
    expect(oldPlayback.status).toBe(401)
    await oldPlayback.arrayBuffer()
    const oldBearer = await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${aAccessToken}` } })
    expect(oldBearer.status).toBe(401)
    const independentBearer = await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${independent.body.accessToken}` } })
    expect(independentBearer.status).toBe(200)
    const independentMedia = await app.request(playbackPath, { headers: { Cookie: independentMediaCookie! } })
    expect(independentMedia.status).toBe(200)
    await independentMedia.arrayBuffer()
    const freshBearer = await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${b.body.accessToken}` } })
    expect(freshBearer.status).toBe(200)
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: await sessionFromMaxReplay(aFreshInitData) } })).revokedAt).not.toBeNull()
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: await sessionFromMaxReplay(independentInitData) } })).revokedAt).toBeNull()
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: await sessionFromMaxReplay(bInitData) } })).revokedAt).toBeNull()
    const aIdentity = await prisma.externalIdentity.findUniqueOrThrow({ where: { provider_subject: { provider: 'max', subject: String(aId) } } })
    expect(await prisma.authSession.count({ where: { userId: aIdentity.userId, revokedAt: null } })).toBe(1)
    expect(await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: String(aId + 10) } } })).toBeNull()
    const loggedOut = await app.request('/api/v1/auth/logout', {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookiePair(b.response), 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(loggedOut.status).toBe(204)
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: await sessionFromMaxReplay(bInitData) } })).revokedAt).not.toBeNull()
    const playbackAfterLogout = await app.request(playbackPath, { headers: { Cookie: mediaCookie! } })
    expect(playbackAfterLogout.status).toBe(401)
    await playbackAfterLogout.arrayBuffer()
    const independentMediaAfterLogout = await app.request(playbackPath, { headers: { Cookie: independentMediaCookie! } })
    expect(independentMediaAfterLogout.status).toBe(200)
    await independentMediaAfterLogout.arrayBuffer()
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${aAccessToken}` } })).status).toBe(401)
  })

  test('browser-link redeem replaces only its browser predecessor, not the MAX approver session', async () => {
    const suffix = randomUUID()
    const browserId = Date.now() + 2
    const approverId = browserId + 1
    const browserInitData = signedMaxInitData({ id: browserId, first_name: `F12 browser ${suffix}` }, `browser-${suffix}`)
    const browser = await exchange(browserInitData)
    expect(browser.response.status).toBe(200)
    const browserRefresh = cookiePair(browser.response)
    const approver = await exchange(signedMaxInitData({ id: approverId, first_name: `F12 approver ${suffix}` }, `approver-${suffix}`))
    expect(approver.response.status).toBe(200)

    const start = await app.request('/api/v1/auth/browser-link/start', {
      method: 'POST', headers: { Origin: origin },
    })
    expect(start.status).toBe(200)
    const { challengeId, startParam } = await start.json() as any
    const verifierCookie = start.headers.get('set-cookie')?.split(';', 1)[0]
    expect(verifierCookie).toMatch(/^web_app_demo_browser_link=/)

    const approve = await app.request(`/api/v1/auth/browser-link/${challengeId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${approver.body.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, initData: signedMaxInitData(
        { id: approverId, first_name: `F12 approver ${suffix}` }, `approval-${suffix}`, startParam,
      ) }),
    })
    expect(approve.status).toBe(200)

    const invalidVerifier = await app.request(`/api/v1/auth/browser-link/${challengeId}/redeem`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: `web_app_demo_browser_link=wrong; ${browserRefresh}` },
    })
    expect(invalidVerifier.status).toBe(401)
    expect(invalidVerifier.headers.get('set-cookie')).toBeNull()
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${browser.body.accessToken}` } })).status).toBe(200)

    const redeemed = await app.request(`/api/v1/auth/browser-link/${challengeId}/redeem`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: `${verifierCookie}; ${browserRefresh}` },
    })
    expect(redeemed.status).toBe(200)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${browser.body.accessToken}` } })).status).toBe(401)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${approver.body.accessToken}` } })).status).toBe(200)
    const redeemedBody = await redeemed.json() as any
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${redeemedBody.accessToken}` } })).status).toBe(200)
    const browserSession = await sessionFromMaxReplay(browserInitData)
    const browserSessionRow = await prisma.authSession.findUniqueOrThrow({ where: { id: browserSession } })
    expect(browserSessionRow.revokedAt).not.toBeNull()
    expect(await prisma.authSession.count({ where: { userId: browserSessionRow.userId, revokedAt: null } })).toBe(0)
    const approverIdentity = await prisma.externalIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: 'max', subject: String(approverId) } },
    })
    expect(await prisma.authSession.count({ where: { userId: approverIdentity.userId, revokedAt: null } })).toBe(2)
  })

  test('browser-link redeem follows authority-before-session lock order during a role transition', async () => {
    const suffix = randomUUID()
    const maxId = Date.now() + 70
    const browserInitData = signedMaxInitData({ id: maxId, first_name: `F12 lock browser ${suffix}` }, `lock-browser-${suffix}`)
    const approverInitData = signedMaxInitData({ id: maxId, first_name: `F12 lock approver ${suffix}` }, `lock-approver-${suffix}`)
    const browser = await exchange(browserInitData)
    const approver = await exchange(approverInitData)
    expect(browser.response.status).toBe(200)
    expect(approver.response.status).toBe(200)
    const browserSessionId = await sessionFromMaxReplay(browserInitData)
    const identity = await prisma.externalIdentity.findUniqueOrThrow({
      where: { provider_subject: { provider: 'max', subject: String(maxId) } },
    })
    const browserCookie = cookiePair(browser.response)

    const start = await app.request('/api/v1/auth/browser-link/start', { method: 'POST', headers: { Origin: origin } })
    const { challengeId, startParam } = await start.json() as any
    const verifierCookie = start.headers.get('set-cookie')?.split(';', 1)[0]!
    const approved = await app.request(`/api/v1/auth/browser-link/${challengeId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${approver.body.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, initData: signedMaxInitData(
        { id: maxId, first_name: `F12 lock approver ${suffix}` }, `lock-approval-${suffix}`, startParam,
      ) }),
    })
    expect(approved.status).toBe(200)

    let releaseAuthority: (() => void) | undefined
    let authorityHeld: (() => void) | undefined
    const held = new Promise<void>((resolveHeld) => { authorityHeld = resolveHeld })
    const waitToUpdate = new Promise<void>((resolveUpdate) => { releaseAuthority = resolveUpdate })
    const authorityTransition = prisma.$transaction(async (tx) => {
      await acquireUserAuthenticationAuthorityLock(tx, identity.userId)
      authorityHeld!()
      await waitToUpdate
      return tx.authSession.update({ where: { id: browserSessionId }, data: { revokedAt: new Date() } })
    }, { timeout: 15_000 })

    let released = false
    try {
      await held
      const redeemPromise = app.request(`/api/v1/auth/browser-link/${challengeId}/redeem`, {
        method: 'POST', headers: { Origin: origin, Cookie: `${verifierCookie}; ${browserCookie}` },
      })

      let authorityWaitObserved = false
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%pg_advisory_xact_lock%'
          ) AS waiting
        `
        if (rows[0]?.waiting) {
          authorityWaitObserved = true
          break
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 10))
      }
      expect(authorityWaitObserved).toBe(true)
      releaseAuthority!()
      released = true
      await authorityTransition
      const redeemed = await redeemPromise
      expect(redeemed.status).toBe(401)
      expect(redeemed.headers.get('set-cookie')).toBeNull()
      expect((await prisma.authSession.findUniqueOrThrow({ where: { id: browserSessionId } })).revokedAt).not.toBeNull()
      expect((await app.request('/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${approver.body.accessToken}` },
      })).status).toBe(200)
    } finally {
      if (!released) releaseAuthority!()
      await authorityTransition.catch(() => undefined)
    }
  }, 20_000)

  test('fresh MAX login can replace its exact expired or absolute-expired browser credential', async () => {
    const suffix = randomUUID()
    const expiredInitData = signedMaxInitData({ id: Date.now() + 20, first_name: `F12 expired ${suffix}` }, `expired-base-${suffix}`)
    const expired = await exchange(expiredInitData)
    const expiredCookie = cookiePair(expired.response)
    const expiredSessionId = await sessionFromMaxReplay(expiredInitData)
    await prisma.authSession.update({
      where: { id: expiredSessionId }, data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const expiredReplay = await exchange(expiredInitData, expiredCookie)
    expect(expiredReplay.response.status).toBe(401)
    expect(expiredReplay.response.headers.get('set-cookie')).toBeNull()
    const afterExpiry = await exchange(signedMaxInitData({ id: Date.now() + 21, first_name: `F12 new expired ${suffix}` }, `expired-replacement-${suffix}`), expiredCookie)
    expect(afterExpiry.response.status).toBe(200)
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: expiredSessionId } })).revokedAt).not.toBeNull()

    const absoluteInitData = signedMaxInitData({ id: Date.now() + 22, first_name: `F12 absolute ${suffix}` }, `absolute-base-${suffix}`)
    const absolute = await exchange(absoluteInitData)
    const absoluteCookie = cookiePair(absolute.response)
    const absoluteSessionId = await sessionFromMaxReplay(absoluteInitData)
    await prisma.authSession.update({ where: { id: absoluteSessionId }, data: {
      createdAt: new Date(Date.now() - (env.SESSION_ABSOLUTE_TTL_DAYS + 1) * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 60_000),
    } })
    const absoluteReplay = await exchange(absoluteInitData, absoluteCookie)
    expect(absoluteReplay.response.status).toBe(401)
    expect(absoluteReplay.response.headers.get('set-cookie')).toBeNull()
    const afterAbsoluteExpiry = await exchange(signedMaxInitData({ id: Date.now() + 23, first_name: `F12 new absolute ${suffix}` }, `absolute-replacement-${suffix}`), absoluteCookie)
    expect(afterAbsoluteExpiry.response.status).toBe(200)
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: absoluteSessionId } })).revokedAt).not.toBeNull()
  })

  test('serializes competing MAX replacements of one browser credential', async () => {
    const suffix = randomUUID()
    const base = await exchange(signedMaxInitData({ id: Date.now() + 3, first_name: `F12 race ${suffix}` }, `race-base-${suffix}`))
    expect(base.response.status).toBe(200)
    const cookie = cookiePair(base.response)
    const competitors = await Promise.all([
      exchange(signedMaxInitData({ id: Date.now() + 4, first_name: `F12 race left ${suffix}` }, `race-left-${suffix}`), cookie),
      exchange(signedMaxInitData({ id: Date.now() + 5, first_name: `F12 race right ${suffix}` }, `race-right-${suffix}`), cookie),
    ])

    expect(competitors.map(({ response }) => response.status).sort()).toEqual([200, 401])
    const winner = competitors.find(({ response }) => response.status === 200)!
    const loser = competitors.find(({ response }) => response.status === 401)!
    expect(cookiePair(winner.response)).toContain('web_app_demo_refresh=')
    expect(loser.response.headers.get('set-cookie')).toBeNull()
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${base.body.accessToken}` } })).status).toBe(401)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${winner.body.accessToken}` } })).status).toBe(200)
  })

  test('serializes MAX replacement against browser-link redeem on the same predecessor', async () => {
    const suffix = randomUUID()
    const personId = Date.now() + 6
    const approverId = personId + 1
    const browser = await exchange(signedMaxInitData({ id: personId, first_name: `F12 intersect ${suffix}` }, `intersect-browser-${suffix}`))
    const approver = await exchange(signedMaxInitData({ id: approverId, first_name: `F12 intersect approver ${suffix}` }, `intersect-approver-${suffix}`))
    expect(browser.response.status).toBe(200)
    expect(approver.response.status).toBe(200)
    const browserCookie = cookiePair(browser.response)

    const start = await app.request('/api/v1/auth/browser-link/start', { method: 'POST', headers: { Origin: origin } })
    const { challengeId, startParam } = await start.json() as any
    const verifierCookie = start.headers.get('set-cookie')?.split(';', 1)[0]!
    const approved = await app.request(`/api/v1/auth/browser-link/${challengeId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${approver.body.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, initData: signedMaxInitData(
        { id: approverId, first_name: `F12 intersect approver ${suffix}` }, `intersect-approval-${suffix}`, startParam,
      ) }),
    })
    expect(approved.status).toBe(200)

    const [maxReplacement, browserRedeem] = await Promise.all([
      exchange(signedMaxInitData({ id: personId + 1, first_name: `F12 MAX winner ${suffix}` }, `intersect-max-${suffix}`), browserCookie),
      Promise.resolve(app.request(`/api/v1/auth/browser-link/${challengeId}/redeem`, {
        method: 'POST', headers: { Origin: origin, Cookie: `${verifierCookie}; ${browserCookie}` },
      })).then(async (response) => ({ response, body: await response.json().catch(() => ({})) as any })),
    ])

    expect([maxReplacement.response.status, browserRedeem.response.status].sort()).toEqual([200, 401])
    const winner = maxReplacement.response.status === 200 ? maxReplacement : browserRedeem
    const loser = maxReplacement.response.status === 401 ? maxReplacement : browserRedeem
    expect(loser.response.headers.get('set-cookie')).toBeNull()
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${browser.body.accessToken}` } })).status).toBe(401)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${winner.body.accessToken}` } })).status).toBe(200)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${approver.body.accessToken}` } })).status).toBe(200)
  })

  test('serializes MAX replacement against logout of the same predecessor', async () => {
    const suffix = randomUUID()
    const base = await exchange(signedMaxInitData({ id: Date.now() + 8, first_name: `F12 logout ${suffix}` }, `logout-base-${suffix}`))
    const cookie = cookiePair(base.response)
    const [replacement, logout] = await Promise.all([
      exchange(signedMaxInitData({ id: Date.now() + 9, first_name: `F12 replacement ${suffix}` }, `logout-replace-${suffix}`), cookie),
      app.request('/api/v1/auth/logout', {
        method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
      }),
    ])

    expect(logout.status).toBe(204)
    expect([200, 401]).toContain(replacement.response.status)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${base.body.accessToken}` } })).status).toBe(401)
    if (replacement.response.status === 200) {
      expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${replacement.body.accessToken}` } })).status).toBe(200)
      expect(replacement.response.headers.get('set-cookie')).toContain('web_app_demo_refresh=')
    } else {
      expect(replacement.response.headers.get('set-cookie')).toBeNull()
    }
  })

  test('refresh and logout serialize on the session row without resurrecting a session', async () => {
    const suffix = randomUUID()
    const baseInitData = signedMaxInitData({ id: Date.now() + 10, first_name: `F12 refresh logout ${suffix}` }, `refresh-logout-${suffix}`)
    const base = await exchange(baseInitData)
    const cookie = cookiePair(base.response)
    const [refresh, logout] = await Promise.all([
      app.request('/api/v1/auth/refresh', {
        method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
      }),
      app.request('/api/v1/auth/logout', {
        method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
      }),
    ])

    expect(logout.status).toBe(204)
    expect([200, 401]).toContain(refresh.status)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${base.body.accessToken}` } })).status).toBe(401)
    const sessionId = await sessionFromMaxReplay(baseInitData)
    expect((await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt).not.toBeNull()
  })

  test('MAX replacement serializes with refresh and a late refresh response cannot revive the old session', async () => {
    const suffix = randomUUID()
    const base = await exchange(signedMaxInitData({ id: Date.now() + 30, first_name: `F12 refresh race ${suffix}` }, `max-refresh-base-${suffix}`))
    const cookie = cookiePair(base.response)
    const maxInitData = signedMaxInitData({ id: Date.now() + 31, first_name: `F12 refresh target ${suffix}` }, `max-refresh-target-${suffix}`)
    const [replacement, refresh] = await Promise.all([
      exchange(maxInitData, cookie),
      app.request('/api/v1/auth/refresh', {
        method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
      }),
    ])

    expect(replacement.response.status).toBe(200)
    expect([200, 401]).toContain(refresh.status)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${base.body.accessToken}` } })).status).toBe(401)
    expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${replacement.body.accessToken}` } })).status).toBe(200)
    if (refresh.status === 200) {
      const lateRefreshCookie = cookiePair(refresh)
      const staleSuccessor = await exchange(
        signedMaxInitData({ id: Date.now() + 32, first_name: `F12 stale refresh ${suffix}` }, `max-refresh-stale-${suffix}`),
        lateRefreshCookie,
      )
      expect(staleSuccessor.response.status).toBe(401)
      expect(staleSuccessor.response.headers.get('set-cookie')).toBeNull()
    }
  })

  async function exchange(initData: string, cookie?: string, requestOrigin = origin) {
    const response = await app.request('/api/v1/auth/max', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ initData }),
    })
    return { response, body: await response.json() as any }
  }

  async function sessionFromMaxReplay(initData: string) {
    const hash = new URLSearchParams(initData).get('hash')!
    const fingerprintHash = createHash('sha256').update(hash.toLowerCase()).digest('hex')
    const replay = await prisma.maxAuthReplay.findUniqueOrThrow({ where: { fingerprintHash }, select: { sessionId: true } })
    return replay.sessionId!
  }

  function cookiePair(response: Response) {
    const value = response.headers.get('set-cookie')?.split(';', 1)[0]
    expect(value).toMatch(/^web_app_demo_refresh=/)
    return value!
  }
})

function signedMaxInitData(user: { id: number; first_name: string }, queryId: string, startParam?: string) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: queryId, user: JSON.stringify(user) })
  if (startParam) fields.set('start_param', startParam)
  const dataCheck = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheck).digest('hex'))
  return fields.toString()
}
