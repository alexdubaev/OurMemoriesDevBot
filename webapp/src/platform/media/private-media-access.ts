let currentAccessToken: string | null = null
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null

export function syncPrivateMediaAccessToken(accessToken: string | null) {
  currentAccessToken = accessToken
  void ensurePrivateMediaAccess()
}

export async function privateMediaSource(path: string) {
  const registration = await ensurePrivateMediaAccess()
  return registration && currentAccessToken ? path : null
}

async function ensurePrivateMediaAccess() {
  if (!('serviceWorker' in navigator)) return null
  registrationPromise ??= registerPrivateMediaWorker()
  const registration = await registrationPromise
  if (!registration) return null
  await sendToken(registration, currentAccessToken)
  return registration
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

async function sendToken(registration: ServiceWorkerRegistration, token: string | null) {
  const workers = new Set([navigator.serviceWorker.controller, registration.active].filter((worker): worker is ServiceWorker => Boolean(worker)))
  await Promise.all([...workers].map((worker) => new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    const timeout = window.setTimeout(resolve, 2_000)
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    worker.postMessage({ type: 'private-media-token', token }, [channel.port2])
  })))
}
