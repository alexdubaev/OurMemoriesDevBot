import { expect, test } from 'bun:test'

import { createMaxWebhook } from './transport/webhook'

const secret = 'test-only-webhook-secret'
const valid = JSON.stringify({ update_type: 'bot_started', timestamp: 1700000000000, chat_id: 1, user: { user_id: 2 }, payload: null })

function route(acceptUpdate: (event: unknown) => Promise<unknown>, bodyLimitBytes = 512) {
  return createMaxWebhook({ secret, bodyLimitBytes, acceptUpdate })
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

test('forwards the exact raw lifecycle update to acceptance instead of acknowledging it as unknown', async () => {
  const rawBody = '{"update_type":"bot_added","timestamp":1700000000000,"chat_id":9223372036854775807,"is_channel":true,"user":{"user_id":42}}'
  let accepted: unknown
  const app = route(async (event) => { accepted = event })
  const response = await app.request('/webhooks/max', {
    method: 'POST',
    headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' },
    body: rawBody,
  })
  expect(response.status).toBe(200)
  expect(accepted).toEqual({ kind: 'bot_added', rawPayload: rawBody })
})
