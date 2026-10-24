import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { backendTestFiles } from './test-files'
import { expectedMaxHistoricalExclusions, integrationChildProcessTimeoutMs, missingMaxVerificationCategories, runBackendIntegration, runIntegrationChild, selectHistoricalIntegration, selectMaxVerificationIntegration } from './test-integration'

describe('MAX PostgreSQL verification catalog', () => {
  test('keeps MAX auth, neutral data and migration checks while excluding messenger-specific suites', () => {
    const files = [
      'scripts/comments-release-compatibility.integration.test.ts',
      'src/modules/auth/max-auth.integration.test.ts',
      'src/db.integration.test.ts',
      'src/outbox/outbox.integration.test.ts',
      'src/modules/families/family-access.integration.test.ts',
      'src/modules/families/family-review-fixes.integration.test.ts',
      'src/modules/max/media-flow.integration.test.ts',
      'src/modules/media/media-access.integration.test.ts',
      'src/modules/uploads/uploads.integration.test.ts',
      'src/modules/users/users.integration.test.ts',
      'src/modules/memories/memories.integration.test.ts',
      'src/modules/memories/unread.integration.test.ts',
      'src/modules/memories/comments.integration.test.ts',
      'src/modules/memories/comments-idempotency.integration.test.ts',
      'src/modules/memories/comments-mutations.integration.test.ts',
      'src/modules/memories/comments-races.integration.test.ts',
      'scripts/deploy-database.integration.test.ts',
      'scripts/welcome-migration.integration.test.ts',
      'scripts/block01-upgrade.integration.test.ts',
      'scripts/block02-upgrade.integration.test.ts',
      'scripts/block03-upgrade.integration.test.ts',
      'scripts/block08-upgrade.integration.test.ts',
      'scripts/mm4-upgrade.integration.test.ts',
      'scripts/memory-reactions-upgrade.integration.test.ts',
      'scripts/t0951-b4-upgrade.integration.test.ts',
      'scripts/int1-max-upgrade.integration.test.ts',
      'src/modules/auth/telegram-auth.integration.test.ts',
    ]
    const selected = selectMaxVerificationIntegration(files)
    expect(selected).toContain('src/modules/auth/max-auth.integration.test.ts')
    expect(selected).toContain('src/db.integration.test.ts')
    expect(selected).toContain('scripts/int1-max-upgrade.integration.test.ts')
    expect(selected).toContain('src/modules/memories/comments.integration.test.ts')
    expect(selected).toContain('src/modules/memories/comments-idempotency.integration.test.ts')
    expect(selected).toContain('src/modules/memories/comments-mutations.integration.test.ts')
    expect(selected).toContain('src/modules/memories/comments-races.integration.test.ts')
    expect(selected).not.toContain('src/modules/auth/telegram-auth.integration.test.ts')
  })

  test('fails closed when any required suite disappears', () => {
    for (const category of requiredCategoryFixtures()) {
      expect(missingMaxVerificationCategories(requiredCategoryFixtures().filter((file) => file !== category.file)))
        .toContain(category.name)
    }
    const historical = ['scripts/historical/selectel-rollback-roundtrip.integration.test.ts']
    expect(() => selectMaxVerificationIntegration([...requiredFixtures(), ...historical])).not.toThrow()
    expect(selectMaxVerificationIntegration([...requiredFixtures(), ...historical])).not.toContain(historical[0])
    expect(selectHistoricalIntegration([...requiredFixtures(), ...historical])).toEqual(historical)
    expect(() => selectHistoricalIntegration(requiredFixtures())).toThrow(/No opt-in historical/)
  })

  test('discovers newly added MAX modules and MAX-named family integration suites', () => {
    const files = [
      ...requiredFixtures(),
      'src/modules/max/future-max-flow.integration.test.ts',
      'src/modules/families/future-neutral-flow.integration.test.ts',
      'src/modules/families/max-family-audit.integration.test.ts',
      'src/modules/families/telegram-family.integration.test.ts',
      'src/modules/telegram/capture.integration.test.ts',
      'scripts/historical/telegram-capture.integration.test.ts',
    ]
    const selected = selectMaxVerificationIntegration(files)
    expect(selected).toContain('src/modules/max/future-max-flow.integration.test.ts')
    expect(selected).toContain('src/modules/families/future-neutral-flow.integration.test.ts')
    expect(selected).toContain('src/modules/families/max-family-audit.integration.test.ts')
    expect(selected).not.toContain('src/modules/families/telegram-family.integration.test.ts')
    expect(selected).not.toContain('src/modules/telegram/capture.integration.test.ts')
    expect(selected).not.toContain('scripts/historical/telegram-capture.integration.test.ts')
  })

  test('keeps exact per-file cross-provider exclusions', () => {
    expect(expectedMaxHistoricalExclusions('src/modules/auth/max-auth.integration.test.ts')).toBe(1)
    expect(expectedMaxHistoricalExclusions('src/modules/families/family-access.integration.test.ts')).toBe(1)
    expect(expectedMaxHistoricalExclusions('src/modules/memories/child-tags-edit.integration.test.ts')).toBe(1)
    expect(expectedMaxHistoricalExclusions('src/modules/families/family-review-fixes.integration.test.ts')).toBe(0)
    expect(expectedMaxHistoricalExclusions('src/modules/max/media-flow.integration.test.ts')).toBe(0)
    expect(expectedMaxHistoricalExclusions('src/modules/memories/child-tags.integration.test.ts')).toBe(0)
  })

  test('accepts the declared historical case while rejecting unexpected filtering, skips and empty evidence', async () => {
    const childTagsEdit = 'src/modules/memories/child-tags-edit.integration.test.ts'
    const integrationTestFiles = [...requiredFixtures(), childTagsEdit]
    const run = (childTagsOutput: string) => runBackendIntegration({
      environment: { TEST_SKIP_DOCKER: '1', TEST_DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:5432/memoly_catalog_test' },
      integrationTestFiles,
      testArgs: ['--max-only'],
      spawn: (_command, args) => {
        const testFile = args.at(-1)?.replaceAll('\\', '/')
        const output = args[0] !== 'test'
          ? ''
          : testFile === childTagsEdit
            ? childTagsOutput
            : expectedMaxHistoricalExclusions(testFile ?? '') === 1
              ? '1 pass\n1 filtered out\nRan 2 tests across 1 files'
              : '1 pass\nRan 1 tests across 1 files'
        return { status: 0, stdout: output, stderr: '' }
      },
    })

    await expect(run('12 pass\n1 filtered out\nRan 13 tests across 1 files')).resolves.toBeUndefined()
    await expect(run('12 pass\n2 filtered out\nRan 14 tests across 1 files')).rejects.toThrow(/Required integration evidence invalid/)
    await expect(run('12 pass\n1 skip\n1 filtered out\nRan 14 tests across 1 files')).rejects.toThrow(/Required integration evidence invalid/)
    await expect(run('Ran 1 tests across 1 files')).rejects.toThrow(/Required integration evidence invalid/)
  })

  test('terminates a hung integration child at the configured process deadline', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'memoly-integration-timeout-'))
    const ready = resolve(directory, 'ready')
    const resultPath = resolve(directory, 'wrapper-result.json')
    let childPid: number | undefined
    try {
      const integrationModule = new URL('./test-integration.mjs', import.meta.url).href
      const probe = `import { spawnSync } from 'node:child_process'; import { writeFileSync } from 'node:fs'; import { runIntegrationChild } from ${JSON.stringify(integrationModule)}; const ready=${JSON.stringify(ready)}; const resultPath=${JSON.stringify(resultPath)}; const started=Date.now(); try { runIntegrationChild((command,args,options)=>spawnSync(command,args,options),process.execPath,['-e',\`require('node:fs').writeFileSync(\${JSON.stringify(ready)},String(process.pid)); setInterval(()=>{},1000)\`],{encoding:'utf8',stdio:'ignore'},1000); writeFileSync(resultPath,JSON.stringify({unexpectedSuccess:true,elapsed:Date.now()-started})); } catch(error) { writeFileSync(resultPath,JSON.stringify({message:String(error),elapsed:Date.now()-started})); }`
      const watchdog = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', stdio: 'ignore', timeout: 3_000 })
      if (existsSync(ready)) childPid = Number(readFileSync(ready, 'utf8'))
      expect(watchdog.error?.code).not.toBe('ETIMEDOUT')
      expect(existsSync(ready)).toBe(true)
      expect(childPid).toBeGreaterThan(0)
      const wrapperResult = JSON.parse(readFileSync(resultPath, 'utf8')) as { message?: string; elapsed: number; unexpectedSuccess?: boolean }
      expect(wrapperResult.message).toContain('Integration test process exceeded 1000ms')
      expect(wrapperResult.elapsed).toBeGreaterThanOrEqual(900)
      expect(wrapperResult.elapsed).toBeLessThan(3_000)
      expect(() => process.kill(childPid!, 0)).toThrow()
      expect(integrationChildProcessTimeoutMs).toBeGreaterThan(0)
    } finally {
      if (childPid) {
        try { process.kill(childPid, 'SIGKILL') } catch { /* already exited */ }
      }
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('missing PostgreSQL infrastructure is a hard failure before any Docker or Prisma command', async () => {
    const backendRoot = fileURLToPath(new URL('..', import.meta.url))
    const integrationTestFiles = backendTestFiles(backendRoot).integration
    await expect(runBackendIntegration({
      environment: { TEST_SKIP_DOCKER: '1', TEST_DATABASE_URL: '' },
      integrationTestFiles,
      testArgs: ['--max-only'],
    })).rejects.toThrow('TEST_SKIP_DOCKER=1 requires TEST_DATABASE_URL')
  })

  test('unsafe PostgreSQL URLs fail before Docker or Prisma can run', async () => {
    let spawned = false
    const url = 'postgresql://synthetic:synthetic@db.example.test:5432/memoly_suite_test'
    await expect(runBackendIntegration({
      environment: { TEST_SKIP_DOCKER: '1', TEST_DATABASE_URL: url, DATABASE_URL: url },
      integrationTestFiles: ['src/db.integration.test.ts'],
      spawn: () => { spawned = true; throw new Error('spawn must not be called') },
    })).rejects.toThrow(/loopback PostgreSQL/)
    expect(spawned).toBe(false)
  })
})

function requiredFixtures() {
  return [
    ...requiredCategoryFixtures().map(({ file }) => file),
  ]
}

function requiredCategoryFixtures() {
  return [
    { name: 'current candidate and permitted rollback compatibility', file: 'scripts/comments-release-boundary.integration.test.ts' },
    { name: 'MAX authentication', file: 'src/modules/auth/future-max-auth.integration.test.ts' },
    { name: 'database concurrency', file: 'src/db.integration.test.ts' },
    { name: 'outbox persistence', file: 'src/outbox/queue.integration.test.ts' },
    { name: 'family ACL', file: 'src/modules/families/family-access.integration.test.ts' },
    { name: 'private media access', file: 'src/modules/media/media-access.integration.test.ts' },
    { name: 'upload persistence', file: 'src/modules/uploads/avatar.integration.test.ts' },
    { name: 'user and auth state', file: 'src/modules/users/accounts.integration.test.ts' },
    { name: 'MAX media delivery', file: 'src/modules/max/future-media.integration.test.ts' },
    { name: 'memory/comment behavior', file: 'src/modules/memories/comments.integration.test.ts' },
    { name: 'migration upgrade coverage', file: 'scripts/future-upgrade.integration.test.ts' },
  ]
}
