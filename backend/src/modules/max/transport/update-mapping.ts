import type { MaxInboundEvent } from '../application/ports'

export type MaxMappedUpdate = MaxInboundEvent | { kind: 'ignored' }

export function normalizeMaxUpdate(input: unknown): MaxMappedUpdate {
  if (!isRecord(input) || typeof input.update_type !== 'string') throw new Error('Invalid MAX update')
  if (input.update_type !== 'message_created' && input.update_type !== 'bot_started') return { kind: 'ignored' }
  const timestamp = input.timestamp
  if (!isNonNegativeSafeInteger(timestamp)) throw new Error('Invalid MAX timestamp')
  const occurredAt = new Date(timestamp).toISOString()
  if (input.update_type === 'bot_started') return normalizeBotStarted(input, occurredAt)
  return normalizeMessage(input, occurredAt)
}

function normalizeBotStarted(input: Record<string, unknown>, occurredAt: string): MaxMappedUpdate {
  if (!isPositiveSafeInteger(input.chat_id) || !isRecord(input.user) || !isPositiveSafeInteger(input.user.user_id)) {
    throw new Error('Invalid MAX bot_started update')
  }
  if (input.payload !== undefined && input.payload !== null &&
      (typeof input.payload !== 'string' || input.payload.length > 512)) {
    throw new Error('Invalid MAX bot_started payload')
  }
  return {
    kind: 'bot_started', chatId: String(input.chat_id), userId: String(input.user.user_id),
    occurredAt, payload: typeof input.payload === 'string' ? input.payload : null,
  }
}

function normalizeMessage(input: Record<string, unknown>, occurredAt: string): MaxMappedUpdate {
  if (!isRecord(input.message)) return { kind: 'ignored' }
  const message = input.message
  if (message.body === null || message.body === undefined) return { kind: 'ignored' }
  if (!isRecord(message.sender) || !isRecord(message.recipient)) return { kind: 'ignored' }
  // MAX always supplies all Recipient keys. A direct dialog has a null chat_id and a positive
  // user_id; group/channel recipients have a positive chat_id and are ignored at this boundary.
  if (!Object.hasOwn(message.recipient, 'chat_id') || !Object.hasOwn(message.recipient, 'chat_type') ||
      !Object.hasOwn(message.recipient, 'user_id')) return { kind: 'ignored' }
  if (message.recipient.chat_id !== null || message.recipient.chat_type !== 'dialog') return { kind: 'ignored' }
  if (!isPositiveSafeInteger(message.sender.user_id) || !isPositiveSafeInteger(message.recipient.user_id)) {
    throw new Error('Invalid MAX message identifiers')
  }
  if (!isRecord(message.body)) throw new Error('Invalid MAX message body')
  if (typeof message.body.mid !== 'string' || message.body.mid.length === 0) throw new Error('Invalid MAX message id')
  const body = message.body
  const messageId = body.mid as string
  if (body.attachments !== undefined && body.attachments !== null && !Array.isArray(body.attachments)) {
    throw new Error('Invalid MAX message attachments')
  }
  const attachments = Array.isArray(body.attachments) ? body.attachments : []
  const text = body.text === null || body.text === undefined ? null :
    typeof body.text === 'string' ? body.text : (() => { throw new Error('Invalid MAX message text') })()
  if (text === null && attachments.length === 0 && isForwardOnly(body)) return { kind: 'ignored' }
  return {
    kind: 'message_created', senderId: String(message.sender.user_id), recipientId: String(message.recipient.user_id),
    messageId, occurredAt, text, hasAttachments: attachments.length > 0,
  }
}

function isForwardOnly(body: Record<string, unknown>) {
  return isRecord(body.link) && body.link.type === 'forward'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
