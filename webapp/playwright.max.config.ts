import baseConfig from './playwright.config'

/** FULL verification uses active MAX/platform-neutral journeys and excludes the legacy Telegram smoke. */
export default {
  ...baseConfig,
  testMatch: [
    '**/max-browser-link.spec.ts',
  ],
}
