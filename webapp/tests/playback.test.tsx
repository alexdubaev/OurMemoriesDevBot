import { expect, test } from 'bun:test'
import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'

import { MediaPlaybackCoordinator } from '../src/features/feed/playback'
import { usePlaybackRegistration } from '../src/features/feed/use-playback-registration'

test('hiding the Mini App pauses registered media and visibility never autoplays it', async () => {
  const browser = installBrowser()
  const first = mediaElement()
  const second = mediaElement()
  const root = createRoot(detachedContainer(browser.window))

  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'first', media: first }),
      createElement(PlayerProbe, { id: 'second', media: second }),
    ))
  })

  browser.setHidden(true)
  browser.dispatch('visibilitychange')
  expect(first.pauseCalls).toBe(1)
  expect(second.pauseCalls).toBe(1)

  browser.setHidden(false)
  browser.dispatch('visibilitychange')
  expect(first.playCalls).toBe(0)
  expect(second.playCalls).toBe(0)

  await act(async () => root.unmount())
  browser.restore()
})

test('unmounting an authenticated feed pauses its active media before unregistering it', async () => {
  const browser = installBrowser()
  const media = mediaElement()
  const root = createRoot(detachedContainer(browser.window))
  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'voice', media }),
    ))
  })

  await act(async () => root.unmount())
  expect(media.pauseCalls).toBe(1)
  browser.restore()
})

function PlayerProbe({ id, media }: { id: string; media: ReturnType<typeof mediaElement> }) {
  const ref = useRef(media as unknown as HTMLMediaElement)
  usePlaybackRegistration(id, ref)
  return null
}

function mediaElement() {
  return {
    pauseCalls: 0,
    playCalls: 0,
    pause() { this.pauseCalls += 1 },
    play() { this.playCalls += 1; return Promise.resolve() },
  }
}

function installBrowser() {
  const priorDocument = globalThis.document
  const priorWindow = globalThis.window
  const listeners = new Map<string, Set<() => void>>()
  let hidden = false
  const document = {
    nodeType: 9,
    activeElement: null,
    body: null,
    get hidden() { return hidden },
    addEventListener(type: string, listener: () => void) {
      const entries = listeners.get(type) ?? new Set()
      entries.add(listener)
      listeners.set(type, entries)
    },
    removeEventListener(type: string, listener: () => void) { listeners.get(type)?.delete(listener) },
  }
  const window = {
    document,
    event: undefined,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
  }
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true })
  return {
    window,
    setHidden(value: boolean) { hidden = value },
    dispatch(type: string) { listeners.get(type)?.forEach((listener) => listener()) },
    restore() {
      Object.assign(globalThis, { document: priorDocument, window: priorWindow })
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    },
  }
}

function detachedContainer(window: unknown) {
  const ownerDocument = {
    nodeType: 9,
    defaultView: window,
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
