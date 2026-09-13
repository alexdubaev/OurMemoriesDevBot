import { afterEach, expect, test } from 'bun:test'

import { privateMediaSource, syncPrivateMediaAccessToken } from '../src/platform/media/private-media-access'
import { toggleMediaPlayback } from '../src/platform/media/playback'

const path = '/api/v1/families/11111111-1111-4111-8111-111111111111/media/22222222-2222-4222-8222-222222222222/content?variant=playback'

const originalNavigator = globalThis.navigator
const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
const originalMessageChannel = globalThis.MessageChannel

afterEach(() => {
  syncPrivateMediaAccessToken(null)
  Object.assign(globalThis, {
    navigator: originalNavigator,
    fetch: originalFetch,
    window: originalWindow,
    MessageChannel: originalMessageChannel,
  })
})

test('a browser without Service Worker support bootstraps an HttpOnly media session and returns a same-origin source', async () => {
  Object.assign(globalThis, { navigator: {} })
  const requests: Array<{ input: string; init: RequestInit | undefined }> = []
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init })
    return new Response(null, { status: 204 })
  }
  syncPrivateMediaAccessToken('access-token-for-test')

  const source = await privateMediaSource(path)

  expect(source).toBe(path)
  const grant = requests.find(({ input }) => input.includes('/playback-session'))
  expect(grant).toEqual({
    input: '/api/v1/families/11111111-1111-4111-8111-111111111111/media/playback-session',
    init: expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ Authorization: 'Bearer access-token-for-test' }),
    }),
  })
  expect(source).not.toContain('access-token-for-test')
  expect(source).not.toContain('bearer=')
  expect(source).not.toContain('token=')
})

test('a controlled Service Worker keeps the existing protected source path without a cookie bootstrap', async () => {
  const requests: string[] = []
  const active = {
    postMessage(_message: unknown, ports: MessagePort[]) { ports[0]!.postMessage(undefined) },
  }
  Object.assign(globalThis, {
    navigator: {
      serviceWorker: {
        controller: active,
        ready: Promise.resolve({ active }),
        register: async () => ({ active, installing: null, waiting: null }),
      },
    },
    fetch: async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(null, { status: 204 })
    },
    window: { clearTimeout, setTimeout },
    MessageChannel: class {
      port1: { onmessage: ((event: unknown) => void) | null } = { onmessage: null }
      port2 = { postMessage: (value: unknown) => this.port1.onmessage?.({ data: value }) }
    } as unknown as typeof MessageChannel,
  })
  syncPrivateMediaAccessToken('access-token-for-test')

  expect(await privateMediaSource(path)).toBe(path)
  expect(requests.some((input) => input.includes('/playback-session'))).toBe(false)
})

test('a no-Service-Worker source is assigned before native audio play is called', async () => {
  Object.assign(globalThis, { navigator: {} })
  globalThis.fetch = async () => new Response(null, { status: 204 })
  syncPrivateMediaAccessToken('access-token-for-test')
  const audio = {
    paused: true,
    playCalls: 0,
    src: '',
    pause() {},
    async play() { this.playCalls += 1 },
  }

  audio.src = (await privateMediaSource(path))!
  const playing = await toggleMediaPlayback(audio)

  expect(audio.src).toBe(path)
  expect(audio.playCalls).toBe(1)
  expect(playing).toBe(true)
})
