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

test('unmounting an authenticated feed pauses every mounted local player before unregistering it', async () => {
  const browser = installBrowser()
  const card = mediaElement()
  const detail = mediaElement()
  const root = createRoot(detachedContainer(browser.window))
  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'same-media', key: 'card', media: card }),
      createElement(PlayerProbe, { id: 'same-media', key: 'detail', media: detail }),
    ))
  })

  await act(async () => root.unmount())
  expect(card.pauseCalls).toBe(1)
  expect(detail.pauseCalls).toBe(1)
  browser.restore()
})

test('deactivating a warm feed pauses registered media and reactivation never resumes it', async () => {
  const browser = installBrowser()
  const video = mediaElement()
  const root = createRoot(detachedContainer(browser.window))

  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, { active: true },
      createElement(PlayerProbe, { id: 'warm-video', media: video }),
    ))
  })
  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, { active: false },
      createElement(PlayerProbe, { id: 'warm-video', media: video }),
    ))
  })
  expect(video.pauseCalls).toBe(1)

  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, { active: true },
      createElement(PlayerProbe, { id: 'warm-video', media: video }),
    ))
  })
  expect(video.playCalls).toBe(0)

  await act(async () => root.unmount())
  browser.restore()
})

test('card and detail players for the same media pause each other as separate mounted instances', async () => {
  const browser = installBrowser()
  const card = mediaElement()
  const detail = mediaElement()
  const root = createRoot(detachedContainer(browser.window))
  let activateCard = () => undefined
  let activateDetail = () => undefined

  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'same-media', key: 'card', media: card, onActivate: (activate) => { activateCard = activate } }),
    ))
  })
  activateCard()
  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'same-media', key: 'card', media: card, onActivate: (activate) => { activateCard = activate } }),
      createElement(PlayerProbe, { id: 'same-media', key: 'detail', media: detail, onActivate: (activate) => { activateDetail = activate } }),
    ))
  })

  activateDetail()
  expect(card.pauseCalls).toBe(1)
  activateCard()
  expect(detail.pauseCalls).toBe(1)

  await act(async () => root.unmount())
  browser.restore()
})

test('unmounting detail keeps the same-media card registered for hidden pause', async () => {
  const browser = installBrowser()
  const card = mediaElement()
  const detail = mediaElement()
  const root = createRoot(detachedContainer(browser.window))

  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'same-media', key: 'card', media: card }),
      createElement(PlayerProbe, { id: 'same-media', key: 'detail', media: detail }),
    ))
  })
  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'same-media', key: 'card', media: card }),
    ))
  })

  browser.setHidden(true)
  browser.dispatch('visibilitychange')
  expect(detail.pauseCalls).toBe(1)
  expect(card.pauseCalls).toBe(1)

  await act(async () => root.unmount())
  browser.restore()
})

test('closing detail and becoming visible never autoplays the remaining card', async () => {
  const browser = installBrowser()
  const card = mediaElement()
  const detail = mediaElement()
  const root = createRoot(detachedContainer(browser.window))

  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'same-media', key: 'card', media: card }),
      createElement(PlayerProbe, { id: 'same-media', key: 'detail', media: detail }),
    ))
  })
  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'same-media', key: 'card', media: card }),
    ))
  })

  browser.setHidden(false)
  browser.dispatch('visibilitychange')
  expect(card.playCalls).toBe(0)
  expect(detail.playCalls).toBe(0)

  await act(async () => root.unmount())
  browser.restore()
})

test('different media instances retain ordinary one-local-media-at-a-time behavior', async () => {
  const browser = installBrowser()
  const first = mediaElement()
  const second = mediaElement()
  const root = createRoot(detachedContainer(browser.window))
  let activateFirst = () => undefined
  let activateSecond = () => undefined

  await act(async () => {
    root.render(createElement(MediaPlaybackCoordinator, null,
      createElement(PlayerProbe, { id: 'first-media', media: first, onActivate: (activate) => { activateFirst = activate } }),
      createElement(PlayerProbe, { id: 'second-media', media: second, onActivate: (activate) => { activateSecond = activate } }),
    ))
  })

  activateFirst()
  expect(second.pauseCalls).toBe(1)
  activateSecond()
  expect(first.pauseCalls).toBe(1)

  await act(async () => root.unmount())
  browser.restore()
})

function PlayerProbe({ id, media, onActivate }: {
  id: string
  media: ReturnType<typeof mediaElement>
  onActivate?: (activate: () => void) => void
}) {
  const ref = useRef(media as unknown as HTMLMediaElement)
  const activate = usePlaybackRegistration(id, ref)
  onActivate?.(activate)
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
