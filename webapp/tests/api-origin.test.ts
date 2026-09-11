import { afterEach, expect, test } from 'bun:test'

import { HttpClient } from '../src/platform/api/http-client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('uses a same-origin API path when VITE_API_URL is absent', async () => {
  let requestUrl = ''
  globalThis.fetch = async (input) => {
    requestUrl = String(input)
    return new Response('{}', { status: 200 })
  }

  await new HttpClient().raw('/api/v1/auth/telegram')

  expect(requestUrl).toBe('/api/v1/auth/telegram')
  expect(requestUrl).not.toContain('localhost')
  expect(requestUrl).not.toContain('127.0.0.1')
})

test('uses an explicitly configured API origin', async () => {
  let requestUrl = ''
  globalThis.fetch = async (input) => {
    requestUrl = String(input)
    return new Response('{}', { status: 200 })
  }

  await new HttpClient('https://api.example.test').raw('/api/health')

  expect(requestUrl).toBe('https://api.example.test/api/health')
})
