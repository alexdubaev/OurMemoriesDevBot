import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'bun:test'

const source = readFileSync(new URL('../public/private-media-sw.js', import.meta.url), 'utf8')
const mediaUrl = 'https://memo.test/api/v1/families/11111111-1111-4111-8111-111111111111/media/22222222-2222-4222-8222-222222222222/content'
type WorkerTestEvent = {
  request?: Request
  data?: { type: string; token?: string }
  ports?: Array<{ postMessage(value: unknown): void }>
  respondWith?: (response: Promise<Response>) => void
}

function createWorker(fetchImpl: typeof fetch) {
  const listeners = new Map<string, (event: WorkerTestEvent) => void>()
  const self = {
    location: { origin: 'https://memo.test' },
    clients: { claim: async () => undefined },
    addEventListener(type: string, listener: (event: WorkerTestEvent) => void) { listeners.set(type, listener) },
    skipWaiting: async () => undefined,
  }
  runInNewContext(source, { self, URL, Headers, Response, fetch: fetchImpl })
  return {
    request(request: Request) {
      let response: Promise<Response> | null = null
      listeners.get('fetch')!({ request, respondWith(value) { response = value } })
      return response
    },
    setToken(token: string) {
      listeners.get('message')!({ data: { type: 'private-media-token', token }, ports: [] })
    },
  }
}

test('a restarted worker forwards a request Authorization header when its in-memory token is empty', async () => {
  let forwardedAuthorization: string | null = null
  const worker = createWorker(async (_input, init) => {
    forwardedAuthorization = new Headers(init?.headers).get('Authorization')
    return new Response('private image', { status: 200 })
  })

  const response = await worker.request(new Request(mediaUrl, {
    headers: { Authorization: 'Bearer request-token' },
  }))

  expect(response?.status).toBe(200)
  expect(forwardedAuthorization).toBe('Bearer request-token')
})

test('the worker keeps request authorization instead of replacing it with a stale in-memory token', async () => {
  let forwardedAuthorization: string | null = null
  const worker = createWorker(async (_input, init) => {
    forwardedAuthorization = new Headers(init?.headers).get('Authorization')
    return new Response(null, { status: 200 })
  })
  worker.setToken('stale-worker-token')

  await worker.request(new Request(mediaUrl, {
    headers: { Authorization: 'Bearer current-request-token' },
  }))

  expect(forwardedAuthorization).toBe('Bearer current-request-token')
})

test('a request without authorization is still denied when the worker has no token', async () => {
  let backendCalled = false
  const worker = createWorker(async () => {
    backendCalled = true
    return new Response(null, { status: 200 })
  })

  const response = await worker.request(new Request(mediaUrl))

  expect(response?.status).toBe(401)
  expect(backendCalled).toBe(false)
})
