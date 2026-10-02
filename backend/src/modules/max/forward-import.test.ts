import { describe, expect, test } from 'bun:test'

import { normalizeMaxUpdate } from './transport/update-mapping'
import { selectMaxImmediateResponse } from './application/accept-update'
import { validateMaxForwardedMessage } from './infrastructure/forward-import'

describe('MAX forward import boundary', () => {
  test('retains only the original identity while keeping the forwarding envelope identity', () => {
    const event = normalizeMaxUpdate(forwardedUpdate())

    expect(event).toMatchObject({
      kind: 'message_created',
      senderId: '7001',
      recipientId: '9001',
      messageId: 'outer-mid-synthetic',
      occurredAt: '2026-10-02T10:00:00.000Z',
      text: null,
      attachments: [],
      forwardedFrom: { messageId: 'original-mid-synthetic' },
    })
  })

  test('acknowledges a forward for import even when the outer message contains no content', () => {
    const event = normalizeMaxUpdate(forwardedUpdate())
    if (event.kind !== 'message_created') throw new Error('Expected a forwarded message')
    expect(selectMaxImmediateResponse(event)).toEqual({
      kind: 'accepted', text: 'Получено. Импортируем публикацию…', destinationUserId: '7001',
    })
  })

  test('requires the authenticated original to be an identified channel message with a bounded timestamp', () => {
    const now = new Date('2026-10-02T10:00:00.000Z')
    const valid = { messageId: 'original-mid', senderId: '0', recipientId: '-9007199254740993', recipientType: 'channel' as const,
      text: 'Synthetic caption', timestamp: Date.parse('2025-01-01T00:00:00.000Z'), attachments: [] }
    expect(validateMaxForwardedMessage(valid, 'original-mid', now)).toEqual({
      channelId: -9007199254740993n, occurredAt: new Date('2025-01-01T00:00:00.000Z'),
    })
    for (const invalid of [
      { ...valid, messageId: 'wrong-mid' },
      { ...valid, recipientType: 'dialog' as const },
      { ...valid, recipientId: '0' },
      { ...valid, timestamp: undefined },
      { ...valid, timestamp: now.getTime() + 5 * 60 * 1_000 + 1 },
      { ...valid, timestamp: 8_640_000_000_000_001 },
    ]) expect(() => validateMaxForwardedMessage(invalid, 'original-mid', now)).toThrow()
  })
})

function forwardedUpdate() {
  return {
    update_type: 'message_created', timestamp: Date.parse('2026-10-02T10:00:00.000Z'),
    message: {
      sender: { user_id: 7001 }, recipient: { chat_type: 'dialog', chat_id: 9001, user_id: 9001 },
      body: { mid: 'outer-mid-synthetic', seq: 21, text: '' },
      link: { type: 'forward', chat_id: -123456, message: {
        mid: 'original-mid-synthetic', seq: 7, text: 'Synthetic caption',
        attachments: [{ type: 'video', payload: { id: 456, token: 'synthetic-token', url: 'https://video.example.invalid/synthetic' }, duration: 29 }],
      } },
    },
  }
}
