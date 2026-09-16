import { describe, expect, test } from 'bun:test'

import { normalizeMaxUpdate } from './transport/update-mapping'

const messageFixture = {
  update_type: 'message_created', timestamp: 1700000000123,
  message: {
    body: { mid: 'mid-1', text: 'hello', attachments: [{ type: 'image', payload: { photo_id: 1, token: 'rotating-token', url: 'https://i.oneme.ru/image-1' } }] },
    sender: { user_id: 42 }, recipient: { chat_id: null, chat_type: 'dialog', user_id: 99 },
  },
}

describe('MAX update mapping', () => {
  test('maps a live-shaped direct dialog with a numeric chat id', () => {
    expect(normalizeMaxUpdate({
      update_type: 'message_created', timestamp: 1700000000123,
      message: {
        sender: { user_id: 42 }, recipient: { chat_type: 'dialog', chat_id: 900, user_id: 99 },
        body: { mid: 'live-dialog-1', text: 'hello from MAX', attachments: [] },
      },
    })).toEqual({
      kind: 'message_created', senderId: '42', recipientId: '99', messageId: 'live-dialog-1',
      occurredAt: '2023-11-14T22:13:20.123Z', text: 'hello from MAX', attachments: [],
    })
  })

  test('keeps group and channel messages out of direct-dialog capture', () => {
    expect(normalizeMaxUpdate({
      ...messageFixture,
      message: { ...messageFixture.message, recipient: { chat_type: 'group', chat_id: 901, user_id: 99 } },
    })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({
      ...messageFixture,
      message: { ...messageFixture.message, recipient: { chat_type: 'channel', chat_id: 902, user_id: 99 } },
    })).toEqual({ kind: 'ignored' })
  })

  test('ignores malformed direct-dialog recipient chat ids safely', () => {
    for (const recipient of [
      { chat_type: 'dialog', chat_id: '900', user_id: 99 },
      { chat_type: 'dialog', chat_id: 0, user_id: 99 },
      { chat_type: 'dialog', chat_id: 1.5, user_id: 99 },
      { chat_type: 'invalid', chat_id: 900, user_id: 99 },
    ]) {
      expect(normalizeMaxUpdate({
        ...messageFixture,
        message: { ...messageFixture.message, recipient },
      })).toEqual({ kind: 'ignored' })
    }
  })

  test('maps documented direct message and bot-started envelopes', () => {
    expect(normalizeMaxUpdate(messageFixture)).toEqual({
      kind: 'message_created', senderId: '42', recipientId: '99', messageId: 'mid-1',
      occurredAt: '2023-11-14T22:13:20.123Z', text: 'hello', attachments: [{ kind: 'image', providerAttachmentId: '1' }],
    })
    expect(normalizeMaxUpdate({
      update_type: 'bot_started', timestamp: 1700000000456,
      chat_id: 99, user: { user_id: 42 }, payload: null,
    })).toEqual({
      kind: 'bot_started', chatId: '99', userId: '42',
      occurredAt: '2023-11-14T22:13:20.456Z', payload: null,
    })
    expect(normalizeMaxUpdate({
      update_type: 'bot_started', timestamp: 1700000000456,
      chat_id: 99, user: { user_id: 42 }, payload: '🙂'.repeat(512),
    })).toMatchObject({ kind: 'bot_started', payload: '🙂'.repeat(512) })
  })

  test('ignores unsupported, group, missing-body, and forward-only messages without leakage', () => {
    expect(normalizeMaxUpdate({ update_type: 'message_edited', secret: 'raw' })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, recipient: { chat_id: 5, chat_type: 'chat', user_id: null } } })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, body: null } })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, body: { mid: 'mid-2', link: { type: 'forward' } } } })).toEqual({ kind: 'ignored' })
    expect(normalizeMaxUpdate({
      ...messageFixture,
      message: {
        ...messageFixture.message,
        link: { type: 'forward', message: { mid: 'forwarded-mid' } },
        body: { mid: 'mid-3', text: null, attachments: [] },
      },
    })).toEqual({ kind: 'ignored' })
  })

  test('rejects malformed supported identities, timestamps, and payloads', () => {
    expect(() => normalizeMaxUpdate({ ...messageFixture, timestamp: -1 })).toThrow()
    expect(() => normalizeMaxUpdate({ update_type: 'message_created', timestamp: 1 })).toThrow()
    expect(() => normalizeMaxUpdate({
      ...messageFixture,
      message: { ...messageFixture.message, recipient: null },
    })).toThrow()
    expect(() => normalizeMaxUpdate({
      ...messageFixture,
      message: {
        ...messageFixture.message,
        recipient: { chat_id: null, chat_type: 'dialog' },
      },
    })).toThrow()
    expect(() => normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, sender: { user_id: 0 } } })).toThrow()
    expect(() => normalizeMaxUpdate({ update_type: 'bot_started', timestamp: 1, chat_id: 1, user: { user_id: 2 }, payload: 'x'.repeat(513) })).toThrow()
    expect(() => normalizeMaxUpdate({ update_type: 'bot_started', timestamp: 1, chat_id: 1, user: { user_id: 2 }, payload: 3 })).toThrow()
  })

  test('normalizes numeric photo_id and top-level file metadata without retaining transport fields', () => {
    const result = normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, body: {
      mid: 'mid-file', text: 'caption', attachments: [
        { type: 'image', payload: { photo_id: 12345, token: 'rotating-a', url: 'https://i.oneme.ru/a' } },
      ],
    } } })
    expect(result).toEqual(expect.objectContaining({ attachments: [{ kind: 'image', providerAttachmentId: '12345' }] }))
    const file = normalizeMaxUpdate({ ...messageFixture, message: { ...messageFixture.message, body: {
      mid: 'mid-file', text: null, attachments: [
        { type: 'file', payload: { fileId: 'file-1', token: 'rotating-b', url: 'https://fd.oneme.ru/f' }, filename: 'photo.png', size: 9 },
      ],
    } } })
    expect(file).toEqual(expect.objectContaining({ attachments: [{ kind: 'file', providerAttachmentId: 'file-1', filename: 'photo.png', declaredSize: 9 }] }))
  })

  test('maps a live-shaped file image with a numeric fileId and rejects invalid numeric fileIds', () => {
    const update = (fileId: unknown) => ({ ...messageFixture, message: { ...messageFixture.message, recipient: { chat_type: 'dialog', chat_id: 900, user_id: 99 }, body: {
      mid: 'mid-numeric-file', text: null, attachments: [
        { type: 'file', payload: { fileId, token: 'rotating-file', url: 'https://fd.oneme.ru/file' }, filename: 'photo.png', size: 9 },
      ],
    } } })

    expect(normalizeMaxUpdate(update(12345))).toEqual(expect.objectContaining({
      kind: 'message_created', attachments: [{ kind: 'file', providerAttachmentId: '12345', filename: 'photo.png', declaredSize: 9 }],
    }))
    for (const fileId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => normalizeMaxUpdate(update(fileId))).toThrow('Invalid MAX attachment identity')
    }
  })

  test('accepts a dotted video mid and numeric payload id without retaining token or URL', () => {
    const result = normalizeMaxUpdate({
      update_type: 'message_created', timestamp: 1700000000123,
      message: { sender: { user_id: 42 }, recipient: { chat_id: null, chat_type: 'dialog', user_id: 99 }, body: {
        mid: 'm.dotted', text: 'video caption', attachments: [{ type: 'video', payload: {
          id: 123, token: 'rotating-token-shape', url: 'https://v.oneme.ru/current', duration: 7, width: 1280, height: 720,
        } }],
      } },
    })
    expect(result).toEqual(expect.objectContaining({ messageId: 'm.dotted', attachments: [{ kind: 'video', providerAttachmentId: '123', durationSeconds: 7, width: 1280, height: 720 }] }))
    expect(JSON.stringify(result)).not.toContain('rotating-token-shape')
    expect(JSON.stringify(result)).not.toContain('v.oneme.ru')
  })
})
