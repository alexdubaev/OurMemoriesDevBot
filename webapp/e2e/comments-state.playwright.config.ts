import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.E2E_WEB_PORT ?? '5193')
const url = `http://127.0.0.1:${port}`
export default defineConfig({
  testDir: '.',
  testMatch: 'comments-state.spec.ts',
  outputDir: '.artifacts/comments-state-results',
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { ...devices['Desktop Chrome'], baseURL: url },
  webServer: {
    command: `bun run dev --host 127.0.0.1 --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
    env: { VITE_MEMOLY_UI_VERSION: 'v2' },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  },
})
