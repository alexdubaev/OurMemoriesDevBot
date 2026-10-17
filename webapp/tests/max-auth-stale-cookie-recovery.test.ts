import { afterEach, describe, expect, test } from 'bun:test'

import { AuthApi } from '../src/features/auth/api'
import { ApiRequestError, HttpClient } from '../src/platform/api'
import { publishBrowserSessionState } from '../src/features/auth/session-coordinator'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  publishBrowserSessionState('cleared')
})

const authResponse = {
  user: {
    id: 'max-user', email: null, displayName: 'MAX test', role: 'user',
    createdAt: '2026-10-16T00:00:00.000Z',
  },
  accessToken: 'fresh access token',
}

function unauthorized() {
  return new Response(JSON.stringify({ error: {
    code: 'UNAUTHORIZED', message: 'Unauthorized', requestId: crypto.randomUUID(),
  } }), { status: 401, headers: { 'Content-Type': 'application/json' } })
}

describe('MAX authentication with a stale browser cookie', () => {
  test('authoritative bootstrap refresh rejection clears the stale cookie under the auth coordinator', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/refresh') return unauthorized()
      if (path === '/api/v1/auth/logout') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${path}`)
    }

    let accessToken: string | null = 'stale access token'
    const api = new AuthApi({
      getAccessToken: () => accessToken,
      setAccessToken: (value) => { accessToken = value },
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    await expect(api.refresh()).rejects.toBeInstanceOf(ApiRequestError)
    expect(requests).toEqual(['/api/v1/auth/refresh', '/api/v1/auth/logout'])
    expect(accessToken).toBeNull()
  })

  test('a newer session epoch prevents refresh rejection from clearing its cookie', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/refresh') {
        publishBrowserSessionState('authenticated')
        return unauthorized()
      }
      throw new Error(`Unexpected request ${path}`)
    }

    const api = new AuthApi({
      getAccessToken: () => 'old access token',
      setAccessToken: () => undefined,
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    await expect(api.refresh()).rejects.toBeInstanceOf(ApiRequestError)
    expect(requests).toEqual(['/api/v1/auth/refresh'])
  })

  test('clears only after refresh confirms the cookie is invalid, then retries signed MAX login', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/max') return requests.filter((entry) => entry === path).length === 1
        ? unauthorized()
        : new Response(JSON.stringify(authResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/v1/auth/refresh') return unauthorized()
      if (path === '/api/v1/auth/logout') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${path}`)
    }

    let accessToken: string | null = 'old access token'
    const api = new AuthApi({
      getAccessToken: () => accessToken,
      setAccessToken: (value) => { accessToken = value },
      onAuthExpired: () => undefined,
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    const transition = await api.authenticateMax('fresh signed MAX initData')

    expect(requests).toEqual([
      '/api/v1/auth/max', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/max',
    ])
    expect(transition.data.accessToken).toBe('fresh access token')
    expect(accessToken).toBe('fresh access token')
  })

  test('does not expire the session when the recovered MAX retry is aborted', async () => {
    const controller = new AbortController()
    let maxAttempts = 0
    let expirationCount = 0
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/max') {
        maxAttempts += 1
        if (maxAttempts === 1) return unauthorized()
        controller.abort(new DOMException('The operation was aborted', 'AbortError'))
        throw controller.signal.reason
      }
      if (path === '/api/v1/auth/refresh') return unauthorized()
      if (path === '/api/v1/auth/logout') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${path}`)
    }

    let accessToken: string | null = 'existing access token'
    const api = new AuthApi({
      getAccessToken: () => accessToken,
      setAccessToken: (value) => { accessToken = value },
      onAuthExpired: () => { expirationCount += 1 },
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    await expect(api.authenticateMax('aborted recovered MAX retry', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toEqual([
      '/api/v1/auth/max', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/max',
    ])
    expect(accessToken).toBe('existing access token')
    expect(expirationCount).toBe(0)
  })

  test('does not expire the session when the recovered MAX retry gets a transient server error', async () => {
    let maxAttempts = 0
    let expirationCount = 0
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/max') {
        maxAttempts += 1
        if (maxAttempts === 1) return unauthorized()
        return new Response(JSON.stringify({ error: {
          code: 'INTERNAL_ERROR', message: 'Temporary failure', requestId: crypto.randomUUID(),
        } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      }
      if (path === '/api/v1/auth/refresh') return unauthorized()
      if (path === '/api/v1/auth/logout') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${path}`)
    }

    let accessToken: string | null = 'existing access token'
    const api = new AuthApi({
      getAccessToken: () => accessToken,
      setAccessToken: (value) => { accessToken = value },
      onAuthExpired: () => { expirationCount += 1 },
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    await expect(api.authenticateMax('transient recovered MAX retry')).rejects.toMatchObject({ status: 503 })
    expect(requests).toEqual([
      '/api/v1/auth/max', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/max',
    ])
    expect(accessToken).toBe('existing access token')
    expect(expirationCount).toBe(0)
  })

  test('does not clear an active browser session when MAX authentication is rejected', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/max') return unauthorized()
      if (path === '/api/v1/auth/refresh') return new Response(
        JSON.stringify({ accessToken: 'refreshed access token' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
      throw new Error(`Unexpected request ${path}`)
    }

    let accessToken: string | null = 'old access token'
    const api = new AuthApi({
      getAccessToken: () => accessToken,
      setAccessToken: (value) => { accessToken = value },
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    await expect(api.authenticateMax('invalid or replayed MAX initData')).rejects.toBeInstanceOf(ApiRequestError)
    expect(requests).toEqual(['/api/v1/auth/max', '/api/v1/auth/refresh'])
    expect(accessToken).toBe('old access token')
  })

  test('a newer browser session epoch prevents a delayed MAX failure from clearing its cookie', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/max') return unauthorized()
      if (path === '/api/v1/auth/refresh') {
        publishBrowserSessionState('authenticated')
        return unauthorized()
      }
      throw new Error(`Unexpected request ${path}`)
    }

    const api = new AuthApi({
      getAccessToken: () => 'old access token',
      setAccessToken: () => undefined,
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    await expect(api.authenticateMax('superseded MAX attempt'))
      .rejects.toMatchObject({ message: 'Browser auth session changed' })
    expect(requests).toEqual(['/api/v1/auth/max', '/api/v1/auth/refresh'])
  })

  test('a newer session epoch prevents a delayed MAX retry success from replacing its access token', async () => {
    let maxAttempts = 0
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      const path = String(input).split('?')[0]
      requests.push(path)
      if (path === '/api/v1/auth/max') {
        maxAttempts += 1
        if (maxAttempts === 1) return unauthorized()
        publishBrowserSessionState('cleared')
        return new Response(JSON.stringify(authResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (path === '/api/v1/auth/refresh') return unauthorized()
      if (path === '/api/v1/auth/logout') return new Response(null, { status: 204 })
      throw new Error(`Unexpected request ${path}`)
    }

    let accessToken: string | null = 'newer session token'
    const api = new AuthApi({
      getAccessToken: () => accessToken,
      setAccessToken: (value) => { accessToken = value },
      authCoordinator: async (operation) => operation(),
    }, new HttpClient())

    await expect(api.authenticateMax('delayed stale MAX retry'))
      .rejects.toMatchObject({ message: 'Browser auth session changed' })
    expect(requests).toEqual([
      '/api/v1/auth/max', '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/max',
    ])
    expect(accessToken).toBe('newer session token')
  })
})
