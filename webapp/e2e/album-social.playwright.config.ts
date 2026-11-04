import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import maxConfig from '../playwright.max.config'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))
const testDir = fileURLToPath(new URL('.', import.meta.url))
const port = process.env.E2E_WEB_PORT ?? '5173'
const servers = Array.isArray(maxConfig.webServer) ? maxConfig.webServer.filter((server) => server.name === 'backend' || server.name === 'web').map((server) => server.name === 'web' ? { ...server, command: `bun run dev --host 127.0.0.1 --port ${port} --strictPort` } : server) : maxConfig.webServer
export default defineConfig({
  ...maxConfig, webServer: servers,
  globalSetup: resolve(webappRoot, 'e2e/global-setup.ts'), globalTeardown: resolve(webappRoot, 'e2e/global-teardown.ts'),
  testDir, testMatch: 'album-social.spec.ts', projects: [{ name: 'album-social', use: { browserName: 'chromium' } }],
  outputDir: resolve(testDir, '.artifacts/album-social-results'),
  reporter: [['list'], ['json', { outputFile: resolve(testDir, '.artifacts/album-social-results.json') }]],
  workers: 1, fullyParallel: false, timeout: 90_000, use: { ...maxConfig.use, actionTimeout: 15_000 },
})
