import baseConfig from './playwright.config'

/** FULL verification uses active MAX/platform-neutral journeys and excludes the legacy Telegram smoke. */
const webServer = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer.map((server) => server.name === 'backend'
    ? {
      ...server,
      command: 'bun run scripts/max-verification-server.ts',
      env: { ...server.env, TEST_DATABASE_URL: server.env?.DATABASE_URL ?? '', MULTI_FAMILY_ACTIVATION: 'on' },
    }
    : server)
  : baseConfig.webServer

export default {
  ...baseConfig,
  webServer,
  testMatch: [
    '**/max-browser-link.spec.ts',
    '**/comments.spec.ts',
    '**/comments-state.spec.ts',
  ],
}
