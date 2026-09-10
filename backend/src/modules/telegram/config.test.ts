import { describe, expect, test } from 'bun:test'

import { telegramConfigSummary } from '.'

describe('Telegram configuration dry run', () => {
  test('shows public target fields and has no place for secrets', () => {
    const summary = telegramConfigSummary({
      TELEGRAM_BOT_EXPECTED_USERNAME: 'OurMemoriesDevBot',
      TELEGRAM_BOT_MODE: 'webhook',
      TELEGRAM_WEBHOOK_URL: 'https://api.example.com/webhooks/telegram',
      TELEGRAM_MINI_APP_URL: 'https://app.example.com',
    })
    expect(summary).toEqual({
      username: '@OurMemoriesDevBot', mode: 'webhook',
      webhookUrl: 'https://api.example.com/webhooks/telegram', miniAppUrl: 'https://app.example.com',
    })
    expect(Object.keys(summary)).not.toContain('token')
    expect(Object.keys(summary)).not.toContain('secret')
  })
})
