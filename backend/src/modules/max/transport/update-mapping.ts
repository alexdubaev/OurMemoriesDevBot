import type { MaxAcceptedEvent } from '../application/ports'

export type MaxMappedUpdate = MaxAcceptedEvent | { kind: 'ignored' }

export function normalizeMaxUpdate(input: unknown, rawBody?: string): MaxMappedUpdate {
  if (!isRecord(input) || typeof input.update_type !== 'string') throw new Error('Invalid MAX update')
  if (isLifecycleType(input.update_type)) {
    if (rawBody === undefined) throw new Error('Missing raw MAX lifecycle update body')
    let rawUpdate: unknown
    try { rawUpdate = JSON.parse(rawBody) } catch { throw new Error('Invalid raw MAX lifecycle update body') }
    if (!isRecord(rawUpdate) || rawUpdate.update_type !== input.update_type || !isNonNegativeSafeInteger(input.timestamp)) {
      throw new Error('Invalid MAX lifecycle update envelope')
    }
    if (input.update_type === 'bot_added' || input.update_type === 'bot_removed') {
      const chatId = readRawTopLevelInteger(rawBody, 'chat_id')
      const rawUser = readRawTopLevelObject(rawBody, 'user')
      const userId = rawUser === null ? null : readRawTopLevelInteger(rawUser, 'user_id')
      if (chatId === null || !isInt64(chatId) || !isRecord(input.user) || userId === null || !isInt64(userId) ||
          typeof input.is_channel !== 'boolean') {
        throw new Error('Invalid MAX bot_added update')
      }
    }
    return { kind: input.update_type, rawPayload: rawBody }
  }
  if (input.update_type !== 'message_created' && input.update_type !== 'bot_started' && input.update_type !== 'message_callback') return { kind: 'ignored' }
  const timestamp = input.timestamp
  if (!isNonNegativeSafeInteger(timestamp)) throw new Error('Invalid MAX timestamp')
  const occurredAt = new Date(timestamp).toISOString()
  if (input.update_type === 'bot_started') return normalizeBotStarted(input, occurredAt)
  if (input.update_type === 'message_callback') return normalizeChoiceCallback(input, occurredAt)
  return normalizeMessage(input, occurredAt)
}

function readRawTopLevelInteger(json: string, targetKey: string): string | null {
  let index = skipWhitespace(json, 0)
  if (json[index] !== '{') return null
  index++
  let found: string | null = null
  while (index < json.length) {
    index = skipWhitespace(json, index)
    if (json[index] === '}') return found
    if (json[index] !== '"') return null
    const keyEnd = scanJsonString(json, index)
    if (keyEnd === null) return null
    let key: unknown
    try { key = JSON.parse(json.slice(index, keyEnd)) } catch { return null }
    index = skipWhitespace(json, keyEnd)
    if (json[index] !== ':') return null
    index = skipWhitespace(json, index + 1)
    const valueStart = index
    if (key === targetKey) {
      const match = /^-?(?:0|[1-9][0-9]*)/.exec(json.slice(valueStart))
      if (!match) return null
      const token = match[0]
      index += token.length
      index = skipWhitespace(json, index)
      if (json[index] !== ',' && json[index] !== '}') return null
      if (found !== null) return null
      found = token
    } else {
      index = skipJsonValue(json, index)
      if (index < 0) return null
    }
    index = skipWhitespace(json, index)
    if (json[index] === ',') { index++; continue }
    if (json[index] === '}') return found
    return null
  }
  return null
}

function readRawTopLevelObject(json: string, targetKey: string): string | null {
  let index = skipWhitespace(json, 0)
  if (json[index] !== '{') return null
  index++
  let found: string | null = null
  while (index < json.length) {
    index = skipWhitespace(json, index)
    if (json[index] === '}') return found
    if (json[index] !== '"') return null
    const keyEnd = scanJsonString(json, index)
    if (keyEnd === null) return null
    let key: unknown
    try { key = JSON.parse(json.slice(index, keyEnd)) } catch { return null }
    index = skipWhitespace(json, keyEnd)
    if (json[index] !== ':') return null
    index = skipWhitespace(json, index + 1)
    const valueStart = index
    const valueEnd = skipJsonValue(json, valueStart)
    if (valueEnd < 0) return null
    if (key === targetKey) {
      if (json[valueStart] !== '{' || found !== null) return null
      found = json.slice(valueStart, valueEnd)
    }
    index = skipWhitespace(json, valueEnd)
    if (json[index] === ',') { index++; continue }
    if (json[index] === '}') return found
    return null
  }
  return null
}

