export type TelegramInsets = { top: number; right: number; bottom: number; left: number }

export type TelegramHostMetadata = {
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  safeAreaInset: TelegramInsets
  contentSafeAreaInset: TelegramInsets
}

type TelegramWebApp = {
  initData?: unknown
  version?: unknown
  platform?: unknown
  colorScheme?: unknown
  safeAreaInset?: unknown
  contentSafeAreaInset?: unknown
  ready?: unknown
}

export function createTelegramHostBridge(host: unknown) {
  const webApp = readWebApp(host)
  return {
    isAvailable: webApp !== null,
    initData: () => typeof webApp?.initData === 'string' && webApp.initData.length > 0
      ? webApp.initData
      : null,
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
  if (!isRecord(value)) return { top: 0, right: 0, bottom: 0, left: 0 }
  return {
    top: finiteNumber(value.top),
    right: finiteNumber(value.right),
    bottom: finiteNumber(value.bottom),
    left: finiteNumber(value.left),
  }
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
