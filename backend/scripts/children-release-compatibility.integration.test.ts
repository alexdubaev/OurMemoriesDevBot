import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'
import { createPrisma } from '../src/db'
import { createApp } from '../src/app'
import { loadEnv } from '../src/env'
import { signAccessToken } from '../src/modules/auth'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
/** Runtime released before child tags: it must keep working on the expanded schema (rollback). */
const previousRuntime = '33a0054c3c71372aa5509ee8ebfa4578ad512ea1'

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout = 120_000) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
  if (result.status !== 0) {
    const reason = result.error ? `spawn=${result.error.message}` : `exit=${result.status} signal=${result.signal}`
    throw new Error(`${command} ${args.join(' ')} failed (${reason})\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

test('the runtime before child tags creates and reads memories on the migrated schema, and current code keeps working', async () => {
  const adminUrl = requireIntegrationDatabaseUrl()
  if (!adminUrl || process.env.DATABASE_URL !== adminUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(adminUrl)
  if (new URL(adminUrl).hostname !== '127.0.0.1') throw new Error('Loopback test database required')

  const databaseName = `children_release_${process.pid}_${Date.now()}_test`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${databaseName}`
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch', 'children-release-compat-'))
  const runtimeRoot = resolve(fixture, 'previous')
  const runtimeProbe = resolve(runtimeRoot, 'backend/scripts/children-runtime-probe.mjs')
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1',
    DATABASE_URL: databaseUrl.toString(), TEST_DATABASE_URL: databaseUrl.toString(),
  }
  const admin = new Client({ connectionString: adminUrl })
  let databaseCreated = false
  let db: ReturnType<typeof createPrisma> | undefined

  try {
    await admin.connect()
    const archive = spawnSync('git', ['archive', previousRuntime, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'], {
      cwd: root, encoding: null, timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    })
    if (archive.status !== 0) throw new Error(`Cannot archive previous runtime ${previousRuntime}: ${archive.stderr}`)
    mkdirSync(runtimeRoot)
    const extract = spawnSync('tar', ['-x', '-C', runtimeRoot], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 30_000 })
    if (extract.status !== 0) throw new Error(`Cannot extract previous runtime: ${extract.stderr}`)
    run('bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], runtimeRoot, env)
    run('bun', ['run', '--cwd', 'backend', 'prisma:generate'], runtimeRoot, env)

    await admin.query(`CREATE DATABASE "${databaseName}"`)
    databaseCreated = true
    run('bun', ['run', '--cwd', 'backend', 'prisma:deploy'], root, env)
    db = createPrisma(databaseUrl.toString())

    const migrationRoot = resolve(backendRoot, 'prisma/migrations')
    const migrations = (await readdir(migrationRoot)).filter((name) => /^\d{14}_/.test(name)).sort()
    expect(migrations).toContain('20261024100000_memory_child_tags')
    const ledgerSnapshot = async () => (await db!.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name
    `)
    const expectedLedger = migrations.map((name) => ({
      migration_name: name,
      checksum: createHash('sha256').update(readFileSync(resolve(migrationRoot, name, 'migration.sql'))).digest('hex'),
    }))
    const beforeLedger = await ledgerSnapshot()
    expect(beforeLedger.map(({ migration_name, checksum }) => ({ migration_name, checksum }))).toEqual(expectedLedger)

    const user = await db.user.create({ data: { displayName: 'Children rollback synthetic owner' } })
    const familyId = randomUUID()
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: familyId, ownerUserId: user.id, name: 'Children rollback synthetic family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'full' } })
    })
    const child = await db.child.create({ data: { familyId, displayName: 'Synthetic child one' } })
    const session = await db.authSession.create({ data: {
      userId: user.id, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000),
    } })
    const appEnv = loadEnv({ DATABASE_URL: databaseUrl.toString(), NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000' })
    const app = createApp({ env: appEnv, prisma: db })
    const token = `Bearer ${await signAccessToken({ sub: user.id, sessionId: session.id }, appEnv)}`
    const request = async (path: string, method = 'GET', body?: unknown, key?: string, extraHeaders: Record<string, string> = {}) => {
      const response = await app.request(`/api/v1${path}`, { method, headers: {
        authorization: token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key ? { 'idempotency-key': key } : {}),
        ...extraHeaders,
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const text = await response.text()
      return { response, body: text ? JSON.parse(text) : null }
    }

    const current = await request(`/families/${familyId}/memories`, 'POST', {
      kind: 'note', body: 'written by current runtime with one-child auto tag', occurredAt: new Date().toISOString(),
    }, randomUUID())
    expect(current.response.status, JSON.stringify(current.body)).toBe(201)
    expect(await db.memoryChildTag.findMany({ where: { memoryId: current.body.id }, select: { childId: true, attachmentId: true } }))
      .toEqual([{ childId: child.id, attachmentId: null }])
    const secondChild = await db.child.create({ data: { familyId, displayName: 'Synthetic child two' } })
    const deletedChild = await db.child.create({ data: { familyId, displayName: 'Synthetic deleted profile' } })
    const attachment = await db.mediaAsset.create({ data: {
      familyId, uploaderId: user.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey: `synthetic/${familyId}/children-rollback-${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: 'a'.repeat(64), byteSize: 10n, width: 64, height: 48, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    const multi = await request(`/families/${familyId}/memories`, 'POST', {
      kind: 'photo', childIds: [child.id, secondChild.id], mediaIds: [attachment.id], body: 'written by current runtime for two children', occurredAt: new Date().toISOString(),
    }, randomUUID())
    expect(multi.response.status, JSON.stringify(multi.body)).toBe(201)
    const updatedTags = await request(`/families/${familyId}/memories/${multi.body.id}/child-tags`, 'PUT', {
      expectedChildTagsVersion: 1,
      tags: [
        { childId: child.id, attachmentId: null },
        { childId: secondChild.id, attachmentId: attachment.id },
      ],
    })
    expect(updatedTags.response.status, JSON.stringify(updatedTags.body)).toBe(200)
    const deleted = await request(`/families/${familyId}/children/${deletedChild.id}`, 'DELETE', undefined, undefined, { 'if-match': '1' })
    expect(deleted.response.status, JSON.stringify(deleted.body)).toBe(204)
    const deletedAt = (await db.child.findUniqueOrThrow({ where: { id: deletedChild.id } })).deletedAt
    expect(deletedAt).not.toBeNull()
    const childTagSnapshot = await db.memoryChildTag.findMany({ where: { memoryId: multi.body.id }, orderBy: [{ attachmentId: 'asc' }, { childId: 'asc' }] })
    expect(childTagSnapshot).toHaveLength(2)

    const seedPath = resolve(fixture, 'seed.json')
    const statePath = resolve(fixture, 'runtime-state.json')
    writeFileSync(seedPath, JSON.stringify({ userId: user.id, familyId, childId: child.id, secondChildId: secondChild.id,
      memoryId: current.body.id, multiMemoryId: multi.body.id, attachmentId: attachment.id, deletedChildId: deletedChild.id, sessionId: session.id }))
    const probeSource = `
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createPrisma } from '../src/db.ts'
import { createApp } from '../src/app.ts'
import { loadEnv } from '../src/env.ts'
import { signAccessToken } from '../src/modules/auth/index.ts'
const [statePath, seedPath] = process.argv.slice(2)
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl)
assert.equal(new URL(databaseUrl).hostname, '127.0.0.1')
assert.match(new URL(databaseUrl).pathname, /^\\/children_release_[0-9]+_[0-9]+_test$/)
const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
const env = loadEnv({ DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000' })
const prisma = createPrisma(databaseUrl)
const app = createApp({ env, prisma })
const token = 'Bearer ' + await signAccessToken({ sub: seed.userId, sessionId: seed.sessionId }, env)
const request = async (path, method = 'GET', body, idempotencyKey) => {
  const response = await app.request('/api/v1' + path, { method, headers: { authorization: token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  return { response, body: text ? JSON.parse(text) : null }
}
try {
  const family = await request('/families/' + seed.familyId)
  assert.equal(family.response.status, 200, JSON.stringify(family.body))
  assert.equal(family.body.child.id, seed.childId)
  const memory = await request('/families/' + seed.familyId + '/memories/' + seed.memoryId)
  assert.equal(memory.response.status, 200, JSON.stringify(memory.body))
  assert.equal(memory.body.body, 'written by current runtime with one-child auto tag')
  assert.equal(memory.body.childId, seed.childId)
  const multi = await request('/families/' + seed.familyId + '/memories/' + seed.multiMemoryId)
  assert.equal(multi.response.status, 200, JSON.stringify(multi.body))
  assert.equal(multi.body.body, 'written by current runtime for two children')
  assert.equal(multi.body.kind, 'photo')
  assert.deepEqual((await prisma.memoryMedia.findMany({ where: { memoryId: seed.multiMemoryId } })).map((media) => media.mediaId), [seed.attachmentId])
  const created = await request('/families/' + seed.familyId + '/memories', 'POST', { kind: 'note', childId: seed.childId, body: 'written by previous runtime', occurredAt: new Date().toISOString() }, crypto.randomUUID())
  assert.equal(created.response.status, 201, JSON.stringify(created.body))
  const feed = await request('/families/' + seed.familyId + '/memories?childId=' + seed.childId)
  assert.equal(feed.response.status, 200, JSON.stringify(feed.body))
  assert.deepEqual(feed.body.items.map((item) => item.id).sort(), [seed.memoryId, seed.multiMemoryId, created.body.id].sort())
  writeFileSync(statePath, JSON.stringify({ previousRuntimeMemoryId: created.body.id }))
  process.stdout.write(JSON.stringify({ success: true, status: created.response.status }) + '\\n')
} finally { await prisma.$disconnect() }
`
    writeFileSync(runtimeProbe, probeSource)
    const output = run('bun', [runtimeProbe, statePath, seedPath], runtimeRoot, env)
    expect(JSON.parse(output.trim().split('\n').at(-1)!)).toMatchObject({ success: true, status: 201 })
    const { previousRuntimeMemoryId } = JSON.parse(readFileSync(statePath, 'utf8')) as { previousRuntimeMemoryId: string }

    const tagsAfterRollback = await db.memoryChildTag.findMany({ where: { memoryId: multi.body.id }, orderBy: [{ attachmentId: 'asc' }, { childId: 'asc' }] })
    expect(tagsAfterRollback).toEqual(childTagSnapshot)
    expect(tagsAfterRollback.map(({ childId: taggedChildId, attachmentId }) => [taggedChildId, attachmentId]).sort()).toEqual([
      [child.id, null], [secondChild.id, attachment.id],
    ].sort())
    expect(await db.child.findUniqueOrThrow({ where: { id: deletedChild.id } })).toMatchObject({ deletedAt })

    // Back on current code: the rollback-era memory is intact, readable and keeps its legacy child.
    const rollbackMemory = await db.memory.findUniqueOrThrow({ where: { id: previousRuntimeMemoryId } })
    expect(rollbackMemory).toMatchObject({ childId: child.id, body: 'written by previous runtime', childTagsVersion: 1 })
    const read = await request(`/families/${familyId}/memories/${previousRuntimeMemoryId}`)
    expect(read.response.status).toBe(200)
    const feed = await request(`/families/${familyId}/memories`)
    expect(feed.response.status).toBe(200)
    expect(feed.body.items.map((item: { id: string }) => item.id)).toContain(previousRuntimeMemoryId)
    expect(await db.memoryChildTag.count({ where: { memoryId: previousRuntimeMemoryId } })).toBe(0)
    const after = await request(`/families/${familyId}/memories`, 'POST', {
      kind: 'note', childIds: [child.id], body: 'current after rollback', occurredAt: new Date().toISOString(),
    }, randomUUID())
    expect(after.response.status).toBe(201)
    expect(await db.memoryChildTag.count({ where: { memoryId: after.body.id, childId: child.id } })).toBe(1)
    expect(await ledgerSnapshot()).toEqual(beforeLedger)
  } finally {
    if (db) await db.$disconnect()
    if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
    await admin.end()
    rmSync(fixture, { recursive: true, force: true })
  }
}, 300_000)
