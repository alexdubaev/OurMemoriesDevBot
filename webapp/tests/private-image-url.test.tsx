import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ApiRequestError, type AuthenticatedTransport } from '../src/platform/api'
import type { HttpRequestOptions } from '../src/platform/api/http-client'
import { usePrivateImageResource, type PrivateImageResourceState } from '../src/platform/media/use-private-image-url'
import {
  PRIVATE_CACHE_SCHEMA,
  activatePrivateCacheIdentity,
  allowPrivateFamilyCache,
  cachePrivateImageResponse,
  privateFamilyAccessRevokedEvent,
  privateFamilyCacheGeneration,
  privateImageValidator,
  readPrivateImageEntry,
} from '../src/platform/persistence/private-cache'
import { installFakeIndexedDb } from './indexeddb-fake'

const userId = 'image-hook-user'
const familyId = '11111111-1111-4111-8111-111111111111'
const path = `/api/v1/families/${familyId}/media/22222222-2222-4222-8222-222222222222/content?variant=preview`
const entryId = `memoLy:${PRIVATE_CACHE_SCHEMA}:${userId}:image:${path}`
const holdsBytes = (value: Record<string, unknown>) => Object.values(value).some((field) => field instanceof ArrayBuffer || ArrayBuffer.isView(field) || field instanceof Blob)

type RawCall = { path: string; headers: Headers; resolve: (response: Response) => void; reject: (error: unknown) => void }
function controlledTransport() {
  const calls: RawCall[] = []
  const transport: AuthenticatedTransport = {
    request: async () => { throw new Error('not used by image loading') },
    raw: (rawPath: string, options?: HttpRequestOptions) => new Promise<Response>((resolve, reject) => {
      calls.push({ path: rawPath, headers: new Headers(options?.headers), resolve, reject })
    }),
  }
  return { transport, calls }
}

/** A 200 image response whose body reports whether anything read it. */
function trackedImage(etag: string, bytes = [9, 9, 9]) {
  const body = { pulled: false, cancelled: false }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { body.pulled = true; controller.enqueue(new Uint8Array(bytes)); controller.close() },
    cancel() { body.cancelled = true },
  }, { highWaterMark: 0 })
  return { body, response: new Response(stream, { status: 200, headers: { 'content-type': 'image/webp', etag } }) }
}

let database: ReturnType<typeof installFakeIndexedDb>
let root: Root | null = null
let states: PrivateImageResourceState[] = []
const events: Event[] = []
const saved = new Map<string, PropertyDescriptor | undefined>()
const globals = ['indexedDB', 'IDBKeyRange', 'window', 'Image', 'IS_REACT_ACT_ENVIRONMENT'] as const

function Probe({ transport, poolMode }: { transport: AuthenticatedTransport; poolMode?: 'album-preview' }) {
  states.push(usePrivateImageResource(userId, path, transport, true, undefined, 'scope', poolMode))
  return null
}

async function render(transport: AuthenticatedTransport, poolMode?: 'album-preview') {
  await act(async () => {
    root ??= createRoot(detachedContainer())
    root.render(createElement(Probe, { transport, poolMode }))
  })
}

async function settle(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await act(async () => { await Bun.sleep(1) })
}

async function seedCachedImage(etag: string) {
  await cachePrivateImageResponse(userId, path, new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp', etag } }),
    undefined, privateFamilyCacheGeneration(userId, familyId))
  privateImageValidator(userId, path)
  await settle()
  const row = database.rows.get(entryId)!
  row.lastAccess = (row.lastAccess as number) - 60_000
  return row.lastAccess as number
}

