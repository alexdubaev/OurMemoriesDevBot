import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.',
  testMatch: 'memoly-v4.spec.ts',
  outputDir: '.artifacts/memoly-v4-results',
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5224', screenshot: 'only-on-failure' },
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 5224',
    url: 'http://127.0.0.1:5224',
    reuseExistingServer: false,
    env: { VITE_MEMOLY_UI_VERSION: 'v2' },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  },
})
