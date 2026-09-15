import { describe, expect, test } from 'bun:test'

import { createMaxMediaDownload } from './media-download'

describe('MAX credential-free media download', () => {
  test('allows only the two observed exact HTTPS hosts and returns exact bytes', async () => {
    const bytes = Uint8Array.of(1, 2, 3)
    let request: Request | undefined
    const download = createMaxMediaDownload({ fetch: async (input, init) => {
      request = new Request(input, init)
      return new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })
    } })
    await expect(download('https://i.oneme.ru/path', 10)).resolves.toMatchObject({ bytes, contentLength: 3 })
    expect(request!.headers.get('authorization')).toBeNull()
    expect(request!.headers.get('cookie')).toBeNull()
    for (const url of ['http://i.oneme.ru/path', 'https://evil.i.oneme.ru/path', 'https://i.oneme.ru.evil.test/path', 'https://user:i.oneme.ru/path', 'https://example.test/path']) {
      await expect(download(url, 10)).rejects.toThrow()
    }
  })

  test('rejects redirects and enforces actual streamed bytes', async () => {
    const redirect = createMaxMediaDownload({ fetch: async () => new Response(null, { status: 302, headers: { location: 'https://fd.oneme.ru/next' } }) })
    await expect(redirect('https://fd.oneme.ru/a', 10)).rejects.toThrow()
    const oversized = createMaxMediaDownload({ fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2, 3, 4)); controller.close() },
    }), { headers: { 'content-length': '1' } }) })
    await expect(oversized('https://fd.oneme.ru/a', 3)).rejects.toThrow()
  })
})
