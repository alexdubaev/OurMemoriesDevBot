import { describe, expect, test } from 'bun:test'
import { createMaxChannelProvider } from './max-channel-provider'

describe('MAX channel avatar metadata', () => {
  test('reads an icon only from the exact active private channel metadata response', async () => {
    let request: Request | undefined
    const provider = createMaxChannelProvider('synthetic-token', { fetch: async (input, init) => {
      request = new Request(input, init)
      return new Response('{"chat_id":-9007199254740993,"type":"channel","status":"active","is_public":false,"icon":{"url":"https://i.oneme.ru/channel.png"}}', { status: 200 })
    } })
    await expect(provider.getChannelAvatarUrl(-9007199254740993n)).resolves.toBe('https://i.oneme.ru/channel.png')
    expect(request?.url).toBe('https://platform-api2.max.ru/chats/-9007199254740993')
    expect(request?.headers.get('authorization')).toBe('synthetic-token')
    expect(request?.redirect).toBe('manual')
  })

  test('returns null for missing icons and rejects mismatched, public, or non-channel metadata', async () => {
    let value: Record<string, unknown> = { chat_id: -123, type: 'channel', status: 'active', is_public: false }
    const provider = createMaxChannelProvider('synthetic-token', { fetch: async () => new Response(JSON.stringify(value), { status: 200 }) })
    await expect(provider.getChannelAvatarUrl(-123n)).resolves.toBeNull()
    value = { ...value, chat_id: -124, icon: { url: 'https://i.oneme.ru/channel.png' } }
    await expect(provider.getChannelAvatarUrl(-123n)).rejects.toThrow()
    value = { ...value, chat_id: -123, is_public: true }
    await expect(provider.getChannelAvatarUrl(-123n)).rejects.toThrow()
    value = { ...value, is_public: false, type: 'chat' }
    await expect(provider.getChannelAvatarUrl(-123n)).rejects.toThrow()
  })
})
