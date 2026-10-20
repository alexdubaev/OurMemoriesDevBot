import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import maxConfig from '../playwright.max.config'

const webappRoot = fileURLToPath(new URL('..', import.meta.url))
const commentsDir = fileURLToPath(new URL('.', import.meta.url))
const webPort = process.env.E2E_WEB_PORT ?? '5173'
const inheritedWebServers = Array.isArray(maxConfig.webServer)
  ? maxConfig.webServer.map((server) => server.name === 'web'
    ? { ...server, command: `bun run build && bunx vite preview --host 127.0.0.1 --port ${webPort} --strictPort` }
    : server)
  : maxConfig.webServer

// The inherited FULL config owns the real MAX verification server and isolated DB. Resolve
// config-relative paths here because Playwright uses this nested file as the config root.
export default defineConfig({
  ...maxConfig,
  webServer: inheritedWebServers,
  globalSetup: resolve(webappRoot, 'e2e/global-setup.ts'),
  globalTeardown: resolve(webappRoot, 'e2e/global-teardown.ts'),
  testDir: commentsDir,
  testMatch: 'comments.spec.ts',
  outputDir: resolve(commentsDir, '.artifacts/comments-results'),
  reporter: [['list'], ['json', { outputFile: resolve(commentsDir, '.artifacts/comments-results.json') }]],
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
})
