import { expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'
import { archiveFrozenMax63Runtime } from './test-support/frozen-max63-recovery'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const archivedSha = 'd2999cca6e4e5980cc2277de7453440353f5b392'

for (const lineEndingMode of ['lf', 'mixed'] as const) test.serial(`reviewed MAX63 → pinned d299 → reviewed MAX63 preserves deletion fences, media bytes and the exact ledger (${lineEndingMode} migration SQL)`, async () => {
  const baseUrl = requireIntegrationDatabaseUrl()
  if (!baseUrl || process.env.DATABASE_URL !== baseUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(baseUrl)
  const base = new URL(baseUrl)
  if (base.hostname !== '127.0.0.1' || !base.pathname.endsWith('_test')) throw new Error('Loopback *_test PostgreSQL required')
  const suffix = `${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}`
  const name = `control_delete_recovery_${suffix}_test`
  const driftName = `control_delete_recovery_drift_${suffix}_test`
  const ownUrl = new URL(baseUrl)
  ownUrl.pathname = `/${name}`
  const driftUrl = new URL(baseUrl)
  driftUrl.pathname = `/${driftName}`
  const admin = new Client({ connectionString: baseUrl })
  const scratchRoot = resolve(root, '.scratch')
  mkdirSync(scratchRoot, { recursive: true })
  const scratchPrefix = `${scratchRoot}${sep}`
  const fixture = mkdtempSync(resolve(scratchRoot, 'control-deletion-recovery-'))
  if (!resolve(fixture).startsWith(scratchPrefix)) throw new Error('Recovery fixture escaped .scratch')
  const archiveRoot = resolve(fixture, 'runtime-d299')
  const reviewedRoot = resolve(fixture, 'runtime-max63')
  const reviewedBackend = resolve(reviewedRoot, 'backend')
  const storageRoot = resolve(fixture, 'private-media')
  const statePath = resolve(fixture, 'roundtrip-state.json')
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1', TEST_SKIP_DOCKER: '1',
    DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString(),
    JWT_SECRET: 'control-deletion-recovery-synthetic-secret-0123456789',
    PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://127.0.0.1:4000',
  }
  const run = (command: string, args: string[], cwd = root, databaseUrl = ownUrl.toString()) => spawnSync(command, args, {
    cwd, env: { ...env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 300_000, maxBuffer: 12 * 1024 * 1024,
  })
  const checked = (label: string, command: string, args: string[], cwd = root, databaseUrl = ownUrl.toString()) => {
    const result = run(command, args, cwd, databaseUrl)
    if (result.status !== 0) throw new Error(`${label} failed exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}\n${result.stdout}\n${result.stderr}`)
    return result.stdout
  }
  let created = false
  let driftCreated = false
  let adminConnected = false
  try {
    mkdirSync(archiveRoot)
    const archive = spawnSync('git', ['archive', archivedSha, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'],
      { cwd: root, encoding: null, timeout: 60_000, maxBuffer: 48 * 1024 * 1024 })
    if (archive.status !== 0 || !archive.stdout) throw new Error(`Cannot archive pinned d299 runtime: ${archive.stderr}`)
    const extract = spawnSync('tar', ['-x', '-C', archiveRoot], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 60_000 })
    if (extract.status !== 0) throw new Error(`Cannot extract pinned d299 runtime: ${extract.stderr}`)
    const archivedSql = archiveMigrationSqlFiles(archiveRoot)
    checked('d299 dependency install', 'bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], archiveRoot)
    checked('d299 Prisma generation', 'bun', ['run', '--cwd', 'backend', 'prisma:generate'], archiveRoot)
    archiveFrozenMax63Runtime(root, reviewedRoot, env)
    await admin.connect()
    adminConnected = true

    if (lineEndingMode === 'mixed') {
      const lastBaselineMigration = [...archivedSql.keys()].at(58)!
      const originalSql = archivedSql.get(lastBaselineMigration)!
      const newline = originalSql.includes(Buffer.from('\r\n')) ? '\r\n' : '\n'
      writeFileSync(resolve(archiveRoot, 'backend/prisma/migrations', lastBaselineMigration, 'migration.sql'),
        Buffer.concat([originalSql, Buffer.from(`${newline}-- synthetic SQL checksum drift${newline}`)]))
      await admin.query(`CREATE DATABASE "${driftName}"`)
      driftCreated = true
      checked('apply d299 catalog with synthetic SQL byte drift', 'bunx', ['--bun', 'prisma', 'migrate', 'deploy', '--config', resolve(archiveRoot, 'backend/prisma.config.ts')], resolve(archiveRoot, 'backend'), driftUrl.toString())
      const driftBefore = await ledgerSnapshot(driftUrl.toString())
      expect(driftBefore).toHaveLength(59)
      const driftResult = run('bun', ['scripts/migrate-max-legacy-videos.ts', '--recover-all'], reviewedBackend, driftUrl.toString())
      expect(driftResult.status).not.toBe(0)
      expect(`${driftResult.stdout}\n${driftResult.stderr}`).toContain('MAX recovery migration ledger is not an exact completed reviewed prefix')
      expect(await ledgerSnapshot(driftUrl.toString())).toEqual(driftBefore)
      await admin.query(`DROP DATABASE "${driftName}" WITH (FORCE)`)
      driftCreated = false
      restoreArchiveMigrationSqlFiles(archiveRoot, archivedSql)
    }

    applyMigrationSqlLineEndingMode(archiveRoot, archivedSql, lineEndingMode)
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true

    checked('apply exact d299 migration catalog', 'bunx', ['--bun', 'prisma', 'migrate', 'deploy', '--config', resolve(archiveRoot, 'backend/prisma.config.ts')], resolve(archiveRoot, 'backend'))
    const historicalLedger = await ledgerSnapshot(ownUrl.toString())
    expect(historicalLedger).toHaveLength(59)
    restoreArchiveMigrationSqlFiles(archiveRoot, archivedSql)
    const preSqlOutput = checked('reviewed MAX63 recovery against validated exact d299 prefix', 'bun', ['scripts/migrate-max-legacy-videos.ts', '--recover-all'], reviewedBackend)
    expect(JSON.parse(preSqlOutput.trim().split('\n').at(-1)!)).toMatchObject({ total: 0, excluded: 0, mode: 'recovery-readiness' })
    expect(await ledgerSnapshot(ownUrl.toString())).toEqual(historicalLedger)
    checked('apply reviewed MAX63 additive lifecycle migrations', 'bun', ['run', 'prisma:deploy'], reviewedBackend)
    expect((await ledgerSnapshot(ownUrl.toString())).slice(0, 59)).toEqual(historicalLedger)
    checked('seed lifecycle, grace archive, durable partial purge and MAX retention', 'bun', [
      'scripts/test-support/control-deletion-recovery-probe.mjs', reviewedRoot, 'seed-current', statePath, storageRoot, reviewedRoot,
    ], backendRoot)
    const before = await ledgerSnapshot(ownUrl.toString())
    expect(before).toHaveLength(63)
    expect(before.at(-1)).toMatchObject({ migration_name: '20261027210000_max_bot_stopped' })
    const candidateRecovery = checked('reviewed MAX63 recovery inverse', 'bun', ['scripts/migrate-max-legacy-videos.ts', '--recover-all', '--apply'], reviewedBackend)
    expect(JSON.parse(candidateRecovery.trim().split('\n').at(-1)!)).toMatchObject({ inspected: 2, excluded: 1, recovered: 2, refused: 0, remaining: 0 })

    const archivedOutput = checked('actual archived d299 auth, MAX, browser-link, family and cleanup paths', 'bun', [
      'scripts/test-support/control-deletion-recovery-probe.mjs', archiveRoot, 'd299-runtime', statePath, storageRoot, reviewedRoot,
    ], backendRoot)
    expect(JSON.parse(archivedOutput.trim().split('\n').at(-1)!)).toMatchObject({ phase: 'd299-runtime', success: true })
    const currentOutput = checked('current maintenance resumes durable purge', 'bun', [
      'scripts/test-support/control-deletion-recovery-probe.mjs', reviewedRoot, 'current-after', statePath, storageRoot, reviewedRoot,
    ], backendRoot)
    expect(JSON.parse(currentOutput.trim().split('\n').at(-1)!)).toMatchObject({ phase: 'current-after', success: true })
    expect(await ledgerSnapshot(ownUrl.toString())).toEqual(before)
  } finally {
    if (adminConnected) {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
      if (driftCreated) await admin.query(`DROP DATABASE "${driftName}" WITH (FORCE)`)
      await admin.end()
    }
    const resolvedFixture = resolve(fixture)
    if (!resolvedFixture.startsWith(scratchPrefix)) throw new Error('Refusing to remove recovery fixture outside .scratch')
    rmSync(resolvedFixture, { recursive: true, force: true })
  }
}, process.platform === 'win32' ? 900_000 : 720_000)

test.serial('actual current65 refuses historical MAX inverse without changing the ledger, recovery data or media bytes', async () => {
  const base = new URL(requireIntegrationDatabaseUrl()!)
  const name = `control_delete_recovery_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}_test`
  const ownUrl = new URL(base); ownUrl.pathname = `/${name}`
  const admin = new Client({ connectionString: base.toString() })
  const scratch = resolve(root, '.scratch'); mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(resolve(scratch, 'current65-max-refusal-'))
  const storageRoot = resolve(fixture, 'media'), state = resolve(fixture, 'state.json')
  const env = { ...process.env, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1', TEST_SKIP_DOCKER: '1',
    DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString(), PRIVATE_STORAGE_DRIVER: 'filesystem',
    PRIVATE_STORAGE_LOCAL_ROOT: storageRoot, JWT_SECRET: 'control-deletion-recovery-synthetic-secret-0123456789' }
  const run = (args: string[]) => spawnSync('bun', args, { cwd: backendRoot, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 12 * 1024 * 1024 })
  const checked = (args: string[]) => { const result = run(args); if (result.status !== 0) throw Error(result.stdout + result.stderr); return result.stdout }
  let created = false, connected = false
  try {
    await admin.connect(); connected = true
    await admin.query(`CREATE DATABASE "${name}"`); created = true
    checked(['run', 'prisma:deploy'])
    checked(['scripts/test-support/control-deletion-recovery-probe.mjs', root, 'seed-current', state, storageRoot, root])
    const db = new Client({ connectionString: ownUrl.toString() }); await db.connect()
    try {
      const tables = ['_prisma_migrations', 'families', 'max_video_references', 'max_video_legacy_retention', 'media_assets', 'control_family_deletions']
      const snapshot = async () => {
        const rows = []
        for (const table of tables) rows.push((await db.query(`SELECT to_jsonb(item) AS item FROM ${table} item ORDER BY to_jsonb(item)::text`)).rows)
        return rows
      }
      const before = await snapshot(), bytes = mediaByteSnapshot(storageRoot)
      expect(before[0]).toHaveLength(65)
      expect(before[2]!.length).toBeGreaterThan(0)
      expect(bytes.length).toBeGreaterThan(0)
      for (const args of [['--recover-all'], ['--recover-all', '--apply']]) {
        const refused = run(['scripts/migrate-max-legacy-videos.ts', ...args])
        expect(refused.status).not.toBe(0)
        expect(refused.stdout + refused.stderr).toContain('MAX recovery migration catalog is not the exact reviewed lifecycle extension')
        expect(await snapshot()).toEqual(before)
        expect(mediaByteSnapshot(storageRoot)).toEqual(bytes)
      }
    } finally { await db.end() }
  } finally {
    if (connected) { if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
    rmSync(fixture, { recursive: true, force: true })
  }
}, 300_000)

function mediaByteSnapshot(directory: string, prefix = ''): Array<[string, string]> {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = resolve(directory, entry.name), relative = `${prefix}${entry.name}`
    return entry.isDirectory() ? mediaByteSnapshot(path, `${relative}/`) : [[relative, createHash('sha256').update(readFileSync(path)).digest('hex')]]
  })
}

function archiveMigrationSqlFiles(archiveRoot: string) {
  const root = resolve(archiveRoot, 'backend/prisma/migrations')
  const entries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  if (entries.length !== 59) throw new Error(`Expected the exact d299 migration prefix, found ${entries.length} files`)
  return new Map(entries.map((name) => [name, readFileSync(resolve(root, name, 'migration.sql'))]))
}

function restoreArchiveMigrationSqlFiles(archiveRoot: string, sources: Map<string, Buffer>) {
  for (const [name, source] of sources) writeFileSync(resolve(archiveRoot, 'backend/prisma/migrations', name, 'migration.sql'), source)
}

function applyMigrationSqlLineEndingMode(archiveRoot: string, sources: Map<string, Buffer>, mode: 'lf' | 'mixed') {
  let index = 0
  for (const [name, source] of sources) {
    const lfSource = Buffer.from(source.toString('utf8').replace(/\r\n/g, '\n'))
    const content = mode === 'mixed' && index < 24
      ? Buffer.from(lfSource.toString('utf8').replace(/\n/g, '\r\n'))
      : lfSource
    writeFileSync(resolve(archiveRoot, 'backend/prisma/migrations', name, 'migration.sql'), content)
    index += 1
  }
}

async function ledgerSnapshot(connectionString: string) {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const result = await client.query(`SELECT migration_name, checksum, finished_at::text, rolled_back_at::text
      FROM _prisma_migrations ORDER BY migration_name, started_at, id`)
    return result.rows
  } finally { await client.end() }
}
