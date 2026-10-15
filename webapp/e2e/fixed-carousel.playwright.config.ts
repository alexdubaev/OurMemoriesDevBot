import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.',
  testMatch: 'fixed-carousel.spec.ts',
  outputDir: '.artifacts/fixed-carousel-results',
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5196' },
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 5196',
    url: 'http://127.0.0.1:5196',
    reuseExistingServer: !process.env.CI,
    env: { VITE_MEMOLY_UI_VERSION: 'v2' },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  },
})
