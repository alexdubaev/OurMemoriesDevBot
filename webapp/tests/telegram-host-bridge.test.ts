import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  createBrowserDevHostBridge,
  createTelegramHostBridge,
  type HostBridge,
} from '../src/platform/telegram/host-bridge'

describe('Telegram HostBridge', () => {
  test('loads Telegram WebApp API before the React production bootstrap', () => {
    const indexPath = fileURLToPath(new URL('../index.html', import.meta.url))
    const html = readFileSync(indexPath, 'utf8')
    const telegramSdk = 'https://telegram.org/js/telegram-web-app.js?63'
    const reactBootstrap = '/src/main.tsx'

    expect(html).toContain(`src="${telegramSdk}"`)
    expect(html.indexOf(telegramSdk)).toBeLessThan(html.indexOf(reactBootstrap))
  })

  test('subscribes to Telegram BackButton without leaking stale callbacks', () => {
    const handlers = new Set<() => void>()
    let showCalls = 0
    let hideCalls = 0
    const bridge = createTelegramHostBridge({
      Telegram: {
        WebApp: {
          BackButton: {
            show: () => { showCalls += 1 },
            hide: () => { hideCalls += 1 },
            onClick: (handler: () => void) => { handlers.add(handler) },
            offClick: (handler: () => void) => { handlers.delete(handler) },
          },
        },
      },
    })
    let backCalls = 0

    const unsubscribeFirst = bridge.onBack(() => { backCalls += 1 })
    expect(showCalls).toBe(1)
    expect(handlers.size).toBe(1)
    handlers.forEach((handler) => handler())
    expect(backCalls).toBe(1)

    unsubscribeFirst()
    unsubscribeFirst()
    expect(hideCalls).toBe(1)
    expect(handlers.size).toBe(0)
    handlers.forEach((handler) => handler())
    expect(backCalls).toBe(1)

    const unsubscribeSecond = bridge.onBack(() => { backCalls += 1 })
    expect(showCalls).toBe(2)
    expect(handlers.size).toBe(1)
    unsubscribeSecond()
    expect(hideCalls).toBe(2)
    expect(handlers.size).toBe(0)
  })

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
    expect(bridge.inviteToken()).toBeNull()
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
    bridge.openInvite('opaque-token_1')
    expect(bridge.openTelegramVideo('https://t.me/OurMemoriesDevBot?start=watch_abcdefghijklmnopqrstuvwxyzABCDEF')).toBe(true)
    expect(bridge.openTelegramVideo('https://evil.example/?start=watch_abcdefghijklmnopqrstuvwxyzABCDEF')).toBe(false)
    expect(readyCalls).toBe(1)
    expect(closeCalls).toBe(1)
    expect(backCalls).toBe(1)
    expect(openedLinks).toEqual([
      'https://t.me/OurMemoriesDevBot',
      'https://t.me/OurMemoriesDevBot?start=invite_opaque-token_1',
      'https://t.me/OurMemoriesDevBot?start=watch_abcdefghijklmnopqrstuvwxyzABCDEF',
    ])
  })

  test('reads only an opaque invite token from signed initData for server-side acceptance', () => {
    const bridge = createTelegramHostBridge({
      Telegram: { WebApp: { initData: 'query_id=signed&start_param=invite_abcdefghijklmnopqrstuvwxyzABCDEF' } },
    })
    expect(bridge.inviteToken()).toBe('abcdefghijklmnopqrstuvwxyzABCDEF')
  })

  test('serializes valid opaque invite tokens to the existing Telegram link', () => {
    const token = 'A'.repeat(32)
    const bridge = createTelegramHostBridge({ Telegram: { WebApp: {} } })
    expect(bridge.inviteLink(token)).toBe(`https://t.me/OurMemoriesDevBot?startapp=invite_${token}`)
    expect(bridge.inviteLink('A'.repeat(31))).toBeNull()
    expect(bridge.inviteLink('A'.repeat(129))).toBeNull()
  })

  test('reads an opaque start context passed to a Mini App button URL', () => {
    const bridge = createTelegramHostBridge({
      location: { search: '?tgWebAppStartParam=invite_abcdefghijklmnopqrstuvwxyzABCDEF' },
      Telegram: { WebApp: { initData: 'query_id=signed' } },
    })
    expect(bridge.inviteToken()).toBe('abcdefghijklmnopqrstuvwxyzABCDEF')
  })

  test('rejects a start payload that exceeds Telegram bot deep-link limits', () => {
    const bridge = createTelegramHostBridge({
      Telegram: { WebApp: { initData: `query_id=signed&start_param=invite_${'a'.repeat(58)}` } },
    })
    expect(bridge.inviteToken()).toBeNull()
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
    expect(() => bridge.openInvite('opaque-token')).not.toThrow()
    expect(bridge.openTelegramVideo('https://t.me/OurMemoriesDevBot?start=watch_abcdefghijklmnopqrstuvwxyzABCDEF')).toBe(false)
    expect(bridge.inviteLink('A'.repeat(32))).toBeNull()
  })
})
