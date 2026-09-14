import type { BrowserDevHostOptions, HostBridge, TelegramHostMetadata, TelegramInsets } from '../host-bridge'
export type { BrowserDevHostOptions, HostBridge, TelegramHostMetadata, TelegramInsets } from '../host-bridge'

type TelegramWebApp = {
  initData?: unknown
  version?: unknown
  platform?: unknown
  colorScheme?: unknown
  safeAreaInset?: unknown
  contentSafeAreaInset?: unknown
  ready?: unknown
  close?: unknown
  BackButton?: unknown
  openTelegramLink?: unknown
}

type BrowserHost = {
  Telegram?: unknown
  history?: { back?: unknown }
  location?: { search?: unknown }
}

const botUrl = 'https://t.me/OurMemoriesDevBot'
const zeroInsets: TelegramInsets = { top: 0, right: 0, bottom: 0, left: 0 }

export function createTelegramHostBridge(host: unknown): HostBridge {
  const webApp = readWebApp(host)
  const browserHost = isRecord(host) ? host as BrowserHost : null
  const backButton = isRecord(webApp?.BackButton) ? webApp.BackButton : null
  const subscribeBack = backButton?.onClick
  const unsubscribeBack = backButton?.offClick
  const showBack = backButton?.show
  const hideBack = backButton?.hide
  const backHandlers = new Set<() => void>()
  return {
    kind: 'telegram',
    isAvailable: webApp !== null,
    initData: () => typeof webApp?.initData === 'string' && webApp.initData.length > 0
      ? webApp.initData
      : null,
    rawAuthData: () => typeof webApp?.initData === 'string' && webApp.initData.length > 0
      ? webApp.initData
      : null,
    inviteToken: () => inviteTokenFromInitData(webApp?.initData) ?? inviteTokenFromSearch(browserHost?.location?.search),
    inviteLink: (rawToken) => createTelegramInviteLink(rawToken),
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
    onBack: (handler) => {
      if (!backButton || typeof subscribeBack !== 'function' || typeof unsubscribeBack !== 'function') {
        return () => undefined
      }
      let subscribed = true
      subscribeBack.call(backButton, handler)
      backHandlers.add(handler)
      if (backHandlers.size === 1 && typeof showBack === 'function') showBack.call(backButton)
      return () => {
        if (!subscribed) return
        subscribed = false
        unsubscribeBack.call(backButton, handler)
        backHandlers.delete(handler)
        if (backHandlers.size === 0 && typeof hideBack === 'function') hideBack.call(backButton)
      }
    },
    openBot: () => {
      if (typeof webApp?.openTelegramLink === 'function') webApp.openTelegramLink(botUrl)
    },
    openTelegramVideo: (deepLink) => {
      // The API creates this link after the Family + Memory guard. Do not compose bot links or
      // accept any other host: the payload is an opaque server-side navigation pointer.
      if (typeof webApp?.openTelegramLink === 'function' && isTelegramBotLink(deepLink)) {
        webApp.openTelegramLink(deepLink)
        return true
      }
      return false
    },
    openInvite: (rawToken) => {
      if (typeof webApp?.openTelegramLink === 'function') {
        webApp.openTelegramLink(`${botUrl}?start=invite_${encodeURIComponent(rawToken)}`)
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
    kind: 'browser',
    isAvailable: false,
    initData: () => null,
    rawAuthData: () => null,
    inviteToken: () => null,
    inviteLink: () => null,
    metadata: () => metadata,
    ready: () => undefined,
    close: () => undefined,
    back: () => undefined,
    onBack: () => () => undefined,
    openBot: () => undefined,
    openTelegramVideo: () => false,
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
  return inviteTokenFromStartParam(startParam)
}

function inviteTokenFromSearch(search: unknown) {
  if (typeof search !== 'string') return null
  return inviteTokenFromStartParam(new URLSearchParams(search).get('tgWebAppStartParam'))
}

function inviteTokenFromStartParam(startParam: string | null) {
  if (!startParam?.startsWith('invite_')) return null
  const token = startParam.slice('invite_'.length)
  return /^[A-Za-z0-9_-]{32,57}$/.test(token) ? token : null
}

function createTelegramInviteLink(rawToken: string) {
  if (!/^[A-Za-z0-9_-]{32,57}$/.test(rawToken)) return null
  const payload = `invite_${rawToken}`
  if (payload.length > 512) return null
  return `${botUrl}?startapp=${payload}`
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
