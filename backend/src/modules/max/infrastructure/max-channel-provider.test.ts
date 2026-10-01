import { describe, expect, test } from 'bun:test'

import { createMaxChannelProvider, MaxChannelProviderError, readMaxRootInt64 } from './max-channel-provider'

describe('MAX channel verification', () => {
  test('preserves the exact signed int64 root channel ID and accepts the official legacy write permission', async () => {
    const chatId = -9_223_372_036_854_775_808n
    const paths: string[] = []
    const provider = createMaxChannelProvider('unit-token', { fetch: async (input) => {
      const path = String(input)
      paths.push(path)
      if (path.endsWith('/members/me')) return Response.json({ is_bot: true, is_owner: true, permissions: ['post_edit_delete_message'] })
      return new Response(`{"chat_id":${chatId},"type":"channel","status":"active","is_public":false,"title":"Memories"}`)
    } })
    await expect(provider.verifyChannel(chatId)).resolves.toEqual({ chatId, title: 'Memories' })
    expect(paths).toEqual([
      'https://platform-api2.max.ru/chats/-9223372036854775808',
      'https://platform-api2.max.ru/chats/-9223372036854775808/members/me',
    ])
  })

  test('reads only a unique root ID and rejects nested/string/duplicate or out-of-range values', () => {
    expect(readMaxRootInt64('{"chat_id":9007199254740993}', 'chat_id')).toBe(9_007_199_254_740_993n)
    expect(readMaxRootInt64('{"a":1,"chat_id":-9223372036854775808,"b":2}', 'chat_id')).toBe(-9_223_372_036_854_775_808n)
    expect(readMaxRootInt64('{"a":1,"b":2,"chat_id":9223372036854775807}', 'chat_id')).toBe(9_223_372_036_854_775_807n)
    expect(readMaxRootInt64('{"nested":{"chat_id":7}}', 'chat_id')).toBeNull()
    expect(readMaxRootInt64('{"text":"chat_id:7"}', 'chat_id')).toBeNull()
    expect(readMaxRootInt64('{"chat_id":"7"}', 'chat_id')).toBeNull()
    expect(readMaxRootInt64('{"chat_id":7,"chat_id":8}', 'chat_id')).toBeNull()
    expect(readMaxRootInt64('{"chat_id":9223372036854775808}', 'chat_id')).toBeNull()
  })

  test('keeps transient provider failures distinguishable from confirmed permission loss', async () => {
    const provider = createMaxChannelProvider('unit-token', { fetch: async () => new Response('{}', { status: 503 }) })
    await expect(provider.verifyChannel(99n)).rejects.toMatchObject({ status: 503, permanentAccessLoss: false })
    const denied = createMaxChannelProvider('unit-token', { fetch: async () => new Response('{}', { status: 403 }) })
    let caught: unknown
    try { await denied.verifyChannel(99n) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(MaxChannelProviderError)
    expect(caught).toMatchObject({ status: 403, permanentAccessLoss: true })
  })
})
