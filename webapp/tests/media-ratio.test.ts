import { expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { DEFAULT_MEDIA_RATIO, getMediaCompositionKey, getMediaFrameRatio, useMediaFrameRatio, type MediaRatioAttachment } from '../src/features/feed/media-ratio'

const photo = (id: string, width: number | null, height: number | null): MediaRatioAttachment => ({ id, kind: 'photo', width, height })
const video = (id: string, width: number | null, height: number | null): MediaRatioAttachment => ({ id, kind: 'video', width, height })

test('single photos and videos use a clamped metadata ratio', () => {
  expect(getMediaFrameRatio([photo('landscape', 1920, 1080)])).toBeCloseTo(16 / 9)
  expect(getMediaFrameRatio([video('portrait', 720, 1280)])).toBe(DEFAULT_MEDIA_RATIO)
  expect(getMediaFrameRatio([photo('too-wide', 5000, 1000)])).toBe(2.4)
  expect(getMediaFrameRatio([photo('too-tall', 500, 1000)])).toBe(DEFAULT_MEDIA_RATIO)
})

test('photo albums use the first attachment in order and mixed albums use the default frame', () => {
  expect(getMediaFrameRatio([photo('first', 1600, 1000), photo('second', 400, 1200)])).toBe(1.6)
  expect(getMediaFrameRatio([video('first-video', 1920, 1080), photo('second-photo', 1000, 1000)])).toBe(DEFAULT_MEDIA_RATIO)
  expect(getMediaFrameRatio([photo('first-photo', 1600, 1000), video('second-video', 1920, 1080)])).toBe(DEFAULT_MEDIA_RATIO)
})

test('invalid dimensions reserve the default frame and only a changed attachment composition gets a new key', () => {
  expect(getMediaFrameRatio([photo('missing', null, 1200)])).toBe(DEFAULT_MEDIA_RATIO)
  expect(getMediaFrameRatio([photo('zero', 0, 1200)])).toBe(DEFAULT_MEDIA_RATIO)

  const initial = [photo('same', 1600, 1000)]
  expect(getMediaCompositionKey('memory', initial)).toBe(getMediaCompositionKey('memory', [photo('same', 2000, 1000)]))
  expect(getMediaCompositionKey('memory', initial)).not.toBe(getMediaCompositionKey('memory', [photo('replacement', 1600, 1000)]))
  expect(getMediaCompositionKey('memory', initial)).not.toBe(getMediaCompositionKey('memory', [photo('same', 1600, 1000), photo('added', 800, 800)]))
})

test('the rendered frame ratio stays frozen until the attachment composition changes', () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const document = { nodeType: 9, activeElement: null, body: null, addEventListener() {}, removeEventListener() {} }
  const window = { document, event: undefined, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} }
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true })
  const ownerDocument = { nodeType: 9, defaultView: window, addEventListener() {}, removeEventListener() {} }
  const container = { nodeType: 1, tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument, addEventListener() {}, removeEventListener() {} } as unknown as Element
  const root = createRoot(container)
  let renderedRatio = 0
  function Probe({ attachments }: { attachments: MediaRatioAttachment[] }) {
    renderedRatio = useMediaFrameRatio('memory', attachments)
    return null
  }

  act(() => { root.render(createElement(Probe, { attachments: [photo('same', 1600, 1000)] })) })
  expect(renderedRatio).toBe(1.6)
  act(() => { root.render(createElement(Probe, { attachments: [photo('same', 2000, 1000)] })) })
  expect(renderedRatio).toBe(1.6)
  act(() => { root.render(createElement(Probe, { attachments: [photo('replacement', 2000, 1000)] })) })
  expect(renderedRatio).toBe(2)
  act(() => { root.unmount() })
  Object.assign(globalThis, { document: previousDocument, window: previousWindow })
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
})
