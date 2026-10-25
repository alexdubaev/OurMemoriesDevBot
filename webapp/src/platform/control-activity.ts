import type { AuthenticatedTransport } from './api'
import type { HostBridge } from './host-bridge'

const ACTIVITY_INTERVAL_MS = 60_000
const lastSentByUser = new Map<string, number>()

export function controlActivitySurface(hostBridge: Pick<HostBridge, 'kind'>, view: Window = window): 'max_mini_app'|'pwa'|'browser'|null {
  if (hostBridge.kind === 'max') return 'max_mini_app'
  if (hostBridge.kind !== 'browser') return null
  const standalone = view.matchMedia?.('(display-mode: standalone)').matches || (view.navigator as Navigator & { standalone?: boolean }).standalone === true
  return standalone ? 'pwa' : 'browser'
}

export function attachControlActivity({ transport, hostBridge, userId, familyId }: {
  transport: AuthenticatedTransport
  hostBridge: Pick<HostBridge, 'kind'>
  userId: string
  familyId: string|null
}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined
  const surface = controlActivitySurface(hostBridge)
  if (!surface) return () => undefined
  let disposed = false
  const report = () => {
    if (disposed || document.visibilityState !== 'visible') return
    const now = Date.now()
    const key = `${userId}:${familyId ?? 'no-family'}`
    const previous = lastSentByUser.get(key) ?? 0
    if (now - previous < ACTIVITY_INTERVAL_MS) return
    for (const [oldKey, sentAt] of lastSentByUser) if (now-sentAt >= ACTIVITY_INTERVAL_MS*5) lastSentByUser.delete(oldKey)
    lastSentByUser.set(key, now)
    void transport.raw('/api/v1/activity', {
      method: 'POST',
      body: familyId ? { surface, familyId } : { surface },
      timeoutMs: 5_000,
    }).catch(() => undefined)
  }
  const onTrustedInteraction = (event: Event) => { if (event.isTrusted) report() }
  const onVisibility = () => { if (document.visibilityState === 'visible') report() }
  report()
  document.addEventListener('pointerdown', onTrustedInteraction, { passive: true, capture: true })
  document.addEventListener('keydown', onTrustedInteraction, { capture: true })
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', report)
  return () => {
    disposed = true
    document.removeEventListener('pointerdown', onTrustedInteraction, true)
    document.removeEventListener('keydown', onTrustedInteraction, true)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', report)
  }
}
