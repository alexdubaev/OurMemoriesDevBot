import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, existsSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const legacySource = 'd4b69a5ce73a03eceb632f23fb9eb17801343ff9'
const legacyTarget = 'e383d79269a3595f4c6cabedf167335aea042cf3'
const attestedSource = '39e8af7bb9e9a5949ada3c32dad31d38f9439505'
const attestedTarget = '3fce2739205da927b95eb3379b1d066b61282965'

test('legacy measured release writes survive d4b → e383 → d4b', () => roundtrip(legacySource, legacyTarget, false), 60_000)
test('candidate #181 writes survive #181 → #180 → #181 with MAX and browser-link recovery', () => roundtrip(attestedSource, attestedTarget, true), 60_000)

async function roundtrip(sourceRevision: string, targetRevision: string, attestSessions: boolean) {
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
  const sourceRoot = resolve(fixture, 'source')
  const targetRoot = resolve(fixture, 'target')
  const archiveRoot = (revision: string, destination: string) => {
    mkdirSync(destination)
    const archive = run('git', ['archive', revision, 'backend', 'packages/contracts'], { encoding: null })
    expect(archive.status).toBe(0)
    expect(run('tar', ['-x', '-C', destination], { input: archive.stdout }).status).toBe(0)
    symlinkSync(resolve(root, 'node_modules'), resolve(destination, 'node_modules'), 'dir')
    if (existsSync(resolve(backendRoot, 'node_modules'))) symlinkSync(resolve(backendRoot, 'node_modules'), resolve(destination, 'backend/node_modules'), 'dir')
    symlinkSync(resolve(backendRoot, 'src/generated'), resolve(destination, 'backend/src/generated'), 'dir')
  }
  const run = (command: string, args: string[], options: Record<string, unknown> = {}) =>
    spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 40_000, maxBuffer: 8 * 1024 * 1024, ...options })
  archiveRoot(sourceRevision, sourceRoot)
  archiveRoot(targetRevision, targetRoot)
  // Both measured pairs intentionally share migration, contract, and dependency inputs.
  expect(run('git', ['diff', '--quiet', sourceRevision, targetRevision, '--', 'backend/prisma', 'packages/contracts', 'bun.lock']).status).toBe(0)
  const childEnv = { ...process.env, NODE_ENV: 'test', DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString() }
  await admin.connect()
  let created = false
  try {
    await admin.query('CREATE DATABASE "' + name + '"')
    created = true
    const deploy = run('bun', ['run', 'prisma:deploy'], { cwd: backendRoot, env: childEnv })
    if (deploy.status !== 0) throw new Error(String(deploy.stdout) + String(deploy.stderr))
    for (const [versionRoot, phase] of [[sourceRoot, attestSessions ? 'candidate-new' : 'new'], [targetRoot, attestSessions ? 'candidate-old' : 'old'], [sourceRoot, attestSessions ? 'candidate-return' : 'return']] as const) {
      const probe = run('bun', [resolve(backendRoot, 'scripts/test-support/rollback-runtime-probe.mjs'),
        versionRoot, phase, resolve(fixture, attestSessions ? 'attested-state.json' : 'legacy-state.json'), resolve(fixture, attestSessions ? 'attested-storage' : 'legacy-storage')], { env: childEnv })
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
