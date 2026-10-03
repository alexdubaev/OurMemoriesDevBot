import { describe, expect, test } from 'bun:test'

import { createMaxMediaDownload, createMaxPosterDownload, createMaxVideoStreamDownload, MaxMediaDownloadError } from './media-download'
import { MaxProviderError } from './max-api'

describe('MAX credential-free media download', () => {
  test('downloads the exact pimg.mycdn.me JPEG thumbnail under a poster-only host policy', async () => {
    let request: Request | undefined
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const download = createMaxPosterDownload({ fetch: async (input, init) => {
      request = new Request(input, init)
      return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.byteLength) } })
    } })
    for (const url of ['https://pimg.mycdn.me/some/path?sig=opaque', 'https://i.oneme.ru/old.jpg', 'https://fd.oneme.ru/old.jpg', 'https://a.oneme.ru/old.jpg']) {
      await expect(download(url, 64)).resolves.toMatchObject({ bytes, contentLength: 4, contentType: 'image/jpeg' })
    }
    expect(request?.redirect).toBe('manual')
    expect(request?.headers.get('authorization')).toBeNull()
    expect(request?.headers.get('cookie')).toBeNull()
  })

  test('poster download rejects redirects, other hosts, and oversized response bytes', async () => {
    const reject = createMaxPosterDownload({ fetch: async () => new Response(null, { status: 302, headers: { location: 'https://pimg.mycdn.me/next' } }) })
    await expect(reject('https://pimg.mycdn.me/a', 64)).rejects.toBeInstanceOf(MaxMediaDownloadError)
    await expect(reject('https://pimg.mycdn.me.evil.test/a', 64)).rejects.toBeInstanceOf(MaxMediaDownloadError)
    const oversized = createMaxPosterDownload({ fetch: async () => new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-type': 'image/jpeg', 'content-length': '3' } }) })
    await expect(oversized('https://pimg.mycdn.me/a', 2)).rejects.toBeInstanceOf(MaxMediaDownloadError)
  })
  test('allows only the three observed exact HTTPS hosts and returns exact bytes', async () => {
    const bytes = Uint8Array.of(1, 2, 3)
    let request: Request | undefined
    const download = createMaxMediaDownload({ fetch: async (input, init) => {
      request = new Request(input, init)
      return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    } })
    for (const url of [
      'https://i.oneme.ru/path',
      'https://fd.oneme.ru/path',
      'https://a.oneme.ru/path',
    ]) {
      await expect(download(url, 10)).resolves.toMatchObject({ bytes, contentLength: 3 })
    }
    expect(request!.headers.get('authorization')).toBeNull()
    expect(request!.headers.get('cookie')).toBeNull()
    for (const url of ['http://a.oneme.ru/path', 'https://a.oneme.ru.evil.example/path', 'https://evil-a.oneme.ru/path', 'https://evil.i.oneme.ru/path', 'https://i.oneme.ru.evil.test/path', 'https://user:i.oneme.ru/path', 'https://example.test/path']) {
      await expect(download(url, 10)).rejects.toThrow()
    }
  })

  test('rejects redirects and enforces actual streamed bytes', async () => {
    const redirect = createMaxMediaDownload({ fetch: async () => new Response(null, { status: 302, headers: { location: 'https://fd.oneme.ru/next' } }) })
    await expect(redirect('https://fd.oneme.ru/a', 10)).rejects.toThrow()
    let cancelled = false
    const oversized = createMaxMediaDownload({ fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3, 4)) },
      cancel() { cancelled = true },
    }), { headers: { 'content-length': '1' } }) })
    await expect(oversized('https://fd.oneme.ru/a', 3)).rejects.toBeInstanceOf(MaxMediaDownloadError)
    expect(cancelled).toBe(true)
  })

  test('keeps network, timeout, 408, 429, and 5xx failures retryable while validation failures are permanent', async () => {
    for (const status of [408, 429, 500, 503]) {
      const download = createMaxMediaDownload({ fetch: async () => new Response(null, { status }) })
      await expect(download('https://i.oneme.ru/a', 10)).rejects.toBeInstanceOf(MaxProviderError)
      await expect(download('https://i.oneme.ru/a', 10)).rejects.not.toBeInstanceOf(MaxMediaDownloadError)
    }
  })

  test('bounds credential-free MAX video CDN streaming to approved hosts and retries CDN outages', async () => {
    const requestUrls: string[] = []
    const download = createMaxVideoStreamDownload({ fetch: async (input) => {
      requestUrls.push(String(input))
      return new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-type': 'video/mp4', 'content-length': '3' } })
    } })
    const streamed = await download('https://maxvd123.okcdn.ru/path?sig=opaque', 3)
    expect(streamed.contentLength).toBe(3)
    expect(new Uint8Array(await new Response(streamed.body).arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
    expect(requestUrls).toHaveLength(1)
    for (const url of ['https://maxvd123.okcdn.ru.evil.test/x', 'https://i.oneme.ru/x', 'http://maxvd123.okcdn.ru/x', 'https://user:maxvd123.okcdn.ru/x']) {
      await expect(download(url, 3)).rejects.toBeInstanceOf(MaxMediaDownloadError)
    }
    expect(requestUrls).toHaveLength(1)
    const outage = createMaxVideoStreamDownload({ fetch: async () => new Response(null, { status: 503 }) })
    try { await outage('https://maxvd123.okcdn.ru/x', 3); throw new Error('expected outage') } catch (error) {
      expect(error).toBeInstanceOf(MaxProviderError)
      expect((error as MaxProviderError).retryable).toBe(true)
    }
  })

  test('streams a video without reading its body before private ingestion and verifies its length', async () => {
    let reads = 0
    const download = createMaxVideoStreamDownload({ fetch: async () => new Response(new ReadableStream({
      pull(controller) { reads += 1; controller.enqueue(Uint8Array.of(reads)); if (reads === 3) controller.close() },
    }), { headers: { 'content-type': 'video/mp4', 'content-length': '3' } }) })
    const result = await download('https://maxvd123.okcdn.ru/video?sig=opaque', 10)
    expect(result.contentLength).toBe(3)
    expect(reads).toBeLessThan(3)
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
    expect(result.failure()).toBeNull()
  })

  test('rejects oversized and malformed video responses and keeps transient CDN failures retryable', async () => {
    const tooLarge = createMaxVideoStreamDownload({ fetch: async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4', 'content-length': '101' } }) })
    await expect(tooLarge('https://maxvd123.okcdn.ru/video', 100)).rejects.toBeInstanceOf(MaxMediaDownloadError)
    const malformed = createMaxVideoStreamDownload({ fetch: async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'text/html', 'content-length': '1' } }) })
    await expect(malformed('https://maxvd123.okcdn.ru/video', 100)).rejects.toBeInstanceOf(MaxMediaDownloadError)
    const outage = createMaxVideoStreamDownload({ fetch: async () => new Response(null, { status: 503 }) })
    try { await outage('https://maxvd123.okcdn.ru/video', 100); throw new Error('expected outage') } catch (error) {
      expect(error).toBeInstanceOf(MaxProviderError)
      expect((error as MaxProviderError).retryable).toBe(true)
    }
  })

  test('stops a streamed video once actual bytes exceed the declared length', async () => {
    let cancelled = false
    const download = createMaxVideoStreamDownload({ fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3)) },
      cancel() { cancelled = true },
    }), { headers: { 'content-type': 'video/mp4', 'content-length': '2' } }) })
    const result = await download('https://maxvd123.okcdn.ru/video', 10)
    await expect(new Response(result.body).arrayBuffer()).rejects.toBeInstanceOf(MaxMediaDownloadError)
    expect(result.failure()).toBeInstanceOf(MaxMediaDownloadError)
    expect(cancelled).toBe(true)
  })

  test('classifies a truncated streamed CDN body as retryable', async () => {
    const download = createMaxVideoStreamDownload({ fetch: async () => new Response(Uint8Array.of(1), { headers: {
      'content-type': 'video/mp4', 'content-length': '2',
    } }) })
    const result = await download('https://maxvd123.okcdn.ru/video', 10)
    await expect(new Response(result.body).arrayBuffer()).rejects.toBeInstanceOf(MaxProviderError)
    expect(result.failure()?.retryable).toBe(true)
  })

  test('lets a valid body finish after the short response-header timeout', async () => {
    const download = createMaxVideoStreamDownload({ timeoutMs: 5, fetch: async (_input, init) => new Response(new ReadableStream({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        if (init?.signal?.aborted) { controller.error(new Error('header timer aborted the body')); return }
        controller.enqueue(Uint8Array.of(1, 2, 3))
        controller.close()
      },
    }), { headers: { 'content-type': 'video/mp4', 'content-length': '3' } }) })
    const result = await download('https://maxvd123.okcdn.ru/video', 10)
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3))
    expect(result.failure()).toBeNull()
  })

  test('uses a bounded body fallback only when no caller deadline is supplied', async () => {
    const makeDownload = () => createMaxVideoStreamDownload({ timeoutMs: 5, bodyTimeoutMs: 10,
      fetch: async (_input, init) => new Response(new ReadableStream({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 30))
          if (init?.signal?.aborted) { controller.error(new Error('body timed out')); return }
          controller.enqueue(Uint8Array.of(1))
          controller.close()
        },
      }), { headers: { 'content-type': 'video/mp4', 'content-length': '1' } }),
    })
    const withoutCaller = await makeDownload()('https://maxvd123.okcdn.ru/video', 10)
    await expect(new Response(withoutCaller.body).arrayBuffer()).rejects.toBeInstanceOf(MaxProviderError)
    expect(withoutCaller.failure()?.retryable).toBe(true)
    const caller = new AbortController()
    const withCaller = await makeDownload()('https://maxvd123.okcdn.ru/video', 10, caller.signal)
    expect(new Uint8Array(await new Response(withCaller.body).arrayBuffer())).toEqual(Uint8Array.of(1))
    expect(withCaller.failure()).toBeNull()
  })
})
