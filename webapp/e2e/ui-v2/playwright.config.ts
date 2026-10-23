import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
const webappRoot = fileURLToPath(new URL('../..', import.meta.url))
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1,
  outputDir: '../.artifacts/ui-v2-results', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4197', browserName: 'chromium', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'bun run dev -- --config ui-v2.vite.config.ts',
    cwd: webappRoot, url: 'http://127.0.0.1:4197/__fixtures/ui-v2', reuseExistingServer: true, timeout: 30_000,
  },
})