function scanJsonString(json: string, start: number): number | null {
  let escaped = false
  for (let index = start + 1; index < json.length; index++) {
    if (escaped) { escaped = false; continue }
    if (json[index] === '\\') { escaped = true; continue }
    if (json[index] === '"') return index + 1
  }
  return null
}

function skipJsonValue(json: string, start: number): number {
  if (json[start] === '"') return scanJsonString(json, start) ?? -1
  if (json[start] !== '{' && json[start] !== '[') {
    let index = start
    while (index < json.length && json[index] !== ',' && json[index] !== '}') index++
    return index
  }
  const stack = [json[start] === '{' ? '}' : ']']
  let index = start + 1
  while (index < json.length && stack.length > 0) {
    const char = json[index]
    if (char === '"') {
      const end = scanJsonString(json, index)
      if (end === null) return -1
      index = end
      continue
    }
    if (char === '{') stack.push('}')
    else if (char === '[') stack.push(']')
    else if (char === stack[stack.length - 1]) stack.pop()
    index++
  }
  return stack.length === 0 ? index : -1
}

function skipWhitespace(json: string, start: number) {
  let index = start
  while (index < json.length && /\s/.test(json[index]!)) index++
  return index
}

function isInt64(value: string) {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) return false
  const integer = BigInt(value)
  return integer >= -9_223_372_036_854_775_808n && integer <= 9_223_372_036_854_775_807n
}

function isLifecycleType(value: string): value is 'bot_added' | 'bot_removed' | 'bot_admin_permissions_changed' {
  return value === 'bot_added' || value === 'bot_removed' || value === 'bot_admin_permissions_changed'
}

function normalizeChoiceCallback(input: Record<string, unknown>, occurredAt: string): MaxMappedUpdate {
  if (!isRecord(input.callback) || !isRecord(input.callback.user) || !isPositiveSafeInteger(input.callback.user.user_id)
    || typeof input.callback.callback_id !== 'string' || input.callback.callback_id.length === 0
    || typeof input.callback.payload !== 'string' || input.callback.payload.length > 512) throw new Error('Invalid MAX callback')
  if (!isRecord(input.message) || !isRecord(input.message.recipient) || input.message.recipient.chat_type !== 'dialog'
    || !isPositiveSafeInteger(input.message.recipient.user_id)) return { kind: 'ignored' }
  return { kind: 'family_choice', callbackId: input.callback.callback_id, payload: input.callback.payload,
    userId: String(input.callback.user.user_id), occurredAt }
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
  // MAX always supplies all Recipient keys. The chat_type discriminator identifies direct dialogs;
  // their chat_id may be null (legacy shape) or a positive numeric id (live shape).
  if (!Object.hasOwn(message.recipient, 'chat_id') || !Object.hasOwn(message.recipient, 'chat_type') ||
      !Object.hasOwn(message.recipient, 'user_id')) throw new Error('Invalid MAX recipient')
  if (message.recipient.chat_type !== 'dialog' ||
      (message.recipient.chat_id !== null && !isPositiveSafeInteger(message.recipient.chat_id))) return { kind: 'ignored' }
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
  // TODO(post-MVP MAX history import): Preserve provider attachment order for history after controlled validation confirms it matches authored/display order.
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
  // Unsupported provider kinds are ignored at the ingress boundary. Supported image/file/video/audio
  // shapes are validated strictly; only the confirmed audio URL is retained transiently in the encrypted event
  // because MAX can omit native audio from its later message lookup.
  if (value.type !== 'image' && value.type !== 'file' && value.type !== 'video' && value.type !== 'audio') return { kind: 'file' as const, providerAttachmentId: `unsupported:${value.type}`, filename: null, declaredSize: null }
  if (!isRecord(value.payload)) throw new Error('Invalid MAX attachment payload')
  const payload = value.payload
  const rawProviderAttachmentId = value.type === 'image' ? payload.photo_id : value.type === 'file' ? payload.fileId : payload.id
  const providerAttachmentId = value.type === 'file' || value.type === 'audio'
    ? normalizeFileAttachmentId(rawProviderAttachmentId)
    : normalizeProviderAttachmentId(rawProviderAttachmentId, true)
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
  if (value.type === 'audio') return { kind: 'voice' as const, providerAttachmentId, url: payload.url }
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

function normalizeFileAttachmentId(value: unknown) {
  if (typeof value === 'number') return isPositiveSafeInteger(value) ? String(value) : null
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
