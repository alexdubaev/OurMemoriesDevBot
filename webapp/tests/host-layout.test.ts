import { expect, test } from 'bun:test'

import { createMaxHostBridge } from '../src/platform/max/host-bridge'
import { readHostLayout, sameHostLayout, subscribeHostLayoutRefresh } from '../src/platform/host-layout'

test('host metadata wins over user agent and browser Android falls back to user agent', () => {
  expect(readHostLayout(maxBridge('iOS').bridge, 'Android').platform).toBe('ios')
  expect(readHostLayout(maxBridge('iPad').bridge, 'Android').platform).toBe('ios')
  expect(readHostLayout(maxBridge('Android').bridge, 'iPhone').platform).toBe('android')
  expect(readHostLayout(browserBridge(), 'Mozilla Android').platform).toBe('android')
  expect(readHostLayout(browserBridge(), 'Mozilla iPhone').platform).toBe('other')
})

test('resize refresh reads updated MAX insets using max(host safe, content safe) and cleans up', () => {
  const { bridge: max, webApp } = maxBridge('Android')
  const windowTarget = eventTarget()
  const viewportTarget = eventTarget()
  const target = Object.assign(windowTarget, { visualViewport: viewportTarget }) as unknown as Window
  let current = readHostLayout(max)
  const refresh = () => { current = readHostLayout(max) }
  const cleanup = subscribeHostLayoutRefresh(target, refresh)

  webApp.safeAreaInset.bottom = 24
  webApp.contentSafeAreaInset.bottom = 48
  windowTarget.dispatch('resize')
  expect(current.insets.bottom).toBe(48)
  expect(sameHostLayout(readHostLayout(max), current)).toBe(true)
  webApp.safeAreaInset.bottom = 64
  webApp.contentSafeAreaInset.bottom = 48
  windowTarget.dispatch('orientationchange')
  expect(current.insets.bottom).toBe(64)
  webApp.safeAreaInset.bottom = 80
  viewportTarget.dispatch('resize')
  expect(current.insets.bottom).toBe(80)

  cleanup()
  webApp.safeAreaInset.bottom = 96
  windowTarget.dispatch('resize')
  viewportTarget.dispatch('resize')
  expect(current.insets.bottom).toBe(80)
})

function maxBridge(platform: string) {
  const webApp = {
    initData: 'signed-init-data',
    platform,
    ready() {},
    safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
  }
  const bridge = createMaxHostBridge({ WebApp: webApp })
  return { bridge, webApp }
}

function browserBridge() {
  return { kind: 'browser', metadata: () => null, getInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) } as never
}

function eventTarget() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null) {
      if (!callback || typeof callback !== 'function') return
      const entries = listeners.get(type) ?? new Set()
      entries.add(callback as () => void)
      listeners.set(type, entries)
    },
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null) {
      if (callback && typeof callback === 'function') listeners.get(type)?.delete(callback as () => void)
    },
    dispatch(type: string) { for (const listener of listeners.get(type) ?? []) listener() },
  }
}
