import { describe, expect, test } from 'bun:test'

import type { MaxInboundEvent } from './ports'
import { maxEventKey } from './event-key'

const botId = '9001'

function message(overrides: Partial<Extract<MaxInboundEvent, { kind: 'message_created' }>> = {}): Extract<MaxInboundEvent, { kind: 'message_created' }> {
  return {
    kind: 'message_created', senderId: '100', recipientId: '200', messageId: 'mid-1',
    occurredAt: '2026-09-14T12:00:00.000Z', text: 'hello', hasAttachments: false, ...overrides,
  }
}

function started(overrides: Partial<Extract<MaxInboundEvent, { kind: 'bot_started' }>> = {}): Extract<MaxInboundEvent, { kind: 'bot_started' }> {
  return {
    kind: 'bot_started', chatId: '300', userId: '400', occurredAt: '2026-09-14T12:00:00.000Z', payload: null, ...overrides,
  }
}

describe('MAX event keys', () => {
  test('message keys are stable and change with bot, recipient, or message identity', () => {
    const event = message()
    expect(maxEventKey(botId, event)).toBe(maxEventKey(botId, { ...event }))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey('9002', event))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey(botId, message({ recipientId: '201' })))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey(botId, message({ messageId: 'mid-2' })))
  })

  test('message response text, attachment flag, and processing fields cannot affect identity', () => {
    const event = message()
    expect(maxEventKey(botId, event)).toBe(maxEventKey(botId, message({ text: 'localized response', hasAttachments: true })))
    expect(maxEventKey(botId, { ...event, responseText: 'retry response', processedAt: 'later' } as never))
      .toBe(maxEventKey(botId, event))
  })

  test('bot_started with no payload is stable and changes with every canonical field', () => {
    const event = started()
    expect(maxEventKey(botId, event)).toBe(maxEventKey(botId, started({ payload: null })))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey('9002', event))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey(botId, started({ chatId: '301' })))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey(botId, started({ userId: '401' })))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey(botId, started({ occurredAt: '2026-09-14T12:00:01.000Z' })))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey(botId, started({ payload: '' })))
    expect(maxEventKey(botId, event)).not.toBe(maxEventKey(botId, started({ payload: 'start' })))
  })

  test('bot_started processing and response fields cannot affect identity', () => {
    const event = started()
    expect(maxEventKey(botId, { ...event, responseText: 'welcome', processTime: 42 } as never))
      .toBe(maxEventKey(botId, event))
  })
})
