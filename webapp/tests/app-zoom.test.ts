import { expect, test } from 'bun:test'

import { installAppZoomPrevention } from '../src/platform/app-zoom'

function touchMove(touchCount: number) {
  const event = new Event('touchmove', { cancelable: true })
  Object.defineProperty(event, 'touches', { value: Array.from({ length: touchCount }, () => ({})) })
  return event
}

test('cancels pinch and WebKit zoom gestures while preserving single-touch scrolling and controls', () => {
  const document = new EventTarget() as unknown as Document
  const uninstall = installAppZoomPrevention(document)

  const safariPinch = new Event('gesturestart', { cancelable: true })
  document.dispatchEvent(safariPinch)
  expect(safariPinch.defaultPrevented).toBe(true)

  const pinchMove = touchMove(2)
  document.dispatchEvent(pinchMove)
  expect(pinchMove.defaultPrevented).toBe(true)

  const verticalScrollOrControl = touchMove(1)
  document.dispatchEvent(verticalScrollOrControl)
  expect(verticalScrollOrControl.defaultPrevented).toBe(false)

  const safariPinchChange = new Event('gesturechange', { cancelable: true })
  document.dispatchEvent(safariPinchChange)
  expect(safariPinchChange.defaultPrevented).toBe(true)

  uninstall()
  const afterCleanup = new Event('gesturestart', { cancelable: true })
  document.dispatchEvent(afterCleanup)
  expect(afterCleanup.defaultPrevented).toBe(false)
})

test('cancels only trackpad wheel events that request browser zoom', () => {
  const document = new EventTarget() as unknown as Document
  const uninstall = installAppZoomPrevention(document)

  const browserZoom = new Event('wheel', { cancelable: true })
  Object.defineProperty(browserZoom, 'ctrlKey', { value: true })
  document.dispatchEvent(browserZoom)
  expect(browserZoom.defaultPrevented).toBe(true)

  const normalScroll = new Event('wheel', { cancelable: true })
  document.dispatchEvent(normalScroll)
  expect(normalScroll.defaultPrevented).toBe(false)
  uninstall()
})

test('leaves image viewer gestures available for PhotoSwipe media', () => {
  const document = new EventTarget() as unknown as Document & { closest: (selector: string) => Element | null }
  document.closest = (selector) => selector === '.pswp' ? {} as Element : null
  const uninstall = installAppZoomPrevention(document)

  const imageViewerPinch = touchMove(2)
  document.dispatchEvent(imageViewerPinch)
  expect(imageViewerPinch.defaultPrevented).toBe(false)
  uninstall()
})

test('blocks page zoom over inline video but leaves native fullscreen video untouched', () => {
  const listeners = new Map<string, EventListener>()
  const document = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.set(type, listener)
    },
    removeEventListener: (type: string) => listeners.delete(type),
    fullscreenElement: null as Element | null,
  } as unknown as Document
  const inlineVideo = { closest: () => null } as unknown as Element
  const fullscreenVideo = { closest: () => null } as unknown as Element
  const uninstall = installAppZoomPrevention(document)
  const dispatchPinch = (target: Element) => {
    let defaultPrevented = false
    const event = {
      cancelable: true,
      defaultPrevented,
      preventDefault() { defaultPrevented = true },
      target,
      touches: [{}, {}],
    } as unknown as TouchEvent
    listeners.get('touchmove')?.(event)
    return defaultPrevented
  }

  expect(dispatchPinch(inlineVideo)).toBe(true)
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: fullscreenVideo })
  expect(dispatchPinch(fullscreenVideo)).toBe(false)
  uninstall()
})
