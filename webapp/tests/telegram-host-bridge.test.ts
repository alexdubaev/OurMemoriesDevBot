import { describe, expect, test } from 'bun:test'

import { createTelegramHostBridge } from '../src/platform/telegram/host-bridge'

describe('Telegram HostBridge', () => {
  test('exposes verified-exchange input and only safe host metadata', () => {
    let readyCalls = 0
    const bridge = createTelegramHostBridge({
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
    bridge.ready()
    expect(readyCalls).toBe(1)
  })

  test('degrades safely outside Telegram without inventing dev authentication', () => {
    const bridge = createTelegramHostBridge({})
    expect(bridge.isAvailable).toBe(false)
    expect(bridge.initData()).toBeNull()
    expect(bridge.metadata()).toBeNull()
    expect(() => bridge.ready()).not.toThrow()
  })
})
