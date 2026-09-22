import { expect, test } from 'bun:test'

import { createMaxWebhook } from './transport/webhook'

const secret = 'test-only-webhook-secret'
const valid = JSON.stringify({ update_type: 'bot_started', timestamp: 1700000000000, chat_id: 1, user: { user_id: 2 }, payload: null })

function route(
  acceptUpdate: (event: unknown) => Promise<unknown>,
  bodyLimitBytes = 512,
  diagnosticLogger?: (marker: string, record: unknown) => void,
) {
  return createMaxWebhook({ secret, bodyLimitBytes, acceptUpdate, diagnosticLogger })
}

test('checks secret before parsing malformed JSON and bounds declared/actual UTF-8 bytes', async () => {
  let accepts = 0
  const app = route(async () => { accepts += 1 })
  expect((await app.request('/webhooks/max', { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': 'wrong' }, body: '{' })).status).toBe(401)
  expect((await app.request('/webhooks/max', { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Length': '999' }, body: valid })).status).toBe(413)
  expect((await app.request('/webhooks/max', { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': secret }, body: '🙂'.repeat(200) })).status).toBe(413)
  expect(accepts).toBe(0)
})

test('returns 400 for malformed JSON/supported events and 200 ignored for unsupported events', async () => {
  let accepts = 0
  const app = route(async () => { accepts += 1 })
  const headers = { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' }
  expect((await app.request('/webhooks/max', { method: 'POST', headers, body: '{' })).status).toBe(400)
  expect((await app.request('/webhooks/max', { method: 'POST', headers, body: JSON.stringify({ update_type: 'bot_started', timestamp: 1, chat_id: 1 }) })).status).toBe(400)
  expect((await app.request('/webhooks/max', { method: 'POST', headers, body: JSON.stringify({ update_type: 'other', token: 'raw' }) })).status).toBe(200)
  expect(accepts).toBe(0)
})

test('accepts valid events before acknowledging and returns retryable failure when acceptance fails', async () => {
  let release: (() => void) | undefined
  let accepted = false
  const pending = new Promise<void>((resolve) => { release = resolve })
  const app = route(async () => { await pending; accepted = true })
  const request = app.request('/webhooks/max', { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': secret }, body: valid })
  await Promise.resolve()
  expect(accepted).toBe(false)
  release!()
  expect((await request).status).toBe(200)
  const failed = route(async () => { throw new Error('test failure') })
  expect((await failed.request('/webhooks/max', { method: 'POST', headers: { 'X-Max-Bot-Api-Secret': secret }, body: valid })).status).toBe(503)
})

test('logs only the audio URL hostname while preserving webhook acceptance', async () => {
  const diagnostics: Array<{ marker: string; record: unknown }> = []
  let accepts = 0
  const privateText = 'private family note'
  const privateToken = 'audio-bearer-token'
  const privatePath = '/private/audio.ogg'
  const privateQuery = 'signature=private'
  const temporaryUrl = `https://media.example.test${privatePath}?${privateQuery}`
  const app = route(
    async () => { accepts += 1 },
    8_192,
    (marker, record) => diagnostics.push({ marker, record }),
  )
  const response = await app.request('/webhooks/max', {
    method: 'POST',
    headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: { user_id: 1 },
        recipient: { chat_id: null, chat_type: 'dialog', user_id: 2 },
        body: {
          mid: 'provider-message-id',
          text: privateText,
          attachments: [{ type: 'audio', payload: { token: privateToken, url: temporaryUrl } }],
        },
      },
    }),
  })

  expect(response.status).toBe(200)
  expect(accepts).toBe(1)
  expect(diagnostics).toEqual([{
    marker: 'MAX_AUDIO_DIAGNOSTIC_CAPTURE',
    record: { timestamp: 1, hostname: 'media.example.test' },
  }])
  const serialized = JSON.stringify(diagnostics)
  expect(serialized).toContain('media.example.test')
  expect(serialized).not.toContain(temporaryUrl)
  expect(serialized).not.toContain(privateToken)
  expect(serialized).not.toContain(privatePath)
  expect(serialized).not.toContain(privateQuery)
  expect(serialized).not.toContain(privateText)
})

test('does not emit the legacy diagnostic alongside an audio diagnostic for mixed attachments', async () => {
  const diagnostics: Array<{ marker: string; record: unknown }> = []
  let accepts = 0
  const app = route(
    async () => { accepts += 1 },
    8_192,
    (marker, record) => diagnostics.push({ marker, record }),
  )
  const response = await app.request('/webhooks/max', {
    method: 'POST',
    headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: { user_id: 1 },
        recipient: { chat_id: null, chat_type: 'dialog', user_id: 2 },
        body: {
          mid: 'provider-message-id',
          text: 'private family note',
          attachments: [
            { type: 'voice', payload: { token: 'private-token', url: 'https://voice.example.test/private' } },
            { type: 'audio', payload: { token: 'private-audio-token', url: 'https://audio.example.test/private?signature=private' } },
          ],
        },
      },
    }),
  })

  expect(response.status).toBe(200)
  expect(accepts).toBe(1)
  expect(diagnostics).toEqual([{
    marker: 'MAX_AUDIO_DIAGNOSTIC_CAPTURE',
    record: { timestamp: 1, hostname: 'audio.example.test' },
  }])
})

test('captures only sanitized shape metadata for an unsupported MAX media attachment', async () => {
  const diagnostics: Array<{ marker: string; record: unknown }> = []
  const app = route(
    async () => undefined,
    8_192,
    (marker, record) => diagnostics.push({ marker, record }),
  )
  const privateText = 'a private family note'
  const privateToken = 'bearer-token-value'
  const temporaryUrl = 'https://media.example.test/private/audio.ogg?signature=private'
  const response = await app.request('/webhooks/max', {
    method: 'POST',
    headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: { user_id: 1 },
        recipient: { chat_id: null, chat_type: 'dialog', user_id: 2 },
        body: {
          mid: 'provider-message-id',
          text: privateText,
          attachments: [{
            type: 'voice',
            payload: {
              token: privateToken,
              url: temporaryUrl,
              mediaId: 'provider-media-id',
              mime_type: 'audio/ogg',
              duration: 7,
              size: 42,
            },
          }],
        },
      },
    }),
  })

  expect(response.status).toBe(200)
  expect(diagnostics).toHaveLength(1)
  expect(diagnostics[0]?.marker).toBe('MAX_VOICE_DIAGNOSTIC_CAPTURE')
  const serialized = JSON.stringify(diagnostics[0]?.record)
  expect(serialized).not.toContain(privateText)
  expect(serialized).not.toContain(privateToken)
  expect(serialized).not.toContain(temporaryUrl)
  expect(diagnostics[0]?.record).toEqual({
    updateType: 'message_created',
    timestamp: 1,
    hasMessage: true,
    hasMessageBody: true,
    hasSender: true,
    hasRecipient: true,
    messageIdSha256: '236e7e3eba1c76e7d8c0e05dbd613e3576339b1d540624274d3e129d73b790ea',
    messageFields: ['body', 'recipient', 'sender'],
    bodyFields: ['attachments', 'mid', 'text'],
    attachments: [{
      index: 0,
      type: 'voice',
      fields: ['payload', 'type'],
      hasPayload: true,
      payloadFields: ['duration', 'mediaId', 'mime_type', 'size', 'token', 'url'],
      mimeType: 'audio/ogg',
      filenameExtension: null,
      duration: 7,
      size: 42,
      hasUrl: true,
      urlScheme: 'https',
      hasToken: true,
      tokenLength: privateToken.length,
      hasId: false,
      hasAttachmentId: false,
      hasMediaId: true,
      hasFileId: false,
      hasDownloadUrl: false,
      sourceLikeFieldNames: ['mediaId', 'token', 'url'],
    }],
  })
})

test('preserves the exact unknown voice attachment type without raw transport values', async () => {
  const diagnostics: Array<{ marker: string; record: unknown }> = []
  const privateToken = 'voice-bearer-token'
  const temporaryUrl = 'https://media.example.test/private/voice?signature=private'
  const app = route(
    async () => undefined,
    8_192,
    (marker, record) => diagnostics.push({ marker, record }),
  )
  const response = await app.request('/webhooks/max', {
    method: 'POST',
    headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: { user_id: 1 },
        recipient: { chat_id: null, chat_type: 'dialog', user_id: 2 },
        body: {
          mid: 'provider-message-id',
          attachments: [{ type: 'voice_message', payload: { token: privateToken, url: temporaryUrl } }],
        },
      },
    }),
  })

  expect(response.status).toBe(200)
  expect(diagnostics[0]?.record).toMatchObject({ attachments: [{ type: 'voice_message' }] })
  const serialized = JSON.stringify(diagnostics[0]?.record)
  expect(serialized).not.toContain(privateToken)
  expect(serialized).not.toContain(temporaryUrl)
  expect(serialized).not.toContain('payload":{"token"')
})

test('does not log attacker-controlled attachment type or MIME strings', async () => {
  const diagnostics: Array<{ marker: string; record: unknown }> = []
  const privateType = 'voice private family note'
  const privateMime = 'audio/private family note'
  const app = route(
    async () => undefined,
    8_192,
    (marker, record) => diagnostics.push({ marker, record }),
  )
  const response = await app.request('/webhooks/max', {
    method: 'POST',
    headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: { user_id: 1 },
        recipient: { chat_id: null, chat_type: 'dialog', user_id: 2 },
        body: {
          mid: 'provider-message-id',
          attachments: [{ type: privateType, payload: { mime_type: privateMime } }],
        },
      },
    }),
  })

  expect(response.status).toBe(200)
  expect(diagnostics[0]?.record).toMatchObject({
    attachments: [{ type: null, mimeType: null }],
  })
  const serialized = JSON.stringify(diagnostics[0]?.record)
  expect(serialized).not.toContain(privateType)
  expect(serialized).not.toContain(privateMime)
})

test('swallows diagnostic logger failures and preserves webhook handling', async () => {
  let accepts = 0
  const app = route(
    async () => { accepts += 1 },
    8_192,
    () => { throw new Error('diagnostic sink unavailable') },
  )
  const response = await app.request('/webhooks/max', {
    method: 'POST',
    headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_type: 'message_created',
      timestamp: 1,
      message: {
        sender: { user_id: 1 },
        recipient: { chat_id: null, chat_type: 'dialog', user_id: 2 },
        body: {
          mid: 'provider-message-id',
          attachments: [{ type: 'voice', payload: {} }],
        },
      },
    }),
  })

  expect(response.status).toBe(200)
  expect(accepts).toBe(1)
})
