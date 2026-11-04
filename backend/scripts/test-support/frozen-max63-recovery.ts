import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { requireIntegrationDatabaseUrl } from '../../src/test-support/integration-database'

/** Immutable reviewed filesystem recovery boundary; never truncate a newer catalog. */
export const frozenMax63Revision = '6de3da8eb4588b3fe3ebe14016ea0c8ae35c69ab'

export function checkedFrozenCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 12 * 1024 * 1024 })
  if (result.status !== 0) throw Error(`Frozen recovery command failed (${result.status ?? 'null'}):\n${result.stdout}\n${result.stderr}`)
  return result.stdout + result.stderr
}

export function archiveFrozenMax63Runtime(repository: string, destination: string, env: NodeJS.ProcessEnv) {
  mkdirSync(destination)
  const archive = spawnSync('git', ['archive', frozenMax63Revision, 'backend', 'packages', 'scripts/repo-env.mjs', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'],
    { cwd: repository, maxBuffer: 48 * 1024 * 1024, timeout: 60_000 })
  if (archive.status !== 0) throw Error('Cannot archive reviewed MAX63 runtime')
  const extract = spawnSync('tar', ['-x', '-C', destination], { input: archive.stdout, encoding: 'utf8', timeout: 60_000 })
  if (extract.status !== 0) throw Error(`Cannot extract reviewed MAX63 runtime: ${extract.stderr}`)
  checkedFrozenCommand('bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], destination, env)
  checkedFrozenCommand('bun', ['run', '--cwd', 'backend', 'prisma:generate'], destination, env)
  return destination
}

/** Execute the original positive body with its actual compatible source and schema. */
export async function runFrozenMax63Positive(repository: string, file: string, name: string) {
  const base = new URL(requireIntegrationDatabaseUrl()!)
  if (base.hostname !== '127.0.0.1' || !base.pathname.endsWith('_test')) throw Error('Loopback test database required')
  const database = `max63_recovery_${randomUUID().replaceAll('-', '')}_test`
  const ownUrl = new URL(base); ownUrl.pathname = `/${database}`
  const admin = new Client({ connectionString: base.toString() })
  const scratch = resolve(repository, '.scratch'); mkdirSync(scratch, { recursive: true })
  const fixture = mkdtempSync(resolve(scratch, 'frozen-max63-positive-'))
  const env = { ...process.env, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1', TEST_SKIP_DOCKER: '1',
    DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString() }
  let connected = false, created = false
  try {
    const runtime = archiveFrozenMax63Runtime(repository, resolve(fixture, 'runtime'), env)
    await admin.connect(); connected = true
    await admin.query(`CREATE DATABASE "${database}"`); created = true
    checkedFrozenCommand('bun', ['run', 'prisma:deploy'], resolve(runtime, 'backend'), env)
    const output = checkedFrozenCommand('bun', ['test', '--test-name-pattern', `${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, file], resolve(runtime, 'backend'), env)
    if (!/\b1 pass\b/.test(output) || !/Ran 1 test across 1 file/.test(output)) throw Error(`Frozen positive did not execute exactly one passing case:\n${output}`)
    return output
  } finally {
    if (connected) { if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`); await admin.end() }
    rmSync(fixture, { recursive: true, force: true })
  }
}
