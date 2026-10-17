import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, existsSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'

const backendRoot = resolve(import.meta.dir, '..')
const root = resolve(backendRoot, '..')
const legacySource = '3fce2739205da927b95eb3379b1d066b61282965'
const legacyTarget = 'e383d79269a3595f4c6cabedf167335aea042cf3'
const attestedSource = '39e8af7bb9e9a5949ada3c32dad31d38f9439505'
const attestedTarget = '3fce2739205da927b95eb3379b1d066b61282965'
const sourceFingerprints = {
  legacy: '3d021aa1eb5160c8022ad5da3189ee30d6738bcb967f752458bef38145509857',
  candidate: '5555b4b9419d29b4366f5a70fbdd9537a3ccde3230a0497c41fa392de9038107',
}

test('legacy measured runtime writes survive the e383 roundtrip', () => roundtrip(legacySource, legacyTarget, false), 60_000)
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
  sourceRevision = resolveMeasuredSource(sourceRevision, attestSessions ? 'candidate' : 'legacy', run)
  console.info('Rollback fixture source: ' + sourceRevision + ' (' + (attestSessions ? 'candidate' : 'legacy') + ')')
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

function resolveMeasuredSource(
  fallbackRevision: string,
  role: keyof typeof sourceFingerprints,
  run: (command: string, args: string[], options?: Record<string, unknown>) => ReturnType<typeof spawnSync>,
) {
  const head = String(run('git', ['rev-parse', 'HEAD']).stdout).trim()
  if (runtimeFingerprint(head, run) === sourceFingerprints[role]) return head

  const available = run('git', ['cat-file', '-e', fallbackRevision + '^{commit}'])
  if (available.status !== 0) {
    throw new Error(`Current HEAD does not match the pinned ${role} runtime and its measured fallback ${fallbackRevision} is unavailable`)
  }
  const fallbackFingerprint = runtimeFingerprint(fallbackRevision, run)
  if (fallbackFingerprint !== sourceFingerprints[role]) {
    throw new Error(`Measured ${role} fallback ${fallbackRevision} has runtime fingerprint ${fallbackFingerprint}`)
  }
  return fallbackRevision
}

function runtimeFingerprint(
  revision: string,
  run: (command: string, args: string[], options?: Record<string, unknown>) => ReturnType<typeof spawnSync>,
) {
  const result = run('git', ['ls-tree', '-rz', '--full-tree', '--format=%(objectmode) %(objecttype) %(objectname)%x09%(path)', revision,
    '--', 'backend', 'webapp', 'packages', 'package.json', 'bun.lock', 'bunfig.toml'], { encoding: null })
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Cannot fingerprint rollback runtime ${revision}: ${String(result.stderr)}`)
  }
  const records: Buffer[] = []
  let start = 0
  for (let index = 0; index < result.stdout.length; index += 1) {
    if (result.stdout[index] !== 0) continue
    const record = result.stdout.subarray(start, index)
    start = index + 1
    const path = record.subarray(record.indexOf(9) + 1).toString('utf8')
    if (/^backend\/scripts\/(?:[^/]+\.test\.ts$|test-support\/|test-integration\.mjs$)/.test(path)) continue
    records.push(record)
  }
  const hash = createHash('sha256')
  for (const record of records) hash.update(record).update(Buffer.from([0]))
  return hash.digest('hex')
}
