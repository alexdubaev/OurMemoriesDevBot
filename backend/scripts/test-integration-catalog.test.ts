import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { backendTestFiles } from './test-files'
import { expectedMaxHistoricalExclusions, integrationChildProcessTimeoutMs, runBackendIntegration, selectMaxVerificationIntegration } from './test-integration'

describe('MAX PostgreSQL verification catalog', () => {
  test('keeps MAX auth, neutral data and migration checks while excluding messenger-specific suites', () => {
    const files = [
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
    expect(selected).not.toContain('src/modules/auth/telegram-auth.integration.test.ts')
  })

  test('fails closed when any required suite disappears', () => {
    expect(() => selectMaxVerificationIntegration([
      'src/modules/auth/max-auth.integration.test.ts',
    ])).toThrow('catalog is incomplete')
  })

  test('discovers newly added MAX modules and MAX-named family integration suites', () => {
    const files = [
      ...requiredFixtures(),
      'src/modules/max/future-max-flow.integration.test.ts',
      'src/modules/families/max-family-audit.integration.test.ts',
      'src/modules/families/telegram-family.integration.test.ts',
    ]
    const selected = selectMaxVerificationIntegration(files)
    expect(selected).toContain('src/modules/max/future-max-flow.integration.test.ts')
    expect(selected).toContain('src/modules/families/max-family-audit.integration.test.ts')
    expect(selected).not.toContain('src/modules/families/telegram-family.integration.test.ts')
  })

  test('permits only the two declared historical cross-provider exclusions', () => {
    expect(expectedMaxHistoricalExclusions('src/modules/auth/max-auth.integration.test.ts')).toBe(1)
    expect(expectedMaxHistoricalExclusions('src/modules/families/family-access.integration.test.ts')).toBe(1)
    expect(expectedMaxHistoricalExclusions('src/modules/families/family-review-fixes.integration.test.ts')).toBe(0)
    expect(expectedMaxHistoricalExclusions('src/modules/max/media-flow.integration.test.ts')).toBe(0)
  })

  test('caps each integration Bun process independently of its per-test timeout', () => {
    expect(integrationChildProcessTimeoutMs).toBe(180_000)
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
})

function requiredFixtures() {
  return [
    'src/modules/auth/max-auth.integration.test.ts', 'src/db.integration.test.ts',
    'src/outbox/outbox.integration.test.ts', 'src/modules/families/family-access.integration.test.ts',
    'src/modules/media/media-access.integration.test.ts', 'src/modules/uploads/uploads.integration.test.ts',
    'src/modules/users/users.integration.test.ts', 'src/modules/max/media-flow.integration.test.ts',
    'scripts/deploy-database.integration.test.ts', 'scripts/welcome-migration.integration.test.ts',
    'scripts/block01-upgrade.integration.test.ts', 'scripts/block02-upgrade.integration.test.ts',
    'scripts/block03-upgrade.integration.test.ts', 'scripts/block08-upgrade.integration.test.ts',
    'scripts/mm4-upgrade.integration.test.ts', 'scripts/memory-reactions-upgrade.integration.test.ts',
    'scripts/t0951-b4-upgrade.integration.test.ts', 'scripts/int1-max-upgrade.integration.test.ts',
  ]
}
