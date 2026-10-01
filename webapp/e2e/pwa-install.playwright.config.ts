import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: 'pwa-install.spec.ts',
  outputDir: '.artifacts/pwa-install-results',
  reporter: 'list',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4180', browserName: 'chromium', viewport: { width: 390, height: 844 } },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 4180',
    cwd: webappRoot,
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
