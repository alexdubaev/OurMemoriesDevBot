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
const archivedSha = 'd2999cca6e4e5980cc2277de7453440353f5b392'

test('current → pinned d299 → current preserves deletion fences, media bytes and the exact ledger', async () => {
  const baseUrl = requireIntegrationDatabaseUrl()
  if (!baseUrl || process.env.DATABASE_URL !== baseUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(baseUrl)
  const base = new URL(baseUrl)
  if (base.hostname !== '127.0.0.1' || !base.pathname.endsWith('_test')) throw new Error('Loopback *_test PostgreSQL required')
  const name = `control_delete_recovery_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}_test`
  const ownUrl = new URL(baseUrl)
  ownUrl.pathname = `/${name}`
  const admin = new Client({ connectionString: baseUrl })
  const scratchRoot = resolve(root, '.scratch')
  mkdirSync(scratchRoot, { recursive: true })
  const scratchPrefix = `${scratchRoot}${sep}`
  const fixture = mkdtempSync(resolve(scratchRoot, 'control-deletion-recovery-'))
  if (!resolve(fixture).startsWith(scratchPrefix)) throw new Error('Recovery fixture escaped .scratch')
  const archiveRoot = resolve(fixture, 'runtime-d299')
  const storageRoot = resolve(fixture, 'private-media')
  const statePath = resolve(fixture, 'roundtrip-state.json')
  const env: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1', TEST_SKIP_DOCKER: '1',
    DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString(),
    JWT_SECRET: 'control-deletion-recovery-synthetic-secret-0123456789',
    PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://127.0.0.1:4000',
  }
  const run = (command: string, args: string[], cwd = root) => spawnSync(command, args, {
    cwd, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 12 * 1024 * 1024,
  })
  const checked = (label: string, command: string, args: string[], cwd = root) => {
    const result = run(command, args, cwd)
    if (result.status !== 0) throw new Error(`${label} failed exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}\n${result.stdout}\n${result.stderr}`)
    return result.stdout
  }
  let created = false
  let adminConnected = false
  try {
    mkdirSync(archiveRoot)
    const archive = spawnSync('git', ['archive', archivedSha, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'],
      { cwd: root, encoding: null, timeout: 60_000, maxBuffer: 48 * 1024 * 1024 })
    if (archive.status !== 0 || !archive.stdout) throw new Error(`Cannot archive pinned d299 runtime: ${archive.stderr}`)
    const extract = spawnSync('tar', ['-x', '-C', archiveRoot], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 60_000 })
    if (extract.status !== 0) throw new Error(`Cannot extract pinned d299 runtime: ${extract.stderr}`)
    checked('d299 dependency install', 'bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], archiveRoot)
    checked('d299 Prisma generation', 'bun', ['run', '--cwd', 'backend', 'prisma:generate'], archiveRoot)
    await admin.connect()
    adminConnected = true
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true

    checked('apply exact d299 migration catalog', 'bunx', ['--bun', 'prisma', 'migrate', 'deploy', '--config', resolve(archiveRoot, 'backend/prisma.config.ts')], resolve(archiveRoot, 'backend'))
    const preSqlOutput = checked('current recovery against validated exact d299 prefix', 'bun', ['scripts/migrate-max-legacy-videos.ts', '--recover-all'], backendRoot)
    expect(JSON.parse(preSqlOutput.trim().split('\n').at(-1)!)).toMatchObject({ total: 0, excluded: 0, mode: 'recovery-readiness' })

    checked('apply current additive lifecycle migrations', 'bun', ['run', 'prisma:deploy'], backendRoot)
    checked('seed lifecycle, grace archive, durable partial purge and MAX retention', 'bun', [
      'scripts/test-support/control-deletion-recovery-probe.mjs', root, 'seed-current', statePath, storageRoot, root,
    ], backendRoot)
    const before = await ledgerSnapshot(ownUrl.toString())
    const candidateRecovery = checked('candidate recovery inverse', 'bun', ['scripts/migrate-max-legacy-videos.ts', '--recover-all', '--apply'], backendRoot)
    expect(JSON.parse(candidateRecovery.trim().split('\n').at(-1)!)).toMatchObject({ inspected: 2, excluded: 1, recovered: 2, refused: 0, remaining: 0 })

    const archivedOutput = checked('actual archived d299 auth, MAX, browser-link, family and cleanup paths', 'bun', [
      'scripts/test-support/control-deletion-recovery-probe.mjs', archiveRoot, 'd299-runtime', statePath, storageRoot, root,
    ], backendRoot)
    expect(JSON.parse(archivedOutput.trim().split('\n').at(-1)!)).toMatchObject({ phase: 'd299-runtime', success: true })
    const currentOutput = checked('current maintenance resumes durable purge', 'bun', [
      'scripts/test-support/control-deletion-recovery-probe.mjs', root, 'current-after', statePath, storageRoot, root,
    ], backendRoot)
    expect(JSON.parse(currentOutput.trim().split('\n').at(-1)!)).toMatchObject({ phase: 'current-after', success: true })
    expect(await ledgerSnapshot(ownUrl.toString())).toEqual(before)
  } finally {
    if (adminConnected) {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
      await admin.end()
    }
    const resolvedFixture = resolve(fixture)
    if (!resolvedFixture.startsWith(scratchPrefix)) throw new Error('Refusing to remove recovery fixture outside .scratch')
    rmSync(resolvedFixture, { recursive: true, force: true })
  }
}, process.platform === 'win32' ? 900_000 : 720_000)

async function ledgerSnapshot(connectionString: string) {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const result = await client.query(`SELECT migration_name, checksum, finished_at::text, rolled_back_at::text
      FROM _prisma_migrations ORDER BY migration_name, started_at, id`)
    return result.rows
  } finally { await client.end() }
}
