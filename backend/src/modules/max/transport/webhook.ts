import { createHash, timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { MaxInboundEvent } from '../application/ports'
import { normalizeMaxUpdate } from './update-mapping'

export function createMaxWebhook(options: {
  secret: string
  bodyLimitBytes: number
  acceptUpdate: (event: MaxInboundEvent) => Promise<unknown>
  diagnosticLogger?: (marker: string, record: unknown) => void
}) {
  const routes = new Hono()
  routes.use('/webhooks/max', async (c, next) => {
    if (!sameSecret(c.req.header('X-Max-Bot-Api-Secret'), options.secret)) return c.json({ ok: false }, 401)
    await next()
  })
  routes.use('/webhooks/max', bodyLimit({
    maxSize: options.bodyLimitBytes,
    onError: (c) => c.json({ ok: false }, 413),
  }))
  routes.post('/webhooks/max', async (c) => {
    const declaredLength = Number(c.req.header('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > options.bodyLimitBytes) return c.json({ ok: false }, 413)
    const body = await c.req.text()
    if (Buffer.byteLength(body, 'utf8') > options.bodyLimitBytes) return c.json({ ok: false }, 413)
    let update: unknown
    try { update = JSON.parse(body) } catch { return c.json({ ok: false }, 400) }
    const diagnostic = describeUnsupportedMaxMediaUpdate(update)
    if (diagnostic) {
      try { (options.diagnosticLogger ?? console.info)('MAX_VOICE_DIAGNOSTIC_CAPTURE', diagnostic) } catch { /* diagnostics must not affect webhook handling */ }
    }
    let event: ReturnType<typeof normalizeMaxUpdate>
    try { event = normalizeMaxUpdate(update) } catch { return c.json({ ok: false }, 400) }
    if (event.kind === 'ignored') return c.json({ ok: true }, 200)
    try {
      await options.acceptUpdate(event)
      return c.json({ ok: true }, 200)
    } catch {
      return c.json({ ok: false }, 503)
    }
  })
  return routes
}

function describeUnsupportedMaxMediaUpdate(input: unknown) {
  if (!isRecord(input) || input.update_type !== 'message_created' || !isRecord(input.message)) return null
  const message = input.message
  const body = isRecord(message.body) ? message.body : null
  const attachments = Array.isArray(body?.attachments) ? body.attachments : null
  if (!attachments || !attachments.some(isUnsupportedAttachment)) return null
  return {
    updateType: 'message_created',
    timestamp: isSafeTimestamp(input.timestamp) ? input.timestamp : null,
    hasMessage: true,
    hasMessageBody: body !== null,
    hasSender: isRecord(message.sender),
    hasRecipient: isRecord(message.recipient),
    messageIdSha256: typeof body?.mid === 'string' ? sha256(body.mid) : null,
    messageFields: keysOf(message),
    bodyFields: body ? keysOf(body) : [],
    attachments: attachments.map(describeAttachment),
  }
}

function describeAttachment(input: unknown, index: number) {
  const attachment = isRecord(input) ? input : null
  const payload = attachment && isRecord(attachment.payload) ? attachment.payload : null
  const sourceLikeFieldNames = [...new Set([
    ...keysOf(attachment).filter(isSourceLikeFieldName),
    ...keysOf(payload).filter(isSourceLikeFieldName),
  ])].sort()
  const url = sourceValue(attachment, payload, 'url')
  const token = sourceValue(attachment, payload, 'token')
  return {
    index,
    type: safeAttachmentType(attachment?.type),
    fields: keysOf(attachment),
    hasPayload: payload !== null,
    payloadFields: keysOf(payload),
    mimeType: safeMimeType(attachment, payload),
    filenameExtension: filenameExtension(metadataString(attachment, payload, ['filename', 'file_name', 'name'])),
    duration: metadataNumber(attachment, payload, ['duration', 'duration_ms', 'durationMs']),
    size: metadataNumber(attachment, payload, ['size', 'file_size', 'fileSize']),
    hasUrl: url !== undefined,
    urlScheme: urlScheme(url),
    hasToken: token !== undefined,
    tokenLength: typeof token === 'string' ? token.length : null,
    hasId: hasSourceField(attachment, payload, 'id'),
    hasAttachmentId: hasSourceField(attachment, payload, 'attachmentId'),
    hasMediaId: hasSourceField(attachment, payload, 'mediaId'),
    hasFileId: hasSourceField(attachment, payload, 'fileId'),
    hasDownloadUrl: hasSourceField(attachment, payload, 'downloadUrl'),
    sourceLikeFieldNames,
  }
}

function isUnsupportedAttachment(input: unknown) {
  return !isRecord(input) || !['image', 'file', 'video'].includes(input.type as string)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keysOf(value: Record<string, unknown> | null) {
  return value ? Object.keys(value).sort() : []
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function safeAttachmentType(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) return null
  return /token|secret|bearer|authorization/i.test(value) ? null : value
}

function sourceValue(attachment: Record<string, unknown> | null, payload: Record<string, unknown> | null, field: string) {
  return payload?.[field] ?? attachment?.[field]
}

function hasSourceField(attachment: Record<string, unknown> | null, payload: Record<string, unknown> | null, field: string) {
  return Object.hasOwn(payload ?? {}, field) || Object.hasOwn(attachment ?? {}, field)
}

function metadataString(attachment: Record<string, unknown> | null, payload: Record<string, unknown> | null, fields: string[]) {
  for (const field of fields) {
    const value = sourceValue(attachment, payload, field)
    if (typeof value === 'string' && value.length <= 256) return value
  }
  return null
}

function safeMimeType(attachment: Record<string, unknown> | null, payload: Record<string, unknown> | null) {
  const value = metadataString(attachment, payload, ['mime_type', 'mime', 'content_type', 'contentType'])
  if (!value) return null
  const normalized = value.toLowerCase()
  return [
    'audio/aac', 'audio/amr', 'audio/flac', 'audio/m4a', 'audio/mp4', 'audio/mpeg',
    'audio/ogg', 'audio/opus', 'audio/wav', 'audio/webm',
    'image/gif', 'image/heic', 'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm',
  ].includes(normalized) ? normalized : null
}

function metadataNumber(attachment: Record<string, unknown> | null, payload: Record<string, unknown> | null, fields: string[]) {
  for (const field of fields) {
    const value = sourceValue(attachment, payload, field)
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return null
}

function filenameExtension(filename: string | null) {
  if (!filename) return null
  const extension = /\.([a-z0-9]{1,16})$/i.exec(filename)?.[1]
  return extension ? extension.toLowerCase() : null
}

function urlScheme(value: unknown) {
  if (typeof value !== 'string') return null
  try { return new URL(value).protocol.replace(/:$/, '') } catch { return null }
}

function isSourceLikeFieldName(field: string) {
  return /url|token|id|file|media|attachment|download|source/i.test(field)
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function sameSecret(received: string | undefined, expected: string) {
  if (!received) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
