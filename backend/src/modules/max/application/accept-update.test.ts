import { describe, expect, test } from 'bun:test'

import { createMaxAcceptUpdate, isPublishableMaxText, selectMaxImmediateResponse } from './accept-update'
import type { MaxInboundEvent, MaxAcceptRepository } from './ports'

describe('MAX durable acceptance policy', () => {
  test('counts text by Unicode code point and rejects blank or attached messages', () => {
    expect(isPublishableMaxText({ text: '💛'.repeat(8_000), hasAttachments: false })).toBe(true)
    expect(isPublishableMaxText({ text: '💛'.repeat(8_001), hasAttachments: false })).toBe(false)
    expect(isPublishableMaxText({ text: '   ', hasAttachments: false })).toBe(false)
    expect(isPublishableMaxText({ text: 'caption', hasAttachments: true })).toBe(false)
  })

  test('selects only the exact immediate responses approved for accepted events', () => {
    const plain: MaxInboundEvent = {
      kind: 'message_created', senderId: '11', recipientId: '99', messageId: 'm-1',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'hello', hasAttachments: false,
    }
    expect(selectMaxImmediateResponse(plain)).toEqual({ kind: 'accepted', text: 'Получено. Сохраняем…', destinationUserId: '11' })
    expect(selectMaxImmediateResponse({ ...plain, hasAttachments: true })).toEqual({
      kind: 'unsupported_media', text: 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.', destinationUserId: '11',
    })
    expect(selectMaxImmediateResponse({ ...plain, text: ' ' })).toBeNull()
    expect(selectMaxImmediateResponse({ kind: 'bot_started', chatId: '7', userId: '11', occurredAt: plain.occurredAt, payload: null })).toEqual({
      kind: 'welcome', text: 'Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.', destinationUserId: '11',
    })
  })

  test('passes normalized event, stable key, encrypted payload, identity and response to repository', async () => {
    const calls: unknown[] = []
    const repository: MaxAcceptRepository = {
      accept: async (input) => { calls.push(input); return { inboxId: 'inbox-1', duplicate: false } },
    }
    const event: MaxInboundEvent = {
      kind: 'message_created', senderId: '11', recipientId: '99', messageId: 'm-2',
      occurredAt: '2026-09-14T10:00:00.000Z', text: ' original ', hasAttachments: false,
    }
    const encrypted = { ciphertext: Uint8Array.of(1), iv: Uint8Array.of(2), authTag: Uint8Array.of(3) }
    const now = new Date('2026-09-14T10:01:00.000Z')
    const result = await createMaxAcceptUpdate({ botId: '99', repository, encrypt: () => encrypted, now: () => now })(event)
    expect(result).toEqual({ inboxId: 'inbox-1', duplicate: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ botId: '99', event, encrypted, now, response: { kind: 'accepted', destinationUserId: '11' } })
    expect((calls[0] as { eventKey: string }).eventKey).toMatch(/^[a-f0-9]{64}$/)
  })
})
