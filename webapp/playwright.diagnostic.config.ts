import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
import standardConfig from './playwright.config'

const standardServers = (standardConfig.webServer ?? []) as Array<Record<string, unknown> & { name?: string; env?: Record<string, string> }>

export default defineConfig({
  ...standardConfig,
  testDir: './e2e',
  testMatch: 'diagnostic-feed.experiment.ts',
  outputDir: './e2e/.artifacts/minimal-feed/test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.artifacts/minimal-feed/report' }]],
  webServer: standardServers.map((server) => {
    if (server.name === 'backend') return {
      ...server,
      env: {
        ...server.env,
        JWT_SECRET: 'web-e2e-secret-at-least-thirty-two-characters',
        MAX_ENABLED: 'false',
        MAX_BOT_TOKEN: '',
        MAX_BOT_EXPECTED_USERNAME: '',
        MAX_WEBHOOK_URL: '',
        MAX_WEBHOOK_SECRET: '',
        MAX_INBOX_ENCRYPTION_KEY: '',
        MAX_MINI_APP_URL: '',
        PRIVATE_STORAGE_LOCAL_ROOT: resolve(process.cwd(), 'e2e/.artifacts/minimal-feed/storage'),
      },
    }
    if (server.name === 'web') return {
      ...server,
      env: { ...server.env, VITE_MAX_BOT_USERNAME: 'id911018762027_bot' },
      command: `bunx vite build --config vite.diagnostic.config.ts && bunx vite preview --config vite.diagnostic.config.ts --host 127.0.0.1 --port ${process.env.E2E_WEB_PORT} --strictPort`,
      url: `${process.env.E2E_WEB_URL}/__experiments/minimal-feed/diagnostic.html`,
    }
    return server
  }),
})
