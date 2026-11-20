import { afterEach, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { z } from 'zod'

import { useLatestTransport } from '../src/features/albums/latest-transport'
import type { AuthenticatedTransport } from '../src/platform/api'

let root: Root | null = null
const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

function transport(name: string, calls: string[]): AuthenticatedTransport {
  return {
    request: async (path: string) => { calls.push(`${name} request ${path}`); return { ok: true } as never },
    raw: async (path: string) => { calls.push(`${name} raw ${path}`); return new Response(null) },
  }
}

// A token refresh replaces the transport object. Album requests built on it (the albums API and
// the gallery's paging) keep their identity, so loading is neither restarted nor aborted.
test('album transport keeps one identity across token refreshes and calls the newest transport', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, window: { event: undefined, HTMLIFrameElement: class {} } })
  const calls: string[] = []
  const seen: AuthenticatedTransport[] = []
  function Probe({ value }: { value: AuthenticatedTransport }) {
    seen.push(useLatestTransport(value))
    return null
  }
  root = createRoot(detachedContainer())
  await act(async () => root!.render(createElement(Probe, { value: transport('first', calls) })))
  await act(async () => root!.render(createElement(Probe, { value: transport('refreshed', calls) })))

  expect(seen.length).toBeGreaterThanOrEqual(2)
  expect(new Set(seen).size).toBe(1)
  await seen.at(-1)!.raw('/image')
  await seen.at(-1)!.request('/albums', z.unknown())
  expect(calls).toEqual(['refreshed raw /image', 'refreshed request /albums'])
})

function detachedContainer() {
  const ownerDocument = { nodeType: 9, defaultView: { HTMLIFrameElement: class {} }, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {} }
  return { nodeType: 1, tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument, addEventListener() {}, removeEventListener() {} } as unknown as Element
}
