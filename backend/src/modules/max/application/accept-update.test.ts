import { describe, expect, test } from 'bun:test'

import { createMaxAcceptUpdate, isMaxCaptionWithinLimit, isPublishableMaxText, selectMaxImmediateResponse } from './accept-update'
import type { MaxInboundEvent, MaxAcceptRepository } from './ports'

describe('MAX durable acceptance policy', () => {
  test('counts text by Unicode code point and rejects blank or attached messages', () => {
    expect(isPublishableMaxText({ text: '💛'.repeat(8_000), hasAttachments: false })).toBe(true)
    expect(isPublishableMaxText({ text: '💛'.repeat(8_001), hasAttachments: false })).toBe(false)
    expect(isPublishableMaxText({ text: '   ', hasAttachments: false })).toBe(false)
    expect(isPublishableMaxText({ text: 'caption', hasAttachments: true })).toBe(false)
  })

  test('bounds captions for supported media, including native audio', () => {
    expect(isMaxCaptionWithinLimit(null)).toBe(true)
    expect(isMaxCaptionWithinLimit('💛'.repeat(8_000))).toBe(true)
    expect(isMaxCaptionWithinLimit('💛'.repeat(8_001))).toBe(false)
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
    expect(selectMaxImmediateResponse({ kind: 'bot_started', chatId: '7', userId: '11', occurredAt: plain.occurredAt, payload: null })).toBeNull()
  })

  test('accepts one confirmed native audio attachment without the unsupported response', () => {
    const event: MaxInboundEvent = {
      kind: 'message_created', senderId: '11', recipientId: '99', messageId: 'audio-1',
      occurredAt: '2026-09-14T10:00:00.000Z', text: null,
      attachments: [{ kind: 'voice', providerAttachmentId: '987', url: 'https://i.oneme.ru/audio-987' }],
    }
    expect(selectMaxImmediateResponse(event)).toEqual({ kind: 'accepted', text: 'Получено. Сохраняем…', destinationUserId: '11' })
  })

  test('accepts ordered mixed image and video attachments within the shared ten-item limit', () => {
    const event: MaxInboundEvent = {
      kind: 'message_created', senderId: '11', recipientId: '99', messageId: 'mixed-1',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'One caption',
      attachments: [
        { kind: 'image', providerAttachmentId: '1' },
        { kind: 'video', providerAttachmentId: '2', durationSeconds: 4, width: 320, height: 240 },
        { kind: 'image', providerAttachmentId: '3' },
      ],
    }
    expect(selectMaxImmediateResponse(event)?.kind).toBe('accepted')
    expect(selectMaxImmediateResponse({ ...event, attachments: Array.from({ length: 11 }, () => event.attachments![0]!) })?.kind).toBe('unsupported_media')
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

  test('acknowledges a message from the configured bot without encrypting or persisting it', async () => {
    let encrypted = 0
    let accepted = 0
    let clockReads = 0
    const repository: MaxAcceptRepository = {
      accept: async () => { accepted += 1; return { inboxId: 'unexpected', duplicate: false } },
    }
    const event: MaxInboundEvent = {
      kind: 'message_created', senderId: '99', recipientId: '11', messageId: 'backup-post-1',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'ordinary caption',
      attachments: [{ kind: 'image', providerAttachmentId: '123' }],
    }
    const accept = createMaxAcceptUpdate({
      botId: '99', repository,
      encrypt: () => { encrypted += 1; return { ciphertext: Uint8Array.of(1), iv: Uint8Array.of(2), authTag: Uint8Array.of(3) } },
      now: () => { clockReads += 1; return new Date() },
    })
    expect(await accept(event)).toEqual({ inboxId: '', duplicate: true })
    expect({ encrypted, accepted, clockReads }).toEqual({ encrypted: 0, accepted: 0, clockReads: 0 })
    expect(await accept({ ...event, senderId: '11' })).toEqual({ inboxId: 'unexpected', duplicate: false })
    expect({ encrypted, accepted, clockReads }).toEqual({ encrypted: 1, accepted: 1, clockReads: 1 })
  })
})
