import { createHmac, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { createTelegramLinkTokens } from './infrastructure/telegram-link-tokens'

const databaseUrl = requireIntegrationDatabaseUrl()
const origin = 'https://app.example.test'
const maxToken = '123456:max-link-fixture'
const telegramToken = '987654:telegram-link-fixture'

describe('Cross-provider identity linking', () => {
  const db = createPrisma(databaseUrl)
  const env = loadEnv({ DATABASE_URL: databaseUrl, JWT_SECRET: '0123456789abcdef'.repeat(4),
    MAX_ENABLED: 'true', MAX_BOT_TOKEN: maxToken, MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
    MAX_WEBHOOK_URL: 'https://example.com/webhooks/max', MAX_WEBHOOK_SECRET: 'M'.repeat(43),
    MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43), MAX_MINI_APP_URL: 'https://app.example.com',
    TELEGRAM_ENABLED: 'false', TELEGRAM_AUTH_BOT_TOKEN: telegramToken,
    TELEGRAM_BOT_EXPECTED_USERNAME: 'OurMemoriesDevBot', CORS_ORIGINS: origin,
    AUTH_RATE_LIMIT_MAX: '10000', MULTI_FAMILY_ACTIVATION: 'on', COOKIE_SECURE: 'true' })
  const tokens = createTelegramLinkTokens(env.JWT_SECRET)
  const app = createApp({ env, prisma: db })
  const users = new Set<string>()
  const families: string[] = []
  let owner: { id: string; accessToken: string; sessionId: string; cookie: string }
  let familyId: string

  beforeEach(async () => {
    const result = await exchange('max', signed(maxToken))
    const body = await result.json()
    users.add(body.user.id)
    const session = await db.authSession.findFirstOrThrow({ where: { userId: body.user.id } })
    owner = { id: body.user.id, accessToken: body.accessToken, sessionId: session.id, cookie: cookie(result) }
    familyId = randomUUID()
    families.push(familyId)
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: familyId, ownerUserId: owner.id, name: 'Link fixture family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId: owner.id, role: 'full' } })
    })
  })

  afterAll(async () => {
    await db.family.deleteMany({ where: { id: { in: families } } })
    await db.user.deleteMany({ where: { id: { in: [...users] } } })
    await db.$disconnect()
  })

  test('links a free signed Telegram to the same owner, family and permissions without changing MAX sessions', async () => {
    const before = await db.family.findUniqueOrThrow({ where: { id: familyId }, include: { members: true } })
    const launch = await start()
    expect(launch.startParam).toMatch(/^link_[A-Za-z0-9_-]{70}$/)
    const record = tokens.verify(launch.startParam.slice(5))
    expect(new Date(launch.expiresAt).getTime() - record.issuedAt).toBe(15000)
    expect(record.sourceSessionId).toBe(owner.sessionId)
    const initData = signed(telegramToken, { start_param: launch.startParam })
    const result = await exchange('telegram', initData)
    expect(result.status).toBe(200)
    const body = await result.json()
    expect(body.user.id).toBe(owner.id)
    expect(result.headers.get('set-cookie')).toContain('HttpOnly')
    const me = await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${body.accessToken}` } })
    expect(await me.json()).toMatchObject({ user: { id: owner.id }, externalIdentityProvider: 'telegram' })
    expect((await app.request(`/api/v1/families/${familyId}`, { headers: { Authorization: `Bearer ${body.accessToken}` } })).status).toBe(200)
    expect(await db.family.findUniqueOrThrow({ where: { id: familyId }, include: { members: true } })).toEqual(before)
    expect((await db.authSession.findUniqueOrThrow({ where: { id: owner.sessionId } })).revokedAt).toBeNull()
    expect(await status()).toEqual({ connected: true })
    expect(await start()).toEqual({ connected: true })
    expect((await exchange('telegram', initData, cookie(result))).status).toBe(200)
    expect((await exchange('telegram', initData)).status).toBe(401)
    expect((await exchange('telegram', signed(telegramToken, { start_param: launch.startParam }))).status).toBe(400)
    expect(await db.externalIdentity.count({ where: { userId: owner.id } })).toBe(2)
  })

  test('does not merge an occupied Telegram or change its user identity and sessions', async () => {
    const subject = nextSubject()
    const telegram = await exchange('telegram', signed(telegramToken, {}, subject))
    const other = await telegram.json()
    users.add(other.user.id)
    const before = await db.authSession.findMany({ where: { userId: other.user.id } })
    const launch = await start()
    const result = await exchange('telegram', signed(telegramToken, { start_param: launch.startParam }, subject), cookie(telegram))
    expect(result.status).toBe(409)
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(await db.authSession.findMany({ where: { userId: other.user.id } })).toEqual(before)
    expect((await db.externalIdentity.findUniqueOrThrow({ where: { provider_subject: { provider: 'telegram', subject: String(subject) } } })).userId).toBe(other.user.id)
    expect(await db.telegramAuthReplay.count({ where: { fingerprintHash: tokens.verify(launch.startParam.slice(5)).tokenHash } })).toBe(0)
    expect(await status()).toEqual({ connected: false })
  })

  test('expired, forged, stale-auth and unsigned link payloads never create users or identities', async () => {
    const current = await start()
    const initialUsers = await db.user.count()
    expect((await exchange('telegram', `${signed(telegramToken, { start_param: current.startParam })}x`)).status).toBe(401)
    expect((await exchange('telegram', signed(telegramToken, { start_param: 'link_invalid' }))).status).toBe(400)
    const missingSignature = new URLSearchParams(signed(telegramToken))
    missingSignature.set('start_param', current.startParam)
    expect((await exchange('telegram', missingSignature.toString())).status).toBe(401)
    const expired = `link_${tokens.create(owner.sessionId, new Date(Date.now() - 15_000))}`
    expect((await exchange('telegram', signed(telegramToken, { start_param: expired }))).status).toBe(400)
    expect((await exchange('telegram', signed(telegramToken, { start_param: current.startParam, auth_date: String(Math.floor(Date.now() / 1000) - 60) }))).status).toBe(400)
    const modified = current.startParam.slice(0, -2) + (current.startParam.at(-2) === 'A' ? 'B' : 'A') + current.startParam.at(-1)
    expect((await exchange('telegram', signed(telegramToken, { start_param: modified }))).status).toBe(400)
    expect(await db.user.count()).toBe(initialUsers)
    expect(await db.externalIdentity.count({ where: { userId: owner.id, provider: 'telegram' } })).toBe(0)
  })

  test('rejects missing/wrong-origin/non-MAX start and invalidates a link when its MAX session is revoked', async () => {
    expect((await app.request('/api/v1/auth/telegram-link', { method: 'POST', headers: { Origin: origin } })).status).toBe(401)
    expect((await app.request('/api/v1/auth/telegram-link', { method: 'POST', headers: { Authorization: `Bearer ${owner.accessToken}`, Origin: 'https://evil.example' } })).status).toBe(403)
    const telegram = await exchange('telegram', signed(telegramToken))
    const body = await telegram.json()
    users.add(body.user.id)
    expect((await app.request('/api/v1/auth/telegram-link', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${body.accessToken}` } })).status).toBe(401)
    const launch = await start()
    await db.authSession.update({ where: { id: owner.sessionId }, data: { revokedAt: new Date() } })
    expect((await exchange('telegram', signed(telegramToken, { start_param: launch.startParam }))).status).toBe(400)
  })

  test('one key has one winner under concurrent distinct Telegram identities', async () => {
    const launch = await start()
    const before = await db.user.count()
    const responses = await Promise.all([1, 2].map(() => exchange('telegram', signed(telegramToken, { start_param: launch.startParam }))))
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400])
    expect(await db.externalIdentity.count({ where: { userId: owner.id, provider: 'telegram' } })).toBe(1)
    expect(await db.user.count()).toBe(before)
    expect(await db.authSession.count({ where: { userId: owner.id } })).toBe(2)
  })

  test('deadline is rechecked after a real database lock wait', async () => {
    const issuedAt = new Date(Date.now() - 14_700)
    const launch = { startParam: `link_${tokens.create(owner.sessionId, issuedAt)}` }
    let release!: () => void
    let locked!: () => void
    const acquired = new Promise<void>((resolve) => { locked = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${owner.sessionId}::uuid FOR UPDATE`
      locked()
      await gate
    }, { timeout: 10000 })
    await acquired
    const pending = exchange('telegram', signed(telegramToken, { start_param: launch.startParam }))
    try {
      let waiting = false
      const deadline = Date.now() + 5000
      while (!waiting && Date.now() < deadline) {
        const [row] = await db.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM auth_sessions WHERE id = %') AS waiting
        `
        waiting = row!.waiting
        if (!waiting) await Bun.sleep(10)
      }
      expect(waiting).toBe(true)
      while (Date.now() <= issuedAt.getTime() + 15_000) await Bun.sleep(10)
    } finally { release(); await holder }
    expect((await pending).status).toBe(400)
    expect(await db.externalIdentity.count({ where: { userId: owner.id, provider: 'telegram' } })).toBe(0)
  })

  test('linked owner sessions and one-use fingerprints survive the pinned S3 recovery runtime and return', async () => {
    const root = resolve(import.meta.dir, '../../../..')
    const scratchRoot = resolve(root, '.scratch')
    mkdirSync(scratchRoot, { recursive: true })
    const fixture = mkdtempSync(resolve(scratchRoot, 'identity-link-recovery-'))
    if (!fixture.startsWith(`${scratchRoot}${sep}`)) throw new Error('Recovery fixture escaped task scratch')
    const run = (command: string, args: string[], input?: Uint8Array) => {
      const result = spawnSync(command, args, { cwd: fixture, input, env: { ...process.env, CHECKPOINT_DISABLE: '1' }, timeout: 120000, maxBuffer: 48 * 1024 * 1024 })
      if (result.status !== 0) throw new Error(`Frozen runtime preparation failed: ${result.stderr.toString()}`)
      return result.stdout
    }
    try {
      const archive = spawnSync('git', ['archive', '26cfab9ce35fd1a42279fc0d9dd3637c340eec6a', 'backend', 'packages', 'scripts/repo-env.mjs', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'], { cwd: root, maxBuffer: 48 * 1024 * 1024 })
      expect(archive.status).toBe(0)
      run('tar', ['-x'], archive.stdout)
      run('bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'])
      run('bun', ['run', '--cwd', 'backend', 'prisma:generate'])
      const launch = await start()
      const initData = signed(telegramToken, { start_param: launch.startParam })
      const linked = await exchange('telegram', initData)
      expect(linked.status).toBe(200)
      const body = await linked.json()
      expect(body.user.id).toBe(owner.id)
      const before = await db.family.findUniqueOrThrow({ where: { id: familyId }, include: { members: true } })
      const marker = tokens.verify(launch.startParam.slice(5)).tokenHash
      const replayBefore = await db.telegramAuthReplay.findUniqueOrThrow({ where: { fingerprintHash: marker } })
      const ledger = await db.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`
      const frozen = await import(pathToFileURL(resolve(fixture, 'backend/src/app.ts')).href)
      const frozenEnv = await import(pathToFileURL(resolve(fixture, 'backend/src/env.ts')).href)
      const oldApp = frozen.createApp({ env: frozenEnv.loadEnv({ DATABASE_URL: databaseUrl,
        JWT_SECRET: env.JWT_SECRET, CORS_ORIGINS: origin, COOKIE_SECURE: 'true', MULTI_FAMILY_ACTIVATION: 'on' }), prisma: db })
      for (const runtime of [oldApp, app]) {
        const headers = { Authorization: `Bearer ${body.accessToken}` }
        const me = await runtime.request('/api/v1/auth/me', { headers })
        expect(me.status).toBe(200)
        expect(await me.json()).toMatchObject({ user: { id: owner.id }, externalIdentityProvider: 'telegram' })
        expect((await runtime.request(`/api/v1/families/${familyId}`, { headers })).status).toBe(200)
        expect((await runtime.request(`/api/v1/families/${familyId}/members`, { headers })).status).toBe(200)
      }
      const refreshed = await oldApp.request('/api/v1/auth/refresh', { method: 'POST', headers: { Origin: origin, Cookie: cookie(linked) } })
      expect(refreshed.status).toBe(200)
      expect((await app.request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${(await refreshed.json()).accessToken}` } })).status).toBe(200)
      expect((await exchange('telegram', signed(telegramToken, { start_param: launch.startParam }))).status).toBe(400)
      expect(await db.telegramAuthReplay.findUniqueOrThrow({ where: { fingerprintHash: marker } })).toEqual(replayBefore)
      expect(await db.family.findUniqueOrThrow({ where: { id: familyId }, include: { members: true } })).toEqual(before)
      expect(await db.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`).toEqual(ledger)
    } finally {
      if (!fixture.startsWith(`${scratchRoot}${sep}`)) throw new Error('Refusing fixture cleanup outside task scratch')
      rmSync(fixture, { recursive: true, force: true })
    }
  }, 180000)

  async function start() {
    const response = await app.request('/api/v1/auth/telegram-link', { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${owner.accessToken}` } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    return response.json()
  }
  async function status() {
    const response = await app.request('/api/v1/auth/telegram-link', { headers: { Authorization: `Bearer ${owner.accessToken}` } })
    expect(response.status).toBe(200)
    return response.json()
  }
  function exchange(provider: 'max' | 'telegram', initData: string, presentedCookie?: string) {
    return app.request(`/api/v1/auth/${provider}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(presentedCookie ? { Cookie: presentedCookie } : {}) },
      body: JSON.stringify({ initData }) })
  }
})

let sequence = Math.floor(Math.random() * 1_000_000)
function nextSubject() { return 880_000_000 + ++sequence }
function signed(token: string, extra: Record<string, string> = {}, subject = nextSubject()) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: randomUUID(),
    user: JSON.stringify({ id: subject, first_name: 'Link fixture' }), ...extra })
  const check = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}
function cookie(response: Response) { return response.headers.get('set-cookie')!.split(';')[0]! }
