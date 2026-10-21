import { afterEach, describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { ApiRequestError, HttpClient } from '../src/platform/api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  mock.restore()
})

describe('HTTP Retry-After metadata', () => {
  it('exposes a numeric Retry-After value as a millisecond minimum', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: {
      code: 'RATE_LIMITED', message: 'Slow down', requestId: 'req-1',
    } }), { status: 429, headers: { 'Retry-After': '2.25', 'Content-Type': 'application/json' } }))) as typeof fetch

    await expect(new HttpClient().request('/comments', z.object({ ok: z.boolean() }))).rejects.toMatchObject<ApiRequestError>({ status: 429, retryAfterMs: 2250 })
  })

  it('keeps Retry-After metadata when the error body is not JSON', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }))) as typeof fetch

    await expect(new HttpClient().request('/comments', z.object({ ok: z.boolean() }))).rejects.toMatchObject({ status: 429, retryAfterMs: 0 })
  })
})
