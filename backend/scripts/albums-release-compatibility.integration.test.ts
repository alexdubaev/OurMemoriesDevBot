import { expect, test } from 'bun:test'
import { randomUUID, createHash } from 'node:crypto'
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

test('current albums survive the frozen v4 runtime and remain usable after returning to current', async () => {
  const adminUrl = requireIntegrationDatabaseUrl()
  if (!adminUrl || process.env.DATABASE_URL !== adminUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(adminUrl)
  const parsedAdminUrl = new URL(adminUrl)
  if (parsedAdminUrl.hostname !== '127.0.0.1') throw new Error('Loopback test database required')

  const databaseName = `albums_release_${process.pid}_${Date.now()}_test`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${databaseName}`
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch', 'albums-release-compat-'))
  const runtimeRoot = resolve(fixture, 'accepted-v4')
  const storageRoot = resolve(fixture, 'private-storage')
  const runtimeProbe = resolve(runtimeRoot, 'backend/scripts/albums-runtime-probe.mjs')
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
      cwd: root,
      encoding: null,
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
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
    const ledgerSnapshot = async () => (await db!.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM _prisma_migrations ORDER BY migration_name
    `)
    const expectedLedger = migrations.map((name) => ({
      migration_name: name,
      checksum: createHash('sha256').update(readFileSync(resolve(migrationRoot, name, 'migration.sql'))).digest('hex'),
    }))
    const beforeLedger = await ledgerSnapshot()
    expect(beforeLedger.map(({ migration_name, checksum }) => ({ migration_name, checksum }))).toEqual(expectedLedger)
    expect(beforeLedger.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true)

    const user = await db.user.create({ data: { displayName: 'Album rollback synthetic owner' } })
    const familyId = randomUUID()
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: familyId, ownerUserId: user.id, name: 'Album rollback synthetic family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'full' } })
    })
    const child = await db.child.create({ data: { familyId, displayName: 'Synthetic child' } })
    const legacyMemory = await db.memory.create({ data: {
      familyId, childId: child.id, authorId: user.id, kind: 'note', body: 'original note body',
      occurredAt: new Date('2025-08-12T09:30:00Z'), firstPublishedAt: new Date(),
    } })
    const session = await db.authSession.create({ data: {
      userId: user.id, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000),
    } })

    const appEnv = loadEnv({ DATABASE_URL: databaseUrl.toString(), NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000', PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot })
    const privateStorage = createPrivateStorage(appEnv)
    const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const photoSha256 = createHash('sha256').update(photoBytes).digest('hex')
    const originalKey = `media-originals/${familyId}/${randomUUID()}.png`
    await privateStorage.storage.writeObject({ key: originalKey, body: new Blob([photoBytes]).stream(), contentLength: photoBytes.byteLength, contentType: 'image/png' })
    const app = createApp({ env: appEnv, prisma: db, privateStorage })
    const token = `Bearer ${await signAccessToken({ sub: user.id, sessionId: session.id }, appEnv)}`
    const request = async (path: string, method = 'GET', body?: unknown, key?: string) => {
      const response = await app.request(`/api/v1${path}`, {
        method,
        headers: {
          authorization: token,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(key ? { 'idempotency-key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await response.text()
      return { response, body: text ? JSON.parse(text) : null }
    }

    const albumCreate = await request(`/families/${familyId}/albums`, 'POST', { kind: 'free', title: 'Persistent memories', childId: null }, randomUUID())
    expect(albumCreate.response.status, JSON.stringify(albumCreate.body)).toBe(201)
    const album = albumCreate.body.album
    const entryCreate = await request(`/families/${familyId}/albums/${album.id}/entries`, 'POST', {
      expectedVersion: album.version, kind: 'work', title: 'Attached note', caption: 'A note linked before rollback', sources: [],
    }, randomUUID())
    expect(entryCreate.response.status).toBe(201)
    const entry = entryCreate.body.entry
    const sourceLink = await request(`/families/${familyId}/albums/${album.id}/entries/${entry.id}/sources`, 'PUT', {
      expectedVersion: entry.aggregateVersion, sources: [{ memoryId: legacyMemory.id, sourceKind: 'memory', sourceId: legacyMemory.id }],
    }, randomUUID())
    expect(sourceLink.response.status).toBe(200)
    const sourceLinkId = sourceLink.body.entry.sources[0].id
    const privatePhoto = await db.mediaAsset.create({ data: {
      familyId, uploaderId: user.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: photoSha256, byteSize: photoBytes.byteLength, width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready',
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    } })
    await db.family.update({ where: { id: familyId }, data: { storageUsedBytes: { increment: privatePhoto.byteSize } } })
    const beforePrivateWrite = {
      memories: await db.memory.count({ where: { familyId } }),
      backups: await db.maxMemoryBackup.count({ where: { familyId } }),
      outbox: await db.taskOutbox.count(),
    }
    const directAttach = await request(`/families/${familyId}/albums/${album.id}/entries/${entry.id}/sources`, 'PUT', {
      expectedVersion: sourceLink.body.entry.aggregateVersion,
      sources: [
        { memoryId: legacyMemory.id, sourceKind: 'memory', sourceId: legacyMemory.id },
        { memoryId: null, sourceKind: 'private_storage', sourceId: privatePhoto.id },
      ],
    }, randomUUID())
    expect(directAttach.response.status).toBe(200)
    const directSourceLinkId = directAttach.body.entry.sources.find((source: { memoryId: string | null }) => source.memoryId === null).id
    expect(await db.memory.count({ where: { familyId } })).toBe(beforePrivateWrite.memories)
    expect(await db.maxMemoryBackup.count({ where: { familyId } })).toBe(beforePrivateWrite.backups)
    expect(await db.taskOutbox.count()).toBe(beforePrivateWrite.outbox)
    expect(await db.albumPhoto.count({ where: { mediaId: privatePhoto.id, familyId } })).toBe(1)
    const contentPath = `/families/${familyId}/media/${privatePhoto.id}/content?variant=original`
    const privateContentBefore = await app.request(`/api/v1${contentPath}`, { headers: { authorization: token } })
    expect(privateContentBefore.status).toBe(200)
    const beforeBytes = Buffer.from(await privateContentBefore.arrayBuffer())
    expect(createHash('sha256').update(beforeBytes).digest('hex')).toBe(photoSha256)
    const viewer = await db.user.create({ data: { displayName: 'Album source viewer' } })
    await db.familyMember.create({ data: { familyId, userId: viewer.id, role: 'viewer' } })
    const viewerSession = await db.authSession.create({ data: {
      userId: viewer.id, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000),
    } })
    const viewerToken = `Bearer ${await signAccessToken({ sub: viewer.id, sessionId: viewerSession.id }, appEnv)}`
    const viewerContent = await app.request(`/api/v1${contentPath}`, { headers: { authorization: viewerToken } })
    expect(viewerContent.status).toBe(200)
    expect(createHash('sha256').update(Buffer.from(await viewerContent.arrayBuffer())).digest('hex')).toBe(photoSha256)
    await db.familyMember.delete({ where: { familyId_userId: { familyId, userId: viewer.id } } })
    const revokedContent = await app.request(`/api/v1${contentPath}`, { headers: { authorization: viewerToken } })
    expect(revokedContent.status).toBe(404)
    const preRollbackDetail = await request(`/families/${familyId}/albums/${album.id}/entries/${entry.id}`)
    expect(preRollbackDetail.body.entry.sources[0]).toMatchObject({ id: sourceLinkId, available: true, body: 'original note body' })

    const seedPath = resolve(fixture, 'seed.json')
    const statePath = resolve(fixture, 'runtime-state.json')
    writeFileSync(seedPath, JSON.stringify({ userId: user.id, familyId, childId: child.id, memoryId: legacyMemory.id, privatePhotoId: privatePhoto.id, originalKey, photoSha256, storageRoot, sessionId: session.id, albumId: album.id, entryId: entry.id, sourceLinkId, directSourceLinkId }))
    const probeSource = `
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPrisma } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { loadEnv } from '../src/env.ts'
import { signAccessToken } from '../src/modules/auth/index.ts'
import { runBackgroundJob } from '../src/jobs.ts'
import { createMediaTasks } from '../src/modules/media/index.ts'
import { createPrivateStorage } from '../src/storage/index.ts'
const [mode, statePath, seedPath] = process.argv.slice(2)
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl)
assert.equal(new URL(databaseUrl).hostname, '127.0.0.1')
assert.match(new URL(databaseUrl).pathname, /^\\/albums_release_[0-9]+_[0-9]+_test$/)
const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
const env = loadEnv({ DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000', PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: seed.storageRoot })
const prisma = createPrisma(databaseUrl)
const privateStorage = createPrivateStorage(env)
const app = createApp({ env, prisma, privateStorage })
const token = 'Bearer ' + await signAccessToken({ sub: seed.userId, sessionId: seed.sessionId }, env)
const request = async (path, method = 'GET', body, idempotencyKey) => {
  const response = await app.request('/api/v1' + path, { method, headers: { authorization: token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { response, body: text ? JSON.parse(text) : null }
}
try {
  const memory = await request('/families/' + seed.familyId + '/memories/' + seed.memoryId)
  assert.equal(memory.response.status, 200)
  assert.equal(memory.body.body, 'original note body')
  const photoBefore = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: seed.privatePhotoId } })
  const storedBefore = await privateStorage.storage.readObject({ key: seed.originalKey })
  assert.ok(storedBefore)
  const bytesBefore = Buffer.from(await new Response(storedBefore.body).arrayBuffer())
  assert.equal(createHash('sha256').update(bytesBefore).digest('hex'), seed.photoSha256)
  assert.equal(BigInt(bytesBefore.byteLength), photoBefore.byteSize)
  const familyBefore = await prisma.family.findUniqueOrThrow({ where: { id: seed.familyId } })
  const outboxBefore = await prisma.taskOutbox.count()
  await runBackgroundJob('media:pending:cleanup', { prisma }, new Date(Date.now() + 26 * 60 * 60 * 1000))
  let deletedObjects = 0
  const countedStorage = new Proxy(privateStorage.storage, {
    get(target, property) {
      if (property === 'deleteObject') return async (key) => { deletedObjects += 1; return target.deleteObject(key) }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  await createMediaTasks({ prisma, privateStorage: { storage: countedStorage }, env: {} }).deleteAsset({ mediaId: seed.privatePhotoId })
  assert.equal(deletedObjects, 0)
  const photoAfterCleanup = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: seed.privatePhotoId } })
  assert.equal(photoAfterCleanup.deletedAt, null)
  assert.equal(photoAfterCleanup.storageDeletedAt, null)
  assert.equal(photoAfterCleanup.originalStatus, photoBefore.originalStatus)
  assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: seed.familyId } })).storageUsedBytes, familyBefore.storageUsedBytes)
  assert.equal(await prisma.taskOutbox.count(), outboxBefore)
  const storedAfterOldDelete = await privateStorage.storage.readObject({ key: seed.originalKey })
  assert.ok(storedAfterOldDelete)
  const bytesAfterOldDelete = Buffer.from(await new Response(storedAfterOldDelete.body).arrayBuffer())
  assert.equal(createHash('sha256').update(bytesAfterOldDelete).digest('hex'), seed.photoSha256)
  assert.deepEqual(bytesAfterOldDelete, bytesBefore)
  const oldPublication = await request('/families/' + seed.familyId + '/memories', 'POST', {
    kind: 'photo', childId: seed.childId, body: '', occurredAt: new Date().toISOString(), mediaIds: [seed.privatePhotoId],
  }, crypto.randomUUID())
  const publicationRejected = oldPublication.response.status >= 400
  assert.equal(publicationRejected, true, 'Frozen Memory publication must fail closed at the database boundary')
  assert.equal(await prisma.memoryMedia.count({ where: { mediaId: seed.privatePhotoId } }), 0)
  const registered = await prisma.$queryRaw\`SELECT count(*)::integer AS count FROM album_photos WHERE media_id = \${seed.privatePhotoId}::uuid AND family_id = \${seed.familyId}::uuid\`
  assert.equal(registered[0].count, 1)
  const created = await request('/families/' + seed.familyId + '/memories', 'POST', { kind: 'note', childId: seed.childId, body: 'written by frozen runtime', occurredAt: new Date().toISOString() }, crypto.randomUUID())
  assert.equal(created.response.status, 201, JSON.stringify(created.body))
  writeFileSync(statePath, JSON.stringify({ oldRuntimeMemoryId: created.body.id }))
  process.stdout.write(JSON.stringify({ success: true, phase: mode, status: created.response.status, legacyCleanupDeletes: deletedObjects, oldPublicationRejected: publicationRejected, storedPhotoSha256: createHash('sha256').update(bytesAfterOldDelete).digest('hex') }) + '\\n')
} finally { await prisma.$disconnect() }
`
    writeFileSync(runtimeProbe, probeSource)
    const oldRuntimeOutput = run('bun', [runtimeProbe, 'accepted-v4', statePath, seedPath], runtimeRoot, env)
    expect(JSON.parse(oldRuntimeOutput.trim().split('\n').at(-1)!)).toMatchObject({ success: true, phase: 'accepted-v4', status: 201, storedPhotoSha256: photoSha256 })
    const rollbackMemory = JSON.parse(readFileSync(statePath, 'utf8')) as { oldRuntimeMemoryId: string }

    const afterRollbackDetail = await request(`/families/${familyId}/albums/${album.id}/entries/${entry.id}`)
    expect(afterRollbackDetail.response.status).toBe(200)
    expect(afterRollbackDetail.body.entry.sources[0]).toMatchObject({ id: sourceLinkId, memoryId: legacyMemory.id, available: true, body: 'original note body' })
    expect(afterRollbackDetail.body.entry.sources.find((source: { id: string }) => source.id === directSourceLinkId))
      .toMatchObject({ id: directSourceLinkId, memoryId: null, sourceId: privatePhoto.id, kind: 'photo', available: true })
    const privateContentAfter = await app.request(`/api/v1${contentPath}`, { headers: { authorization: token } })
    expect(privateContentAfter.status).toBe(200)
    const afterBytes = Buffer.from(await privateContentAfter.arrayBuffer())
    expect(createHash('sha256').update(afterBytes).digest('hex')).toBe(photoSha256)
    expect(afterBytes).toEqual(photoBytes)
    expect((await db.memory.findUniqueOrThrow({ where: { id: rollbackMemory.oldRuntimeMemoryId } })).body).toBe('written by frozen runtime')
    const finalUpdate = await request(`/families/${familyId}/albums/${album.id}/entries/${entry.id}`, 'PATCH', {
      expectedVersion: afterRollbackDetail.body.entry.aggregateVersion, caption: 'Current runtime works after rollback',
    })
    expect(finalUpdate.response.status).toBe(200)
    expect(finalUpdate.body.entry.caption).toBe('Current runtime works after rollback')
    const afterLedger = await ledgerSnapshot()
    expect(afterLedger).toEqual(beforeLedger)
    expect(afterLedger.map(({ migration_name, checksum }) => ({ migration_name, checksum }))).toEqual(expectedLedger)
    await db.family.delete({ where: { id: familyId } })
    expect(await db.albumPhoto.count({ where: { mediaId: privatePhoto.id } })).toBe(0)
    expect(await db.mediaAsset.count({ where: { id: privatePhoto.id } })).toBe(0)
    expect(await db.albumEntrySource.count({ where: { id: directSourceLinkId } })).toBe(0)
  } finally {
    if (db) await db.$disconnect()
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    await admin.end()
    rmSync(fixture, { recursive: true, force: true })
  }
}, 300_000)
