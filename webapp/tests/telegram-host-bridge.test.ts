import { describe, expect, test } from 'bun:test'

import {
  createBrowserDevHostBridge,
  createTelegramHostBridge,
  type HostBridge,
} from '../src/platform/telegram/host-bridge'

describe('Telegram HostBridge', () => {
  test('exposes verified-exchange input and only safe host metadata', () => {
    let readyCalls = 0
    let closeCalls = 0
    let backCalls = 0
    const openedLinks: string[] = []
    const bridge: HostBridge = createTelegramHostBridge({
      history: { back: () => { backCalls += 1 } },
      Telegram: {
        WebApp: {
          initData: 'query_id=signed',
          initDataUnsafe: { user: { id: 999, username: 'must-not-be-trusted' } },
          version: '8.0',
          platform: 'ios',
          colorScheme: 'dark',
          safeAreaInset: { top: 12, right: 0, bottom: 8, left: 0 },
          contentSafeAreaInset: { top: 16, right: 0, bottom: 8, left: 0 },
          ready: () => { readyCalls += 1 },
          close: () => { closeCalls += 1 },
          openTelegramLink: (url: string) => { openedLinks.push(url) },
        },
      },
    })

    expect(bridge.initData()).toBe('query_id=signed')
    expect(bridge.metadata()).toEqual({
      version: '8.0',
      platform: 'ios',
      colorScheme: 'dark',
      safeAreaInset: { top: 12, right: 0, bottom: 8, left: 0 },
      contentSafeAreaInset: { top: 16, right: 0, bottom: 8, left: 0 },
    })
    expect(bridge.metadata()).not.toHaveProperty('initDataUnsafe')
    expect(bridge.getInsets()).toEqual({ top: 16, right: 0, bottom: 8, left: 0 })
    bridge.ready()
    bridge.close()
    bridge.back()
    bridge.openBot()
    expect(readyCalls).toBe(1)
    expect(closeCalls).toBe(1)
    expect(backCalls).toBe(1)
    expect(openedLinks).toEqual(['https://t.me/OurMemoriesDevBot'])
  })

  test('provides a safe browser-dev adapter without inventing Telegram authentication', () => {
    const bridge: HostBridge = createBrowserDevHostBridge({
      colorScheme: 'dark',
      insets: { top: 20, right: 1, bottom: 12, left: 1 },
    })
    expect(bridge.isAvailable).toBe(false)
    expect(bridge.initData()).toBeNull()
    expect(bridge.metadata()).toEqual({
      version: 'browser-dev',
      platform: 'browser',
      colorScheme: 'dark',
      safeAreaInset: { top: 20, right: 1, bottom: 12, left: 1 },
      contentSafeAreaInset: { top: 20, right: 1, bottom: 12, left: 1 },
    })
    expect(bridge.getInsets()).toEqual({ top: 20, right: 1, bottom: 12, left: 1 })
    expect(() => bridge.ready()).not.toThrow()
    expect(() => bridge.close()).not.toThrow()
    expect(() => bridge.back()).not.toThrow()
    expect(() => bridge.openBot()).not.toThrow()
  })
})
