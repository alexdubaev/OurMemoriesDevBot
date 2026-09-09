import { describe, expect, test } from 'bun:test'

import { verifyTelegramBotIdentity } from './telegram-bot-identity'

describe('Telegram bot startup identity', () => {
  test('accepts only the configured bot username', async () => {
    const request = async () => new Response(JSON.stringify({
      ok: true,
      result: { id: 123456, is_bot: true, username: 'OurMemoriesDevBot' },
    }), { status: 200 })

    await expect(verifyTelegramBotIdentity({
      token: 'secret-token',
      expectedUsername: 'OurMemoriesDevBot',
      request,
    })).resolves.toBeUndefined()
    await expect(verifyTelegramBotIdentity({
      token: 'secret-token',
      expectedUsername: 'DifferentBot',
      request,
    })).rejects.toThrow('expected Telegram bot')
  })

  test('fails closed without exposing the token when getMe fails', async () => {
    const token = 'must-never-appear-in-errors'
    const request = async () => new Response(JSON.stringify({ ok: false }), { status: 401 })
    let message = ''
    try {
      await verifyTelegramBotIdentity({ token, expectedUsername: 'OurMemoriesDevBot', request })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('getMe')
    expect(message).not.toContain(token)
  })
})
