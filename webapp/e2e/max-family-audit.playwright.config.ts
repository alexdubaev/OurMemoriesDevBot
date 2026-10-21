import { defineConfig, devices } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assertLoopbackTestDatabaseUrl } from '../../scripts/repo-env.mjs'

const webappDirectory = fileURLToPath(new URL('..', import.meta.url))
const backendDirectory = fileURLToPath(new URL('../../backend', import.meta.url))
const runId = process.env.MAX_FAMILY_AUDIT_RUN_ID ?? randomUUID()
if (!/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error('MAX_FAMILY_AUDIT_RUN_ID must be a simple unique identifier')
const apiPort = process.env.MAX_FAMILY_AUDIT_API_PORT ?? '56601'
const webPort = process.env.MAX_FAMILY_AUDIT_WEB_PORT ?? '56602'
const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for MAX family audit Playwright tests')
assertLoopbackTestDatabaseUrl(databaseUrl, process.env.DATABASE_URL)

export default defineConfig({
  testDir: '.',
  testMatch: 'max-family-audit.max-e2e.ts',
  outputDir: `.artifacts/max-family-audit-${runId}`,
  reporter: [['list'], ['json', { outputFile: `.scratch/max-family-audit-${runId}.json` }]],
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${webPort}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'bun run src/modules/families/test-support/max-family-audit-server.ts',
      cwd: backendDirectory,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      env: { ...process.env, MAX_FAMILY_AUDIT_RUN_ID: runId, MAX_FAMILY_AUDIT_API_PORT: apiPort, MAX_FAMILY_AUDIT_WEB_PORT: webPort, TEST_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl, PORT: apiPort },
    },
    {
      command: `bun run build -- --config e2e/max-family-audit.vite.config.ts && bunx vite preview --config e2e/max-family-audit.vite.config.ts --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: webappDirectory,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      env: { ...process.env, VITE_MAX_BOT_USERNAME: 'OurMemoriesMaxBot', VITE_MEMOLY_UI_VERSION: 'v2', MAX_FAMILY_AUDIT_API_PORT: apiPort },
    },
  ],
})
