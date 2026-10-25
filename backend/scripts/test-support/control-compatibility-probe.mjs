// Synthetic current → frozen-33a → current application probe. Runs only inside an isolated *_test DB.
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [root, phase, stateFile, storageRoot] = process.argv.slice(2)
const load = (path) => import(pathToFileURL(resolve(root, 'backend/src', path)).href)
const [{ createApp }, { createPrisma }, { loadEnv }, { signAccessToken }] = await Promise.all([
  load('app.ts'), load('db.ts'), load('env.ts'), load('modules/auth/index.ts'),
])
const { pngFixture } = await import(pathToFileURL(resolve(import.meta.dir, '../../src/storage/storage-contract.ts')).href)
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl)
const database = new URL(databaseUrl)
assert.equal(database.hostname, '127.0.0.1')
assert.match(database.pathname, /^\/control_compat_[0-9a-z_]+_test$/)
const envFor = (ownerId = '') => loadEnv({
  DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4),
  MAX_ENABLED: 'true', MAX_BOT_TOKEN: '987654:control-compat-synthetic',
  MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot', MAX_WEBHOOK_URL: 'https://max.example.test/webhook',
  MAX_WEBHOOK_SECRET: 'M'.repeat(43), MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
  MAX_MINI_APP_URL: 'https://app.example.test', CORS_ORIGINS: 'http://localhost:5173',
  COOKIE_SECURE: 'false', MULTI_FAMILY_ACTIVATION: 'on', AUTH_RATE_LIMIT_MAX: '10000',
  CONTROL_ENABLED: 'true', CONTROL_OWNER_USER_IDS: ownerId,
  PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
  PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
})
const prisma = createPrisma(databaseUrl)
let app = createApp({ env: envFor(), prisma })
const request = async (path, token, method = 'GET', body, idempotencyKey) => {
  const response = await app.request('/api/v1' + path, {
    method,
    headers: { Origin: 'http://localhost:5173', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'POST' ? { 'Idempotency-Key': idempotencyKey ?? randomUUID() } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { response, status: response.status, body: text ? JSON.parse(text) : null }
}
const signed = (subject) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(), user: JSON.stringify({ id: subject, first_name: 'Control synthetic' }) })
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('987654:control-compat-synthetic').digest()
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return params.toString()
}
const actor = async (subject) => {
  const login = await request('/auth/max', null, 'POST', { initData: signed(subject) })
  assert.equal(login.status, 200)
  await prisma.pilotAdmission.upsert({ where: { provider_subject: { provider: 'max', subject: String(subject) } },
    create: { provider: 'max', subject: String(subject) }, update: {} })
  return { id: login.body.user.id, token: login.body.accessToken }
}
const snapshotControl = async () => JSON.parse(JSON.stringify({
  users: await prisma.controlUserActivity.findMany({ orderBy: [{ userId: 'asc' }, { utcDay: 'asc' }] }),
  families: await prisma.controlFamilyActivity.findMany({ orderBy: [{ familyId: 'asc' }, { userId: 'asc' }, { utcDay: 'asc' }] }),
  metrics: await prisma.controlMetricSnapshot.findMany({ orderBy: [{ sourceId: 'asc' }, { utcDay: 'asc' }] }),
  collections: await prisma.controlCollectionState.findMany({ orderBy: { id: 'asc' } }),
}))
try {
  if (phase === 'current-before') {
    const owner = await actor(Date.now())
    const guest = await actor(Date.now() + 1)
    app = createApp({ env: envFor(owner.id), prisma })
    const familyResult = await request('/families', owner.token, 'POST', { name: 'Control compatibility family', timezone: 'Europe/Moscow' })
    assert.equal(familyResult.status, 201)
    const familyId = familyResult.body.family.id
    const avatar = await prisma.mediaAsset.create({ data: {
      familyId, uploaderId: owner.id, sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
      originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'), byteSize: 1n, width: 1, height: 1,
      originalStatus: 'stored', renditionStatus: 'ready',
    } })
    const profile = await request(`/families/${familyId}/child`, owner.token, 'PUT', {
      name: 'Synthetic child', birthDate: '2024-01-01', sex: 'girl', avatarMediaId: avatar.id,
      avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    })
    assert.equal(profile.status, 200)
    const child = await prisma.child.findFirstOrThrow({ where: { familyId } })
    for (const [label, result] of [
      ['family', await request(`/families/${familyId}`, guest.token)],
      ['memory collection', await request(`/families/${familyId}/memories`, guest.token)],
      ['playback session', await request(`/families/${familyId}/media/playback-session`, guest.token, 'POST', {})],
    ]) assert.notEqual(result.status, label === 'playback session' ? 204 : 200, `nonmember unexpectedly accessed ${label}`)
    const activity = await request('/activity', owner.token, 'POST', { surface: 'pwa', familyId })
    assert.equal(activity.status, 204)
    const seeded = await prisma.controlMetricSnapshot.create({ data: {
      sourceId: 'synthetic_control_compatibility', utcDay: new Date('2026-10-25T00:00:00Z'),
      value: { marker: 'preserve-control-telemetry' }, observedAt: new Date(), lastAttemptAt: new Date(),
      status: 'ok', attempts: 1, successes: 1,
    } })
    await prisma.controlCollectionState.create({ data: { id: 'synthetic_control_compatibility', startedAt: new Date() } })
    const upload = await request(`/families/${familyId}/uploads`, owner.token, 'POST', {
      purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
    })
    assert.equal(upload.status, 201)
    const put = await app.request(upload.body.upload.url, { method: 'PUT', headers: upload.body.upload.headers, body: pngFixture })
    assert.equal(put.status, 200)
    assert.equal((await request(`/families/${familyId}/uploads/${upload.body.upload.uploadId}/finalize`, owner.token, 'POST')).status, 200)
    const memory = await request(`/families/${familyId}/memories`, owner.token, 'POST', {
      kind: 'photo', childId: child.id, body: 'control compatibility media', occurredAt: new Date().toISOString(), mediaIds: [upload.body.assetId],
    }, randomUUID())
    assert.equal(memory.status, 201)
    const invitation = await request(`/families/${familyId}/invites`, owner.token, 'POST', { role: 'full' })
    assert.equal(invitation.status, 201)
    const playback = await request(`/families/${familyId}/media/playback-session`, owner.token, 'POST', {})
    assert.equal(playback.status, 204)
    const mediaPath = `/api/v1/families/${familyId}/media/${upload.body.assetId}/content?variant=original`
    const media = await app.request(mediaPath, { headers: { Cookie: playback.response.headers.get('set-cookie').split(';')[0] } })
    assert.equal(media.status, 200)
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from(pngFixture))
    const control = await request('/control/overview', owner.token)
    assert.equal(control.status, 200)
    const ledger = await prisma.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`
    const telemetry = await snapshotControl()
    assert.ok(telemetry.users.length > 0 && telemetry.families.length > 0 && telemetry.metrics.some((row) => row.sourceId === seeded.sourceId) && telemetry.collections.some((row) => row.id === 'synthetic_control_compatibility'))
    writeFileSync(stateFile, JSON.stringify({ owner, guest, familyId, childId: child.id, memoryId: memory.body.id,
      assetId: upload.body.assetId, mediaPath, mediaCookie: playback.response.headers.get('set-cookie').split(';')[0],
      inviteToken: invitation.body.rawToken, bytesSha256: memory.body.attachments[0]?.sha256 ?? null, ledger, telemetry }))
  } else {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    const family = await request(`/families/${state.familyId}`, state.owner.token)
    assert.equal(family.status, 200)
    const memory = await request(`/families/${state.familyId}/memories/${state.memoryId}`, state.owner.token)
    assert.equal(memory.status, 200)
    assert.equal(memory.body.body, 'control compatibility media')
    const media = await app.request(state.mediaPath, { headers: { Cookie: state.mediaCookie } })
    assert.equal(media.status, 200)
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from(pngFixture))
    if (phase === 'rollback') {
      for (const [label, result] of [
        ['family', await request(`/families/${state.familyId}`, state.guest.token)],
        ['memory', await request(`/families/${state.familyId}/memories/${state.memoryId}`, state.guest.token)],
        ['playback session', await request(`/families/${state.familyId}/media/playback-session`, state.guest.token, 'POST', {})],
      ]) assert.notEqual(result.status, label === 'playback session' ? 204 : 200, `frozen 33a nonmember unexpectedly accessed ${label}`)
      const accepted = await request('/invites/accept', state.guest.token, 'POST', { token: state.inviteToken })
      assert.equal(accepted.status, 200)
      const legacyMemory = await request(`/families/${state.familyId}/memories`, state.owner.token, 'POST', {
        kind: 'note', childId: state.childId, body: 'written by frozen 33a', occurredAt: new Date().toISOString(),
      }, randomUUID())
      assert.equal(legacyMemory.status, 201)
      state.legacyMemoryId = legacyMemory.body.id
      writeFileSync(stateFile, JSON.stringify(state))
    } else if (phase === 'current-after') {
      app = createApp({ env: envFor(state.owner.id), prisma })
      const accepted = await request(`/families/${state.familyId}/memories/${state.legacyMemoryId}`, state.owner.token)
      assert.equal(accepted.status, 200)
      assert.equal(accepted.body.body, 'written by frozen 33a')
      const member = await request(`/families/${state.familyId}/members`, state.guest.token)
      assert.equal(member.status, 200)
      assert.equal((await request('/control/overview', state.guest.token)).status, 403)
      assert.deepEqual(await snapshotControl(), state.telemetry)
      const ledger = await prisma.$queryRaw`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`
      assert.deepEqual(JSON.parse(JSON.stringify(ledger)), state.ledger)
      assert.equal((await request('/control/overview', state.owner.token)).status, 200)
    } else throw new Error(`Unknown Control compatibility phase: ${phase}`)
  }
  process.stdout.write(JSON.stringify({ phase, success: true }) + '\n')
} finally { await prisma.$disconnect() }
