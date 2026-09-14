import { createMaxHostBridge, isMeaningfulMaxWebApp } from './max/host-bridge'
import { createBrowserDevHostBridge, createTelegramHostBridge } from './telegram/host-bridge'

export type HostKind = 'max' | 'telegram' | 'browser'

export type TelegramInsets = { top: number; right: number; bottom: number; left: number }

export type TelegramHostMetadata = {
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  safeAreaInset: TelegramInsets
  contentSafeAreaInset: TelegramInsets
}

export type HostBridge = {
  readonly kind: HostKind
  readonly isAvailable: boolean
  /** Raw signed platform launch data. Never use an unsafe parsed user object for auth. */
  initData(): string | null
  rawAuthData(): string | null
  inviteToken(): string | null
  inviteLink(rawToken: string): string | null
  metadata(): TelegramHostMetadata | null
  ready(): void
  close(): void
  back(): void
  onBack(handler: () => void): () => void
  openBot(): void
  openTelegramVideo(deepLink: string): boolean
  openInvite(rawToken: string): void
  getInsets(): TelegramInsets
}

export type BrowserDevHostOptions = {
  colorScheme?: 'light' | 'dark'
  insets?: Partial<TelegramInsets>
}

export type HostBridgeOptions = {
  maxBotUsername?: string
}

/** Selects one host deterministically. MAX wins only for a meaningful MAX WebApp surface. */
export function createHostBridge(
  host: unknown = typeof window === 'undefined' ? undefined : window,
  options: HostBridgeOptions = {},
): HostBridge {
  if (isMeaningfulMaxWebApp(host)) return createMaxHostBridge(host, options)
  if (hasTelegramWebApp(host)) return createTelegramHostBridge(host)
  return createBrowserDevHostBridge()
}

function hasTelegramWebApp(host: unknown) {
  if (!isRecord(host) || !isRecord(host.Telegram)) return false
  return isRecord(host.Telegram.WebApp)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export { createBrowserDevHostBridge, createTelegramHostBridge }
