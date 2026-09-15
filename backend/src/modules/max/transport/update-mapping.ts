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
      (typeof input.payload !== 'string' || [...input.payload].length > 512)) {
    throw new Error('Invalid MAX bot_started payload')
  }
  return {
    kind: 'bot_started', chatId: String(input.chat_id), userId: String(input.user.user_id),
    occurredAt, payload: typeof input.payload === 'string' ? input.payload : null,
  }
}

function normalizeMessage(input: Record<string, unknown>, occurredAt: string): MaxMappedUpdate {
  if (!isRecord(input.message)) throw new Error('Invalid MAX message')
  const message = input.message
  if (message.body === null || message.body === undefined) return { kind: 'ignored' }
  if (!isRecord(message.sender)) return { kind: 'ignored' }
  if (!isRecord(message.recipient)) throw new Error('Invalid MAX recipient')
  // MAX always supplies all Recipient keys. A direct dialog has a null chat_id and a positive
  // user_id; group/channel recipients have a positive chat_id and are ignored at this boundary.
  if (!Object.hasOwn(message.recipient, 'chat_id') || !Object.hasOwn(message.recipient, 'chat_type') ||
      !Object.hasOwn(message.recipient, 'user_id')) throw new Error('Invalid MAX recipient')
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
  const attachments = Array.isArray(body.attachments) ? body.attachments.map(normalizeAttachment) : []
  const text = body.text === null || body.text === undefined ? null :
    typeof body.text === 'string' ? body.text : (() => { throw new Error('Invalid MAX message text') })()
  if (text === null && attachments.length === 0 && isForwardOnly(message, body)) return { kind: 'ignored' }
  return {
    kind: 'message_created', senderId: String(message.sender.user_id), recipientId: String(message.recipient.user_id),
    messageId, occurredAt, text, attachments,
  }
}

function normalizeAttachment(value: unknown) {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('Invalid MAX attachment')
  // Unsupported provider kinds are ignored at the ingress boundary. Supported image/file/video
  // shapes are validated strictly so no transient URL/token can enter the encrypted event.
  if (value.type !== 'image' && value.type !== 'file' && value.type !== 'video') return { kind: 'file' as const, providerAttachmentId: `unsupported:${value.type}`, filename: null, declaredSize: null }
  if (!isRecord(value.payload)) throw new Error('Invalid MAX attachment payload')
  const payload = value.payload
  const rawProviderAttachmentId = value.type === 'image' ? payload.photo_id : value.type === 'video' ? payload.id : payload.fileId
  const providerAttachmentId = normalizeProviderAttachmentId(rawProviderAttachmentId, value.type === 'image' || value.type === 'video')
  if (!providerAttachmentId) {
    throw new Error('Invalid MAX attachment identity')
  }
  if (typeof payload.token !== 'string' || payload.token.length === 0 || typeof payload.url !== 'string' || !isHttpsUrl(payload.url)) {
    throw new Error('Invalid MAX attachment transport')
  }
  if (value.type === 'image') return { kind: 'image' as const, providerAttachmentId }
  if (value.type === 'video') {
    const durationSeconds = value.duration ?? payload.duration
    const width = value.width ?? payload.width
    const height = value.height ?? payload.height
    if (durationSeconds !== undefined && durationSeconds !== null && !isPositiveSafeInteger(durationSeconds)) throw new Error('Invalid MAX video duration')
    if (width !== undefined && width !== null && !isPositiveSafeInteger(width)) throw new Error('Invalid MAX video width')
    if (height !== undefined && height !== null && !isPositiveSafeInteger(height)) throw new Error('Invalid MAX video height')
    return { kind: 'video' as const, providerAttachmentId, durationSeconds: durationSeconds ?? null, width: width ?? null, height: height ?? null }
  }
  const filename = value.filename === undefined || value.filename === null ? null : value.filename
  if (filename !== null && (typeof filename !== 'string' || filename.length === 0 || [...filename].length > 512)) throw new Error('Invalid MAX filename')
  const declaredSize = value.size === undefined || value.size === null ? null : value.size
  if (declaredSize !== null && (!isNonNegativeSafeInteger(declaredSize) || declaredSize === 0)) throw new Error('Invalid MAX attachment size')
  return { kind: 'file' as const, providerAttachmentId, filename, declaredSize }
}

function normalizeProviderAttachmentId(value: unknown, numeric: boolean) {
  if (numeric) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
    if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 20) return value
    return null
  }
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null
}

function isForwardOnly(message: Record<string, unknown>, body: Record<string, unknown>) {
  return (isRecord(message.link) && message.link.type === 'forward') ||
    (isRecord(body.link) && body.link.type === 'forward')
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

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { return new URL(value).protocol === 'https:' } catch { return false }
}
