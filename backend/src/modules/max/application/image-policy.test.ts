import { describe, expect, test } from 'bun:test'

import { classifyMaxImageMessage } from './image-policy'
import type { MaxInboundEvent } from './ports'

const base: Extract<MaxInboundEvent, { kind: 'message_created' }> = {
  kind: 'message_created', senderId: '1', recipientId: '2', messageId: 'm', occurredAt: '2026-09-15T00:00:00.000Z', text: null, attachments: [],
}

describe('MAX image application policy', () => {
  test('accepts one to ten ordered quick images and preserves body', () => {
    const event = { ...base, text: ' caption ', attachments: Array.from({ length: 10 }, (_, index) => ({ kind: 'image' as const, providerAttachmentId: `p-${index}` })) }
    expect(classifyMaxImageMessage(event)).toEqual({ kind: 'quick-images', attachments: event.attachments, body: ' caption ' })
  })

  test('the 11-image test is a memoLy application limit rather than a provider limit', () => {
    expect(classifyMaxImageMessage({ ...base, attachments: Array.from({ length: 11 }, (_, index) => ({ kind: 'image' as const, providerAttachmentId: `p-${index}` })) })).toEqual({ kind: 'unsupported' })
  })

  test('accepts one file candidate and rejects multiple/mixed shapes', () => {
    const file = { kind: 'file' as const, providerAttachmentId: 'f-1', filename: 'x.png', declaredSize: 10 }
    expect(classifyMaxImageMessage({ ...base, attachments: [file] })).toEqual({ kind: 'image-file', attachment: file, body: '' })
    expect(classifyMaxImageMessage({ ...base, attachments: [file, file] })).toEqual({ kind: 'unsupported' })
    expect(classifyMaxImageMessage({ ...base, attachments: [file, { kind: 'image' as const, providerAttachmentId: 'p-1' }] })).toEqual({ kind: 'unsupported' })
  })

  test('denies captions above 8000 Unicode code points without truncating', () => {
    expect(classifyMaxImageMessage({ ...base, text: '💛'.repeat(8_000), attachments: [{ kind: 'image', providerAttachmentId: 'p' }] })).toMatchObject({ kind: 'quick-images' })
    expect(classifyMaxImageMessage({ ...base, text: '💛'.repeat(8_001), attachments: [{ kind: 'image', providerAttachmentId: 'p' }] })).toEqual({ kind: 'denied', reason: 'invalid_caption' })
  })
})
