import { describe, expect, test } from 'bun:test'

import { classifyMaxVideoMessage, normalizeVideoDurationMs } from './application/video-policy'
import type { MaxInboundEvent } from './application/ports'

describe('MAX video policy', () => {
  test('accepts one normal video and preserves only caption and stable identity', () => {
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = {
      kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'm.1',
      occurredAt: '2026-09-15T10:00:00.000Z', text: 'caption',
      attachments: [{ kind: 'video', providerAttachmentId: '123', durationSeconds: 7, width: 1280, height: 720 }],
    }

    expect(classifyMaxVideoMessage(event)).toEqual({
      kind: 'video', body: 'caption', attachment: expect.objectContaining({ providerAttachmentId: '123' }),
    })
  })

  test('normalizes only the documented 7 second inbound to 7000 millisecond resolver pair', () => {
    expect(normalizeVideoDurationMs(7, 7000)).toBe(7000)
    expect(normalizeVideoDurationMs(7, 7001)).toBeNull()
    expect(normalizeVideoDurationMs(null, 7000)).toBeNull()
    expect(normalizeVideoDurationMs(7, null)).toBeNull()
  })
})
