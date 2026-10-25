import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const rollbackRuntime = '33a0054c3c71372aa5509ee8ebfa4578ad512ea1'

test('current Control, frozen 33a runtime, then current preserve family, media, invite, telemetry and migration history', () => {
  const baseUrl = requireIntegrationDatabaseUrl()
  if (!baseUrl || process.env.DATABASE_URL !== baseUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(baseUrl)
  if (new URL(baseUrl).hostname !== '127.0.0.1' || !new URL(baseUrl).pathname.endsWith('_test')) throw new Error('Loopback *_test PostgreSQL required')
  const name = `control_compat_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}_test`
  const ownUrl = new URL(baseUrl)
  ownUrl.pathname = `/${name}`
  const admin = new Client({ connectionString: baseUrl })
  const scratchRoot = resolve(root, '.scratch')
  mkdirSync(scratchRoot, { recursive: true })
  const scratchPrefix = `${scratchRoot}${sep}`
  let fixture: string | undefined
  const cleanupFixture = () => {
    if (!fixture) return
    const resolvedFixture = resolve(fixture)
    if (!resolvedFixture.startsWith(scratchPrefix)) throw new Error('Refusing to recursively remove a fixture outside .scratch')
    rmSync(resolvedFixture, { recursive: true, force: true })
  }
  fixture = mkdtempSync(resolve(scratchRoot, 'control-release-compat-'))
  if (!resolve(fixture).startsWith(scratchPrefix)) throw new Error('Compatibility fixture escaped .scratch')
  const storageRoot = resolve(fixture, 'private-media')
  const stateFile = resolve(fixture, 'roundtrip-state.json')
  const archived = resolve(fixture, 'runtime-33a')
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1',
    DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString(),
  }
  const run = (command: string, args: string[], cwd = root, childEnv = env, timeout = 300_000) =>
    spawnSync(command, args, { cwd, env: childEnv, encoding: 'utf8', timeout, maxBuffer: 12 * 1024 * 1024 })
  const checked = (label: string, command: string, args: string[], cwd = root, childEnv = env) => {
    const result = run(command, args, cwd, childEnv)
    if (result.status !== 0) throw new Error(`${label} failed exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}\n${result.stdout}\n${result.stderr}`)
    return result.stdout
  }
  const archiveRuntime = () => {
    mkdirSync(archived)
    const archive = spawnSync('git', ['archive', rollbackRuntime, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'],
      { cwd: root, encoding: null, timeout: 60_000, maxBuffer: 48 * 1024 * 1024 })
    if (archive.status !== 0 || !archive.stdout) throw new Error(`Cannot archive frozen 33a runtime: ${archive.stderr}`)
    const extract = spawnSync('tar', ['-x', '-C', archived], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 60_000 })
    if (extract.status !== 0) throw new Error(`Cannot extract frozen 33a runtime: ${extract.stderr}`)
    checked('frozen runtime dependency install', 'bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], archived)
    checked('frozen runtime Prisma generation', 'bun', ['run', '--cwd', 'backend', 'prisma:generate'], archived)
  }
  let created = false
  try {
    mkdirSync(storageRoot, { recursive: true })
    return admin.connect().then(async () => {
      try {
        archiveRuntime()
        await admin.query(`CREATE DATABASE "${name}"`)
        created = true
        checked('apply exact current migration catalog', 'bunx', ['--bun', 'prisma', 'migrate', 'deploy', '--config', resolve(backendRoot, 'prisma.config.ts')], backendRoot)
        const db = new Client({ connectionString: ownUrl.toString() })
        await db.connect()
        try {
          const readLedger = async () => (await db.query<{
            migration_name: string
            checksum: string
            finished_at: string | null
            rolled_back_at: string | null
          }>(
            `SELECT migration_name, checksum, finished_at::text AS finished_at, rolled_back_at::text AS rolled_back_at
             FROM _prisma_migrations ORDER BY migration_name, started_at, id`,
          )).rows
          const ledgerBefore = await readLedger()
          expect(ledgerBefore.length).toBeGreaterThan(0)
          expect(ledgerBefore.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true)
          const probe = resolve(backendRoot, 'scripts/test-support/control-compatibility-probe.mjs')
          checked('current application and Control telemetry', 'bun', [probe, root, 'current-before', stateFile, storageRoot])
          const oldOutput = checked('actual archived 33a application against expanded schema', 'bun', [probe, archived, 'rollback', stateFile, storageRoot], archived)
          expect(JSON.parse(oldOutput.trim().split('\n').at(-1)!)).toMatchObject({ phase: 'rollback', success: true })
          const currentOutput = checked('current application after 33a runtime', 'bun', [probe, root, 'current-after', stateFile, storageRoot])
          expect(JSON.parse(currentOutput.trim().split('\n').at(-1)!)).toMatchObject({ phase: 'current-after', success: true })
          const ledgerAfter = await readLedger()
          expect(ledgerAfter).toEqual(ledgerBefore)
          expect(ledgerAfter.every((row) => row.finished_at !== null && row.rolled_back_at === null)).toBe(true)
        } finally { await db.end() }
      } finally {
        if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
        await admin.end()
        cleanupFixture()
      }
    })
  } catch (error) {
    if (created) void admin.query(`DROP DATABASE "${name}" WITH (FORCE)`).catch(() => {})
    void admin.end().catch(() => {})
    cleanupFixture()
    throw error
  }
}, process.platform === 'win32' ? 600_000 : 420_000)
