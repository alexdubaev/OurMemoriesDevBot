import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.E2E_WEB_PORT ?? '5198')
const url = `http://127.0.0.1:${port}/e2e/comments-crash.harness.html?variant=A`
const preview = process.env.COMMENTS_CRASH_PREVIEW === '1'
export default defineConfig({
  testDir: '.', testMatch: 'comments-crash.spec.ts', outputDir: '.artifacts/comments-crash-results', reporter: 'list', timeout: 45_000,
  expect: { timeout: 10_000 }, use: { ...devices[process.env.COMMENTS_CRASH_WEBKIT === '1' ? 'Desktop Safari' : 'Desktop Chrome'], baseURL: url },
  webServer: { command: preview ? `bunx vite preview --config e2e/comments-crash.vite.config.ts --host 127.0.0.1 --port ${port}` : `bunx vite --config e2e/comments-crash.vite.config.ts --host 127.0.0.1 --port ${port}`, url, reuseExistingServer: false, cwd: fileURLToPath(new URL('..', import.meta.url)) },
})
