import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const oldProduction = '4ce200620bf87d1ba5605aee73f5442fe50ccdb4'
const rollbackTarget = '3fce2739205da927b95eb3379b1d066b61282965'

test('COM-4 old frozen runtimes read and write after additive comments migration while comments and legacy rows survive', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(databaseUrl)
  if (new URL(databaseUrl).hostname !== '127.0.0.1') throw new Error('Loopback test database required')
  const name = 'comments_compat_' + process.pid + '_' + Date.now() + '_test'
  const ownUrl = new URL(databaseUrl)
  ownUrl.pathname = '/' + name
  const admin = new Client({ connectionString: databaseUrl })
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch', 'comments-compat-'))
  const childEnv = { ...process.env, NODE_ENV: 'test', DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString() }
  const run = (command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env, timeout = 120_000) =>
    spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
  const checked = (command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env) => {
    const result = run(command, args, cwd, env)
    if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stdout}\n${result.stderr}`)
    return result.stdout
  }
  const archiveRuntime = (revision: string, runtimeRoot: string) => {
    mkdirSync(runtimeRoot)
    const archive = spawnSync('git', ['archive', revision, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'], { cwd: root, encoding: null, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 })
    if (archive.status !== 0) throw new Error(`Cannot archive ${revision}: ${archive.stderr}`)
    const tarResult = spawnSync('tar', ['-x', '-C', runtimeRoot], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 30_000 })
    if (tarResult.status !== 0) throw new Error(`Cannot extract ${revision}: ${tarResult.stderr}`)
    checked('bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], runtimeRoot, childEnv)
    checked('bun', ['run', '--cwd', 'backend', 'prisma:generate'], runtimeRoot, childEnv)
  }
  const rollbackRuntimeRoot = resolve(fixture, 'runtime-rollback-target')
  // Prepare this frozen CLI/client before any fixture rows exist. It establishes
  // the actual historical migration ledger used by the compatibility probe.
  await admin.connect()
  let created = false
  try {
    archiveRuntime(rollbackTarget, rollbackRuntimeRoot)
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    const db = new Client({ connectionString: ownUrl.toString() })
    await db.connect()
    try {
      const migrationRoot = resolve(backendRoot, 'prisma/migrations')
      const { readdir } = await import('node:fs/promises')
      const migrations = (await readdir(migrationRoot)).filter((entry) => /^\d{14}_/.test(entry)).sort()
      const boundary = migrations.findIndex((entry) => entry.endsWith('_memory_comments'))
      expect(boundary).toBeGreaterThan(0)
      checked('bunx', ['--bun', 'prisma', 'migrate', 'deploy'], resolve(rollbackRuntimeRoot, 'backend'), childEnv)
      const appliedBeforeComments = await db.query<{ migration_name: string }>(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name',
      )
      expect(appliedBeforeComments.rows.map((row) => row.migration_name)).toEqual(migrations.slice(0, boundary))

      const userId = randomUUID(), familyId = randomUUID(), childId = randomUUID(), memoryId = randomUUID()
      await db.query('BEGIN')
      await db.query('SET CONSTRAINTS ALL DEFERRED')
      await db.query("INSERT INTO users(id,display_name,updated_at) VALUES($1,'COM-4 legacy user',now())", [userId])
      await db.query("INSERT INTO families(id,owner_user_id,name,timezone,updated_at) VALUES($1,$2,'COM-4 legacy family','Europe/Moscow',now())", [familyId, userId])
      await db.query("INSERT INTO family_members(family_id,user_id,role) VALUES($1,$2,'full')", [familyId, userId])
      await db.query("INSERT INTO children(id,family_id,display_name,updated_at) VALUES($1,$2,'COM-4 child',now())", [childId, familyId])
      await db.query("INSERT INTO memories(id,family_id,child_id,author_id,kind,body,occurred_at,first_published_at,updated_at) VALUES($1,$2,$3,$4,'note','legacy memory',now(),now(),now())", [memoryId, familyId, childId, userId])
      await db.query('COMMIT')
      const legacyBefore = (await db.query('SELECT id,family_id,child_id,author_id,kind,body,occurred_at,first_published_at FROM memories WHERE id=$1', [memoryId])).rows[0]
      checked('bunx', ['--bun', 'prisma', 'migrate', 'deploy'], resolve(backendRoot), childEnv)
      const appliedAfterComments = await db.query<{ migration_name: string }>(
        'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name',
      )
      expect(appliedAfterComments.rows.map((row) => row.migration_name)).toEqual(migrations)
      const probe = resolve(root, 'backend/scripts/test-support/comments-runtime-probe.mjs')
      const statePath = resolve(fixture, 'runtime-state.json')
      const seedPath = resolve(fixture, 'seed.json')
      writeFileSync(seedPath, JSON.stringify({ userId, familyId, childId, memoryId }))
      checked('bun', [probe, root, 'candidate-before', statePath, seedPath], root, childEnv)
      const beforeRows = (await db.query('SELECT id,family_id,memory_id,author_id,body,version,deleted_at,create_request_id,initial_payload_hash FROM memory_comments ORDER BY id')).rows

      for (const [index, revision] of [oldProduction, rollbackTarget].entries()) {
        const runtimeRoot = revision === rollbackTarget ? rollbackRuntimeRoot : resolve(fixture, `runtime-${index}`)
        if (revision !== rollbackTarget) archiveRuntime(revision, runtimeRoot)
        const mode = index === 0 ? 'old-production' : 'old-rollback-target'
        const output = checked('bun', [probe, runtimeRoot, mode, statePath], runtimeRoot, childEnv)
        expect(JSON.parse(output.trim().split('\n').at(-1)!)).toMatchObject({ success: true, phase: mode })
      }

      const oldStatus = run('bunx', ['--bun', 'prisma', 'migrate', 'status'], resolve(rollbackRuntimeRoot, 'backend'), childEnv)
      const oldStatusOutput = `${oldStatus.stdout}\n${oldStatus.stderr}`
      process.stdout.write(`COM-4 old rollback CLI migrate status exit=${oldStatus.status}\n${oldStatusOutput}\n`)
      expect(oldStatus.status, `Frozen ${rollbackTarget} Prisma CLI must accept the applied migration history. Output:\n${oldStatusOutput}`).toBe(0)

      checked('bun', [probe, root, 'candidate-after', statePath], root, childEnv)
      const preserved = (await db.query('SELECT id,family_id,memory_id,author_id,body,version,deleted_at,create_request_id,initial_payload_hash FROM memory_comments ORDER BY id')).rows
      expect(preserved).toEqual(beforeRows)
      expect((await db.query('SELECT id,family_id,child_id,author_id,kind,body,occurred_at,first_published_at FROM memories WHERE id=$1', [memoryId])).rows[0]).toMatchObject(legacyBefore)
      const retained = await db.query("SELECT id,body,create_request_id,deleted_at FROM memory_comments WHERE memory_id=$1 ORDER BY body", [memoryId])
      expect(retained.rows).toHaveLength(2)
      expect(retained.rows.some((row) => row.body === 'COM-4 API-created retained comment' && row.deleted_at === null)).toBe(true)
      expect(retained.rows.some((row) => row.body === '' && row.deleted_at !== null)).toBe(true)
    } finally {
      await db.end()
    }
  } finally {
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
    rmSync(fixture, { recursive: true, force: true })
  }
}, 180_000)
