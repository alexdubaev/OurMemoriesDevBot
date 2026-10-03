import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  testDir: '.',
  testMatch: 'private-video-poster.spec.ts',
  outputDir: '.artifacts/private-video-poster-results',
  reporter: 'list',
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } } },
  ],
  use: { baseURL: 'http://127.0.0.1:4197', viewport: { width: 390, height: 844 }, trace: 'on' },
  webServer: {
    command: 'bun run dev -- --config e2e/private-video-poster.vite.config.ts --host 127.0.0.1 --port 4197',
    cwd: webappRoot,
    url: 'http://127.0.0.1:4197/e2e/private-video-poster.fixture.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
