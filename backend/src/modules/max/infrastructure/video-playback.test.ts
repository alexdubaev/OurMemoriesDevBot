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

  test('accepts extensionless signed MAX CDN URLs while keeping the host allowlist', () => {
    expect(selectRendition([
      { url: 'https://maxvd123.okcdn.ru/3f8e5c?sig=opaque', width: 1280, height: 720, contentLength: 1 },
      { url: 'https://maxvd123.okcdn.ru/480.mp4?sig=opaque', width: 854, height: 480, contentLength: 1 },
      { url: 'https://maxvd123.evil.example/720?sig=opaque', width: 1280, height: 720, contentLength: 1 },
      { url: 'https://user:pass@maxvd123.okcdn.ru/720?sig=opaque', width: 1280, height: 720, contentLength: 1 },
      { url: 'https://maxvd123.okcdn.ru:8443/720?sig=opaque', width: 1280, height: 720, contentLength: 1 },
      { url: 'https://maxvd123.okcdn.ru/1080?sig=opaque', width: 1920, height: 1080, contentLength: 1 },
    ])).toMatchObject({ height: 720, width: 1280, url: 'https://maxvd123.okcdn.ru/3f8e5c?sig=opaque' })
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

  test('fetches an extensionless signed MAX CDN URL after validating the video response', async () => {
    const originalFetch = globalThis.fetch
    let requestedUrl: string | undefined
    globalThis.fetch = (async (input) => {
      requestedUrl = String(input)
      return new Response(new Uint8Array([1, 2]), { status: 200, headers: {
        'content-type': 'video/mp4', 'content-length': '2',
      } })
    }) as typeof fetch
    try {
      const result = await fetchCdnVideo('https://maxvd123.okcdn.ru/3f8e5c?sig=opaque', undefined, 'GET', 250)
      expect(requestedUrl).toBe('https://maxvd123.okcdn.ru/3f8e5c?sig=opaque')
      expect(await new Response(result.body).arrayBuffer()).toHaveLength(2)
    } finally { globalThis.fetch = originalFetch }
  })

  test('still rejects an extensionless MAX CDN URL when the response is not video/mp4', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: {
      'content-type': 'application/octet-stream', 'content-length': '2',
    } })) as unknown as typeof fetch
    try {
      await expect(fetchCdnVideo('https://maxvd123.okcdn.ru/3f8e5c?sig=opaque', undefined, 'GET', 250))
        .rejects.toMatchObject({ kind: 'unsupported_media', message: 'Медиа недоступно' })
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

  test('sanitizes failures while cancelling rejected CDN responses', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(new ReadableStream({ cancel() { throw new Error('signed-url-token-leaked') } }), {
      status: 302, headers: { location: 'https://maxvd1.okcdn.ru/next.mp4' },
    })) as unknown as typeof fetch
    try {
      await expect(fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', undefined, 'GET', 250)).rejects.toMatchObject({ kind: 'unsupported_media', message: 'Медиа недоступно' })
    } finally { globalThis.fetch = originalFetch }
  })

  test('preserves caller abort reason when cancellation overlaps a rejected CDN response', async () => {
    const originalFetch = globalThis.fetch
    const controller = new AbortController()
    const callerError = new Error('caller-aborted')
    let cancellationStarted!: () => void
    let finishCancellation!: () => void
    const cancellationHasStarted = new Promise<void>((resolve) => { cancellationStarted = resolve })
    const cancellationResult = new Promise<void>((_resolve, reject) => { finishCancellation = () => reject(new Error('signed-url-token-leaked')) })
    globalThis.fetch = (async () => new Response(new ReadableStream({
      cancel() {
        cancellationStarted()
        return cancellationResult
      },
    }), { status: 302, headers: { location: 'https://maxvd1.okcdn.ru/next.mp4' } })) as unknown as typeof fetch
    try {
      const request = fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', undefined, 'GET', 250, controller.signal)
      await cancellationHasStarted
      controller.abort(callerError)
      finishCancellation()
      await expect(request).rejects.toBe(callerError)
    } finally { globalThis.fetch = originalFetch }
  })

  test('preserves caller abort reason when CDN cancellation never settles', async () => {
    const originalFetch = globalThis.fetch
    const controller = new AbortController()
    const callerError = new Error('caller-aborted')
    let cancellationStarted!: () => void
    const cancellationHasStarted = new Promise<void>((resolve) => { cancellationStarted = resolve })
    globalThis.fetch = (async () => new Response(new ReadableStream({
      cancel() {
        cancellationStarted()
        return new Promise<void>(() => {})
      },
    }), { status: 302, headers: { location: 'https://maxvd1.okcdn.ru/next.mp4' } })) as unknown as typeof fetch
    try {
      const request = fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', undefined, 'GET', 250, controller.signal)
      let settled = false
      let rejection: unknown
      void request.then(() => { settled = true }, (error) => { settled = true; rejection = error })
      await cancellationHasStarted
      controller.abort(callerError)
      for (let turn = 0; turn < 8 && !settled; turn += 1) await Promise.resolve()
      expect(settled).toBe(true)
      expect(rejection).toBe(callerError)
    } finally { globalThis.fetch = originalFetch }
  })

  test('sanitizes a never-settling CDN cancellation without a caller signal', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(new ReadableStream({ cancel() { return new Promise<void>(() => {}) } }), {
      status: 302, headers: { location: 'https://maxvd1.okcdn.ru/next.mp4' },
    })) as unknown as typeof fetch
    try {
      const request = fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', undefined, 'GET', 250)
      let settled = false
      let rejection: unknown
      void request.then(() => { settled = true }, (error) => { settled = true; rejection = error })
      for (let turn = 0; turn < 8 && !settled; turn += 1) await Promise.resolve()
      expect(settled).toBe(true)
      expect(rejection).toMatchObject({ kind: 'unsupported_media', message: 'Медиа недоступно' })
    } finally { globalThis.fetch = originalFetch }
  })

  test('sanitizes a never-settling CDN cancellation with a non-aborted caller signal', async () => {
    const originalFetch = globalThis.fetch
    const controller = new AbortController()
    globalThis.fetch = (async () => new Response(new ReadableStream({ cancel() { return new Promise<void>(() => {}) } }), {
      status: 302, headers: { location: 'https://maxvd1.okcdn.ru/next.mp4' },
    })) as unknown as typeof fetch
    try {
      const request = fetchCdnVideo('https://maxvd1.okcdn.ru/video.mp4', undefined, 'GET', 250, controller.signal)
      let settled = false
      let rejection: unknown
      void request.then(() => { settled = true }, (error) => { settled = true; rejection = error })
      for (let turn = 0; turn < 8 && !settled; turn += 1) await Promise.resolve()
      expect(settled).toBe(true)
      expect(rejection).toMatchObject({ kind: 'unsupported_media', message: 'Медиа недоступно' })
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

  test('plays an authorized outbound MAX video through its separate source projection', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(new Uint8Array([1, 2]), { status: 200, headers: {
      'content-type': 'video/mp4', 'content-length': '2',
    } })) as unknown as typeof fetch
    try {
      const playback = createMaxVideoPlayback({
        runtime: { env: { MAX_VIDEO_MAX_BYTES: 250_000_000 }, prisma: {
          familyMember: { findFirst: async () => ({ role: 'viewer', family: { ownerUserId: 'owner-id' } }) },
          maxVideoReference: { findFirst: async () => ({
            id: 'reference-id', familyId: 'family-id', attachmentPosition: 0, providerAttachmentId: 'attachment-id',
            source: null,
            outboundSource: { familyId: 'family-id', recipientId: 123n, messageId: 'outbound-message-id' },
            memory: { id: 'memory-id', familyId: 'family-id', status: 'published', deletedAt: null },
          }) },
        } } as never,
        api: {
          getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }),
          getMessage: async () => ({ messageId: 'outbound-message-id', senderId: '900', recipientId: '123', attachments: [
            { kind: 'video', providerAttachmentId: 'attachment-id', currentToken: 'rotating-token', inboundDurationSeconds: null, width: 1280, height: 720 },
          ] }),
          getVideo: async () => ({ width: 1280, height: 720, durationMs: null, renditions: [
            { url: 'https://maxvd1.okcdn.ru/outbound-video?sig=opaque', width: 1280, height: 720, contentLength: 2 },
          ] }),
        } as never,
      })

      const result = await playback.content(
        { familyId: 'family-id', principal: { userId: 'viewer-id', sessionId: 'session-id' } },
        'reference-id', undefined, 'GET',
      )

      expect(result.contentType).toBe('video/mp4')
      expect(result.bodyLength).toBe(2)
      expect(await new Response(result.body).arrayBuffer()).toHaveLength(2)
    } finally { globalThis.fetch = originalFetch }
  })
})
