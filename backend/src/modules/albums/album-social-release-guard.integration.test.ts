import { expect, test } from 'bun:test'
import { Client } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
// @ts-expect-error Test-only JavaScript fixture has no declaration surface.
import { verifyS3AlbumSocialMigrationRoute } from '../../../scripts/test-support/s3-album-social-route-fixture.mjs'

const root = resolve(import.meta.dir, '../../../..')
const pinned = '26cfab9ce35fd1a42279fc0d9dd3637c340eec6a'
const baseline = '6de3da8eb4588b3fe3ebe14016ea0c8ae35c69ab'

test('S3 album-social normal migration uses exact routed prefixes and preserves historical MAX routing', async () => {
  const result = await verifyS3AlbumSocialMigrationRoute(root, resolve(root, 'deploy/selectel/redeploy.sh'))
  expect(result.cases).toBe(14)
}, 300_000)

test('S3 album-social release guard validates only exact real PostgreSQL prefixes and preserves data through frozen Prisma status', async () => {
  const base = new URL(requireIntegrationDatabaseUrl()!)
  if (base.hostname !== '127.0.0.1' || !base.pathname.endsWith('_test')) throw Error('Isolated loopback test database required')
  const name = `s3_social_guard_${randomUUID().replaceAll('-', '')}_test`
  const url = new URL(base); url.pathname = `/${name}`
  const admin = new Client({ connectionString: base.toString() })
  await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`)
  const db = new Client({ connectionString: url.toString() }); await db.connect()
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const fixture = mkdtempSync(resolve(root, '.scratch/s3-social-ledger-'))
  const env = { ...process.env, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString(), CHECKPOINT_DISABLE: '1' }
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    if (result.status !== 0) throw Error(result.stderr)
    return result.stdout
  }
  // Use the same committed SQL byte normalization as the production catalog helper.
  const paths = (revision: string) => git('ls-tree', '-r', '--name-only', revision, '--', 'backend/prisma/migrations/').trim().split('\n').filter(path => path.endsWith('/migration.sql')).sort()
  const catalog = (revision: string) => paths(revision).map(path => {
    const sql = git('show', `${revision}:${path}`).replaceAll('\r\n', '\n')
    return `${path.split('/').at(-2)}:${createHash('sha256').update(sql).digest('hex')}:${createHash('sha256').update(sql.replaceAll('\n', '\r\n')).digest('hex')}`
  }).join('\n')
  const candidate = catalog('HEAD'), originalBaseline = catalog(baseline)
  const program = readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8').replaceAll('\r\n', '\n')
    .match(/MEMOLY_S3_SOCIAL_HISTORY_JS'\n([\s\S]*?)\nMEMOLY_S3_SOCIAL_HISTORY_JS/)?.[1]
  if (!program) throw Error('Actual release validator is missing')
  let cases = 0
  const check = (phase: string, accepted: boolean, candidateCatalog = candidate, baselineCatalog = originalBaseline) => {
    const result = spawnSync('bun', ['-e', program], { cwd: root, env: { ...env,
      MEMOLY_S3_SOCIAL_PHASE: phase, MEMOLY_S3_SOCIAL_CANDIDATE: candidateCatalog, MEMOLY_S3_SOCIAL_BASELINE: baselineCatalog }, encoding: 'utf8', timeout: 15_000 })
    expect(result.error).toBeUndefined()
    if (accepted) expect(result.status).toBe(0)
    else expect(result.status).not.toBe(0)
    cases++
  }
  try {
    await db.query('CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)')
    const migrations = paths('HEAD'); expect(migrations.length).toBe(65)
    const migrate = async (index: number) => {
      const path = migrations[index]!, sql = git('show', `HEAD:${path}`).replaceAll('\r\n', '\n')
      await db.query(sql)
      await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)',
        [randomUUID(), createHash('sha256').update(index % 2 ? sql.replaceAll('\n', '\r\n') : sql).digest('hex'), path.split('/').at(-2)])
    }
    for (let index = 0; index < 63; index++) await migrate(index)
    await db.query("CREATE TABLE guard_sentinel (value text); INSERT INTO guard_sentinel VALUES ('synthetic retained data')")
    for (let count = 63; count <= 65; count++) {
      check('pre-sql', true); check('complete', count === 65)
      if (count === 63) {
        await db.query('CREATE TABLE album_entry_comments(dummy int)'); check('pre-sql', false); await db.query('DROP TABLE album_entry_comments')
      }
      if (count === 64) {
        await db.query('ALTER TABLE album_entries RENAME COLUMN discussion_generation TO missing_generation')
        check('pre-sql', false)
        await db.query('ALTER TABLE album_entries RENAME COLUMN missing_generation TO discussion_generation')
      }
      if (count < 65) await migrate(count)
    }
    const first = (await db.query('SELECT id,checksum FROM _prisma_migrations ORDER BY migration_name LIMIT 1')).rows[0]
    for (const mutation of ["checksum=repeat('0',64)", 'finished_at=NULL', 'rolled_back_at=now()']) {
      await db.query(`UPDATE _prisma_migrations SET ${mutation} WHERE id=$1`, [first.id]); check('complete', false)
      await db.query('UPDATE _prisma_migrations SET checksum=$2,finished_at=now(),rolled_back_at=NULL WHERE id=$1', [first.id, first.checksum])
    }
    const duplicate = randomUUID()
    await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at) SELECT $1,checksum,migration_name,finished_at FROM _prisma_migrations WHERE id=$2', [duplicate, first.id])
    check('pre-sql', false); await db.query('DELETE FROM _prisma_migrations WHERE id=$1', [duplicate])
    await db.query("UPDATE _prisma_migrations SET migration_name='20990101000000_foreign' WHERE migration_name='20261104113000_album_social_recovery_clear'")
    check('complete', false)
    await db.query("UPDATE _prisma_migrations SET migration_name='20261104113000_album_social_recovery_clear' WHERE migration_name='20990101000000_foreign'")
    await db.query('ALTER TABLE album_entries DISABLE TRIGGER album_entries_legacy_clear_discussion'); check('complete', false)
    await db.query('ALTER TABLE album_entries ENABLE TRIGGER album_entries_legacy_clear_discussion')
    check('complete', false, candidate.replace('20261104113000_album_social_recovery_clear', '20990101000000_foreign'))
    check('complete', false, candidate.replace(/(20261104110000_album_entry_social:)[a-f0-9]{64}/, `$1${'f'.repeat(64)}`))
    check('complete', false, candidate.replace(/:[a-f0-9]{64}:/, `:${'f'.repeat(64)}:`))
    check('unknown', false); check('complete', true)
    const before = (await db.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows
    const archive = spawnSync('git', ['archive', pinned, 'backend/prisma', 'backend/prisma.config.ts'], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
    expect(archive.status).toBe(0)
    expect(spawnSync('tar', ['-x', '-C', fixture], { input: archive.stdout }).status).toBe(0)
    const status = spawnSync('bun', [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'status'], { cwd: resolve(fixture, 'backend'), env, encoding: 'utf8', timeout: 30_000 })
    if (status.status !== 0) throw Error(status.stdout + status.stderr)
    expect((await db.query('SELECT * FROM _prisma_migrations ORDER BY migration_name')).rows).toEqual(before)
    expect((await db.query('SELECT value FROM guard_sentinel')).rows).toEqual([{ value: 'synthetic retained data' }])
    console.log(`S3 album-social guard: ${cases} real PostgreSQL checks, frozen63 Prisma status on current65, ledger/data preserved`)
  } finally {
    await db.end(); await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end()
    rmSync(fixture, { recursive: true, force: true })
  }
}, 180_000)
