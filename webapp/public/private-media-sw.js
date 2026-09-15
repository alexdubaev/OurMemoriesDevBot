const PRIVATE_MEDIA_PATH = /^\/api\/v1\/families\/[0-9a-f-]+\/media\/(?:[0-9a-f-]+|max-videos\/[0-9a-f-]+)\/content$/i

let accessToken = null

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'private-media-token') return
  accessToken = typeof event.data.token === 'string' ? event.data.token : null
  event.ports[0]?.postMessage({ ready: true })
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !PRIVATE_MEDIA_PATH.test(url.pathname)) return
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return
  event.respondWith(fetchPrivateMedia(event.request))
})

async function fetchPrivateMedia(request) {
  if (!accessToken) {
    return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(request.url, {
    method: request.method,
    headers,
    credentials: 'include',
    cache: 'no-store',
  })
}
