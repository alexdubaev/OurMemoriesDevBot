import type { HostBridge, TelegramInsets } from './host-bridge'

export type HostLayoutPlatform = 'android' | 'ios' | 'other'
export type HostLayoutSnapshot = { platform: HostLayoutPlatform; insets: TelegramInsets }

export function readHostLayout(hostBridge: HostBridge, userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): HostLayoutSnapshot {
  const hostPlatform = hostBridge.metadata()?.platform.trim().toLowerCase()
  const platform = hostPlatform === 'android'
    ? 'android'
    : hostPlatform === 'ios' || hostPlatform === 'iphone' || hostPlatform === 'ipad'
      ? 'ios'
      : hostBridge.kind === 'browser' && /android/i.test(userAgent)
        ? 'android'
        : 'other'
  return { platform, insets: hostBridge.getInsets() }
}

export function sameHostLayout(left: HostLayoutSnapshot, right: HostLayoutSnapshot): boolean {
  return left.platform === right.platform
    && left.insets.top === right.insets.top
    && left.insets.right === right.insets.right
    && left.insets.bottom === right.insets.bottom
    && left.insets.left === right.insets.left
}

export function subscribeHostLayoutRefresh(target: Window, refresh: () => void): () => void {
  const viewport = target.visualViewport
  target.addEventListener('resize', refresh)
  target.addEventListener('orientationchange', refresh)
  viewport?.addEventListener('resize', refresh)
  return () => {
    target.removeEventListener('resize', refresh)
    target.removeEventListener('orientationchange', refresh)
    viewport?.removeEventListener('resize', refresh)
  }
}
