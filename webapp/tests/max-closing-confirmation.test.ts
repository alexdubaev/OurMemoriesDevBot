import { describe, expect, test } from 'bun:test'
import { act, createElement, StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createHostBridge } from '../src/platform/host-bridge'
import { createMaxHostBridge } from '../src/platform/max/host-bridge'

function maxHost(overrides: Record<string, unknown> = {}) {
  return {
    WebApp: {
      initData: 'user=synthetic',
      ready() {},
      close() {},
      ...overrides,
    },
  }
}

describe('MAX closing confirmation', () => {
  test('requests confirmation once per WebApp and retains ready, close, and back behavior', () => {
    const calls: string[] = []
    const host = maxHost({
      enableClosingConfirmation(this: unknown) {
        expect(this).toBe(host.WebApp)
        calls.push('confirmation')
      },
      ready() { calls.push('ready') },
      close() { calls.push('close') },
    })
    const history = { back() { calls.push('back') } }

    createMaxHostBridge(host).ready()
    createMaxHostBridge(host).ready()
    const bridge = createMaxHostBridge(host)
    bridge.ready()
    bridge.close()
    createHostBridge({ ...host, history }).back()

    expect(calls).toEqual(['confirmation', 'ready', 'ready', 'ready', 'close', 'back'])
  })

  test('configures a replacement WebApp independently', () => {
    let confirmations = 0
    const first = maxHost({ enableClosingConfirmation() { confirmations++ } })
    const second = maxHost({ enableClosingConfirmation() { confirmations++ } })
    createMaxHostBridge(first).ready()
    createMaxHostBridge(second).ready()
    expect(confirmations).toBe(2)
  })

  test('tolerates absent, malformed, or throwing confirmation methods and still calls ready', () => {
    for (const confirmation of [undefined, 'malformed', () => { throw new Error('unsupported') }]) {
      let readyCalls = 0
      const host = maxHost({ enableClosingConfirmation: confirmation, ready() { readyCalls++ } })
      expect(() => createMaxHostBridge(host).ready()).not.toThrow()
      expect(readyCalls).toBe(1)
    }

    let throwingCalls = 0
    const throwingHost = maxHost({
      enableClosingConfirmation() { throwingCalls++; throw new Error('unsupported') },
    })
    const throwingBridge = createMaxHostBridge(throwingHost)
    throwingBridge.ready()
    throwingBridge.ready()
    expect(throwingCalls).toBe(1)
  })

  test('remains once-per-WebApp across StrictMode effect replay and separate React mounts', async () => {
    const calls: string[] = []
    const host = maxHost({
      enableClosingConfirmation() { calls.push('confirmation') },
      ready() { calls.push('ready') },
    })
    const bridge = createMaxHostBridge(host)
    function Harness() {
      useEffect(() => { bridge.ready() }, [])
      return null
    }

    const priorWindow = globalThis.window
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      window: { event: undefined, HTMLIFrameElement: class {} },
    })
    try {
      for (let index = 0; index < 2; index++) {
        const root = createRoot(detachedContainer())
        await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))))
        await act(async () => root.unmount())
      }
    } finally {
      Object.assign(globalThis, { window: priorWindow })
    }
    expect(calls.filter((call) => call === 'confirmation')).toHaveLength(1)
    expect(calls.filter((call) => call === 'ready')).toHaveLength(4)
  })

  test('handles an absent WebApp and a confirmation method without ready', () => {
    expect(() => createMaxHostBridge(undefined).ready()).not.toThrow()
    let confirmations = 0
    const bridge = createMaxHostBridge(maxHost({ enableClosingConfirmation() { confirmations++ }, ready: undefined }))
    bridge.ready()
    expect(confirmations).toBe(1)
  })

  test('does not configure browser/PWA bridges or install beforeunload handlers', () => {
    let confirmations = 0
    const host = {
      WebApp: { initData: '', enableClosingConfirmation() { confirmations++ } },
      addEventListener() { throw new Error('unexpected listener') },
    }
    const bridge = createHostBridge(host)
    bridge.ready()
    expect(bridge.kind).toBe('browser')
    expect(confirmations).toBe(0)
  })
})

describe('MAX native BackButton', () => {
  test('uses one native listener and dispatches only to the newest active handler', () => {
    const calls: string[] = []
    const listeners = new Set<() => void>()
    const backButton = {
      show(this: unknown) { expect(this).toBe(backButton); calls.push('show') },
      hide(this: unknown) { expect(this).toBe(backButton); calls.push('hide') },
      onClick(this: unknown, callback: () => void) { expect(this).toBe(backButton); calls.push('on'); listeners.add(callback) },
      offClick(this: unknown, callback: () => void) { expect(this).toBe(backButton); calls.push('off'); listeners.delete(callback) },
    }
    const bridge = createMaxHostBridge(maxHost({ BackButton: backButton }))
    const unsubscribeParent = bridge.onBack(() => calls.push('parent'))
    const unsubscribeChild = bridge.onBack(() => calls.push('child'))

    expect(calls).toEqual(['on', 'show'])
    expect(listeners.size).toBe(1)
    for (const listener of listeners) listener()
    expect(calls.slice(2)).toEqual(['child'])

    unsubscribeParent()
    unsubscribeParent()
    for (const listener of listeners) listener()
    expect(calls.slice(2)).toEqual(['child', 'child'])
    expect(listeners.size).toBe(1)

    unsubscribeChild()
    unsubscribeChild()
    expect(calls.slice(-2)).toEqual(['off', 'hide'])
    expect(listeners.size).toBe(0)
  })

  test('removes a nested handler safely when cleanups arrive out of order', () => {
    const calls: string[] = []
    let nativeClick: (() => void) | undefined
    const backButton = {
      show() {},
      hide() {},
      onClick(callback: () => void) { nativeClick = callback },
      offClick(callback: () => void) { if (nativeClick === callback) nativeClick = undefined },
    }
    const bridge = createMaxHostBridge(maxHost({ BackButton: backButton }))
    const unsubscribeFirst = bridge.onBack(() => calls.push('first'))
    const unsubscribeSecond = bridge.onBack(() => calls.push('second'))

    unsubscribeSecond()
    nativeClick?.()
    unsubscribeFirst()
    nativeClick?.()
    expect(calls).toEqual(['first'])
  })

  test('treats an absent or incomplete BackButton as a safe no-op', () => {
    expect(() => createMaxHostBridge(maxHost()).onBack(() => { throw new Error('unexpected callback') })()).not.toThrow()

    const calls: string[] = []
    const bridge = createMaxHostBridge(maxHost({ BackButton: {
      show() { calls.push('show') },
      onClick() { calls.push('on') },
      offClick() { calls.push('off') },
      // Missing hide means the capability is incomplete and should not partially install.
    } }))
    const unsubscribe = bridge.onBack(() => calls.push('handler'))
    unsubscribe()
    expect(calls).toEqual([])
  })
})

function detachedContainer() {
  const ownerDocument = {
    nodeType: 9,
    defaultView: { HTMLIFrameElement: class {} },
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
  }
  return {
    nodeType: 1,
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument,
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Element
}
