import { expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const uuid = '11111111-1111-4111-8111-111111111111'
type WorkerEvent = {
  data?: { type?: string; userId?: string | null; token?: string | null }
  source?: { id?: string }
  ports?: Array<{ postMessage: (value: unknown) => void }>
  request?: Request
  clientId?: string
  respondWith?: (value: Promise<Response>) => void
}

async function createWorkerHarness() {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const requests: Array<{ url: string; method?: string; authorization: string | null; cache: RequestCache; range: string | null }> = []
  const source = await readFile(new URL('../public/private-media-sw.js', import.meta.url), 'utf8')
  const self = {
    location: { origin: 'https://memoly.test' },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener),
  }
  runInNewContext(source, {
    self, URL, Map, Headers, Response,
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method, authorization: new Headers(init.headers).get('Authorization'), cache: init.cache!, range: new Headers(init.headers).get('Range') })
      return new Response('ok', { status: 200 })
    },
  })
  const sendCredentials = (clientId: string, userId: string | null, token: string | null) => {
    listeners.get('message')!({
      data: { type: 'private-media-token', userId, token },
      source: { id: clientId },
      ports: [{ postMessage: () => undefined }],
    })
  }
  const request = async (clientId: string, path: string, headers: HeadersInit = {}, method = 'GET') => {
    let response: Promise<Response> | undefined
    listeners.get('fetch')!({
      request: new Request(`https://memoly.test${path}`, { headers, method }),
      clientId,
      respondWith: (value: Promise<Response>) => { response = value },
    })
    return response ? await response : null
  }
  return { requests, sendCredentials, request }
}

it('scopes bearer tokens per page and only revalidates explicit non-Range image requests', async () => {
  const worker = await createWorkerHarness()
  worker.sendCredentials('tab-a', 'user-a', 'token-a')
  worker.sendCredentials('tab-b', 'user-b', 'token-b')
  const imagePath = `/api/v1/families/${uuid}/media/${uuid}/content?variant=display`
  await worker.request('tab-a', imagePath, { 'X-Private-Media-Purpose': 'image' })
  await worker.request('tab-b', imagePath, { 'X-Private-Media-Purpose': 'image' })
  await worker.request('tab-a', imagePath, { 'X-Private-Media-Purpose': 'image', Range: 'bytes=0-1' })
  await worker.request('tab-a', `/api/v1/families/${uuid}/media/max-videos/${uuid}/content`)
  await worker.request('tab-a', `/api/v1/families/${uuid}/media/${uuid}/content?variant=playback`)
  await worker.request('tab-a', `/api/v1/families/${uuid}/media/${uuid}/content?variant=original`)
  await worker.request('tab-a', imagePath, { Authorization: 'Bearer explicit-token', 'X-Private-Media-Purpose': 'image' })
  expect(worker.requests.map(({ authorization, cache, range }) => ({ authorization, cache, range }))).toEqual([
    { authorization: 'Bearer token-a', cache: 'no-cache', range: null },
    { authorization: 'Bearer token-b', cache: 'no-cache', range: null },
    { authorization: 'Bearer token-a', cache: 'no-store', range: 'bytes=0-1' },
    { authorization: 'Bearer token-a', cache: 'no-store', range: null },
    { authorization: 'Bearer token-a', cache: 'no-store', range: null },
    { authorization: 'Bearer token-a', cache: 'no-store', range: null },
    { authorization: 'Bearer explicit-token', cache: 'no-cache', range: null },
  ])
  worker.sendCredentials('tab-a', null, null)
  expect((await worker.request('tab-a', imagePath, { 'X-Private-Media-Purpose': 'image' }))?.status).toBe(401)
})

it('preserves existing authorization on worker restart and denies requests without a client credential', async () => {
  const worker = await createWorkerHarness()
  const imagePath = `/api/v1/families/${uuid}/media/${uuid}/content?variant=display`
  expect((await worker.request('new-tab', imagePath, { Authorization: 'Bearer restored-token' }))?.status).toBe(200)
  expect(worker.requests[0]?.authorization).toBe('Bearer restored-token')
  expect(worker.requests[0]?.cache).toBe('no-store')
  expect(await worker.request('empty-tab', imagePath)).toMatchObject({ status: 401 })
  expect(worker.requests).toHaveLength(1)
})

it('keeps HEAD media requests on the authenticated no-store path', async () => {
  const worker = await createWorkerHarness()
  worker.sendCredentials('tab', 'user', 'token')
  await worker.request('tab', `/api/v1/families/${uuid}/media/${uuid}/content?variant=original`, {}, 'HEAD')
  expect(worker.requests).toMatchObject([{ method: 'HEAD', authorization: 'Bearer token', cache: 'no-store' }])
})
