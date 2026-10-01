import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: 'welcome-*-fixture.spec.ts',
  outputDir: '.artifacts/welcome-splash-results',
  reporter: 'list',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4192', browserName: 'chromium', viewport: { width: 390, height: 844 } },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 4192',
    cwd: webappRoot,
    url: 'http://127.0.0.1:4192',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
