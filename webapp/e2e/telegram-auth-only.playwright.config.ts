import { defineConfig } from '@playwright/test'
import baseConfig from '../playwright.config'

const servers = Array.isArray(baseConfig.webServer) ? baseConfig.webServer : []
export default defineConfig({
  ...baseConfig,
  // The caller migrates the existing owned *_test database; this journey never creates Docker
  // resources, changes schema, or imports the broader MAX journey servers.
  globalSetup: undefined,
  globalTeardown: undefined,
  testDir: '.',
  testMatch: 'telegram-auth-only.spec.ts',
  outputDir: './.artifacts/telegram-auth-only/results',
  reporter: [['list']],
  use: { ...baseConfig.use, actionTimeout: 15_000 },
  projects: [{ name: 'telegram-auth-only', use: { browserName: 'chromium' } }],
  webServer: servers.map((server) => server.name === 'backend'
    ? { ...server, command: 'bun run scripts/telegram-auth-only-verification-server.ts',
      env: { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '', PORT: server.env?.PORT ?? '',
        CORS_ORIGINS: String(baseConfig.use?.baseURL ?? '') } }
    : server),
})
