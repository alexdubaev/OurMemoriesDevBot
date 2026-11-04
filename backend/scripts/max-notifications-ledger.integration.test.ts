import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'
import { frozenMax63Revision } from './test-support/frozen-max63-recovery'

const root = resolve(import.meta.dir, '../..')

test('pilot recovery ledger accepts only exact completed 62-to-63 migration and real enum state', async () => {
  const baseUrl = requireIntegrationDatabaseUrl()
  const ownUrl = new URL(baseUrl)
  const name = `pilot_ledger_${randomUUID().replaceAll('-', '')}_test`
  ownUrl.pathname = `/${name}`
  const admin = new Client({ connectionString: baseUrl })
  const scratch = resolve(root, '.scratch')
  mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(resolve(scratch, 'pilot-ledger-'))
  const env = { ...process.env, DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString() }
  const checked = (command: string, args: string[], cwd = root, input?: Uint8Array) => {
    const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 120_000, maxBuffer: 12 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`Ledger fixture command failed: ${command}\n${result.stdout}\n${result.stderr}`)
    return result
  }
  const catalog = (directory: string) => readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name: migration }) => {
    const lf = readFileSync(resolve(directory, migration, 'migration.sql'), 'utf8').replaceAll('\r\n', '\n')
    const sha = (value: string) => createHash('sha256').update(value).digest('hex')
    return `${migration}:${sha(lf)}:${sha(lf.replaceAll('\n', '\r\n'))}`
  }).sort().join('\n')
  let db: Client | undefined
  let created = false
  try {
    await admin.connect()
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    const archive = spawnSync('git', ['archive', 'aa4e9bc818392bc067ba862017c63a0d2d35495b',
      'backend/prisma', 'backend/prisma.config.ts'], { cwd: root, encoding: null, maxBuffer: 16 * 1024 * 1024 })
    if (archive.status !== 0 || !archive.stdout) throw new Error('Cannot archive actual production migration baseline')
    checked('tar', ['-x', '-C', fixture], root, archive.stdout)
    const baselineRoot = resolve(fixture, 'backend')
    checked('bunx', ['--bun', 'prisma', 'migrate', 'deploy', '--config', resolve(baselineRoot, 'prisma.config.ts')], resolve(root, 'backend'))
    const candidateRoot = resolve(fixture, 'candidate-63')
    mkdirSync(candidateRoot)
    const candidateArchive = spawnSync('git', ['archive', frozenMax63Revision, 'backend/prisma', 'backend/prisma.config.ts'],
      { cwd: root, encoding: null, maxBuffer: 16 * 1024 * 1024 })
    if (candidateArchive.status !== 0 || !candidateArchive.stdout) throw new Error('Cannot archive reviewed63 migration candidate')
    checked('tar', ['-x', '-C', candidateRoot], root, candidateArchive.stdout)
    const candidateBackend = resolve(candidateRoot, 'backend')
    const baseline = catalog(resolve(baselineRoot, 'prisma/migrations'))
    const candidate = catalog(resolve(candidateBackend, 'prisma/migrations'))
    const currentCandidate = catalog(resolve(root, 'backend/prisma/migrations'))
    expect(baseline.split('\n')).toHaveLength(62)
    expect(candidate.split('\n')).toHaveLength(63)
    expect(currentCandidate.split('\n').length).toBeGreaterThan(63)
    const source = readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8').replaceAll('\r\n', '\n')
    const marker = "<<'MEMOLY_MAX_VIDEO_MIGRATION_HISTORY_JS'\n"
    const guard = source.split(marker)[1]?.split('\nMEMOLY_MAX_VIDEO_MIGRATION_HISTORY_JS')[0]
    if (!guard) throw new Error('Actual recovery ledger guard is unavailable')
    const verify = (phase: 'pre-sql' | 'complete', candidateCatalog = candidate) => spawnSync(process.execPath, ['-e', guard], { cwd: root,
      env: { ...env, MEMOLY_EXPECTED_BASELINE_MIGRATIONS: baseline, MEMOLY_EXPECTED_CANDIDATE_MIGRATIONS: candidateCatalog,
        MEMOLY_MAX_VIDEO_LEDGER_PHASE: phase, MEMOLY_MAX_VIDEO_LEDGER_PROFILE: 'notifications63' },
      encoding: 'utf8', timeout: 30_000 }).status
    db = new Client({ connectionString: ownUrl.toString() })
    await db.connect()
    const snapshot = async () => (await db!.query('SELECT * FROM _prisma_migrations ORDER BY migration_name,started_at,id')).rows
    const enumPresent = async () => (await db!.query("SELECT EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='max_inbox_event_kind' AND e.enumlabel='bot_stopped') AS present")).rows[0].present
    const rejectCurrent65 = async () => {
      const before = await snapshot(), beforeEnum = await enumPresent()
      for (const phase of ['pre-sql', 'complete'] as const) {
        expect(verify(phase, currentCandidate)).not.toBe(0)
        expect(await snapshot()).toEqual(before)
        expect(await enumPresent()).toBe(beforeEnum)
      }
    }
    expect(await enumPresent()).toBe(false)
    await rejectCurrent65()
    expect(verify('pre-sql')).toBe(0)
    expect(verify('complete')).not.toBe(0)
    checked('bunx', ['--bun', 'prisma', 'migrate', 'deploy', '--config', resolve(candidateBackend, 'prisma.config.ts')], resolve(root, 'backend'))
    expect(verify('complete')).toBe(0)
    expect(await enumPresent()).toBe(true)
    expect(await snapshot()).toHaveLength(63)
    await rejectCurrent65()
    const migration = '20261027210000_max_bot_stopped'
    const before = (await db.query('SELECT checksum,finished_at FROM _prisma_migrations WHERE migration_name=$1', [migration])).rows[0]
    await db.query('UPDATE _prisma_migrations SET checksum=$1 WHERE migration_name=$2', ['0'.repeat(64), migration])
    expect(verify('complete')).not.toBe(0)
    await db.query('UPDATE _prisma_migrations SET checksum=$1,finished_at=NULL WHERE migration_name=$2', [before.checksum, migration])
    expect(verify('pre-sql')).not.toBe(0)
    await db.query('UPDATE _prisma_migrations SET finished_at=$1 WHERE migration_name=$2', [before.finished_at, migration])
    expect(verify('complete')).toBe(0)
    // A missing ledger row cannot disguise an already-expanded schema as a pre-SQL baseline.
    await db.query('DELETE FROM _prisma_migrations WHERE migration_name=$1', [migration])
    expect(verify('pre-sql')).not.toBe(0)
    expect(verify('complete')).not.toBe(0)
  } finally {
    await db?.end()
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
    if (!resolve(fixture).startsWith(`${scratch}${sep}`)) throw new Error('Ledger fixture escaped owned scratch directory')
    await rm(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}, 180_000)
