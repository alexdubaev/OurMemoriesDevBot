import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: 'warm-navigation-cache-regression.spec.ts',
  testIgnore: '**/.artifacts/**',
  outputDir: '.artifacts/warm-navigation-cache-results',
  reporter: 'list',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4193', browserName: 'chromium', viewport: { width: 390, height: 844 }, trace: 'on' },
  webServer: {
    command: 'bun run dev -- --host 127.0.0.1 --port 4193',
    cwd: webappRoot,
    url: 'http://127.0.0.1:4193',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
