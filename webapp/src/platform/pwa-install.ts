export type BeforeInstallPromptLike = Event & {
  prompt: () => Promise<void> | void
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

export type PwaInstallSnapshot = { available: boolean; installed: boolean; standalone: boolean }

export class PwaInstallController {
  private event: BeforeInstallPromptLike | null = null
  private installed: boolean
  private standalone: boolean
  private snapshot: PwaInstallSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(host: Window) {
    const nav = host.navigator as Navigator & { standalone?: boolean }
    this.standalone = Boolean(nav.standalone || host.matchMedia?.('(display-mode: standalone)').matches)
    this.installed = this.standalone
    this.snapshot = this.createSnapshot()
    host.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt as EventListener)
    host.addEventListener('appinstalled', this.onInstalled)
  }

  getSnapshot = (): PwaInstallSnapshot => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  prompt = (): Promise<'accepted' | 'dismissed' | 'unavailable' | 'error'> => {
    const event = this.event
    if (!event || this.installed) return Promise.resolve('unavailable')
    this.event = null
    this.notify()
    try {
      const promptResult = event.prompt()
      return Promise.resolve(promptResult).then(async () => {
        const choice = await event.userChoice
        if (choice.outcome === 'accepted') this.notify()
        return choice.outcome
      }).catch(() => 'error')
    } catch {
      return Promise.resolve('error')
    }
  }

  private readonly onBeforeInstallPrompt = (rawEvent: Event) => {
    const event = rawEvent as BeforeInstallPromptLike
    if (typeof event.prompt !== 'function' || !event.userChoice || this.installed) return
    event.preventDefault()
    this.event = event
    this.notify()
  }

  private readonly onInstalled = () => {
    this.event = null
    this.installed = true
    this.standalone = true
    this.notify()
  }

  private notify() {
    this.snapshot = this.createSnapshot()
    for (const listener of this.listeners) listener()
  }

  private createSnapshot(): PwaInstallSnapshot {
    return { available: this.event !== null && !this.installed, installed: this.installed, standalone: this.standalone }
  }
}

let defaultController: PwaInstallController | null = null

/** Call before React mounts so an early beforeinstallprompt event cannot be missed. */
export function installPwaPromptListeners(host: Window = window) {
  defaultController ??= new PwaInstallController(host)
  return defaultController
}

export function createPwaInstallController(host: Window) {
  return new PwaInstallController(host)
}

export function createPwaInstallUrl(origin: string, familyId: string | null) {
  try {
    const url = new URL('/', origin)
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== origin) return null
    url.searchParams.set('install', '1')
    if (familyId && isUuid(familyId)) url.searchParams.set('familyId', familyId)
    return url.href
  } catch {
    return null
  }
}

export function readPwaInstallIntent(location: { pathname: string; search: string }) {
  if (location.pathname !== '/') return null
  const params = new URLSearchParams(location.search)
  const installs = params.getAll('install')
  if (installs.length !== 1 || installs[0] !== '1') return null
  const familyIds = params.getAll('familyId')
  if (familyIds.length > 1 || (familyIds.length === 1 && !isUuid(familyIds[0] ?? ''))) return null
  return { familyId: familyIds[0] ?? null }
}

export function isPwaInstallDismissed(storage: Pick<Storage, 'getItem'>) {
  try { return storage.getItem('memoly:pwa-install-dismissed-v1') === '1' } catch { return false }
}

export function setPwaInstallDismissed(storage: Pick<Storage, 'setItem' | 'removeItem'>, dismissed: boolean) {
  try {
    if (dismissed) storage.setItem('memoly:pwa-install-dismissed-v1', '1')
    else storage.removeItem('memoly:pwa-install-dismissed-v1')
  } catch { /* Private browsing may deny local storage; the prompt remains usable for this view. */ }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && value !== '00000000-0000-0000-0000-000000000000'
}
