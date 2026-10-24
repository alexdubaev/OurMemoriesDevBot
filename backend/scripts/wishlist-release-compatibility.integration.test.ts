import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'
import { createPrisma } from '../src/db'
import { createApp } from '../src/app'
import { loadEnv } from '../src/env'
import { signAccessToken } from '../src/modules/auth'
import { createPrivateStorage } from '../src/storage'
import { pngFixture } from '../src/storage/storage-contract'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const acceptedRuntime = '33a0054c3c71372aa5509ee8ebfa4578ad512ea1'

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout = 120_000) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) {
    const reason = result.error ? `spawn=${result.error.message}` : `exit=${result.status} signal=${result.signal}`
    throw new Error(`${command} ${args.join(' ')} failed (${reason})\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

test('gift photos survive the frozen v4 cleanup and remain usable after returning to current', async () => {
  const adminUrl = requireIntegrationDatabaseUrl()
  if (!adminUrl || process.env.DATABASE_URL !== adminUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(adminUrl)
  const parsedAdminUrl = new URL(adminUrl)
  if (parsedAdminUrl.hostname !== '127.0.0.1') throw new Error('Loopback test database required')

  const databaseName = `wishlist_release_${process.pid}_${Date.now()}_test`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${databaseName}`
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch', 'wishlist-release-compat-'))
  const runtimeRoot = resolve(fixture, 'accepted-v4')
  const storageRoot = resolve(fixture, 'private-storage')
  const runtimeProbe = resolve(runtimeRoot, 'backend/scripts/wishlist-runtime-probe.mjs')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    CHECKPOINT_DISABLE: '1',
    DATABASE_URL: databaseUrl.toString(),
    TEST_DATABASE_URL: databaseUrl.toString(),
  }
  const admin = new Client({ connectionString: adminUrl })
  let databaseCreated = false
  let db: ReturnType<typeof createPrisma> | undefined

  try {
    await admin.connect()

    const archive = spawnSync('git', ['archive', acceptedRuntime, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'], {
      cwd: root, encoding: null, timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    })
    if (archive.status !== 0) throw new Error(`Cannot archive frozen runtime ${acceptedRuntime}: ${archive.stderr}`)
    mkdirSync(runtimeRoot)
    const extract = spawnSync('tar', ['-x', '-C', runtimeRoot], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 30_000 })
    if (extract.status !== 0) throw new Error(`Cannot extract frozen runtime: ${extract.stderr}`)
    run('bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], runtimeRoot, env)
    run('bun', ['run', '--cwd', 'backend', 'prisma:generate'], runtimeRoot, env)

    await admin.query(`CREATE DATABASE "${databaseName}"`)
    databaseCreated = true
    run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], root, env)
    db = createPrisma(databaseUrl.toString())

    const migrationRoot = resolve(backendRoot, 'prisma/migrations')
    const { readdir } = await import('node:fs/promises')
    const migrations = (await readdir(migrationRoot)).filter((name) => /^\d{14}_/.test(name)).sort()
    const expectedLedger = migrations.map((name) => ({
      migration_name: name,
      checksum: createHash('sha256').update(readFileSync(resolve(migrationRoot, name, 'migration.sql'))).digest('hex'),
    }))
    const ledgerSnapshot = async () => db!.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM _prisma_migrations ORDER BY migration_name
    `
    const beforeLedger = await ledgerSnapshot()
    expect(beforeLedger.map(({ migration_name, checksum }) => ({ migration_name, checksum }))).toEqual(expectedLedger)
    expect(beforeLedger.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true)

    const owner = await db.user.create({ data: { displayName: 'Wishlist recovery synthetic owner' } })
    const buyer = await db.user.create({ data: { displayName: 'Wishlist recovery synthetic buyer' } })
    const viewer = await db.user.create({ data: { displayName: 'Wishlist recovery synthetic viewer' } })
    const familyId = randomUUID()
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: familyId, ownerUserId: owner.id, name: 'Wishlist recovery synthetic family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId: owner.id, role: 'full' } })
      await tx.familyMember.create({ data: { familyId, userId: buyer.id, role: 'full' } })
      await tx.familyMember.create({ data: { familyId, userId: viewer.id, role: 'viewer' } })
    })
    const child = await db.child.create({ data: { familyId, displayName: 'Synthetic child' } })
    const createSession = async (userId: string) => db!.authSession.create({ data: {
      userId, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000),
    } })
    const [ownerSession, buyerSession, viewerSession] = await Promise.all([createSession(owner.id), createSession(buyer.id), createSession(viewer.id)])
    const appEnv = loadEnv({
      DATABASE_URL: databaseUrl.toString(), NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4),
      CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000', PRIVATE_STORAGE_DRIVER: 'filesystem',
      PRIVATE_STORAGE_LOCAL_ROOT: storageRoot, PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
      PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '100000000', MEDIA_FAMILY_QUOTA_BYTES: '1000000000',
    })
    const privateStorage = createPrivateStorage(appEnv)
    const app = createApp({ env: appEnv, prisma: db, privateStorage })
    const tokens = new Map<string, string>(await Promise.all([
      [owner.id, ownerSession.id], [buyer.id, buyerSession.id], [viewer.id, viewerSession.id],
    ].map(async ([userId, sessionId]) => [userId!, `Bearer ${await signAccessToken({ sub: userId!, sessionId: sessionId! }, appEnv)}`] as const)))
    const request = async (userId: string, path: string, method = 'GET', body?: unknown, idempotencyKey?: string, extraHeaders: Record<string, string> = {}) => {
      const response = await app.request(`/api/v1${path}`, {
        method,
        headers: { authorization: tokens.get(userId)!, ...extraHeaders, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      return { response, body: text ? JSON.parse(text) : null }
    }
    const uploadGiftPhoto = async (userId: string) => {
      const reserved = await request(userId, `/families/${familyId}/uploads`, 'POST', {
        purpose: 'gift', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
      }, randomUUID())
      expect(reserved.response.status, JSON.stringify(reserved.body)).toBe(201)
      const stored = await app.request(reserved.body.upload.url, { method: 'PUT', headers: reserved.body.upload.headers, body: pngFixture as unknown as BodyInit })
      expect(stored.status).toBe(200)
      const finalized = await request(userId, `/families/${familyId}/uploads/${reserved.body.upload.uploadId}/finalize`, 'POST', {})
      expect(finalized.response.status, JSON.stringify(finalized.body)).toBe(200)
      return reserved.body.assetId as string
    }
    const photoContent = async (userId: string, mediaId: string) => app.request(
      `/api/v1/families/${familyId}/media/${mediaId}/content?variant=original`,
      { headers: { authorization: tokens.get(userId)! } },
    )

    const note = await request(owner.id, `/families/${familyId}/memories`, 'POST', {
      kind: 'note', childId: child.id, body: 'ordinary note before frozen recovery', occurredAt: new Date().toISOString(),
    }, randomUUID())
    expect(note.response.status, JSON.stringify(note.body)).toBe(201)
    const originalPhotoId = await uploadGiftPhoto(owner.id)
    const originalObject = await privateStorage.storage.readObject({ key: (await db.mediaAsset.findUniqueOrThrow({ where: { id: originalPhotoId } })).originalKey })
    expect(originalObject).not.toBeNull()
    const photoBytes = Buffer.from(await new Response(originalObject!.body).arrayBuffer())
    const photoSha256 = createHash('sha256').update(photoBytes).digest('hex')
    const createdGift = await request(owner.id, `/families/${familyId}/gifts`, 'POST', {
      title: 'Synthetic recovery gift', url: 'https://shop.example/recovery-gift', photoMediaId: originalPhotoId,
    }, randomUUID())
    expect(createdGift.response.status, JSON.stringify(createdGift.body)).toBe(201)
    const giftId = createdGift.body.gift.id as string
    const reservedGift = await request(buyer.id, `/families/${familyId}/gifts/${giftId}/reservation`, 'POST', { expectedVersion: 1 })
    expect(reservedGift.response.status, JSON.stringify(reservedGift.body)).toBe(200)
    const boughtGift = await request(buyer.id, `/families/${familyId}/gifts/${giftId}/purchase`, 'POST', { expectedVersion: 2 })
    expect(boughtGift.response.status, JSON.stringify(boughtGift.body)).toBe(200)
    expect(boughtGift.body.gift.reservation).toMatchObject({ userId: buyer.id, boughtAt: expect.any(String) })
    await db.mediaAsset.update({ where: { id: originalPhotoId }, data: { createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) } })

    const familyBeforeLegacy = await db.family.findUniqueOrThrow({ where: { id: familyId } })
    const giftBeforeLegacy = await db.gift.findUniqueOrThrow({ where: { id: giftId } })
    const photoBeforeLegacy = await db.mediaAsset.findUniqueOrThrow({ where: { id: originalPhotoId } })
    const outboxBeforeLegacy = await db.taskOutbox.count()
    const currentBytesBefore = await photoContent(viewer.id, originalPhotoId)
    expect(currentBytesBefore.status).toBe(200)
    expect(createHash('sha256').update(Buffer.from(await currentBytesBefore.arrayBuffer())).digest('hex')).toBe(photoSha256)

    const seedPath = resolve(fixture, 'seed.json')
    writeFileSync(seedPath, JSON.stringify({ ownerId: owner.id, familyId, childId: child.id, noteId: note.body.id, giftId,
      photoId: originalPhotoId, buyerId: buyer.id, ownerSessionId: ownerSession.id, storageRoot, photoSha256 }))
    const probeSource = `
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createPrisma } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { loadEnv } from '../src/env.ts'
import { signAccessToken } from '../src/modules/auth/index.ts'
import { runBackgroundJob } from '../src/jobs.ts'
import { createMediaTasks } from '../src/modules/media/index.ts'
import { createPrivateStorage } from '../src/storage/index.ts'
const [mode, seedPath] = process.argv.slice(2)
const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl)
assert.equal(new URL(databaseUrl).hostname, '127.0.0.1')
assert.match(new URL(databaseUrl).pathname, /^\\/wishlist_release_[0-9]+_[0-9]+_test$/)
const env = loadEnv({ DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000', PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: seed.storageRoot })
const prisma = createPrisma(databaseUrl)
const privateStorage = createPrivateStorage(env)
const app = createApp({ env, prisma, privateStorage })
const legacyMediaPrisma = (client) => new Proxy(client, {
  get(target, property) {
    if (property === 'mediaAsset') {
      const delegate = target.mediaAsset
      return new Proxy(delegate, {
        get(receiver, method) {
          if (method === 'findUnique') return async ({ where }) => {
            const rows = await target.$queryRawUnsafe('SELECT id, family_id, original_key, media_kind::text AS media_kind, byte_size, original_status::text AS original_status, deleted_at, storage_deleted_at FROM media_assets WHERE id = $1::uuid', where.id)
            if (!rows.length) return null
            const variants = await target.$queryRawUnsafe('SELECT object_key FROM media_variants WHERE media_id = $1::uuid', where.id)
            const row = rows[0]
            return { id: row.id, familyId: row.family_id, originalKey: row.original_key, mediaKind: row.media_kind,
              byteSize: row.byte_size, originalStatus: row.original_status, deletedAt: row.deleted_at,
              storageDeletedAt: row.storage_deleted_at, variants: variants.map(({ object_key }) => ({ objectKey: object_key })) }
          }
          const value = Reflect.get(receiver, method, receiver)
          return typeof value === 'function' ? value.bind(receiver) : value
        },
      })
    }
    if (property === '$transaction') return (callback) => target.$transaction((tx) => callback(legacyMediaPrisma(tx)))
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
})
const token = 'Bearer ' + await signAccessToken({ sub: seed.ownerId, sessionId: seed.ownerSessionId }, env)
const request = async (path, method = 'GET', body, idempotencyKey) => {
  const response = await app.request('/api/v1' + path, { method, headers: { authorization: token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { response, body: text ? JSON.parse(text) : null }
}
try {
  if (mode === 'protected') {
    const memory = await request('/families/' + seed.familyId + '/memories/' + seed.noteId)
    assert.equal(memory.response.status, 200)
    assert.equal(memory.body.body, 'ordinary note before frozen recovery')
    const giftPhotoPublication = await request('/families/' + seed.familyId + '/memories', 'POST', {
      kind: 'photo', childId: seed.childId, body: '', occurredAt: new Date().toISOString(), mediaIds: [seed.photoId],
    }, crypto.randomUUID())
    assert.ok(giftPhotoPublication.response.status >= 400, 'the frozen Memory API must reject a gift-purpose photo')
    const memoryLinks = await prisma.$queryRaw\`SELECT count(*)::integer AS count FROM memory_media WHERE media_id = \${seed.photoId}::uuid\`
    assert.equal(memoryLinks[0].count, 0, 'the frozen Memory API must not attach gift-purpose media')
    const writtenNote = await request('/families/' + seed.familyId + '/memories', 'POST', {
      kind: 'note', childId: seed.childId, body: 'written by frozen recovery runtime', occurredAt: new Date().toISOString(),
    }, crypto.randomUUID())
    assert.equal(writtenNote.response.status, 201)
    const beforeRows = await prisma.$queryRaw\`SELECT original_key, original_status::text AS original_status, deleted_at, storage_deleted_at FROM media_assets WHERE id = \${seed.photoId}::uuid\`
    assert.equal(beforeRows.length, 1)
    const before = beforeRows[0]
    const stored = await privateStorage.storage.readObject({ key: before.original_key })
    assert.ok(stored)
    const bytesBefore = Buffer.from(await new Response(stored.body).arrayBuffer())
    assert.equal(createHash('sha256').update(bytesBefore).digest('hex'), seed.photoSha256)
    const familyBefore = await prisma.family.findUniqueOrThrow({ where: { id: seed.familyId } })
    const outboxBefore = await prisma.taskOutbox.count()
    await runBackgroundJob('media:pending:cleanup', { prisma }, new Date(Date.now() + 60_000))
    const afterRows = await prisma.$queryRaw\`SELECT original_key, original_status::text AS original_status, deleted_at, storage_deleted_at FROM media_assets WHERE id = \${seed.photoId}::uuid\`
    assert.equal(afterRows.length, 1)
    const after = afterRows[0]
    assert.equal(after.deleted_at, null)
    assert.equal(after.storage_deleted_at, null)
    assert.equal(after.original_status, before.original_status)
    assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: seed.familyId } })).storageUsedBytes, familyBefore.storageUsedBytes)
    assert.equal(await prisma.taskOutbox.count(), outboxBefore)
    let deletedObjects = 0
    const countedStorage = new Proxy(privateStorage.storage, {
      get(target, property) {
        if (property === 'deleteObject') return async (key) => { deletedObjects += 1; return target.deleteObject(key) }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    await createMediaTasks({ prisma: legacyMediaPrisma(prisma), privateStorage: { storage: countedStorage }, env: {} }).deleteAsset({ mediaId: seed.photoId })
    assert.equal(deletedObjects, 0, 'the frozen deleteAsset handler must leave active gift-photo bytes alone')
    const stillStored = await privateStorage.storage.readObject({ key: before.original_key })
    assert.ok(stillStored)
    const stillStoredBytes = Buffer.from(await new Response(stillStored.body).arrayBuffer())
    assert.deepEqual(stillStoredBytes, bytesBefore)
    const registered = await prisma.$queryRaw\`SELECT count(*)::integer AS count FROM gifts WHERE id = \${seed.giftId}::uuid AND photo_media_id = \${seed.photoId}::uuid\`
    assert.equal(registered[0].count, 1)
    process.stdout.write(JSON.stringify({ success: true, phase: mode, tombstoned: after.deleted_at !== null, deletedObjects, oldRuntimeNoteId: writtenNote.body.id, outboxBefore, outboxAfter: await prisma.taskOutbox.count(), sha256: createHash('sha256').update(stillStoredBytes).digest('hex') }) + '\\n')
  } else if (mode === 'unprotected') {
    await runBackgroundJob('media:pending:cleanup', { prisma }, new Date(Date.now() + 60_000))
    const assetRows = await prisma.$queryRaw\`SELECT deleted_at, storage_deleted_at FROM media_assets WHERE id = \${seed.photoId}::uuid\`
    assert.equal(assetRows.length, 1)
    assert.ok(assetRows[0].deleted_at, 'the frozen cleanup should tombstone a registered gift photo without the protection trigger')
    assert.equal(assetRows[0].storage_deleted_at, null)
    const taskRows = await prisma.$queryRaw\`SELECT count(*)::integer AS count FROM task_outbox WHERE type = 'media:delete' AND dedupe_key = 'media-delete:' || \${seed.photoId}\`
    assert.equal(taskRows[0].count, 1, 'the frozen cleanup should queue physical deletion after an unprotected tombstone')
    process.stdout.write(JSON.stringify({ success: true, phase: mode, tombstoned: true, queuedDeletion: true }) + '\\n')
  } else throw new Error('unknown legacy-probe mode')
} finally { await prisma.$disconnect() }
`
    writeFileSync(runtimeProbe, probeSource)
    const oldEnv = { ...env, TEST_DATABASE_URL: databaseUrl.toString() }
    const protectedOutput = run('bun', [runtimeProbe, 'protected', seedPath], runtimeRoot, oldEnv)
    const protectedResult = JSON.parse(protectedOutput.trim().split('\n').at(-1)!)
    expect(protectedResult).toMatchObject({ success: true, phase: 'protected', tombstoned: false, deletedObjects: 0, sha256: photoSha256 })

    const memoryAfter = await request(owner.id, `/families/${familyId}/memories/${note.body.id}`)
    expect(memoryAfter.response.status).toBe(200)
    const legacyWriteAfter = await request(owner.id, `/families/${familyId}/memories/${protectedResult.oldRuntimeNoteId}`)
    expect(legacyWriteAfter.response.status).toBe(200)
    expect(legacyWriteAfter.body.body).toBe('written by frozen recovery runtime')
    const giftAfter = await request(viewer.id, `/families/${familyId}/gifts`)
    expect(giftAfter.response.status).toBe(200)
    const stillGift = giftAfter.body.gifts.find((gift: { id: string }) => gift.id === giftId)
    expect(stillGift).toMatchObject({ id: giftId, photoMediaId: originalPhotoId, version: giftBeforeLegacy.version,
      reservation: { userId: buyer.id, boughtAt: expect.any(String) } })
    const photoAfterLegacy = await photoContent(viewer.id, originalPhotoId)
    expect(photoAfterLegacy.status).toBe(200)
    const recoveredBytes = Buffer.from(await photoAfterLegacy.arrayBuffer())
    expect(createHash('sha256').update(recoveredBytes).digest('hex')).toBe(photoSha256)
    expect(recoveredBytes).toEqual(photoBytes)
    const recoveredAsset = await db.mediaAsset.findUniqueOrThrow({ where: { id: originalPhotoId } })
    expect(recoveredAsset).toMatchObject({ deletedAt: photoBeforeLegacy.deletedAt, storageDeletedAt: photoBeforeLegacy.storageDeletedAt, originalStatus: photoBeforeLegacy.originalStatus })
    expect((await db.family.findUniqueOrThrow({ where: { id: familyId } })).storageUsedBytes).toBe(familyBeforeLegacy.storageUsedBytes)
    expect(await db.taskOutbox.count()).toBe(outboxBeforeLegacy)

    const replacementPhotoId = await uploadGiftPhoto(owner.id)
    const replaced = await request(owner.id, `/families/${familyId}/gifts/${giftId}`, 'PATCH', {
      expectedVersion: stillGift.version, title: 'Recovery gift edited', photoMediaId: replacementPhotoId,
    })
    expect(replaced.response.status, JSON.stringify(replaced.body)).toBe(200)
    expect(replaced.body.gift).toMatchObject({ id: giftId, title: 'Recovery gift edited', photoMediaId: replacementPhotoId, version: stillGift.version + 1 })
    expect((await photoContent(viewer.id, originalPhotoId)).status).toBe(404)
    expect((await photoContent(viewer.id, replacementPhotoId)).status).toBe(200)
    const deletedGift = await request(owner.id, `/families/${familyId}/gifts/${giftId}`, 'DELETE', undefined, undefined, { 'if-match': String(replaced.body.gift.version) })
    expect(deletedGift.response.status).toBe(204)
    expect((await photoContent(viewer.id, replacementPhotoId)).status).toBe(404)
    expect(await db.gift.findUnique({ where: { id: giftId } })).toBeNull()

    await db.$executeRaw`DROP TRIGGER "media_assets_protect_gift_photos" ON "media_assets"`
    const unprotectedPhotoId = await uploadGiftPhoto(owner.id)
    const unprotectedGift = await request(owner.id, `/families/${familyId}/gifts`, 'POST', {
      title: 'Synthetic unprotected control', url: 'https://shop.example/unprotected-control', photoMediaId: unprotectedPhotoId,
    }, randomUUID())
    expect(unprotectedGift.response.status, JSON.stringify(unprotectedGift.body)).toBe(201)
    await db.mediaAsset.update({ where: { id: unprotectedPhotoId }, data: { createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000) } })
    const unprotectedSeed = { ...JSON.parse(readFileSync(seedPath, 'utf8')), photoId: unprotectedPhotoId, giftId: unprotectedGift.body.gift.id }
    writeFileSync(seedPath, JSON.stringify(unprotectedSeed))
    const unprotectedOutput = run('bun', [runtimeProbe, 'unprotected', seedPath], runtimeRoot, oldEnv)
    expect(JSON.parse(unprotectedOutput.trim().split('\n').at(-1)!)).toMatchObject({ success: true, phase: 'unprotected', tombstoned: true, queuedDeletion: true })
    const unprotectedAsset = await db.mediaAsset.findUniqueOrThrow({ where: { id: unprotectedPhotoId } })
    expect(unprotectedAsset.deletedAt).not.toBeNull()
    expect(unprotectedAsset.storageDeletedAt).toBeNull()
    expect(await privateStorage.storage.readObject({ key: unprotectedAsset.originalKey })).not.toBeNull()
    expect((await photoContent(viewer.id, unprotectedPhotoId)).status).toBe(404)
    expect((await ledgerSnapshot()).map(({ migration_name, checksum }) => ({ migration_name, checksum }))).toEqual(expectedLedger)
  } finally {
    if (db) await db.$disconnect()
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    await admin.end()
    rmSync(fixture, { recursive: true, force: true })
  }
}, 300_000)
