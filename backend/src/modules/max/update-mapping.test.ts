import { describe, expect, test } from 'bun:test'

import { normalizeMaxUpdate } from './transport/update-mapping'

const messageFixture = {
  update_type: 'message_created', timestamp: 1700000000123,
  message: {
    body: { mid: 'mid-1', text: 'hello', attachments: [{ type: 'image' }] },
    sender: { user_id: 42 }, recipient: { user_id: 99 },
  },
}

describe('MAX update mapping', () => {
  test('maps documented direct message and bot-started envelopes', () => {
    expect(normalizeMaxUpdate(messageFixture)).toEqual({
      kind: 'message_created', senderId: '42', recipientId: '99', messageId: 'mid-1',
      occurredAt: '2023-11-14T22:13:20.123Z', text: 'hello', hasAttachments: true,
    })
    expect(normalizeMaxUpdate({
      update_type: 'bot_started', timestamp: 1700000000456,
      chat_id: 99, user: { user_id: 42 }, payload: null,
    })).toEqual({
      kind: 'bot_started', chatId: '99', userId: '42',
      occurredAt: '2023-11-14T22:13:20.456Z', payload: null,
    })
  })

  test('ignores unsupported, group, missing-body, and forward-only messages without leakage', () => {
    expect(normalizeMaxUpdate({ update_type: 'message_edited', secret: 'raw' })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, recipient: { chat_id: 5 } } })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, body: null } })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, body: { mid: 'mid-2', link: { type: 'forward' } } } })).toEqual({ kind: 'ignored' })
  })

  test('rejects malformed supported identities, timestamps, and payloads', () => {
    expect(() => normalizeMaxUpdate({ ...messageFixture, timestamp: -1 })).toThrow()
    expect(() => normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, sender: { user_id: 0 } } })).toThrow()
    expect(() => normalizeMaxUpdate({ update_type: 'bot_started', timestamp: 1, chat_id: 1, user: { user_id: 2 }, payload: 'x'.repeat(513) })).toThrow()
    expect(() => normalizeMaxUpdate({ update_type: 'bot_started', timestamp: 1, chat_id: 1, user: { user_id: 2 }, payload: 3 })).toThrow()
  })
})
