import { describe, expect, test } from 'bun:test'

import { createMaxApi, MaxProviderError } from './infrastructure/max-api'

const token = 'max:test-only-token'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('MAX API client', () => {
  test('uses the pinned host and header-only token for identity', async () => {
    const requests: Request[] = []
    const api = createMaxApi(token, {
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return response({ user_id: 42, username: 'OurMemoriesMaxBot', is_bot: true, name: 'optional' })
      },
    })

    await expect(api.getMe()).resolves.toEqual({
      userId: 42,
      username: 'OurMemoriesMaxBot',
      isBot: true,
    })
    expect(requests[0]!.url).toBe('https://platform-api2.max.ru/me')
    expect(requests[0]!.headers.get('authorization')).toBe(token)
    expect(requests[0]!.url).not.toContain(token)
  })

  test('normalizes subscriptions and sends the exact create body', async () => {
    const requests: Request[] = []
    const api = createMaxApi(token, {
      fetch: async (input, init) => {
        requests.push(new Request(input, init))
        return requests.length === 1
          ? response({ subscriptions: [{ url: 'https://example.com/hook', time: 1700000000000, update_types: ['message_created'] }] })
          : response({ success: true })
      },
    })

    await expect(api.getSubscriptions()).resolves.toEqual([{
      url: 'https://example.com/hook', time: 1700000000000, updateTypes: ['message_created'],
    }])
    await expect(api.createSubscription({
      url: 'https://example.com/hook', updateTypes: ['message_created', 'bot_started'], secret: 'test-only-secret',
    })).resolves.toEqual({ success: true })
    expect(requests[0]!.url).toBe('https://platform-api2.max.ru/subscriptions')
    expect(requests[1]!.method).toBe('POST')
    const requestBody = await requests[1]!.json()
    expect(requestBody).toEqual({
      url: 'https://example.com/hook', update_types: ['message_created', 'bot_started'], secret: 'test-only-secret',
    })
    expect(JSON.stringify(requestBody)).not.toContain('version')
  })

  test('encodes only the delete URL query parameter and never the token', async () => {
    let request: Request | undefined
    const api = createMaxApi(token, {
      fetch: async (input, init) => {
        request = new Request(input, init)
        return response({ success: true })
      },
    })

    await expect(api.deleteSubscription('https://example.com/a?x=1&y=2')).resolves.toEqual({ success: true })
    expect(request!.url).toBe('https://platform-api2.max.ru/subscriptions?url=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2')
    expect(request!.headers.get('authorization')).toBe(token)
    expect(request!.url).not.toContain(token)
  })

  test('rejects subscription secrets outside the documented character and length bounds before fetch', async () => {
    let fetchCalls = 0
    const api = createMaxApi(token, { fetch: async () => {
      fetchCalls += 1
      return response({ success: true })
    } })
    const input = { url: 'https://example.com/hook', updateTypes: ['message_created'], secret: '' }
    await expect(api.createSubscription({ ...input, secret: 'abcd' })).rejects.toBeInstanceOf(MaxProviderError)
    await expect(api.createSubscription({ ...input, secret: 'a'.repeat(257) })).rejects.toBeInstanceOf(MaxProviderError)
    await expect(api.createSubscription({ ...input, secret: 'abc$d' })).rejects.toBeInstanceOf(MaxProviderError)
    expect(fetchCalls).toBe(0)
  })

  test('sends a narrow message request with only the recipient in the query and token in the header', async () => {
    let request: Request | undefined
    const api = createMaxApi(token, {
      fetch: async (input, init) => {
        request = new Request(input, init)
        return response({ message: { body: 'accepted' } })
      },
    })

    await expect(api.sendMessage({ userId: '77', text: 'Сохраняем…' })).resolves.toBeUndefined()
    expect(request!.method).toBe('POST')
    expect(request!.url).toBe('https://platform-api2.max.ru/messages?user_id=77')
    expect(request!.headers.get('content-type')).toBe('application/json')
    expect(request!.headers.get('authorization')).toBe(token)
    expect(await request!.json()).toEqual({ text: 'Сохраняем…' })
    expect(request!.url).not.toContain(token)
  })

  test('validates decimal recipients, the 4000-code-point bound, and the documented response envelope', async () => {
    let fetchCalls = 0
    const api = createMaxApi(token, {
      fetch: async () => {
        fetchCalls += 1
        return response({ message: {} })
      },
    })

    for (const userId of ['', '0', '-1', '1.2', 'abc']) {
      await expect(api.sendMessage({ userId, text: 'ok' })).rejects.toBeInstanceOf(MaxProviderError)
    }
    await expect(api.sendMessage({ userId: '77', text: '💛'.repeat(4_001) })).rejects.toBeInstanceOf(MaxProviderError)
    await expect(api.sendMessage({ userId: '77', text: 'ok' })).resolves.toBeUndefined()
    await expect(createMaxApi(token, { fetch: async () => response({}) }).sendMessage({ userId: '77', text: 'ok' }))
      .rejects.toBeInstanceOf(MaxProviderError)
    expect(fetchCalls).toBe(1)
  })

  test('exposes only a sanitized numeric retry delay for a rate limit', async () => {
    const api = createMaxApi(token, {
      fetch: async () => new Response(JSON.stringify({ message: token }), {
        status: 429,
        headers: { 'retry-after': '17.5', 'content-type': 'application/json' },
      }),
    })

    await expect(api.sendMessage({ userId: '77', text: 'ok' })).rejects.toMatchObject({
      name: 'MaxProviderError', retryAfterSeconds: 17.5,
    })
    await expect(api.sendMessage({ userId: '77', text: 'ok' })).rejects.not.toThrow(token)
  })

  test('rejects non-2xx, malformed responses, and network failures generically', async () => {
    const statuses = [
      async () => response({ message: token }, 500),
      async () => response({ user_id: 0, username: '', is_bot: true }),
      async () => { throw new Error(`network ${token}`) },
    ]
    for (const fetch of statuses) {
      const api = createMaxApi(token, { fetch })
      await expect(api.getMe()).rejects.toBeInstanceOf(MaxProviderError)
      await expect(api.getMe()).rejects.not.toThrow(token)
    }
  })

  test('distinguishes malformed video responses from retryable provider failures', async () => {
    const malformed = createMaxApi(token, { fetch: async () => response({ urls: { mp4_720: 'http://unsafe.example/video.mp4' } }) })
    await expect(malformed.getVideo!('rotating/token')).rejects.toMatchObject({ name: 'MaxProviderError', retryable: false })

    const unavailable = createMaxApi(token, { fetch: async () => { throw new Error('network unavailable') } })
    await expect(unavailable.getVideo!('rotating/token')).rejects.toMatchObject({ name: 'MaxProviderError', retryable: true })
  })

  test('combines the fixed timeout with caller cancellation', async () => {
    const api = createMaxApi(token, {
      fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')), { once: true })
      }),
    })
    await expect(api.getMe()).rejects.toBeInstanceOf(MaxProviderError)

    const controller = new AbortController()
    const pending = api.getMe(controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(MaxProviderError)
  }, 12_000)

  test('looks up a message with only its encoded identity and returns ordered transient URLs', async () => {
    let request: Request | undefined
    const api = createMaxApi(token, { fetch: async (input, init) => {
      request = new Request(input, init)
      return response({ messages: [{ sender: { user_id: 42 }, recipient: { chat_id: null, chat_type: 'dialog', user_id: 99 }, body: {
        mid: 'm/1', attachments: [
          { type: 'image', payload: { photo_id: 1_234, token: 'rotating', url: 'https://i.oneme.ru/a' } },
          { type: 'file', payload: { fileId: 'f-1', token: 'rotating-2', url: 'https://fd.oneme.ru/b' }, filename: 'x.png', size: 12 },
        ],
      } }] })
    } })
    await expect(api.getMessage('m/1')).resolves.toEqual({ messageId: 'm/1', senderId: '42', recipientId: '99', attachments: [
      { kind: 'image', providerAttachmentId: '1234', url: 'https://i.oneme.ru/a' },
      { kind: 'file', providerAttachmentId: 'f-1', filename: 'x.png', declaredSize: 12, url: 'https://fd.oneme.ru/b' },
    ] })
    expect(request!.method).toBe('GET')
    expect(request!.url).toBe('https://platform-api2.max.ru/messages?message_ids=m%2F1')
    expect(request!.headers.get('authorization')).toBe(token)
    expect(JSON.stringify(request)).not.toContain('rotating')
  })

  test('accepts a live-shaped direct dialog with a positive numeric chat id', async () => {
    const api = createMaxApi(token, { fetch: async () => response({ messages: [{
      sender: { user_id: 42 }, recipient: { chat_id: 900, chat_type: 'dialog', user_id: 99 }, body: {
        mid: 'live-m/1', attachments: [],
      },
    }] }) })

    await expect(api.getMessage('live-m/1')).resolves.toEqual({
      messageId: 'live-m/1', senderId: '42', recipientId: '99', attachments: [],
    })
  })

  test('resolves a live-shaped file image with a numeric fileId and rejects invalid numeric fileIds', async () => {
    const message = (fileId: unknown) => ({ messages: [{
      sender: { user_id: 42 }, recipient: { chat_id: 900, chat_type: 'dialog', user_id: 99 }, body: {
        mid: 'live-file/1', attachments: [
          { type: 'file', payload: { fileId, token: 'rotating-file', url: 'https://fd.oneme.ru/file' }, filename: 'photo.png', size: 9 },
        ],
      },
    }] })

    const api = createMaxApi(token, { fetch: async () => response(message(12345)) })
    await expect(api.getMessage('live-file/1')).resolves.toEqual({
      messageId: 'live-file/1', senderId: '42', recipientId: '99', attachments: [
        { kind: 'file', providerAttachmentId: '12345', filename: 'photo.png', declaredSize: 9, url: 'https://fd.oneme.ru/file' },
      ],
    })

    for (const fileId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = createMaxApi(token, { fetch: async () => response(message(fileId)) })
      await expect(invalid.getMessage('live-file/1')).rejects.toMatchObject({ name: 'MaxProviderError', retryable: false })
    }
  })

  test('looks up a live-shaped video and resolves its exact encoded rotating token', async () => {
    const requests: Request[] = []
    const api = createMaxApi(token, { fetch: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (requests.length === 1) return response({ messages: [{ sender: { user_id: 42 }, recipient: { chat_id: null, chat_type: 'dialog', user_id: 99 }, body: {
        mid: 'm.dotted', attachments: [{ type: 'video', payload: { id: 123, token: 'rotating/token', url: 'https://v.oneme.ru/current', duration: 7, width: 1280, height: 720 } }],
      } }] })
      return response({ width: 720, height: 1_280, videos: [{ url: 'https://maxvd123.okcdn.ru/video.mp4?sig=opaque', width: 1280, height: 720, duration: 7000, size: 12_345 }] })
    } })

    const message = await api.getMessage('m.dotted')
    expect(message.attachments).toEqual([{ kind: 'video', providerAttachmentId: '123', currentToken: 'rotating/token', inboundDurationSeconds: 7, width: 1280, height: 720 }])
    const video = await api.getVideo!('rotating/token')
    expect(video).toMatchObject({ width: 720, height: 1_280 })
    expect(video.renditions[0]).toMatchObject({ url: 'https://maxvd123.okcdn.ru/video.mp4?sig=opaque', height: 720 })
    expect(requests[0]!.url).toBe('https://platform-api2.max.ru/messages?message_ids=m.dotted')
    expect(requests[1]!.url).toBe('https://platform-api2.max.ru/videos/rotating%2Ftoken')
    expect(requests.every((request) => request.headers.get('authorization') === token)).toBe(true)
  })

  test('normalizes the live object-shaped urls.mp4_720 response family', async () => {
    const api = createMaxApi(token, { fetch: async () => response({
      urls: {
        mp4_1080: 'https://maxvd123.okcdn.ru/video-1080.mp4?sig=opaque',
        mp4_720: 'https://maxvd123.okcdn.ru/video-720.mp4?sig=opaque',
      },
      duration: 7000,
    }) })

    await expect(api.getVideo!('rotating/token')).resolves.toEqual({
      width: null,
      height: null,
      durationMs: 7000,
      renditions: [
        { url: 'https://maxvd123.okcdn.ru/video-1080.mp4?sig=opaque', width: null, height: 1080, contentLength: null },
        { url: 'https://maxvd123.okcdn.ru/video-720.mp4?sig=opaque', width: null, height: 720, contentLength: null },
      ],
    })
  })
})
