import { createHash } from 'node:crypto'

import type { MaxInboundEvent } from './ports'

export function maxEventKey(botId: string, event: MaxInboundEvent): string {
  const fields = event.kind === 'message_created'
    ? [event.kind, botId, event.recipientId, event.messageId]
    : event.kind === 'family_choice'
    ? [event.kind, botId, event.callbackId]
    : [
        event.kind,
        botId,
        event.chatId,
        event.userId,
        event.occurredAt,
        event.payload === null ? 'absent' : `present:${sha256(event.payload)}`,
      ]
  return sha256(lengthPrefixed(fields))
}

function lengthPrefixed(fields: string[]) {
  return fields.map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`).join('\u0000')
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
