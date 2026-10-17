// Runs only inside the roundtrip integration test's private *_test database.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHmac, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [root, phase, stateFile, storageRoot] = process.argv.slice(2)
const load = (path) => import(pathToFileURL(resolve(root, 'backend/src', path)).href)
const { createApp } = await load('app.ts')
const { createPrisma } = await load('db.ts')
const { loadEnv } = await load('env.ts')
const { createPrivateStorage } = await load('storage/index.ts')
const { pngFixture } = await load('storage/storage-contract.ts')
const { enqueueTask, drainTaskOutbox } = await load('outbox/index.ts')
const { createSourceMemoryPublisher } = await load('modules/memories/infrastructure/source-memory-publisher.ts')
const { createPrismaFamilyAccess } = await load('modules/families/infrastructure/family-access.ts')
const databaseUrl = process.env.TEST_DATABASE_URL
const address = new URL(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl)
assert.equal(address.hostname, '127.0.0.1')
assert.match(address.pathname, /^\/memoly_rollback_roundtrip_[0-9_]+_test$/)
const botToken = '987654:rollback-synthetic'
const env = loadEnv({
  DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4),
  MAX_ENABLED: 'true', MAX_BOT_TOKEN: botToken, MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
  MAX_WEBHOOK_URL: 'https://max.example.test/webhook', MAX_WEBHOOK_SECRET: 'M'.repeat(43),
  MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43), MAX_MINI_APP_URL: 'https://app.example.test',
  CORS_ORIGINS: 'http://localhost:5173', COOKIE_SECURE: 'false',
  MULTI_FAMILY_ACTIVATION: 'on', AUTH_RATE_LIMIT_MAX: '10000',
  PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
  PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
})
const prisma = createPrisma(databaseUrl)
const storage = createPrivateStorage(env)
const app = createApp({ env, prisma, privateStorage: storage })
let checks = 0
const equal = (a, b) => { checks++; assert.deepEqual(a, b) }
async function request(path, token, method = 'GET', body, cookie) {
  const response = await app.request('/api/v1' + path, {
    method, headers: { Origin: 'http://localhost:5173',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { response, status: response.status, body: text ? JSON.parse(text) : null }
}
const signed = (id) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(), user: JSON.stringify({ id, first_name: 'Synthetic rollback' }) })
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return params.toString()
}
async function actor(id, cookie) {
  const auth = await request('/auth/max', null, 'POST', { initData: signed(id) }, cookie)
  equal(auth.status, 200)
  await prisma.pilotAdmission.upsert({ where: { provider_subject: { provider: 'max', subject: String(id) } },
    create: { provider: 'max', subject: String(id) }, update: {} })
  return { id: auth.body.user.id, token: auth.body.accessToken,
    cookie: auth.response.headers.get('set-cookie').split(';')[0] }
}
async function family(owner) {
  const created = await request('/families', owner.token, 'POST', { name: 'Synthetic family', timezone: 'Europe/Moscow' })
  equal(created.status, 201)
  const id = created.body.family.id
  const avatar = await prisma.mediaAsset.create({ data: { familyId: id, uploaderId: owner.id,
    sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo', originalKey: 'media-originals/' + randomUUID(),
    declaredMime: 'image/png', verifiedMime: 'image/png', sha256: 'a'.repeat(64), byteSize: 1n,
    width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready' } })
  const child = await prisma.child.create({ data: { familyId: id, displayName: 'Synthetic child',
    birthDate: new Date('2024-01-01'), sex: 'girl', avatarMediaId: avatar.id,
    avatarCrop: { x: 0, y: 0, width: 1, height: 1 } } })
  return { id, childId: child.id }
}
async function invite(owner, target, fam, role) {
  const invitation = await request('/families/' + fam.id + '/invites', owner.token, 'POST', { role })
  equal(invitation.status, 201)
  equal((await request('/invites/accept', target.token, 'POST', { token: invitation.body.rawToken })).status, 200)
}
const note = (who, fam, text) => request('/families/' + fam.id + '/memories', who.token, 'POST',
  { kind: 'note', childId: fam.childId, body: text, occurredAt: '2026-10-01T10:00:00.000Z' })
try {
  if (phase === 'new') {
    const baseId = Date.now()
    const owner = await actor(baseId)
    const independent = await actor(baseId)
    const secondOwner = await actor(baseId + 1)
    const viewer = await actor(baseId + 2)
    const outsider = await actor(baseId + 3)
    const first = await family(owner)
    const second = await family(secondOwner)
    await invite(secondOwner, owner, second, 'full')
    await invite(owner, viewer, first, 'viewer')
    const initialNote = await note(owner, first, 'new version note')
    equal(initialNote.status, 201)
    equal((await note(owner, second, 'new full-role note')).status, 201)
    equal((await note(viewer, first, 'denied')).status, 403)
    equal((await request('/families/' + first.id + '/memories', outsider.token)).status, 404)
    const reserved = await request('/families/' + first.id + '/uploads', owner.token, 'POST', {
      purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength })
    equal(reserved.status, 201)
    equal((await app.request(reserved.body.upload.url, { method: 'PUT',
      headers: reserved.body.upload.headers, body: pngFixture })).status, 200)
    equal((await request('/families/' + first.id + '/uploads/' + reserved.body.upload.uploadId + '/finalize',
      owner.token, 'POST')).status, 200)
    const photo = await request('/families/' + first.id + '/memories', owner.token, 'POST',
      { kind: 'photo', childId: first.childId, body: '', occurredAt: '2026-10-01T10:00:00.000Z',
        mediaIds: [reserved.body.assetId] })
    equal(photo.status, 201)
    const playback = await request('/families/' + first.id + '/media/playback-session', owner.token, 'POST', {})
    equal(playback.status, 204)
    const mediaCookie = playback.response.headers.get('set-cookie').split(';')[0]
    const mediaPath = '/api/v1/families/' + first.id + '/media/' + reserved.body.assetId + '/content?variant=original'
    equal((await app.request(mediaPath, { headers: { Cookie: mediaCookie } })).status, 200)
    await actor(baseId + 3, owner.cookie) // F12 must revoke only the replaced browser session.
    equal((await request('/auth/me', owner.token)).status, 401)
    equal((await request('/auth/me', independent.token)).status, 200)
    const queued = { memoryId: randomUUID(), familyId: first.id, childId: first.childId, authorId: owner.id }
    await enqueueTask(prisma, { type: 'rollback:publish', dedupeKey: queued.memoryId, payload: queued },
      { 'rollback:publish': { run: async () => {} } })
    const state = { owner, independent, viewer, outsider, first, second, queued,
      initialNoteId: initialNote.body.id, photoId: photo.body.id, mediaPath, mediaCookie }
    writeFileSync(stateFile, JSON.stringify(state))
  } else {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    const { owner, independent, viewer, outsider, first, second } = state
    const hub = await request('/me/families', independent.token)
    equal(hub.status, 200)
    equal(hub.body.items.length, 2)
    equal(hub.body.items.every((item) => item.unreadState === 'ready'), true)
    equal((await request('/families/' + first.id + '/memories/' + state.initialNoteId, viewer.token)).status, 200)
    equal((await request('/families/' + first.id + '/memories', outsider.token)).status, state.outsiderAdmitted ? 200 : 404)
    equal((await request('/auth/me', owner.token)).status, 401)
    equal((await request('/auth/me', independent.token)).status, 200)
    equal((await app.request(state.mediaPath, { headers: { Cookie: state.mediaCookie } })).status, 401)
    equal((await app.request(state.mediaPath, { headers: { Authorization: 'Bearer ' + independent.token } })).status, 200)
    equal((await note(viewer, first, 'still denied')).status, 403)
    if (phase === 'old') {
      const written = await note(independent, second, 'old version full-role write')
      equal(written.status, 201)
      state.oldNoteId = written.body.id
      const publisher = createSourceMemoryPublisher(prisma, createPrismaFamilyAccess(prisma))
      const sessionId = (await prisma.authSession.findFirstOrThrow({ where: { userId: independent.id, revokedAt: null } })).id
      const drained = await drainTaskOutbox({ prisma }, { handlers: { 'rollback:publish': { run: async ({ payload }) => {
        await publisher.publish({ familyId: payload.familyId, principal: { userId: payload.authorId, sessionId } },
          { id: payload.memoryId, childId: payload.childId, kind: 'note', body: 'old worker publication',
            occurredAt: new Date('2026-10-01'), sourcePublishedAt: new Date(), mediaIds: [] })
      } } } })
      equal(drained.done, 1)
      equal((await prisma.memory.findUniqueOrThrow({ where: { id: state.queued.memoryId } })).status, 'published')
      await invite(independent, outsider, first, 'viewer')
      equal((await request('/families/' + first.id + '/memories', outsider.token)).status, 200)
      // That participant is now legitimately admitted; retain a separate denied-viewer write check.
      equal((await note(outsider, first, 'still viewer')).status, 403)
      equal((await request('/families/' + first.id + '/memories/seen', viewer.token, 'POST', {
        memoryIds: [state.initialNoteId, state.photoId, state.queued.memoryId], expectedMembershipEpoch: 1 })).status, 204)
      const viewerHub = await request('/me/families', viewer.token)
      equal(viewerHub.body.items[0].unreadCount, 0)
      state.outsiderAdmitted = true
      writeFileSync(stateFile, JSON.stringify(state))
    } else {
      equal((await request('/families/' + second.id + '/memories/' + state.oldNoteId, independent.token)).status, 200)
      equal((await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: state.queued.memoryId } })).status, 'done')
      equal(await prisma.memorySeen.count({ where: { userId: viewer.id, familyId: first.id } }), 3)
      equal((await request('/me/families', viewer.token)).body.items[0].unreadCount, 0)
    }
    const published = await prisma.memory.findMany({ where: { familyId: first.id, firstPublishedOrdinal: { not: null } } })
    equal(new Set(published.map((memory) => String(memory.firstPublishedOrdinal))).size, published.length)
    equal((await prisma.family.findUniqueOrThrow({ where: { id: first.id } })).publicationOrdinal, BigInt(published.length))
  }
  console.log(JSON.stringify({ phase, checks, success: true }))
} finally { await prisma.$disconnect() }