beforeEach(() => {
  for (const name of globals) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    window: { event: undefined, HTMLIFrameElement: class {}, dispatchEvent: (event: Event) => { events.push(event); return true } },
    Image: class { src = ''; naturalWidth = 4; naturalHeight = 4; decode() { return Promise.resolve() } },
  })
  database = installFakeIndexedDb()
  activatePrivateCacheIdentity(userId)
  allowPrivateFamilyCache(userId, familyId, 1)
  states = []
  events.length = 0
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  activatePrivateCacheIdentity(null)
  for (const name of globals) {
    const original = saved.get(name)
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('private image loading', () => {
  test('an image that is not cached starts its network request without waiting for IndexedDB', async () => {
    const gate = Promise.withResolvers<void>()
    database = installFakeIndexedDb((mode) => mode === 'readonly' ? gate.promise : undefined)
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    expect(calls.map((call) => call.path)).toEqual([path])
    gate.resolve()
  })

  test('a cached image shows before the network answers and is revalidated with its ETag', async () => {
    await seedCachedImage('"v1"')
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    expect(states.at(-1)?.status).toBe('ready')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers.get('If-None-Match')).toBe('"v1"')
  })

  test('a 304 keeps the cached image and refreshes recency without writing bytes', async () => {
    const before = await seedCachedImage('"v1"')
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    database.log.puts.length = 0
    calls[0]!.reject(new ApiRequestError(304, 'INTERNAL_ERROR', 'Request failed with status 304'))
    await settle(20)
    expect(states.at(-1)?.status).toBe('ready')
    expect(calls).toHaveLength(1)
    expect(database.log.puts.filter(({ value }) => holdsBytes(value))).toEqual([])
    expect(database.rows.get(entryId)?.lastAccess).toBeGreaterThan(before)
  })

  test('a 200 with the same ETag is not downloaded and not written again', async () => {
    await seedCachedImage('"v1"')
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    database.log.puts.length = 0
    const { body, response } = trackedImage('"v1"')
    calls[0]!.resolve(response)
    await settle(20)
    expect(states.at(-1)?.status).toBe('ready')
    expect(body.pulled).toBe(false)
    expect(body.cancelled).toBe(true)
    expect(database.log.puts.filter(({ value }) => holdsBytes(value))).toEqual([])
  })

  test('a changed image replaces the stored copy and its ETag', async () => {
    await seedCachedImage('"v1"')
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    calls[0]!.resolve(trackedImage('"v2"', [4, 5]).response)
    await settle(20)
    const stored = await readPrivateImageEntry(userId, path)
    expect(stored?.etag).toBe('"v2"')
    expect([...new Uint8Array(await stored!.blob.arrayBuffer())]).toEqual([4, 5])
  })

  for (const status of [401, 403, 404]) {
    test(`a ${status} hides the cached image, removes it and reports access the same way as before`, async () => {
      await seedCachedImage('"v1"')
      const { transport, calls } = controlledTransport()
      await render(transport)
      await settle()
      expect(states.at(-1)?.status).toBe('ready')
      calls[0]!.reject(new ApiRequestError(status, 'DENIED', 'Synthetic denial'))
      await settle(20)
      expect(states.at(-1)).toEqual({ url: null, status: 'error' })
      if (status === 403) {
        expect(database.rows.has(entryId)).toBe(true)
        expect(events.map((event) => [event.type, (event as CustomEvent).detail])).toEqual([[privateFamilyAccessRevokedEvent, { userId, familyId }]])
      } else {
        expect(database.rows.has(entryId)).toBe(false)
        expect(database.store('imageBytes').has(entryId)).toBe(false)
        expect(events).toEqual([])
      }
    })
  }

  test('a 304 for a copy another tab already evicted fetches the image once without a validator', async () => {
    await seedCachedImage('"v1"')
    database.rows.delete(entryId)
    database.store('imageBytes').delete(entryId)
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    expect(calls[0]!.headers.get('If-None-Match')).toBe('"v1"')
    calls[0]!.reject(new ApiRequestError(304, 'INTERNAL_ERROR', 'Request failed with status 304'))
    await settle(10)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.headers.get('If-None-Match')).toBeNull()
    calls[1]!.resolve(trackedImage('"v1"').response)
    await settle(20)
    expect(states.at(-1)?.status).toBe('ready')
    expect((await readPrivateImageEntry(userId, path))?.etag).toBe('"v1"')
  })

  test('a denial that arrives before a slow cache read keeps the image hidden', async () => {
    let holdReads = false
    const gate = Promise.withResolvers<void>()
    database = installFakeIndexedDb((mode) => holdReads && mode === 'readonly' ? gate.promise : undefined)
    await seedCachedImage('"v1"')
    holdReads = true
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    // 403 keeps the stored row (access may return), so the late read still finds the image.
    calls[0]!.reject(new ApiRequestError(403, 'FORBIDDEN', 'Synthetic denial'))
    await settle(10)
    gate.resolve()
    await settle(20)
    expect(states.at(-1)).toEqual({ url: null, status: 'error' })
  })

  test('a network failure that arrives before a slow cache read waits for the cached image instead of flashing an error', async () => {
    let holdReads = false
    const gate = Promise.withResolvers<void>()
    database = installFakeIndexedDb((mode) => holdReads && mode === 'readonly' ? gate.promise : undefined)
    await seedCachedImage('"v1"')
    holdReads = true
    const { transport, calls } = controlledTransport()
    await render(transport)
    await settle()
    calls[0]!.reject(new TypeError('Failed to fetch'))
    await settle(10)
    gate.resolve()
    await settle(20)
    expect(states.some((state) => state.status === 'error')).toBe(false)
    expect(states.at(-1)?.status).toBe('ready')
  })

  for (const poolMode of [undefined, 'album-preview'] as const) {
    test(`a new transport object for the same user and image starts no new request (${poolMode ?? 'plain'})`, async () => {
      const first = controlledTransport()
      await render(first.transport, poolMode)
      await settle()
      first.calls[0]!.resolve(trackedImage('"v1"').response)
      await settle(20)
      const shown = states.at(-1)
      expect(shown?.status).toBe('ready')

      const second = controlledTransport()
      await render(second.transport, poolMode)
      await settle(20)
      expect(first.calls).toHaveLength(1)
      expect(second.calls).toHaveLength(0)
      expect(states.at(-1)).toEqual(shown!)
    })
  }
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
