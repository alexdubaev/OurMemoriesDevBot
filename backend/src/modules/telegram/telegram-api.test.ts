import { describe, expect, test } from 'bun:test'

import { telegramInlineKeyboard, telegramProviderFailure } from './infrastructure/telegram-api'

describe('Telegram provider failures', () => {
  test('keeps retry_after while dropping provider details that could contain the token', () => {
    const token = 'must-never-reach-the-error'
    const error = telegramProviderFailure({ message: `request failed at bot${token}`, parameters: { retry_after: 17 } })
    expect(error.retryAfterSeconds).toBe(17)
    expect(error.message).toBe('Telegram Bot API request failed')
    expect(error.message).not.toContain(token)
  })

  test('opens the signed Mini App context instead of a plain browser URL', () => {
    expect(telegramInlineKeyboard([{ text: 'Открыть', webAppUrl: 'https://example.test/memories/1' }])).toEqual({
      inline_keyboard: [[{ text: 'Открыть', web_app: { url: 'https://example.test/memories/1' } }]],
    })
  })

  test('puts each family callback on its own inline keyboard row', () => {
    expect(telegramInlineKeyboard([
      { text: 'Семья A', callbackData: 'family:source-a:0' },
      { text: 'Семья B', callbackData: 'family:source-a:1' },
    ])).toEqual({ inline_keyboard: [
      [{ text: 'Семья A', callback_data: 'family:source-a:0' }],
      [{ text: 'Семья B', callback_data: 'family:source-a:1' }],
    ] })
  })
})
