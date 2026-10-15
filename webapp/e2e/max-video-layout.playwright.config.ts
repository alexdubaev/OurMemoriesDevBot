import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.',
  testMatch: 'max-video-layout.spec.ts',
  outputDir: '.artifacts/max-video-layout-results',
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5193' },
  webServer: {
    command: 'bun run dev --config e2e/max-video-layout.vite.config.ts --host 127.0.0.1 --port 5193',
    url: 'http://127.0.0.1:5193',
    reuseExistingServer: false,
    env: { VITE_MEMOLY_UI_VERSION: 'v2' },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  },
})
