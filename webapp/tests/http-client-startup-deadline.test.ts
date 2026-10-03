import { afterEach, expect, test } from 'bun:test'
import { HttpClient } from '../src/platform/api/http-client'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('startup deadline rejects when fetch never settles and aborts its transport', async () => {
  let signal: AbortSignal | undefined
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined
    return new Promise<Response>(() => undefined)
  }) as typeof fetch

  await expect(new HttpClient('').request('/startup', { parse: (value: unknown) => value } as never, { timeoutMs: 10 })).rejects.toThrow('Request timed out')
  expect(signal?.aborted).toBe(true)
})

test('startup deadline includes response body parsing', async () => {
  globalThis.fetch = (async () => ({
    ok: true,
    json: () => new Promise<unknown>(() => undefined),
  } as Response)) as typeof fetch

  await expect(new HttpClient('').request('/startup', { parse: (value: unknown) => value } as never, { timeoutMs: 10 })).rejects.toThrow('Request timed out')
})

test('caller abort settles even when fetch ignores its abort signal', async () => {
  let signal: AbortSignal | undefined
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined
    return new Promise<Response>(() => undefined)
  }) as typeof fetch
  const controller = new AbortController()
  const request = new HttpClient('').request('/startup', { parse: (value: unknown) => value } as never, { timeoutMs: 1000, signal: controller.signal })
  controller.abort(new DOMException('superseded', 'AbortError'))
  await expect(request).rejects.toThrow('superseded')
  expect(signal?.aborted).toBe(true)
})
