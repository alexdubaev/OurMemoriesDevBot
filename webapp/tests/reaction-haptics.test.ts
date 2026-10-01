import { describe, expect, test } from 'bun:test'

import type { HostBridge } from '../src/platform/host-bridge'
import { requestReactionHaptic } from '../src/platform/reaction-haptics'

function bridge(overrides: Partial<HostBridge> = {}): HostBridge {
  return {
    kind: 'browser', isAvailable: true, initData: () => 'signed', rawAuthData: () => 'signed',
    inviteToken: () => null, inviteLink: () => null, metadata: () => null, ready: () => undefined,
    close: () => undefined, back: () => undefined, onBack: () => () => undefined, openBot: () => undefined,
    openTelegramVideo: () => false, openInvite: () => undefined, getInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    ...overrides,
  }
}

describe('reaction haptics', () => {
  test('uses MAX impactOccurred(light/soft) only for signed iOS and Android app surfaces', () => {
    const calls: unknown[][] = []
    const host = { WebApp: { HapticFeedback: { impactOccurred: (...args: unknown[]) => { calls.push(args) } } } }
    const max = bridge({ kind: 'max', metadata: () => ({ version: '1', platform: 'ios', colorScheme: 'light', safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 }, contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 } }) })
    const android = bridge({ kind: 'max', metadata: () => ({ version: '1', platform: 'android', colorScheme: 'light', safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 }, contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 } }) })
    requestReactionHaptic(max, 'light', host)
    requestReactionHaptic(max, 'soft', host)
    requestReactionHaptic(android, 'light', host)
    expect(calls).toEqual([['light'], ['soft'], ['light']])
  })

  test('ignores unavailable, unsigned, desktop and unsupported MAX haptic surfaces', () => {
    const calls: unknown[][] = []
    const host = { WebApp: { HapticFeedback: { impactOccurred: (...args: unknown[]) => { calls.push(args) } } }, navigator: { vibrate: () => calls.push(['vibrate']) } }
    const metadata = (platform: string) => () => ({ version: '1', platform, colorScheme: 'light' as const, safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 }, contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 } })
    requestReactionHaptic(bridge({ kind: 'max', metadata: metadata('desktop') }), 'light', host)
    requestReactionHaptic(bridge({ kind: 'max', isAvailable: false, metadata: metadata('ios') }), 'light', host)
    requestReactionHaptic(bridge({ kind: 'max', rawAuthData: () => null, metadata: metadata('ios') }), 'light', host)
    expect(calls).toEqual([])
  })

  test('uses one short vibration for browser fallback', () => {
    const calls: unknown[] = []
    const host = { navigator: { vibrate(value: number) { calls.push(value); return true } } }
    requestReactionHaptic(bridge({ kind: 'browser' }), 'light', host)
    expect(calls).toEqual([12])
  })

  test('swallows absent APIs, getter and call errors, and rejected MAX promises without fallback', async () => {
    const calls: unknown[] = []
    const metadata = () => ({ version: '1', platform: 'ios', colorScheme: 'light' as const, safeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 }, contentSafeAreaInset: { top: 0, right: 0, bottom: 0, left: 0 } })
    const native = bridge({ kind: 'max', metadata })
    requestReactionHaptic(native, 'light', {})
    requestReactionHaptic(native, 'light', { get WebApp() { throw new Error('host unavailable') } })
    requestReactionHaptic(native, 'light', { WebApp: { HapticFeedback: { impactOccurred: () => { throw new Error('failed') } } } })
    requestReactionHaptic(native, 'light', { navigator: { vibrate: () => calls.push('fallback') }, WebApp: { HapticFeedback: { impactOccurred: () => Promise.reject(new Error('rejected')) } } })
    await Promise.resolve()
    expect(calls).toEqual([])
  })
})
