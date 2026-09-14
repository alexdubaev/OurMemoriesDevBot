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
})
