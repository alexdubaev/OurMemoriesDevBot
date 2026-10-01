import { expect, test } from 'bun:test'

import { createPwaInstallController, createPwaInstallUrl, isPwaInstallDismissed, readPwaInstallIntent, setPwaInstallDismissed, type BeforeInstallPromptLike } from '../src/platform/pwa-install'

test('captures beforeinstallprompt early and consumes one prompt event once on user action', async () => {
  const host = fakeWindow()
  const manager = createPwaInstallController(host.window)
  let prompts = 0
  let prevented = false
  host.dispatch('beforeinstallprompt', {
    preventDefault: () => { prevented = true },
    prompt: async () => { prompts += 1 },
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  })
  expect(prevented).toBe(true)
  expect(manager.getSnapshot().available).toBe(true)
  expect(await manager.prompt()).toBe('accepted')
  expect(await manager.prompt()).toBe('unavailable')
  expect(prompts).toBe(1)
})

test('handles dismissed, throwing, absent and installed prompt states without waiting', async () => {
  const host = fakeWindow()
  const manager = createPwaInstallController(host.window)
  expect(await manager.prompt()).toBe('unavailable')
  host.dispatch('beforeinstallprompt', promptEvent('dismissed'))
  expect(await manager.prompt()).toBe('dismissed')
  host.dispatch('beforeinstallprompt', { preventDefault() {}, prompt: () => { throw new Error('denied') }, userChoice: Promise.resolve({ outcome: 'accepted' }) })
  expect(await manager.prompt()).toBe('error')
  host.dispatch('beforeinstallprompt', promptEvent('accepted'))
  const rejectedChoice = promptEvent('accepted')
  host.dispatch('beforeinstallprompt', { ...rejectedChoice, userChoice: Promise.reject(new Error('rejected')) })
  expect(await manager.prompt()).toBe('error')
  host.dispatch('beforeinstallprompt', promptEvent('accepted'))
  host.dispatch('appinstalled', new Event('appinstalled'))
  expect(manager.getSnapshot()).toMatchObject({ available: false, installed: true })
})

test('dismissal is a resilient UX preference and can be cleared to reopen the offer', () => {
  let value: string | null = null
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    removeItem: () => { value = null },
  }
  setPwaInstallDismissed(storage, true)
  expect(isPwaInstallDismissed(storage)).toBe(true)
  setPwaInstallDismissed(storage, false)
  expect(isPwaInstallDismissed(storage)).toBe(false)
  expect(isPwaInstallDismissed({ getItem: () => { throw new Error('storage denied') } })).toBe(false)
  setPwaInstallDismissed({ setItem: () => { throw new Error('storage denied') }, removeItem: () => { throw new Error('storage denied') } }, true)
})

test('keeps install intent on the internal root route and rejects unsafe routes and ids', () => {
  expect(createPwaInstallUrl('https://memoly.example', '019c0000-0000-7000-8000-000000000001'))
    .toBe('https://memoly.example/?install=1&familyId=019c0000-0000-7000-8000-000000000001')
  expect(createPwaInstallUrl('http://memoly.example', null)).toBeNull()
  expect(readPwaInstallIntent({ pathname: '/', search: '?install=1&familyId=019c0000-0000-7000-8000-000000000001' }))
    .toEqual({ familyId: '019c0000-0000-7000-8000-000000000001' })
  expect(readPwaInstallIntent({ pathname: '/invite', search: '?install=1' })).toBeNull()
  expect(readPwaInstallIntent({ pathname: '/', search: '?install=1&familyId=https://evil.example' })).toBeNull()
})

function promptEvent(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptLike {
  return { preventDefault() {}, prompt: async () => undefined, userChoice: Promise.resolve({ outcome }) }
}

function fakeWindow() {
  const listeners = new Map<string, (event: Event) => void>()
  const window = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, typeof listener === 'function' ? listener as (event: Event) => void : (event) => listener.handleEvent(event))
    },
    matchMedia: () => ({ matches: false }),
    navigator: { standalone: false },
  } as unknown as Window
  return { window, dispatch(type: string, event: Event | BeforeInstallPromptLike) { listeners.get(type)?.(event as Event) } }
}
