import type {
  HostBridge,
  TelegramHostMetadata,
  TelegramInsets,
} from '../host-bridge'

type MaxWebApp = {
  initData?: unknown
  version?: unknown
  platform?: unknown
  colorScheme?: unknown
  safeAreaInset?: unknown
  contentSafeAreaInset?: unknown
  ready?: unknown
  close?: unknown
}

type BrowserHost = {
  WebApp?: unknown
  history?: { back?: unknown }
  location?: { search?: unknown }
}

export type MaxHostBridgeOptions = { maxBotUsername?: string }

const zeroInsets: TelegramInsets = { top: 0, right: 0, bottom: 0, left: 0 }

export function createMaxHostBridge(host: unknown, options: MaxHostBridgeOptions = {}): HostBridge {
  const browserHost = isRecord(host) ? host as BrowserHost : null
  const webApp = isRecord(browserHost?.WebApp) ? browserHost.WebApp as MaxWebApp : null
  const available = isMeaningfulMaxWebApp(host)

  return {
    kind: 'max',
    isAvailable: available,
    initData: () => rawInitData(webApp),
    rawAuthData: () => rawInitData(webApp),
    inviteToken: () => {
      const signed = startParamResult(rawInitData(webApp))
      if (signed.present) return inviteTokenFromStartParam(signed.value)
      return inviteTokenFromSearch(browserHost?.location?.search)
    },
    inviteLink: (rawToken) => createMaxInviteLink(rawToken, options.maxBotUsername),
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
    onBack: () => () => undefined,
    // MAX does not expose a Telegram bot/deep-link capability in this boundary.
    openBot: () => undefined,
    openTelegramVideo: () => false,
    openInvite: () => undefined,
    getInsets: () => normalizedInsets(webApp),
  }
}

/** A raw initData string alone is not enough to identify MAX; require a documented surface too. */
export function isMeaningfulMaxWebApp(host: unknown): boolean {
  if (!isRecord(host) || !isRecord(host.WebApp)) return false
  const webApp = host.WebApp
  const raw = webApp.initData
  if (typeof raw !== 'string' || raw.trim().length === 0) return false

  return typeof webApp.ready === 'function'
    || typeof webApp.close === 'function'
    || typeof webApp.version === 'string'
    || typeof webApp.platform === 'string'
    || typeof webApp.colorScheme === 'string'
}

function rawInitData(webApp: MaxWebApp | null) {
  return typeof webApp?.initData === 'string' && webApp.initData.length > 0
    ? webApp.initData
    : null
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

function normalizedInsets(webApp: MaxWebApp | null): TelegramInsets {
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

function startParamResult(initData: string | null) {
  if (!initData) return { present: false, value: null as string | null }
  const params = new URLSearchParams(initData)
  const values = params.getAll('start_param')
  return { present: values.length > 0, value: values.length === 1 ? values[0] ?? null : null }
}

function inviteTokenFromSearch(search: unknown) {
  if (typeof search !== 'string') return null
  return inviteTokenFromStartParam(new URLSearchParams(search).get('startapp'))
}

function inviteTokenFromStartParam(startParam: string | null) {
  if (!startParam?.startsWith('invite_')) return null
  const token = startParam.slice('invite_'.length)
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null
}

function createMaxInviteLink(rawToken: string, username: string | undefined) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(rawToken)) return null
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null
  const payload = `invite_${rawToken}`
  if (payload.length > 512) return null
  return `https://max.ru/${username}?startapp=${payload}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
