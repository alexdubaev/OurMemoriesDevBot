import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, GetBucketVersioningCommand } from '@aws-sdk/client-s3'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'

const root = resolve(import.meta.dir, '../..')
const baseline = '26cfab9ce35fd1a42279fc0d9dd3637c340eec6a'

test('current → pinned S3 runtime → current preserves media, ACLs, in-flight uploads, retirement and partial purge', async () => {
  const baseUrl = new URL(requireIntegrationDatabaseUrl()!)
  if (baseUrl.hostname !== '127.0.0.1' || !baseUrl.pathname.endsWith('_test')) throw Error('Loopback isolated PostgreSQL required')
  for (const key of ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']) {
    if (!process.env[`TEST_S3_RECOVERY_${key}`]) throw Error(`Explicit TEST_S3_RECOVERY_${key} required`)
  }
  const config = { endpoint: process.env.TEST_S3_RECOVERY_ENDPOINT!, region: process.env.TEST_S3_RECOVERY_REGION!,
    forcePathStyle: process.env.TEST_S3_RECOVERY_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: process.env.TEST_S3_RECOVERY_ACCESS_KEY_ID!, secretAccessKey: process.env.TEST_S3_RECOVERY_SECRET_ACCESS_KEY! },
    requestChecksumCalculation: 'WHEN_REQUIRED' as const }
  const s3 = new S3Client(config), bucket = process.env.TEST_S3_RECOVERY_BUCKET!
  const prefix = `recovery-checks/${randomUUID()}/`
  console.log(JSON.stringify({ technicalTestNamespace: prefix }))
  const name = `s3_recovery_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 8)}_test`
  const ownUrl = new URL(baseUrl); ownUrl.pathname = `/${name}`
  const admin = new Client({ connectionString: baseUrl.toString() })
  const scratchRoot = resolve(root, '.scratch'); mkdirSync(scratchRoot, { recursive: true })
  const fixture = mkdtempSync(resolve(scratchRoot, 's3-application-recovery-'))
  const archived = resolve(fixture, 'baseline'), state = resolve(fixture, 'state.json')
  const env = { ...process.env, NODE_ENV: 'test', CHECKPOINT_DISABLE: '1', TEST_SKIP_DOCKER: '1',
    DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString() }
  const checked = (label: string, args: string[], cwd: string, executionEnv = env) => {
    const r = spawnSync('bun', args, { cwd, env: executionEnv, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
    if (r.status !== 0) throw Error(`${label} failed: ${r.stdout.slice(-2000)}\n${r.stderr.slice(-2000)}`)
    return r.stdout
  }
  let connected = false, created = false
  const keys = async () => {
    const result: string[] = []; let token: string | undefined
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
      for (const entry of page.Contents ?? []) {
        if (!entry.Key?.startsWith(prefix)) throw Error('Provider returned an object outside the test namespace')
        result.push(entry.Key)
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return result
  }
  try {
    expect((await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status).toBeUndefined()
    expect(await keys()).toEqual([])
    mkdirSync(archived)
    const archive = spawnSync('git', ['archive', baseline, 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'],
      { cwd: root, encoding: null, maxBuffer: 48 * 1024 * 1024 })
    if (archive.status !== 0) throw Error('Cannot archive exact S3 baseline')
    const extract = spawnSync('tar', ['-x', '-C', archived], { input: archive.stdout, encoding: 'utf8' })
    if (extract.status !== 0) throw Error('Cannot extract exact S3 baseline')
    checked('baseline dependency install', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], archived)
    checked('baseline Prisma generation', ['run', '--cwd', 'backend', 'prisma:generate'], archived)
    await admin.connect(); connected = true
    await admin.query(`CREATE DATABASE "${name}"`); created = true
    checked('current exact schema deploy into isolated database', ['run', 'prisma:deploy'], resolve(root, 'backend'))
    const program = readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8').replaceAll('\r\n', '\n')
      .match(/MEMOLY_S3_READINESS_JS'\n([\s\S]*?)\nMEMOLY_S3_READINESS_JS/)?.[1]
    if (!program) throw Error('Executable S3 readiness program is missing')
    const readinessEnv = { ...env, JWT_SECRET: 's3-recovery-synthetic-secret-0123456789', PRIVATE_STORAGE_DRIVER: 's3',
      PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true', PRIVATE_STORAGE_FORCE_PATH_STYLE: process.env.TEST_S3_RECOVERY_FORCE_PATH_STYLE!,
      ...Object.fromEntries(['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'].map(k => [`PRIVATE_STORAGE_${k}`, process.env[`TEST_S3_RECOVERY_${k}`]!])) }
    for (const [runtime, phase] of [[root, 'seed-current'], [archived, 'baseline'], [root, 'current-after']] as const) {
      const output = checked(phase, [resolve(root, 'backend/scripts/test-support/s3-application-recovery-probe.mjs'), runtime, phase, state, prefix], resolve(root, 'backend'))
      expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({ phase, success: true })
      checked(`${phase} actual deploy readiness program`, ['-e', program], resolve(runtime, 'backend'), readinessEnv)
    }
    expect((await keys()).length).toBeGreaterThan(0)
  } finally {
    // Only this invocation's random technical namespace, never family data keys.
    try {
      for (const Key of await keys()) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key }))
      expect(await keys()).toEqual([])
    } finally {
      s3.destroy()
      if (connected) { if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
      if (!resolve(fixture).startsWith(scratchRoot + sep)) throw Error('Recovery fixture escaped .scratch')
      rmSync(fixture, { recursive: true, force: true })
    }
  }
}, 300_000)
