export type TelegramInsets = { top: number; right: number; bottom: number; left: number }

export type TelegramHostMetadata = {
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  safeAreaInset: TelegramInsets
  contentSafeAreaInset: TelegramInsets
}

export type HostBridge = {
  readonly isAvailable: boolean
  initData(): string | null
  inviteToken(): string | null
  metadata(): TelegramHostMetadata | null
  ready(): void
  close(): void
  back(): void
  openBot(): void
  openTelegramVideo(deepLink: string): void
  openInvite(rawToken: string): void
  getInsets(): TelegramInsets
}

export type BrowserDevHostOptions = {
  colorScheme?: 'light' | 'dark'
  insets?: Partial<TelegramInsets>
}

type TelegramWebApp = {
  initData?: unknown
  version?: unknown
  platform?: unknown
  colorScheme?: unknown
  safeAreaInset?: unknown
  contentSafeAreaInset?: unknown
  ready?: unknown
  close?: unknown
  openTelegramLink?: unknown
}

type BrowserHost = {
  Telegram?: unknown
  history?: { back?: unknown }
}

const botUrl = 'https://t.me/OurMemoriesDevBot'
const zeroInsets: TelegramInsets = { top: 0, right: 0, bottom: 0, left: 0 }

export function createTelegramHostBridge(host: unknown): HostBridge {
  const webApp = readWebApp(host)
  const browserHost = isRecord(host) ? host as BrowserHost : null
  return {
    isAvailable: webApp !== null,
    initData: () => typeof webApp?.initData === 'string' && webApp.initData.length > 0
      ? webApp.initData
      : null,
    inviteToken: () => inviteTokenFromInitData(webApp?.initData),
    metadata: (): TelegramHostMetadata | null => {
      if (!webApp) return null
      return {
        version: stringValue(webApp.version),
        platform: stringValue(webApp.platform),
        colorScheme: webApp.colorScheme === 'dark' ? 'dark' : 'light',
        safeAreaInset: insets(webApp.safeAreaInset),
        contentSafeAreaInset: insets(webApp.contentSafeAreaInset),
      }
    },
    ready: () => {
      if (typeof webApp?.ready === 'function') webApp.ready()
    },
    close: () => {
      if (typeof webApp?.close === 'function') webApp.close()
    },
    back: () => {
      if (typeof browserHost?.history?.back === 'function') browserHost.history.back()
    },
    openBot: () => {
      if (typeof webApp?.openTelegramLink === 'function') webApp.openTelegramLink(botUrl)
    },
    openTelegramVideo: (deepLink) => {
      // The API creates this link after the Family + Memory guard. Do not compose bot links or
      // accept any other host: the payload is an opaque server-side navigation pointer.
      if (typeof webApp?.openTelegramLink === 'function' && isTelegramBotLink(deepLink)) {
        webApp.openTelegramLink(deepLink)
      }
    },
    openInvite: (rawToken) => {
      if (typeof webApp?.openTelegramLink === 'function') {
        webApp.openTelegramLink(`${botUrl}?startapp=invite_${encodeURIComponent(rawToken)}`)
      }
    },
    getInsets: () => normalizedInsets(webApp),
  }
}

export function createBrowserDevHostBridge(
  options: BrowserDevHostOptions = {},
): HostBridge {
  const safeInsets = insets(options.insets)
  const metadata: TelegramHostMetadata = {
    version: 'browser-dev',
    platform: 'browser',
    colorScheme: options.colorScheme === 'dark' ? 'dark' : 'light',
    safeAreaInset: safeInsets,
    contentSafeAreaInset: safeInsets,
  }
  return {
    isAvailable: false,
    initData: () => null,
    inviteToken: () => null,
    metadata: () => metadata,
    ready: () => undefined,
    close: () => undefined,
    back: () => undefined,
    openBot: () => undefined,
    openTelegramVideo: () => undefined,
    openInvite: () => undefined,
    getInsets: () => safeInsets,
  }
}

function readWebApp(host: unknown): TelegramWebApp | null {
  if (!isRecord(host) || !isRecord(host.Telegram) || !isRecord(host.Telegram.WebApp)) return null
  return host.Telegram.WebApp
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function insets(value: unknown): TelegramInsets {
  if (!isRecord(value)) return zeroInsets
  return {
    top: finiteNumber(value.top),
    right: finiteNumber(value.right),
    bottom: finiteNumber(value.bottom),
    left: finiteNumber(value.left),
  }
}

function normalizedInsets(webApp: TelegramWebApp | null): TelegramInsets {
  if (!webApp) return zeroInsets
  const safe = insets(webApp.safeAreaInset)
  const content = insets(webApp.contentSafeAreaInset)
  return {
    top: Math.max(safe.top, content.top),
    right: Math.max(safe.right, content.right),
    bottom: Math.max(safe.bottom, content.bottom),
    left: Math.max(safe.left, content.left),
  }
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function inviteTokenFromInitData(initData: unknown) {
  if (typeof initData !== 'string' || initData.length === 0) return null
  const startParam = new URLSearchParams(initData).get('start_param')
  if (!startParam?.startsWith('invite_')) return null
  const token = startParam.slice('invite_'.length)
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTelegramBotLink(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 't.me' &&
      url.pathname === '/OurMemoriesDevBot' && /^watch_[A-Za-z0-9_-]{32}$/.test(url.searchParams.get('start') ?? '')
  } catch {
    return false
  }
}
