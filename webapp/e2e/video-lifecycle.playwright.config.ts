import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.', testMatch: 'video-lifecycle.spec.ts', outputDir: '.artifacts/video-lifecycle-results', reporter: 'list', timeout: 60_000,
  expect: { timeout: 10_000 }, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5199' },
  webServer: { command: 'bun run dev --host 127.0.0.1 --port 5199', url: 'http://127.0.0.1:5199', reuseExistingServer: false, env: { VITE_MEMOLY_UI_VERSION: 'v2' }, cwd: fileURLToPath(new URL('..', import.meta.url)) },
})
