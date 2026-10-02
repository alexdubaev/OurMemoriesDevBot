let currentAccessToken: string | null = null
let currentUserId: string | null = null
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

export function syncPrivateMediaAccessToken(accessToken: string | null, userId: string | null = currentUserId) {
  currentAccessToken = accessToken
  currentUserId = userId
  void ensurePrivateMediaAccess()
}

export async function privateMediaSource(path: string) {
  await ensurePrivateMediaAccess()
  return currentAccessToken && await bootstrapMediaSession(path) ? path : null
}

async function ensurePrivateMediaAccess() {
  if (!('serviceWorker' in navigator)) return null
  try {
    registrationPromise ??= registerPrivateMediaWorker()
    const registration = await registrationPromise
    if (!registration) return null
    await sendToken(registration, currentAccessToken, currentUserId)
    return registration
  } catch {
    return null
  }
}

async function registerPrivateMediaWorker() {
  const registration = await navigator.serviceWorker.register('/private-media-sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        resolve()
      }, { once: true })
    })
  }
  return registration
}

async function sendToken(registration: ServiceWorkerRegistration, token: string | null, userId: string | null) {
  const workers = new Set([navigator.serviceWorker.controller, registration.active].filter((worker): worker is ServiceWorker => Boolean(worker)))
  await Promise.all([...workers].map((worker) => new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    const timeout = window.setTimeout(resolve, 2_000)
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    worker.postMessage({ type: 'private-media-token', token, userId }, [channel.port2])
  })))
}

async function bootstrapMediaSession(path: string) {
  const familyId = /^\/api\/v1\/families\/([0-9a-f-]{36})\/media\//i.exec(path)?.[1]
  if (!familyId || !currentAccessToken) return false
  try {
    const response = await fetch(`/api/v1/families/${familyId}/media/playback-session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentAccessToken}` },
      credentials: 'include',
    })
    return response.ok
  } catch {
    return false
  }
}
