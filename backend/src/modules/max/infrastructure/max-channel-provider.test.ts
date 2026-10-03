import { describe, expect, test } from 'bun:test'

import { createMaxChannelProvider, MaxChannelProviderError, readMaxRootInt64 } from './max-channel-provider'

describe('MAX channel verification', () => {
  test('verifies an exact non-bot admin actor from the authoritative members list', async () => {
    const paths: string[] = []
    const provider = createMaxChannelProvider('unit-token', { fetch: async (input) => {
      const path = String(input)
      paths.push(path)
      return new Response('{"members":[{"user_id":9007199254740993,"is_admin":true,"is_bot":false},{"user_id":8,"is_admin":false,"is_bot":false},{"user_id":7,"is_owner":true,"is_bot":true}]}')
    } })
    await expect(provider.verifyActorAdmin(55n, 9007199254740993n)).resolves.toBe(true)
    await expect(provider.verifyActorAdmin(55n, 7n)).resolves.toBe(false)
    await expect(provider.verifyActorAdmin(55n, 8n)).resolves.toBe(false)
    expect(paths).toEqual([
      'https://platform-api2.max.ru/chats/55/members/admins',
      'https://platform-api2.max.ru/chats/55/members/admins',
      'https://platform-api2.max.ru/chats/55/members/admins',
    ])
  })

  test('fails closed for malformed IDs and incomplete administrator pages', async () => {
    const malformed = createMaxChannelProvider('unit-token', { fetch: async () => new Response('{"members":[{"user_id":"9007199254740993","is_admin":true,"is_bot":false}]}') })
    await expect(malformed.verifyActorAdmin(55n, 9007199254740993n)).rejects.toBeInstanceOf(MaxChannelProviderError)
    const incomplete = createMaxChannelProvider('unit-token', { fetch: async () => Response.json({ members: [], marker: 1 }) })
    await expect(incomplete.verifyActorAdmin(55n, 9007199254740993n)).rejects.toBeInstanceOf(MaxChannelProviderError)
    const denied = createMaxChannelProvider('unit-token', { fetch: async () => new Response('{}', { status: 403 }) })
    await expect(denied.verifyActorAdmin(55n, 9007199254740993n)).rejects.toMatchObject({ status: 403, permanentAccessLoss: true })
    const network = createMaxChannelProvider('unit-token', { fetch: async () => { throw new Error('offline') } })
    await expect(network.verifyActorAdmin(55n, 9007199254740993n)).rejects.toMatchObject({ status: null, permanentAccessLoss: false })
  })

  test('fails closed when the administrator response contains ambiguous or malformed later rows', async () => {
    const duplicate = createMaxChannelProvider('unit-token', { fetch: async () => new Response(
      '{"members":[{"user_id":77,"is_admin":true,"is_bot":false},{"user_id":77,"is_admin":false,"is_bot":false}]}',
    ) })
    await expect(duplicate.verifyActorAdmin(55n, 77n)).rejects.toMatchObject({ status: null })

    const malformedLater = createMaxChannelProvider('unit-token', { fetch: async () => new Response(
      '{"members":[{"user_id":77,"is_admin":true,"is_bot":false},{"user_id":"78","is_admin":true,"is_bot":false}]}',
    ) })
    await expect(malformedLater.verifyActorAdmin(55n, 77n)).rejects.toMatchObject({ status: null })
  })

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
