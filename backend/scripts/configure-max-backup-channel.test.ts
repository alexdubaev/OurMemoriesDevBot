import { describe, expect, test } from 'bun:test'

import {
  configureMaxBackupChannel,
  createMaxBackupChannelApi,
  createPrismaMaxBackupChannelRepository,
  parseMaxBackupChannelArgs,
} from './configure-max-backup-channel'
import type { DbClient } from '../src/db'

const familyId = '11111111-1111-4111-8111-111111111111'

describe('MAX backup channel configuration CLI', () => {
  test('parses a signed non-zero int64 target and defaults to dry-run', () => {
    expect(parseMaxBackupChannelArgs(['--family', familyId, '--chat-id', '88001'])).toEqual({
      familyId,
      chatId: 88001n,
      apply: false,
    })
    expect(parseMaxBackupChannelArgs(['--family', familyId, '--chat-id', '9223372036854775807', '--apply']).apply).toBe(true)
    expect(parseMaxBackupChannelArgs(['--family', familyId, '--chat-id', '-88001']).chatId).toBe(-88001n)
    expect(parseMaxBackupChannelArgs(['--family', familyId, '--chat-id', '-9223372036854775808']).chatId).toBe(-9_223_372_036_854_775_808n)
  })

  test('rejects malformed, zero, out-of-range, and unknown arguments', () => {
    for (const args of [
      ['--family', 'not-a-uuid', '--chat-id', '5'],
      ['--family', familyId, '--chat-id', '0'],
      ['--family', familyId, '--chat-id', '-0'],
      ['--family', familyId, '--chat-id', '9223372036854775808'],
      ['--family', familyId, '--chat-id', '-9223372036854775809'],
      ['--family', familyId, '--chat-id', '5', '--force'],
    ]) expect(() => parseMaxBackupChannelArgs(args)).toThrow()
  })

  test('uses Authorization header and requires a verified active channel and bot write access', async () => {
    const seen: Array<{ url: string; authorization: string | null }> = []
    const api = createMaxBackupChannelApi('secret-must-not-leak', {
      fetch: async (input, init) => {
        seen.push({ url: String(input), authorization: new Headers(init?.headers).get('Authorization') })
        const url = String(input)
        if (url.endsWith('/members/me')) return Response.json({ is_bot: true, is_admin: true, permissions: ['read_all_messages', 'write'] })
        if (url.endsWith('/me')) return Response.json({ is_bot: true, username: 'OurMemoriesMaxBot' })
        return new Response('{"chat_id":88001,"type":"channel","status":"active","is_public":false}')
      },
    })
    await api.verifyBot('OurMemoriesMaxBot')
    await api.verifyChannel(88001n)
    expect(seen.map(({ url }) => url)).toEqual([
      'https://platform-api2.max.ru/me',
      'https://platform-api2.max.ru/chats/88001',
      'https://platform-api2.max.ru/chats/88001/members/me',
    ])
    expect(seen.every(({ authorization }) => authorization === 'secret-must-not-leak')).toBe(true)
    expect(seen.every(({ url }) => !url.includes('secret-must-not-leak'))).toBe(true)
  })

  test('verifies a negative channel using its exact signed ID in both paths', async () => {
    const paths: string[] = []
    const api = createMaxBackupChannelApi('test-token', {
      fetch: async (input) => {
        const path = String(input)
        paths.push(path)
        if (path.endsWith('/members/me')) return Response.json({ is_bot: true, is_admin: true, permissions: ['write'] })
        return new Response('{"chat_id":-88001,"type":"channel","status":"active","is_public":false}')
      },
    })
    await api.verifyChannel(-88_001n)
    expect(paths).toEqual([
      'https://platform-api2.max.ru/chats/-88001',
      'https://platform-api2.max.ru/chats/-88001/members/me',
    ])
  })

  test('rejects a non-channel or inactive target before requesting membership', async () => {
    const paths: string[] = []
    const api = createMaxBackupChannelApi('test-token', {
      fetch: async (input) => {
        paths.push(String(input))
        return Response.json({ chat_id: 88001, type: 'chat', status: 'active', is_public: false })
      },
    })
    await expect(api.verifyChannel(88001n)).rejects.toThrow('active channel')
    expect(paths).toHaveLength(1)
  })

  test('rejects public channels and chat responses for a different channel ID', async () => {
    for (const chatResponse of [
      '{"chat_id":88001,"type":"channel","status":"active","is_public":true}',
      '{"chat_id":88002,"type":"channel","status":"active","is_public":false}',
    ]) {
      const paths: string[] = []
      const api = createMaxBackupChannelApi('test-token', {
        fetch: async (input) => {
          paths.push(String(input))
          return new Response(chatResponse)
        },
      })
      await expect(api.verifyChannel(88001n)).rejects.toThrow('active channel')
      expect(paths).toHaveLength(1)
    }
  })

  test('compares int64 channel IDs exactly and requires bot membership', async () => {
    const chatId = 9_007_199_254_740_993n
    const makeApi = (chatRaw: string, memberRaw: string) => createMaxBackupChannelApi('test-token', {
      fetch: async (input) => String(input).endsWith('/members/me')
        ? new Response(memberRaw)
        : new Response(chatRaw),
    })
    const channel = `{"chat_id":${chatId},"type":"channel","status":"active","is_public":false}`
    await expect(makeApi(channel, '{"is_bot":true,"is_admin":true,"permissions":["write"]}').verifyChannel(chatId)).resolves.toBeUndefined()
    await expect(makeApi(channel, '{"is_admin":true,"permissions":["write"]}').verifyChannel(chatId)).rejects.toThrow('owner or admin')
    await expect(makeApi(channel, '{"is_bot":false,"is_admin":true,"permissions":["write"]}').verifyChannel(chatId)).rejects.toThrow('owner or admin')
  })

  test('fails closed when privacy or channel ID fields are missing', async () => {
    for (const chatResponse of [
      '{"type":"channel","status":"active","chat_id":88001}',
      '{"type":"channel","status":"active","is_public":false}',
    ]) {
      const api = createMaxBackupChannelApi('test-token', { fetch: async () => new Response(chatResponse) })
      await expect(api.verifyChannel(88001n)).rejects.toThrow('active channel')
    }
  })

  test('dry-run verifies first and never calls the repository; apply binds only after verification', async () => {
    const events: string[] = []
    const api = {
      verifyBot: async () => { events.push('bot') },
      verifyChannel: async () => { events.push('channel') },
    }
    const repository = { bindAndQueue: async () => { events.push('database'); return { queued: 3 } } }
    expect(await configureMaxBackupChannel({ familyId, chatId: 88001n, apply: false, expectedBotUsername: 'OurMemoriesMaxBot', api, repository }))
      .toEqual({ applied: false, queued: null })
    expect(events).toEqual(['bot', 'channel'])
    events.length = 0
    expect(await configureMaxBackupChannel({ familyId, chatId: 88001n, apply: true, expectedBotUsername: 'OurMemoriesMaxBot', api, repository }))
      .toEqual({ applied: true, queued: 3 })
    expect(events).toEqual(['bot', 'channel', 'database'])
    await expect(configureMaxBackupChannel({
      familyId, chatId: 88001n, apply: true, expectedBotUsername: 'OurMemoriesMaxBot',
      api: { ...api, verifyChannel: async () => { throw new Error('invalid') } }, repository,
    })).rejects.toThrow('invalid')
    expect(events).toEqual(['bot', 'channel', 'database', 'bot'])
  })

  test('transaction binds the family, moves only unconfigured backups, and dedupes their task keys', async () => {
    const queued: Array<{ type: string; dedupeKey: string; payload: unknown }> = []
    const tx = {
      family: {
        findUnique: async () => ({ maxBackupChatId: null }),
        findFirst: async () => null,
        updateMany: async (input: unknown) => { expect(input).toMatchObject({ data: { maxBackupChatId: 88001n } }); return { count: 1 } },
      },
      maxMemoryBackup: {
        updateManyAndReturn: async (input: unknown) => {
          expect(input).toMatchObject({
            where: { familyId, state: { in: ['needs_configuration', 'pending', 'uploading'] }, sendIntentAt: null, providerMessageId: null },
            data: { channelChatId: 88001n, state: 'pending', lastErrorCode: null },
          })
          return [{ memoryId: 'memory-one' }, { memoryId: 'memory-two' }]
        },
      },
      taskOutbox: {
        createMany: async ({ data }: { data: typeof queued }) => { queued.push(...data); return { count: data.length } },
        findUniqueOrThrow: async ({ where }: { where: { type_dedupeKey: { dedupeKey: string } } }) => ({ id: where.type_dedupeKey.dedupeKey }),
      },
      maxChannelBinding: {
        findUnique: async () => null,
        upsert: async () => ({ version: 1 }),
      },
    }
    Object.assign(tx, { $executeRaw: async () => 1, $queryRaw: async () => [] })
    const prisma = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as DbClient
    const result = await createPrismaMaxBackupChannelRepository(prisma).bindAndQueue(familyId, 88001n)
    expect(result).toEqual({ queued: 2 })
    expect(queued).toEqual([
      { type: 'max:backup-media', dedupeKey: 'max-backup-media:memory-one:channel:88001:1', payload: { memoryId: 'memory-one' } },
      { type: 'max:backup-media', dedupeKey: 'max-backup-media:memory-two:channel:88001:1', payload: { memoryId: 'memory-two' } },
    ])
  })
})
