import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [root, phase, statePath, prefix] = process.argv.slice(2)
assert.match(prefix, /^recovery-checks\/[a-f0-9-]{36}\/$/)
const url = new URL(process.env.TEST_DATABASE_URL)
assert.equal(url.hostname, '127.0.0.1')
assert.match(url.pathname, /^\/s3_recovery_[0-9]+_[a-f0-9]+_test$/)
assert.equal(process.env.DATABASE_URL, url.toString())
const load = (path) => import(pathToFileURL(resolve(root, 'backend/src', path)).href)
const [{ createApp }, { createPrisma }, { loadEnv }, { createPrivateStorage }, { signAccessToken }] = await Promise.all([
  load('app.ts'), load('db.ts'), load('env.ts'), load('storage/index.ts'), load('modules/auth/index.ts'),
])
const env = loadEnv({ DATABASE_URL: url.toString(), NODE_ENV: 'test', JWT_SECRET: 's3-recovery-synthetic-secret-0123456789',
  PRIVATE_STORAGE_DRIVER: 's3', PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true', PRIVATE_STORAGE_FORCE_PATH_STYLE: process.env.TEST_S3_RECOVERY_FORCE_PATH_STYLE,
  ...Object.fromEntries(['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'].map(k => [`PRIVATE_STORAGE_${k}`, process.env[`TEST_S3_RECOVERY_${k}`]])),
  CORS_ORIGINS: 'http://localhost:5173', COOKIE_SECURE: 'false', MULTI_FAMILY_ACTIVATION: 'on' })
