import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  createMaxHostBridge,
  type HostBridge,
} from '../src/platform/max/host-bridge'

const invite = 'invite_abcdefghijklmnopqrstuvwxyzABCDEF'

describe('MAX HostBridge', () => {
  test('serializes valid opaque invite tokens with the configured MAX bot username', () => {
    const token = 'A'.repeat(32)
    const bridge = createMaxHostBridge({ WebApp: { initData: 'query_id=signed' } }, { maxBotUsername: 'OurMemoriesMaxBot' })

    expect(bridge.inviteLink(token)).toBe(`https://max.ru/OurMemoriesMaxBot?startapp=invite_${token}`)
    expect(bridge.inviteLink('A'.repeat(128))).toBe(`https://max.ru/OurMemoriesMaxBot?startapp=invite_${'A'.repeat(128)}`)
    expect(bridge.inviteLink('A'.repeat(31))).toBeNull()
    expect(bridge.inviteLink('A'.repeat(129))).toBeNull()
    expect(bridge.inviteLink('A'.repeat(31) + '.')).toBeNull()
    expect(bridge.inviteLink(token)).not.toContain('familyId')
    expect(bridge.inviteLink(token)).not.toContain('userId')
    expect(bridge.inviteLink(token)).not.toContain('childId')
  })

  test('fails closed when MAX username configuration is missing or invalid', () => {
    const bridge = createMaxHostBridge({ WebApp: { initData: 'query_id=signed' } })
    expect(bridge.inviteLink('A'.repeat(32))).toBeNull()
    expect(createMaxHostBridge({}, { maxBotUsername: 'bad-name' }).inviteLink('A'.repeat(32))).toBeNull()
    expect(createMaxHostBridge({}, { maxBotUsername: 'x'.repeat(33) }).inviteLink('A'.repeat(32))).toBeNull()
  })

  test('loads the documented MAX SDK before the React production bootstrap', () => {
    const indexPath = fileURLToPath(new URL('../index.html', import.meta.url))
    const html = readFileSync(indexPath, 'utf8')
    const maxSdk = 'https://st.max.ru/js/max-web-app.js'
    expect(html).toContain(`src="${maxSdk}"`)
    expect(html.indexOf(maxSdk)).toBeLessThan(html.indexOf('/src/main.tsx'))
  })

  test('passes raw initData through and exposes only safe metadata', () => {
    const rawInitData = `query_id=signed&start_param=${invite}`
    const bridge: HostBridge = createMaxHostBridge({
      WebApp: {
        initData: rawInitData,
        initDataUnsafe: { user: { id: 999 } },
        version: '1.0',
        platform: 'ios',
        colorScheme: 'dark',
        ready: () => undefined,
        close: () => undefined,
      },
    })

    expect(bridge.kind).toBe('max')
    expect(bridge.isAvailable).toBe(true)
    expect(bridge.initData()).toBe(rawInitData)
    expect(bridge.rawAuthData()).toBe(rawInitData)
    expect(bridge.inviteToken()).toBe('abcdefghijklmnopqrstuvwxyzABCDEF')
    expect(bridge.metadata()).toEqual({
      version: '1.0',
      platform: 'ios',
      colorScheme: 'dark',
      safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
      contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 },
    })
    expect(bridge.metadata()).not.toHaveProperty('initDataUnsafe')
  })

  test('missing and partial globals remain safe and never use initDataUnsafe', () => {
    const missing = createMaxHostBridge(undefined)
    expect(missing.isAvailable).toBe(false)
    expect(missing.initData()).toBeNull()
    expect(missing.inviteToken()).toBeNull()
    expect(() => missing.ready()).not.toThrow()
    expect(() => missing.close()).not.toThrow()
    expect(() => missing.back()).not.toThrow()

    const partial = createMaxHostBridge({ WebApp: { initDataUnsafe: { user: { id: 1 } } } })
    expect(partial.isAvailable).toBe(false)
    expect(partial.initData()).toBeNull()
    expect(() => partial.ready()).not.toThrow()
    expect(() => partial.close()).not.toThrow()
    expect(() => partial.openBot()).not.toThrow()
    expect(partial.openTelegramVideo('https://example.test')).toBe(false)
  })

  test('does not even read initDataUnsafe while selecting authentication input', () => {
    const webApp = {
      initData: 'query_id=signed',
      ready: () => undefined,
    }
    Object.defineProperty(webApp, 'initDataUnsafe', {
      get: () => { throw new Error('unsafe MAX data must not be read') },
    })
    const bridge = createMaxHostBridge({ WebApp: webApp })
    expect(bridge.initData()).toBe('query_id=signed')
    expect(bridge.rawAuthData()).toBe('query_id=signed')
  })

  test('rejects invalid signed start params and uses MAX startapp only as fallback', () => {
    const invalid = createMaxHostBridge({
      location: { search: `?startapp=${invite}` },
      WebApp: { initData: 'query_id=signed&start_param=invite_too-short' },
    })
    expect(invalid.inviteToken()).toBeNull()

    const fallback = createMaxHostBridge({
      location: { search: `?startapp=${invite}` },
      WebApp: { initData: 'query_id=signed' },
    })
    expect(fallback.inviteToken()).toBe('abcdefghijklmnopqrstuvwxyzABCDEF')
  })

  test('accepts the full 128-character signed invite token', () => {
    const token = 'Z'.repeat(128)
    const bridge = createMaxHostBridge({ WebApp: { initData: `query_id=signed&start_param=invite_${token}` } })
    expect(bridge.inviteToken()).toBe(token)
  })

  test('blocks query fallback when signed start_param is duplicated', () => {
    const token = 'Z'.repeat(32)
    const bridge = createMaxHostBridge({
      location: { search: `?startapp=invite_${token}` },
      WebApp: { initData: `query_id=signed&start_param=invite_${token}&start_param=invite_${token}` },
    })
    expect(bridge.inviteToken()).toBeNull()
  })
})
