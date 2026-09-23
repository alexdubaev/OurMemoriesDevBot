import type {
  HostBridge,
  TelegramHostMetadata,
  TelegramInsets,
} from '../host-bridge'

type MaxWebApp = {
  initData?: unknown
  initDataUnsafe?: { start_param?: unknown }
  version?: unknown
  platform?: unknown
  colorScheme?: unknown
  safeAreaInset?: unknown
  contentSafeAreaInset?: unknown
  ready?: unknown
  close?: unknown
  openLink?: unknown
  openMaxLink?: unknown
}

type BrowserHost = {
  WebApp?: unknown
  history?: { back?: unknown }
  location?: { pathname?: unknown; search?: unknown }
}

export type MaxHostBridgeOptions = { maxBotUsername?: string }

export type MaxRuntimeDiagnostic = {
  hostDetected: boolean
  webAppPresent: boolean
  initDataPresent: boolean
  signedStartParamPresent: boolean
  signedStartParamValue: string | null
  initDataUnsafePresent: boolean
  unsafeStartParamPresent: boolean
  unsafeStartParamValue: string | null
  webAppStartParamPresent: boolean
  webAppStartParamValue: string | null
  locationPathname: string
  locationQueryKeys: string[]
  resolvedStartParam: string | null
  isMaxVideoUploadAcceptanceLaunch: boolean
}

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
    openBot: () => {
      // Direct bot navigation is supported by MAX openLink. openMaxLink is reserved for
      // mini-app startapp links and must not receive an arbitrary direct-chat URL.
      if (!webApp || !isValidMaxBotUsername(options.maxBotUsername) || typeof webApp.openLink !== 'function') return
      webApp.openLink.call(webApp, `https://max.ru/${options.maxBotUsername}`)
    },
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

/** The direct video composer is intentionally reachable only from the acceptance launch. */
export function isMaxVideoUploadAcceptanceLaunch(host: unknown): boolean {
  if (!isMeaningfulMaxWebApp(host)) return false
  const browserHost = isRecord(host) ? host as BrowserHost : null
  const webApp = isRecord(browserHost?.WebApp) ? browserHost.WebApp as MaxWebApp : null
  const signed = startParamResult(rawInitData(webApp))
  if (signed.present) return signed.value === 'max-video-upload-acceptance'

  const unsafe = unsafeStartParamResult(webApp)
  if (unsafe.present) return unsafe.value === 'max-video-upload-acceptance'

  const documented = queryStartParamResult(browserHost?.location?.search, 'WebAppStartParam')
  return documented.present && documented.value === 'max-video-upload-acceptance'
}

/** Returns an on-screen-only snapshot of safe MAX launch diagnostics. */
export function readMaxRuntimeDiagnostic(host: unknown): MaxRuntimeDiagnostic {
  const browserHost = isRecord(host) ? host as BrowserHost : null
  const webAppPresent = isRecord(browserHost?.WebApp)
  const webApp = webAppPresent ? browserHost?.WebApp as MaxWebApp : null
  const raw = rawInitData(webApp)
  const signed = startParamResult(raw)
  const unsafe = unsafeStartParamResult(webApp)
  const documented = queryStartParamResult(browserHost?.location?.search, 'WebAppStartParam')
  const resolved = resolveStartParam(signed, unsafe, documented)

  return {
    hostDetected: isMeaningfulMaxWebApp(host),
    webAppPresent,
    initDataPresent: raw !== null,
    signedStartParamPresent: signed.present,
    signedStartParamValue: signed.value,
    initDataUnsafePresent: isRecord(webApp?.initDataUnsafe),
    unsafeStartParamPresent: unsafe.present,
    unsafeStartParamValue: unsafe.value,
    webAppStartParamPresent: documented.present,
    webAppStartParamValue: documented.value,
    locationPathname: stringValue(browserHost?.location?.pathname),
    locationQueryKeys: queryKeys(browserHost?.location?.search),
    resolvedStartParam: resolved,
    isMaxVideoUploadAcceptanceLaunch: isMaxVideoUploadAcceptanceLaunch(host),
  }
}

export function isMaxRuntimeDiagnosticLaunch(host: unknown): boolean {
  if (!isMeaningfulMaxWebApp(host)) return false
  const diagnostic = readMaxRuntimeDiagnostic(host)
  if (diagnostic.resolvedStartParam === 'max-start-param-debug') return true
  const browserHost = isRecord(host) ? host as BrowserHost : null
  const internalDebug = queryStartParamResult(browserHost?.location?.search, 'startapp')
  return internalDebug.present && internalDebug.value === 'max-start-param-debug'
}

export function shouldShowMaxRuntimeDiagnostic(hostKind: HostBridge['kind'], host: unknown): boolean {
  return hostKind === 'max' && isMaxRuntimeDiagnosticLaunch(host)
}

/** Returns only the validated browser pairing challenge carried by signed MAX launch data. */
export function maxBrowserLinkChallengeId(host: unknown): string | null {
  if (!isMeaningfulMaxWebApp(host)) return null
  const browserHost = isRecord(host) ? host as BrowserHost : null
  const webApp = isRecord(browserHost?.WebApp) ? browserHost.WebApp as MaxWebApp : null
  const signed = startParamResult(rawInitData(webApp))
  const match = signed.value?.match(/^browser_(\d{24})$/)
  return signed.present && match ? match[1] ?? null : null
}

export function createMaxBrowserLink(startParam: string, username: string | undefined) {
  if (!/^browser_\d{24}$/.test(startParam) || !isValidMaxBotUsername(username)) return null
  return `https://max.ru/${username}?startapp=${encodeURIComponent(startParam)}`
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
  return queryStartParamResult(initData, 'start_param')
}

function unsafeStartParamResult(webApp: MaxWebApp | null) {
  const value = webApp?.initDataUnsafe?.start_param
  return typeof value === 'string'
    ? { present: true, value }
    : { present: false, value: null as string | null }
}

function queryStartParamResult(search: unknown, name: string) {
  if (typeof search !== 'string') return { present: false, value: null as string | null }
  const values = new URLSearchParams(search).getAll(name)
  return { present: values.length > 0, value: values.length === 1 ? values[0] ?? null : null }
}

function resolveStartParam(
  signed: { present: boolean; value: string | null },
  unsafe: { present: boolean; value: string | null },
  documented: { present: boolean; value: string | null },
) {
  if (signed.present) return signed.value
  if (unsafe.present) return unsafe.value
  if (documented.present) return documented.value
  return null
}

function queryKeys(search: unknown) {
  if (typeof search !== 'string') return []
  return [...new Set([...new URLSearchParams(search).keys()])]
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
  if (!isValidMaxBotUsername(username)) return null
  const payload = `invite_${rawToken}`
  if (payload.length > 512) return null
  return `https://max.ru/${username}?startapp=${payload}`
}

function isValidMaxBotUsername(username: string | undefined) {
  return typeof username === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(username)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
