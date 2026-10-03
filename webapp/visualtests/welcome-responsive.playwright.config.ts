import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const visualRoot = fileURLToPath(new URL('.', import.meta.url))
const webappRoot = path.resolve(visualRoot, '..')
const port = Number(process.env.T06_VISUAL_PORT ?? 4197)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.resolve(webappRoot, 'e2e/.artifacts/welcome-responsive/results'),
  reporter: [['list']],
  retries: 0,
  testDir: visualRoot,
  testMatch: ['**/welcome-responsive.pw.ts', '**/welcome-parity.pw.ts'],
  timeout: 45_000,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 390, height: 844 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `bun run dev --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: webappRoot,
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
})
