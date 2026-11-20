import { afterEach, expect, test } from 'bun:test'

import { ApiRequestError } from '../src/platform/api'
import { HttpClient } from '../src/platform/api/http-client'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

// Image revalidation relies on two transport facts: the validator header reaches fetch, and a
// 304 surfaces as an ApiRequestError with that status rather than as an image body.
test('raw requests carry If-None-Match and report a 304 as status 304', async () => {
  const sent: Array<string | null> = []
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers).get('If-None-Match'))
    return new Response(null, { status: 304, headers: { ETag: '"v1"' } })
  }) as typeof fetch
  const error = await new HttpClient('').raw('/api/v1/families/x/media/y/content?variant=preview', { headers: { 'If-None-Match': '"v1"' } })
    .then(() => null, (reason: unknown) => reason)
  expect(sent).toEqual(['"v1"'])
  expect(error).toBeInstanceOf(ApiRequestError)
  expect((error as ApiRequestError).status).toBe(304)
})
