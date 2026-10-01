import { describe, expect, test } from 'bun:test'

import { TerminalTaskError } from '../../../outbox'
import type { MaxApiPort } from '../application/ports'
import { createMaxResponseDelivery } from './deliver-response'

const responseId = '019c0000-0000-7000-8000-000000000001'

function fakePrisma(response: unknown) {
  let updates = 0
  const updateMany = async (input: unknown) => { updates += 1; return { count: 1, input } }
  const responseDelegate = {
    findUnique: async () => response,
    updateMany,
  }
  const prisma = {
    maxOutgoingResponse: responseDelegate,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      maxOutgoingResponse: responseDelegate,
      maxInbox: { updateMany: async () => ({ count: 1 }) },
    }),
  }
  return { prisma: prisma as never, updates: () => updates }
}

function api(overrides: Partial<MaxApiPort> = {}): MaxApiPort {
  return {
    getMe: async () => ({ userId: 1, username: 'bot', isBot: true }),
    getSubscriptions: async () => [],
    createSubscription: async () => ({ success: true }),
    deleteSubscription: async () => ({ success: true }),
    sendMessage: async () => undefined,
    createVideoUpload: async () => ({ url: 'https://upload.example.test/video', token: 'upload-token' }),
    sendVideoMessage: async () => ({ messageId: 'unused' }),
    getMessage: async () => ({ messageId: 'unused', senderId: '1', recipientId: '1', attachments: [] }),
    ...overrides,
  }
}

describe('MAX response delivery', () => {
  test('rejects malformed response task ids as terminal work', async () => {
    const { prisma } = fakePrisma(null)
    const deliver = createMaxResponseDelivery({ prisma, api: api() })
    for (const payload of [null, {}, { responseId: 'bad' }, { responseId: 12 }, { responseId, extra: true }]) {
      await expect(deliver(payload)).rejects.toBeInstanceOf(TerminalTaskError)
    }
  })

  test('skips missing and already delivered logical responses without a provider call', async () => {
    let calls = 0
    const provider = api({ sendMessage: async () => { calls += 1 } })
    const missing = fakePrisma(null)
    await expect(createMaxResponseDelivery({ prisma: missing.prisma, api: provider })({ responseId })).resolves.toBe('skipped')
    const delivered = fakePrisma({ id: responseId, destinationUserId: 77n, text: 'done', deliveredAt: new Date() })
    await expect(createMaxResponseDelivery({ prisma: delivered.prisma, api: provider })({ responseId })).resolves.toBe('skipped')
    expect(calls).toBe(0)
  })

  test('delivers once and marks the same logical row with a conditional update', async () => {
    let sent: unknown
    const row = fakePrisma({ id: responseId, destinationUserId: 77n, text: 'Сохранено.', deliveredAt: null })
    const deliver = createMaxResponseDelivery({
      prisma: row.prisma,
      now: () => new Date('2026-09-14T10:00:00.000Z'),
      api: api({ sendMessage: async (input) => { sent = input } }),
    })

    await expect(deliver({ responseId })).resolves.toBe('done')
    expect(sent).toEqual({ userId: '77', text: 'Сохранено.' })
    expect(row.updates()).toBe(1)
  })

  test('delivers the full welcome with the official memoLy open_app button', async () => {
    let sent: unknown
    const text = `Добро пожаловать в memoLy 💛

Здесь живёт история вашей семьи: первые улыбки,
маленькие открытия и моменты, которые хочется сохранить.
Фото, видео и заметки о ребёнке — в одном семейном альбоме,
доступном только его участникам.

🌱 Создаёте семейный альбом?
Добавляйте воспоминания, приглашайте родных и друзей
и выбирайте, какой доступ им предоставить.

💛 Вас пригласили близкие?
Смотрите семейные воспоминания и оставляйте реакции —
будьте рядом, даже на расстоянии. Возможность добавлять
свои воспоминания зависит от выданного вам доступа.

Нажмите кнопку ниже, чтобы открыть приложение
и начать вашу семейную историю.`
    const row = fakePrisma({ id: responseId, destinationUserId: 77n, kind: 'welcome', text, buttons: null, deliveredAt: null,
      inbox: { encryptedPayload: new Uint8Array(), encryptionIv: new Uint8Array(), encryptionAuthTag: new Uint8Array(), source: null }, channelDecision: null })
    const deliver = createMaxResponseDelivery({ prisma: row.prisma, maxBotUsername: 'OurMemoriesMaxBot', api: api({ sendMessage: async (input) => { sent = input } }) })
    await expect(deliver({ responseId })).resolves.toBe('done')
    expect(sent).toEqual({ userId: '77', text, buttons: [{ type: 'open_app', text: 'Открыть memoLy', webApp: 'OurMemoriesMaxBot' }] })
  })

  test('batches channel choices in groups of 30 without renumbering persisted callback indexes', async () => {
    const sent: Array<{ buttons: Array<{ text: string; payload: string }> }> = []
    const buttons = Array.from({ length: 31 }, (_, index) => ({ text: `Family ${index}`, payload: `max_channel:${responseId}:select:${index}` }))
    const row = fakePrisma({ id: responseId, destinationUserId: 77n, kind: 'family_choice', deliveredAt: null,
      channelDecisionId: responseId, channelDecision: { status: 'pending', expiresAt: new Date('2026-10-01T11:00:00.000Z') },
      buttons })
    const deliver = createMaxResponseDelivery({
      prisma: row.prisma,
      now: () => new Date('2026-10-01T10:00:00.000Z'),
      api: api({ sendMessage: async (input) => { sent.push(input as typeof sent[number]) } }),
    })
    await expect(deliver({ responseId })).resolves.toBe('done')
    expect(sent.map((message) => message.buttons.length)).toEqual([30, 1])
    expect(sent[0]!.buttons[29]!.payload).toBe(`max_channel:${responseId}:select:29`)
    expect(sent[1]!.buttons[0]!.payload).toBe(`max_channel:${responseId}:select:30`)
    expect(row.updates()).toBe(1)
  })

  test('leaves delivery state untouched when the provider fails', async () => {
    const row = fakePrisma({ id: responseId, destinationUserId: 77n, text: 'retry', deliveredAt: null })
    const failure = new Error('provider failure')
    await expect(createMaxResponseDelivery({ prisma: row.prisma, api: api({ sendMessage: async () => { throw failure } }) })({ responseId }))
      .rejects.toBe(failure)
    expect(row.updates()).toBe(0)
  })
})
