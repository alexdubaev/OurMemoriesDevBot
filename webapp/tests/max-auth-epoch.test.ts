import { afterEach, describe, expect, test } from 'bun:test'

import { AuthApi } from '../src/features/auth/api'
import { HttpClient } from '../src/platform/api'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('MAX session epoch binding', () => {
  test('a same-token MAX transition creates a fresh API epoch while an older API instance remains invalid', async () => {
    const sameToken = 'same synthetic token'
    const authResponse = {
      user: {
        id: 'max-user', email: null, displayName: 'MAX test', role: 'user',
        createdAt: '2026-10-16T00:00:00.000Z',
      },
      accessToken: sameToken,
    }
    globalThis.fetch = async (input) => new Response(
      String(input).includes('/api/v1/auth/max') ? JSON.stringify(authResponse) : JSON.stringify({ approved: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )

    let token: string | null = sameToken
    const options = {
      getAccessToken: () => token,
      setAccessToken: (next: string | null) => { token = next },
      authCoordinator: async <T>(operation: () => Promise<T>) => operation(),
    }
    const staleApi = new AuthApi(options, new HttpClient())
    const transition = await staleApi.authenticateMax('signed MAX initData')
    expect(transition.data.accessToken).toBe(sameToken)
    expect(token).toBe(sameToken)

    await expect(staleApi.approveBrowserLink('123456789012345678901234', 'signed MAX initData'))
      .rejects.toMatchObject({ name: 'Error', message: 'Browser auth session changed' })

    const currentApi = new AuthApi(options, new HttpClient())
    await expect(currentApi.approveBrowserLink('123456789012345678901234', 'signed MAX initData'))
      .resolves.toEqual({ approved: true })
  })
})
