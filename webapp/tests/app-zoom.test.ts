import { describe, expect, test } from 'bun:test'

import { installAppZoomPrevention } from '../src/platform/app-zoom'

type Registration = { type: string; listener: EventListenerOrEventListenerObject; passive: boolean; capture: boolean }

function makeSurface(maxTouchPoints: number) {
  const target = new EventTarget() as EventTarget & { defaultView: Window; fullscreenElement: Element | null }
  Object.defineProperties(target, {
    defaultView: { value: { navigator: { maxTouchPoints } } },
    fullscreenElement: { value: null, writable: true },
  })
  const registrations: Registration[] = []
  const add = target.addEventListener.bind(target)
  const remove = target.removeEventListener.bind(target)
  target.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    const normalized = typeof options === 'boolean' ? { capture: options } : options
    registrations.push({ type, listener, passive: normalized?.passive === true, capture: normalized?.capture === true })
    add(type, listener, options)
  }) as typeof target.addEventListener
  target.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    const capture = typeof options === 'boolean' ? options : options?.capture === true
    const index = registrations.findIndex((entry) => entry.type === type && entry.listener === listener && entry.capture === capture)
    if (index >= 0) registrations.splice(index, 1)
    remove(type, listener, options)
  }) as typeof target.removeEventListener
  return { document: target as unknown as Document, registrations }
}

function dispatch(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperties(event, Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, { configurable: true, value }])))
  target.dispatchEvent(event)
  return event
}

function active(surface: ReturnType<typeof makeSurface>, type: string) {
  return surface.registrations.filter((entry) => entry.type === type)
}

describe('app zoom prevention listener lifecycle', () => {
  test('keeps touch listeners passive at rest and arms blockers only after gesturestart', () => {
    const surface = makeSurface(5)
    const dispose = installAppZoomPrevention(surface.document)

    expect(active(surface, 'touchstart').map(({ passive }) => passive)).toEqual([true])
    expect(active(surface, 'touchend').map(({ passive }) => passive)).toEqual([true])
    expect(active(surface, 'touchcancel').map(({ passive }) => passive)).toEqual([true])
    expect(active(surface, 'gesturestart')).toHaveLength(0)
    expect(active(surface, 'gesturechange')).toHaveLength(0)
    expect(active(surface, 'touchmove')).toHaveLength(0)

    dispatch(surface.document, 'touchstart', { touches: [{}] })
    dispatch(surface.document, 'touchstart', { touches: [{}] })
    expect(active(surface, 'gesturestart').map(({ passive }) => passive)).toEqual([false])
    expect(active(surface, 'gesturechange')).toHaveLength(0)
    expect(active(surface, 'touchmove')).toHaveLength(0)
    expect(dispatch(surface.document, 'touchmove', { touches: [{}] }).defaultPrevented).toBe(false)

    expect(dispatch(surface.document, 'gesturestart').defaultPrevented).toBe(true)
    expect(active(surface, 'gesturechange').map(({ passive }) => passive)).toEqual([false])
    expect(active(surface, 'touchmove').map(({ passive }) => passive)).toEqual([false])
    expect(active(surface, 'gesturestart')).toHaveLength(1)
    expect(active(surface, 'gesturechange')).toHaveLength(1)
    expect(active(surface, 'touchmove')).toHaveLength(1)
    expect(dispatch(surface.document, 'touchmove', { touches: [{}] }).defaultPrevented).toBe(false)
    expect(dispatch(surface.document, 'touchmove', { touches: [{}, {}] }).defaultPrevented).toBe(true)

    dispatch(surface.document, 'touchend', { touches: [{}] })
    expect(active(surface, 'gesturechange')).toHaveLength(0)
    expect(active(surface, 'touchmove')).toHaveLength(0)
    expect(active(surface, 'gesturestart')).toHaveLength(1)
    dispatch(surface.document, 'touchend', { touches: [] })
    expect(active(surface, 'gesturestart')).toHaveLength(0)
    dispose()
  })

  test('arms fallback multitouch blockers and fully resets on cancel and disposal', () => {
    const surface = makeSurface(5)
    const dispose = installAppZoomPrevention(surface.document)
    dispatch(surface.document, 'touchstart', { touches: [{}] })
    dispatch(surface.document, 'touchstart', { touches: [{}, {}] })
    expect(active(surface, 'touchmove')).toHaveLength(1)
    expect(active(surface, 'gesturechange')).toHaveLength(1)
    expect(dispatch(surface.document, 'touchmove', { touches: [{}, {}] }).defaultPrevented).toBe(true)

    dispatch(surface.document, 'touchcancel', { touches: [] })
    expect(active(surface, 'gesturestart')).toHaveLength(0)
    expect(active(surface, 'gesturechange')).toHaveLength(0)
    expect(active(surface, 'touchmove')).toHaveLength(0)
    dispatch(surface.document, 'touchstart', { touches: [{}] })
    dispatch(surface.document, 'gesturestart')
    expect(active(surface, 'touchmove')).toHaveLength(1)
    dispose()
    expect(surface.registrations).toHaveLength(0)
  })

  test('preserves page zoom protection on desktop and media exemptions', () => {
    const surface = makeSurface(0)
    const dispose = installAppZoomPrevention(surface.document)
    expect(active(surface, 'gesturestart')).toHaveLength(1)
    expect(active(surface, 'gesturechange')).toHaveLength(1)
    expect(active(surface, 'touchmove')).toHaveLength(0)
    expect(dispatch(surface.document, 'gesturestart').defaultPrevented).toBe(true)
    expect(dispatch(surface.document, 'gesturechange').defaultPrevented).toBe(true)
    expect(dispatch(surface.document, 'wheel', { ctrlKey: true, metaKey: false }).defaultPrevented).toBe(true)
    expect(dispatch(surface.document, 'wheel', { ctrlKey: false, metaKey: false }).defaultPrevented).toBe(false)

    const event = new Event('gesturestart', { cancelable: true })
    Object.defineProperty(event, 'target', { value: { closest: (selector: string) => selector === '.pswp' ? {} : null } })
    const listener = active(surface, 'gesturestart')[0].listener
    if (typeof listener === 'function') listener(event)
    else listener.handleEvent(event)
    expect(event.defaultPrevented).toBe(false)
    dispose()
  })
})
