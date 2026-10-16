import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: '.', testMatch: 'voice-player.spec.ts', outputDir: '.artifacts/voice-player-results', reporter: 'list', timeout: 45_000,
  expect: { timeout: 10_000 }, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5200' },
  webServer: { command: 'bun run dev --host 127.0.0.1 --port 5200', url: 'http://127.0.0.1:5200', reuseExistingServer: false, env: { VITE_MEMOLY_UI_VERSION: 'v2' }, cwd: fileURLToPath(new URL('..', import.meta.url)) },
})
