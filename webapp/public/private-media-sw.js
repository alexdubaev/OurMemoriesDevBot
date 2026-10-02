const PRIVATE_MEDIA_PATH = /^\/api\/v1\/families\/[0-9a-f-]+\/media\/(?:[0-9a-f-]+|max-videos\/[0-9a-f-]+|avatars\/[0-9a-f-]+\/[0-9a-f-]+)\/(?:content|poster)$/i
const PRIVATE_IMAGE_PATH = /^\/api\/v1\/families\/[0-9a-f-]+\/media\/(?:[0-9a-f-]+\/content\?variant=(?:display|preview)|avatars\/[0-9a-f-]+\/[0-9a-f-]+\/content|max-videos\/[0-9a-f-]+\/poster)$/i
const clientCredentials = new Map()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'private-media-token' || !event.source?.id) return
  const clientId = event.source.id
  const token = typeof event.data.token === 'string' ? event.data.token : null
  const userId = typeof event.data.userId === 'string' ? event.data.userId : null
  if (token && userId) clientCredentials.set(clientId, { token, userId })
  else clientCredentials.delete(clientId)
  event.ports[0]?.postMessage({ ready: true })
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !PRIVATE_MEDIA_PATH.test(url.pathname)) return
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return
  event.respondWith(fetchPrivateMedia(event.request, event.clientId))
})

async function fetchPrivateMedia(request, clientId) {
  const headers = new Headers(request.headers)
  const credentials = clientCredentials.get(clientId)
  if (!headers.has('Authorization') && !credentials?.token) {
    return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${credentials.token}`)
  const imageRequest = request.method === 'GET'
    && !headers.has('Range')
    && headers.get('X-Private-Media-Purpose') === 'image'
    && PRIVATE_IMAGE_PATH.test(`${new URL(request.url).pathname}${new URL(request.url).search}`)
  return fetch(request.url, {
    method: request.method,
    headers,
    credentials: 'include',
    cache: imageRequest ? 'no-cache' : 'no-store',
  })
}