const db = createPrisma(url.toString()), privateStorage = createPrivateStorage(env), storage = privateStorage.storage
const app = createApp({ env, prisma: db, privateStorage })
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
const digest = b => createHash('sha256').update(b).digest('hex')
const json = async (path, actor, body) => {
  const r = await app.request(`/api/v1${path}`, { method: 'POST', headers: { Authorization: `Bearer ${actor.token}`,
    Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body) })
  assert.equal(r.status, 201, 'synthetic publication failed')
  return r.json()
}
const photo = async (state, actor, expected) => {
  const r = await app.request(`/api/v1/families/${state.family.id}/media/${state.asset.id}/content?variant=original`, {
    headers: { Authorization: `Bearer ${actor.token}`, 'X-Private-Media-Purpose': 'image' } })
  if (expected === 200) { assert.equal(r.status, 200); assert.equal(digest(Buffer.from(await r.arrayBuffer())), digest(bytes)) }
  else assert.ok([403, 404].includes(r.status), 'foreign or revoked member read private media')
}
let subjectSequence = 7_900_000_000
async function actor() {
  const user = await db.user.create({ data: { displayName: 'S3 recovery synthetic' } })
  const subject = String(++subjectSequence)
  const identity = await db.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } })
  await db.pilotAdmission.create({ data: { provider: 'max', subject } })
  const session = await db.authSession.create({ data: { userId: user.id, externalIdentityId: identity.id,
    refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 60 * 60_000) } })
  return { id: user.id, token: await signAccessToken({ sub: user.id, sessionId: session.id }, env) }
}
async function family(owner) {
  const f = await db.family.create({ data: { name: 'S3 recovery synthetic', timezone: 'UTC', ownerUserId: owner.id,
    members: { create: { userId: owner.id, role: 'full' } } } })
  const child = await db.child.create({ data: { familyId: f.id, displayName: 'Synthetic', birthDate: new Date('2025-01-01') } })
  return { id: f.id, childId: child.id }
}
async function asset(family, owner, label) {
  const key = prefix + label + '.png'
  await storage.writeObject({ key, body: new Response(bytes).body, contentLength: bytes.length, contentType: 'image/png' })
  const row = await db.mediaAsset.create({ data: { familyId: family.id, uploaderId: owner.id, sourceKind: 'web', purpose: 'memory',
    mediaKind: 'photo', originalKey: key, declaredMime: 'image/png', verifiedMime: 'image/png', sha256: digest(bytes), byteSize: BigInt(bytes.length),
    width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready' } })
  for (const variant of ['preview', 'display']) {
    const objectKey = prefix + label + '-' + variant + '.png'
    await storage.writeObject({ key: objectKey, body: new Response(bytes).body, contentLength: bytes.length, contentType: 'image/png' })
    await db.mediaVariant.create({ data: { familyId: family.id, mediaId: row.id, variant, objectKey,
      sha256: digest(bytes), byteSize: BigInt(bytes.length), mime: 'image/png', width: 1, height: 1 } })
  }
  return { id: row.id, key }
}
async function ledger() {
  return db.$queryRaw`SELECT migration_name, checksum, finished_at::text, rolled_back_at::text FROM _prisma_migrations ORDER BY migration_name, started_at, id`
}
async function assertBytes(key) {
  const object = await storage.readObject({ key }); assert.ok(object)
  assert.equal(digest(Buffer.from(await new Response(object.body).arrayBuffer())), digest(bytes))
}
try {
  const lifecycle = await load('modules/control/infrastructure/control-lifecycle.ts')
  const { runControlDeletionMaintenance } = await load('modules/control/infrastructure/control-purge.ts')
  if (phase === 'seed-current') {
    const owner = await actor(), foreign = await actor(), guest = await actor()
    const ownFamily = await family(owner), foreignFamily = await family(foreign), purgeFamily = await family(owner)
    const active = await asset(ownFamily, owner, 'active'), purged = await asset(purgeFamily, owner, 'purge')
    const memory = await json(`/families/${ownFamily.id}/memories`, owner, { kind: 'photo', childId: ownFamily.childId,
      occurredAt: new Date().toISOString(), body: 'Synthetic preserved caption', mediaIds: [active.id] })
    await db.familyMember.create({ data: { familyId: ownFamily.id, userId: guest.id, role: 'viewer' } })
    const state = { owner, foreign, guest, family: ownFamily, foreignFamily, purgeFamily, asset: active, purged, memoryId: memory.id,
      retiredKey: prefix + 'late-retired.png', inFlightKey: prefix + 'in-flight.png', ledger: await ledger() }
    await photo(state, guest, 200)
    await db.familyMember.update({ where: { familyId_userId: { familyId: ownFamily.id, userId: guest.id } }, data: { revokedAt: new Date() } })
    state.retiredTicket = await storage.createUploadUrl({ key: state.retiredKey, contentType: 'image/png', byteSize: bytes.length })
    state.inFlightTicket = await storage.createUploadUrl({ key: state.inFlightKey, contentType: 'image/png', byteSize: bytes.length })
    await storage.retireObject(state.retiredKey)
    const preview = await lifecycle.previewFamilyDeletion(db, purgeFamily.id)
    await lifecycle.purgeControlFamily(db, { actorId: foreign.id, targetId: purgeFamily.id, protectedIds: [foreign.id],
      key: randomUUID(), fingerprint: preview.fingerprint, confirmation: purgeFamily.id })
    const failedKey = prefix + 'purge-preview.png'
    const failing = new Proxy(storage, { get(target, key) {
      if (key === 'retireObject') return async objectKey => { if (objectKey === failedKey) throw Error('synthetic interrupted purge'); return target.retireObject(objectKey) }
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value
    } })
    for (const minutes of [17, 35, 52]) await runControlDeletionMaintenance({ db, storage: failing }, new Date(Date.now() + minutes * 60_000), 10)
    const operation = await db.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId: purgeFamily.id } })
    assert.equal(operation.purgedAt, null)
    assert.equal(await storage.headObject(purged.key), null)
    assert.ok(await storage.headObject(failedKey))
    writeFileSync(statePath, JSON.stringify({ ...state, purgeId: operation.id }), { mode: 0o600 })
  } else {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    await photo(state, state.owner, 200); await photo(state, state.foreign, 403); await photo(state, state.guest, 403)
    await assertBytes(state.asset.key)
    assert.equal(await storage.headObject(state.retiredKey), null)
    const late = await fetch(state.retiredTicket.url, { method: 'PUT', headers: state.retiredTicket.headers, body: bytes })
    assert.equal(late.status, 412, 'retirement barrier did not survive version change')
    if (phase === 'baseline') {
      const upload = await fetch(state.inFlightTicket.url, { method: 'PUT', headers: state.inFlightTicket.headers, body: bytes })
      assert.equal(upload.status, 200, 'in-flight upload did not survive version change')
      await assertBytes(state.inFlightKey)
      const note = await json(`/families/${state.foreignFamily.id}/memories`, state.foreign, { kind: 'note',
        childId: state.foreignFamily.childId, body: 'Synthetic baseline write', occurredAt: new Date().toISOString() })
      state.baselineMemoryId = note.id
      for (let i = 0; i < 12; i++) {
        await runControlDeletionMaintenance({ db, storage }, new Date(Date.now() + (120 + i * 17) * 60_000), 10)
        if ((await db.controlFamilyDeletion.findUniqueOrThrow({ where: { id: state.purgeId } })).purgedAt) break
      }
      assert.ok((await db.controlFamilyDeletion.findUniqueOrThrow({ where: { id: state.purgeId } })).purgedAt)
      writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 })
    } else {
      assert.equal(phase, 'current-after')
      await assertBytes(state.inFlightKey)
      assert.equal(await db.family.findUnique({ where: { id: state.purgeFamily.id } }), null)
      assert.ok((await db.controlFamilyDeletion.findUniqueOrThrow({ where: { id: state.purgeId } })).purgedAt)
      assert.equal((await db.memory.findUniqueOrThrow({ where: { id: state.baselineMemoryId } })).body, 'Synthetic baseline write')
      const memory = await db.memory.findUniqueOrThrow({ where: { id: state.memoryId }, include: { media: true } })
      assert.equal(memory.body, 'Synthetic preserved caption'); assert.equal(memory.media.length, 1)
    }
    assert.deepEqual(await ledger(), state.ledger)
  }
  console.log(JSON.stringify({ phase, success: true }))
} catch (error) {
  // Provider exceptions can contain signed capabilities. Never emit raw errors.
  console.error(JSON.stringify({ phase, success: false, type: error?.name ?? 'Error', code: error?.code,
    assertion: error?.code === 'ERR_ASSERTION' ? error.message : undefined }))
  process.exitCode = 1
} finally { await db.$disconnect() }
