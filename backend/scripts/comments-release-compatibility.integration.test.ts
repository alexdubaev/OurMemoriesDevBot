import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const oldProduction = '4ce200620bf87d1ba5605aee73f5442fe50ccdb4'
const rollbackTarget = '3fce2739205da927b95eb3379b1d066b61282965'
const acceptedV4RollbackTarget = '4b4edc0992803b84c919aadb835e8d2e21095c51'

test('COM-4 current and measured rollback runtimes read and write after additive migration while comments and legacy rows survive', async () => {
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
  const childEnv = {
    ...process.env,
    NODE_ENV: 'test',
    CHECKPOINT_DISABLE: '1',
    DATABASE_URL: ownUrl.toString(),
    TEST_DATABASE_URL: ownUrl.toString(),
  }
  const run = (command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env, timeout = 120_000) =>
    spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })
  const timed = <T>(label: string, action: () => T): T => {
    const startedAt = performance.now()
    process.stdout.write(`COM-4 phase start label=${label}\n`)
    try {
      return action()
    } finally {
      process.stdout.write(`COM-4 phase done label=${label} elapsedMs=${Math.round(performance.now() - startedAt)}\n`)
    }
  }
  const timedAsync = async <T>(label: string, action: () => Promise<T>): Promise<T> => {
    const startedAt = performance.now()
    process.stdout.write(`COM-4 phase start label=${label}\n`)
    try {
      return await action()
    } finally {
      process.stdout.write(`COM-4 phase done label=${label} elapsedMs=${Math.round(performance.now() - startedAt)}\n`)
    }
  }
  const checked = (label: string, command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env) => timed(label, () => {
    const result = run(command, args, cwd, env)
    if (result.status !== 0) {
      const reason = result.error
        ? `spawnError=${result.error.code ?? result.error.name}`
        : `exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}`
      throw new Error(`${command} ${args.join(' ')} failed (${reason}): ${result.stdout}\n${result.stderr}`)
    }
    return result.stdout
  })
  const archiveRuntime = (revision: string, runtimeRoot: string, label: string) => {
    mkdirSync(runtimeRoot)
    const archive = timed(`${label}:archive`, () => spawnSync('git', ['archive', revision, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'], { cwd: root, encoding: null, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }))
    if (archive.status !== 0) throw new Error(`Cannot archive ${label}: ${archive.stderr}`)
    const tarResult = timed(`${label}:extract`, () => spawnSync('tar', ['-x', '-C', runtimeRoot], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 30_000 }))
    if (tarResult.status !== 0) throw new Error(`Cannot extract ${label}: ${tarResult.stderr}`)
    checked(`${label}:install`, 'bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], runtimeRoot, childEnv)
    checked(`${label}:prisma-generate`, 'bun', ['run', '--cwd', 'backend', 'prisma:generate'], runtimeRoot, childEnv)
  }
  const rollbackRuntimeRoot = resolve(fixture, 'runtime-rollback-target')
  const acceptedV4RuntimeRoot = resolve(fixture, 'runtime-accepted-v4-rollback-target')
  // Prepare this frozen CLI/client before any fixture rows exist. It establishes
  // the actual historical migration ledger used by the compatibility probe.
  await admin.connect()
  let created = false
  try {
    archiveRuntime(rollbackTarget, rollbackRuntimeRoot, 'rollback-target')
    archiveRuntime(acceptedV4RollbackTarget, acceptedV4RuntimeRoot, 'accepted-v4')
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
      checked('rollback-migrate-deploy', 'bunx', ['--bun', 'prisma', 'migrate', 'deploy'], resolve(rollbackRuntimeRoot, 'backend'), childEnv)
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
      // Exercise the actual Selectel entrypoint on an existing MAX database. The deliberately
      // missing runtime role makes the grant postcondition fail only after Prisma has applied
      // the additive comments migration; retrying with a safe role must be a ledger no-op.
      const selectelEnv = {
        ...childEnv,
        MAX_ENABLED: 'true',
        ADMIN_SEED_EMAIL: '',
        ADMIN_SEED_PASSWORD: '',
        DATABASE_RUNTIME_USER: `missing_runtime_${process.pid}`,
      }
      const failedSelectel = timed('selectel-failure-run', () => run('bun', ['scripts/deploy-selectel-database.ts'], resolve(backendRoot), selectelEnv))
      expect(failedSelectel.status).not.toBe(0)
      expect(`${failedSelectel.stdout}\n${failedSelectel.stderr}`).toContain('Database migration was applied, but runtime grants or postconditions failed')
      expect(`${failedSelectel.stdout}\n${failedSelectel.stderr}`).not.toContain(ownUrl.toString())
      const appliedAfterFailure = await db.query<{ migration_name: string; checksum: string; finished_at: Date }>(
        'SELECT migration_name,checksum,finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
      )
      expect(appliedAfterFailure.rows.map((row) => row.migration_name)).toEqual(migrations)
      expect(appliedAfterFailure.rows.at(-1)?.migration_name).toBe(migrations.at(-1))

      const runtimeRole = `selectel_runtime_${process.pid}`
      await admin.query(`CREATE ROLE "${runtimeRole}" NOLOGIN`)
      try {
        const retryEnv = { ...selectelEnv, DATABASE_RUNTIME_USER: runtimeRole }
        checked('selectel-retry-run', 'bun', ['scripts/deploy-selectel-database.ts'], resolve(backendRoot), retryEnv)
        const appliedAfterRetry = await db.query<{ migration_name: string; checksum: string; finished_at: Date }>(
          'SELECT migration_name,checksum,finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
        )
        expect(appliedAfterRetry.rows).toEqual(appliedAfterFailure.rows)
        const runtimeState = (await db.query<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean; can_create: boolean; can_temp: boolean; has_default_public_acl: boolean }>(
          `SELECT role.rolsuper,role.rolcreaterole,role.rolcreatedb,role.rolbypassrls,
                  has_schema_privilege($1,'public','CREATE') AS can_create,
                  has_database_privilege($1,current_database(),'TEMPORARY') AS can_temp,
                  EXISTS (SELECT 1 FROM pg_default_acl acl
                           CROSS JOIN LATERAL aclexplode(acl.defaclacl) grant_entry
                           WHERE grant_entry.grantee=0) AS has_default_public_acl
             FROM pg_roles role WHERE role.rolname=$1`,
          [runtimeRole],
        )).rows[0]
        expect(runtimeState).toMatchObject({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, can_create: false, can_temp: false, has_default_public_acl: false })
        const userState = await db.query<{ users: string; admins: string; passwords: string }>(
          "SELECT count(*)::text AS users, count(*) FILTER (WHERE role='admin')::text AS admins, count(*) FILTER (WHERE password_hash IS NOT NULL)::text AS passwords FROM users",
        )
        expect(userState.rows).toEqual([{ users: '1', admins: '0', passwords: '0' }])
        const cloudNoAdmin = timed('cloud-no-admin-run', () => run('bun', ['scripts/deploy-database.ts'], resolve(backendRoot), retryEnv))
        expect(cloudNoAdmin.status).not.toBe(0)
        expect(`${cloudNoAdmin.stdout}\n${cloudNoAdmin.stderr}`).toContain('Database migration was applied, but runtime grants or postconditions failed')
        expect(`${cloudNoAdmin.stdout}\n${cloudNoAdmin.stderr}`).not.toContain(ownUrl.toString())
      } finally {
        await db.query(`DROP OWNED BY "${runtimeRole}"`)
        await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`)
      }
      const appliedAfterComments = await db.query<{ migration_name: string; checksum: string }>(
        'SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
      )
      expect(appliedAfterComments.rows.map((row) => row.migration_name)).toEqual(migrations)
      expect(appliedAfterComments.rows.map(({ migration_name, checksum }) => ({ migration_name, checksum }))).toEqual(
        migrations.map((migration) => ({
          migration_name: migration,
          checksum: createHash('sha256').update(readFileSync(resolve(backendRoot, 'prisma/migrations', migration, 'migration.sql'))).digest('hex'),
        })),
      )
      const probe = resolve(root, 'backend/scripts/test-support/comments-runtime-probe.mjs')
      const statePath = resolve(fixture, 'runtime-state.json')
      const seedPath = resolve(fixture, 'seed.json')
      writeFileSync(seedPath, JSON.stringify({ userId, familyId, childId, memoryId }))
      checked('probe-candidate-before', 'bun', [probe, root, 'candidate-before', statePath, seedPath], root, childEnv)
      const beforeRows = (await db.query('SELECT id,family_id,memory_id,author_id,body,version,deleted_at,create_request_id,initial_payload_hash FROM memory_comments ORDER BY id')).rows

      for (const [revision, runtimeRoot, mode] of [
        [oldProduction, resolve(fixture, 'runtime-old-production'), 'old-production'],
        [rollbackTarget, rollbackRuntimeRoot, 'old-rollback-target'],
        [acceptedV4RollbackTarget, acceptedV4RuntimeRoot, 'accepted-v4-rollback-target'],
      ] as const) {
        if (revision === oldProduction) archiveRuntime(revision, runtimeRoot, 'old-production')
        const output = checked(`probe-${mode}`, 'bun', [probe, runtimeRoot, mode, statePath], runtimeRoot, childEnv)
        expect(JSON.parse(output.trim().split('\n').at(-1)!)).toMatchObject({ success: true, phase: mode })
      }

      const oldStatus = timed('old-rollback-cli-status', () => run('bunx', ['--bun', 'prisma', 'migrate', 'status'], resolve(rollbackRuntimeRoot, 'backend'), childEnv))
      const oldStatusOutput = `${oldStatus.stdout}\n${oldStatus.stderr}`
      process.stdout.write(`COM-4 old rollback CLI migrate status exit=${oldStatus.status}\n${oldStatusOutput}\n`)
      expect(oldStatus.status, `Frozen ${rollbackTarget} Prisma CLI must accept the applied migration history. Output:\n${oldStatusOutput}`).toBe(0)

      checked('probe-candidate-after', 'bun', [probe, root, 'candidate-after', statePath], root, childEnv)
      await timedAsync('final-db-assertions', async () => {
        const preserved = (await db.query('SELECT id,family_id,memory_id,author_id,body,version,deleted_at,create_request_id,initial_payload_hash FROM memory_comments ORDER BY id')).rows
        expect(preserved).toEqual(beforeRows)
        expect((await db.query('SELECT id,family_id,child_id,author_id,kind,body,occurred_at,first_published_at FROM memories WHERE id=$1', [memoryId])).rows[0]).toMatchObject(legacyBefore)
        const retained = await db.query("SELECT id,body,create_request_id,deleted_at FROM memory_comments WHERE memory_id=$1 ORDER BY body", [memoryId])
        expect(retained.rows).toHaveLength(2)
        expect(retained.rows.some((row) => row.body === 'COM-4 API-created retained comment' && row.deleted_at === null)).toBe(true)
        expect(retained.rows.some((row) => row.body === '' && row.deleted_at !== null)).toBe(true)
      })
    } finally {
      await timedAsync('db-end', () => db.end())
    }
  } finally {
    if (created) await timedAsync('drop-test-database', () => admin.query(`DROP DATABASE "${name}" WITH (FORCE)`))
    await timedAsync('admin-end', () => admin.end())
    timed('fixture-rmsync', () => rmSync(fixture, { recursive: true, force: true }))
  }
}, process.platform === 'win32' ? 300_000 : 180_000)
