import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, existsSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const baseline = 'e383d79269a3595f4c6cabedf167335aea042cf3'

test('validated release writes survive new → e383 → new with active unread, multi-family ACL, media, sessions and jobs', () => roundtrip(), 60_000)

async function roundtrip() {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(databaseUrl)
  if (new URL(databaseUrl).hostname !== '127.0.0.1') throw new Error('Loopback test database required')
  const name = 'memoly_rollback_roundtrip_' + process.pid + '_' + Date.now() + '_test'
  if (!/^memoly_rollback_roundtrip_[0-9_]+_test$/.test(name)) throw new Error('Unsafe fixture database')
  const ownUrl = new URL(databaseUrl)
  ownUrl.pathname = '/' + name
  const admin = new Client({ connectionString: databaseUrl })
  const directory = resolve(root, '.scratch')
  mkdirSync(directory, { recursive: true })
  const fixture = mkdtempSync(resolve(directory, 'rollback-runtime-'))
  const oldRoot = resolve(fixture, 'baseline')
  mkdirSync(oldRoot)
  const run = (command: string, args: string[], options: Record<string, unknown> = {}) =>
    spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024, ...options })
  const archive = run('git', ['archive', baseline, 'backend', 'packages/contracts'], { encoding: null })
  expect(archive.status).toBe(0)
  expect(run('tar', ['-x', '-C', oldRoot], { input: archive.stdout }).status).toBe(0)
  // These dependencies/generated types have identical schema/lockfile inputs across the two versions.
  expect(run('git', ['diff', '--quiet', baseline, 'HEAD', '--', 'backend/prisma', 'packages/contracts', 'bun.lock']).status).toBe(0)
  symlinkSync(resolve(root, 'node_modules'), resolve(oldRoot, 'node_modules'), 'dir')
  if (existsSync(resolve(backendRoot, 'node_modules'))) symlinkSync(resolve(backendRoot, 'node_modules'), resolve(oldRoot, 'backend/node_modules'), 'dir')
  symlinkSync(resolve(backendRoot, 'src/generated'), resolve(oldRoot, 'backend/src/generated'), 'dir')
  const childEnv = { ...process.env, NODE_ENV: 'test', DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString() }
  await admin.connect()
  let created = false
  try {
    await admin.query('CREATE DATABASE "' + name + '"')
    created = true
    const deploy = run('bun', ['run', 'prisma:deploy'], { cwd: backendRoot, env: childEnv })
    if (deploy.status !== 0) throw new Error(String(deploy.stdout) + String(deploy.stderr))
    for (const [versionRoot, phase] of [[root, 'new'], [oldRoot, 'old'], [root, 'return']] as const) {
      const probe = run('bun', [resolve(backendRoot, 'scripts/test-support/rollback-runtime-probe.mjs'),
        versionRoot, phase, resolve(fixture, 'state.json'), resolve(fixture, 'storage')], { env: childEnv })
      if (probe.status !== 0) throw new Error(phase + ': ' + String(probe.stdout) + String(probe.stderr))
      const summary = JSON.parse(String(probe.stdout).trim().split('\n').at(-1)!)
      expect(summary.success).toBe(true)
      expect(summary.checks).toBeGreaterThan(10)
      console.info('Rollback runtime probe: ' + JSON.stringify(summary))
    }
  } finally {
    // Only this run's newly-created database; the caller's DB and preserved fixtures are untouched.
    if (created) await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)')
    await admin.end()
  }
}
