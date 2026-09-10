import { describe, expect, test } from 'bun:test'

import { createTelegramWebhook } from './transport/webhook'

describe('Telegram webhook boundary', () => {
  const update = JSON.stringify({ update_id: 1, message: {
    message_id: 2, date: 1_788_000_000, chat: { id: 3, type: 'private' },
    from: { id: 3, is_bot: false, first_name: 'Тест' }, text: 'Заметка',
  } })

  test('rejects a wrong secret and oversized body before acceptance', async () => {
    let accepted = 0
    const app = createTelegramWebhook({ secret: 's'.repeat(43), bodyLimitBytes: update.length - 1, acceptUpdate: async () => { accepted += 1 } })
    expect((await app.request('/webhooks/telegram', { method: 'POST', headers: {
      'X-Telegram-Bot-Api-Secret-Token': 'wrong', 'Content-Type': 'application/json',
    }, body: update })).status).toBe(401)
    expect((await app.request('/webhooks/telegram', { method: 'POST', headers: {
      'X-Telegram-Bot-Api-Secret-Token': 's'.repeat(43), 'Content-Type': 'application/json',
    }, body: update })).status).toBe(413)
    expect(accepted).toBe(0)
  })

  test('returns 200 only after durable acceptance and a database failure is retryable', async () => {
    let committed = false
    const ok = createTelegramWebhook({ secret: 's'.repeat(43), bodyLimitBytes: 10_000, acceptUpdate: async () => { committed = true } })
    const accepted = await ok.request('/webhooks/telegram', { method: 'POST', headers: {
      'X-Telegram-Bot-Api-Secret-Token': 's'.repeat(43), 'Content-Type': 'application/json',
    }, body: update })
    expect(accepted.status).toBe(200)
    expect(committed).toBe(true)

    const failing = createTelegramWebhook({ secret: 's'.repeat(43), bodyLimitBytes: 10_000, acceptUpdate: async () => { throw new Error('db offline') } })
    expect((await failing.request('/webhooks/telegram', { method: 'POST', headers: {
      'X-Telegram-Bot-Api-Secret-Token': 's'.repeat(43), 'Content-Type': 'application/json',
    }, body: update })).status).toBe(503)
  })
})
