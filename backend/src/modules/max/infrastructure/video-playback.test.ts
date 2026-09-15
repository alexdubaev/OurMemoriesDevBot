import { describe, expect, test } from 'bun:test'

import { fetchCdnVideo, selectRendition, createMaxVideoPlayback } from './video-playback'

describe('MAX guarded video transport', () => {
  test('selects the highest MP4 rendition at or below 720p and rejects unsafe hosts', () => {
    expect(selectRendition([
      { url: 'https://maxvd1.okcdn.ru/1080.mp4?sig=x', width: 1920, height: 1080, contentLength: 1 },
      { url: 'https://maxvd1.okcdn.ru/720.mp4?sig=x', width: 1280, height: 720, contentLength: 1 },
      { url: 'https://maxvd2.okcdn.ru/480.mp4?sig=x', width: 854, height: 480, contentLength: 1 },
      { url: 'https://evil.example/720.mp4', width: 1280, height: 720, contentLength: 1 },
    ])).toMatchObject({ height: 720, width: 1280 })
  })

  test('forwards one Range without MAX credentials and returns consistent 206 headers', async () => {
    const originalFetch = globalThis.fetch
    let request: Request | undefined
    let requestInit: RequestInit | undefined
    globalThis.fetch = (async (input, init) => {
      requestInit = init
      request = new Request(input, init)
      return new Response(new Uint8Array([1, 2]), { status: 206, headers: {
        'content-type': 'video/mp4', 'content-length': '2', 'content-range': 'bytes 4-5/10',
      } })
    }) as typeof fetch
    try {
      const result = await fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4?sig=opaque', 'bytes=4-5', 'GET', 250)
      expect(request!.headers.get('range')).toBe('bytes=4-5')
      expect(request!.headers.get('authorization')).toBeNull()
      expect(requestInit!.credentials).toBe('omit')
      expect(result.range).toEqual({ start: 4, end: 5, total: 10 })
      expect(result.bodyLength).toBe(2)
      expect(await new Response(result.body).arrayBuffer()).toHaveLength(2)
    } finally { globalThis.fetch = originalFetch }
  })

  test('rejects redirects, malformed ranges, and content that exceeds the ceiling', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(null, { status: 302, headers: { location: 'https://maxvd1.okcdn.ru/next.mp4' } })) as unknown as typeof fetch
    try { await expect(fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', undefined, 'GET', 250)).rejects.toThrow('Медиа недоступно') } finally { globalThis.fetch = originalFetch }
    await expect(fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', 'bytes=0-1,2-3', 'GET', 250)).rejects.toThrow('Запрошенный диапазон')
  })

  test('preserves the CDN total for an unsatisfiable range', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(null, { status: 416, headers: { 'content-range': 'bytes */10' } })) as unknown as typeof fetch
    try {
      await expect(fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', 'bytes=10-', 'GET', 250)).rejects.toMatchObject({ kind: 'range_not_satisfiable', details: { total: 10 } })
    } finally { globalThis.fetch = originalFetch }
  })

  test('passes the request abort signal and rejects a CDN body that exceeds declared length', async () => {
    const originalFetch = globalThis.fetch
    const controller = new AbortController()
    let requestInit: RequestInit | undefined
    globalThis.fetch = (async (_input, init) => {
      requestInit = init
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: {
        'content-type': 'video/mp4', 'content-length': '2',
      } })
    }) as typeof fetch
    try {
      const result = await fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', undefined, 'GET', 250, controller.signal)
      expect(requestInit!.signal).toBe(controller.signal)
      await expect(new Response(result.body).arrayBuffer()).rejects.toThrow('Медиа недоступно')
    } finally { globalThis.fetch = originalFetch }
  })

  test('sanitizes errors raised while reading or cancelling the CDN body', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(new ReadableStream({
      pull(controller) { controller.error(new Error('signed-url-token-leaked')) },
      cancel() { throw new Error('signed-url-token-leaked') },
    }), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '1' } })) as unknown as typeof fetch
    try {
      const result = await fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4?sig=opaque', undefined, 'GET', 250)
      await expect(new Response(result.body).arrayBuffer()).rejects.toMatchObject({ kind: 'storage_unavailable', message: 'Медиа недоступно' })
    } finally { globalThis.fetch = originalFetch }
  })

  test('sanitizes CDN network failures', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('signed-url-token-leaked') }) as unknown as typeof fetch
    try {
      await expect(fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4?sig=opaque', undefined, 'GET', 250)).rejects.toMatchObject({ kind: 'storage_unavailable', message: 'Медиа недоступно' })
    } finally { globalThis.fetch = originalFetch }
  })

  test('checks family membership before loading the MAX reference or calling the provider', async () => {
    let providerCalls = 0
    const playback = createMaxVideoPlayback({
      runtime: { env: { MAX_VIDEO_MAX_BYTES: 250_000_000 }, prisma: {
        familyMember: { findFirst: async () => null },
        maxVideoReference: { findFirst: async () => { providerCalls += 1; return null } },
      } } as never,
      api: {
        getMessage: async () => { providerCalls += 1; throw new Error('provider must not be called') },
        getVideo: async () => { providerCalls += 1; throw new Error('provider must not be called') },
      } as never,
    })

    await expect(playback.content({ familyId: 'family-id', principal: { userId: 'user-id', sessionId: 'session-id' } }, 'reference-id', undefined, 'GET')).rejects.toMatchObject({ kind: 'not_found' })
    expect(providerCalls).toBe(0)
  })
})
