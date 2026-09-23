import { describe, expect, test } from 'bun:test'

import type { BrowserLinkStartResponse } from '@web-app-demo/contracts'
import { handleError } from '../../../http/errors'
import { loadEnv, type AppEnv } from '../../../env'
import type { AuthService } from '../application/auth-service'
import type { BrowserLinkService } from '../application/browser-link-service'
import type { MaxAuthService } from '../application/max-auth-service'
import type { TelegramAuthService } from '../application/telegram-auth-service'
import type { AuthenticatedPrincipal } from '../domain/user'
import { createRequireAuth } from './middleware'
import { createAuthRoutes } from './routes'

const env = loadEnv({
  DATABASE_URL: 'postgresql://superuser:superpassword@localhost:54329/web_app_demo',
  JWT_SECRET: '0123456789abcdef'.repeat(4),
  CORS_ORIGINS: 'https://web.example.com',
  ACCESS_TOKEN_TTL_SECONDS: '60',
  TRUST_PROXY: 'true',
  TRUSTED_PROXY_CLIENT_IP_HEADER: 'do-connecting-ip',
  COOKIE_SECURE: 'true',
})
const origin = 'https://web.example.com'
const challengeId = '123456789012345678901234'
const secondChallengeId = '987654321098765432109876'
const expiry = '2026-09-24T12:05:00.000Z'
const principal: AuthenticatedPrincipal = {
  id: '019c0000-0000-7000-8000-000000000001',
  email: null,
  displayName: 'MAX User',
  role: 'user',
  createdAt: '2026-09-24T12:00:00.000Z',
  sessionId: 'max-session-1',
  externalIdentity: {
    id: '019c0000-0000-7000-8000-000000000002',
    provider: 'max',
    subject: '31415926',
  },
}

describe('browser link auth routes', () => {
  test('scopes verifier cookies to each challenge path, so two tabs do not share them', async () => {
    const starts: Array<{ challengeId: string; verifier: string }> = []
    const app = createRoutes({
      browserLinkService: {
        start: async () => {
          const challenge = starts.length === 0
            ? { challengeId, verifier: 'verifier-one' }
            : { challengeId: secondChallengeId, verifier: 'verifier-two' }
          starts.push(challenge)
          return startResponse(challenge.challengeId, challenge.verifier)
        },
      },
    })

    const first = await app.request('/auth/browser-link/start', {
      method: 'POST',
      headers: { Origin: origin },
    })
    const second = await app.request('/auth/browser-link/start', {
      method: 'POST',
      headers: { Origin: origin },
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.headers.get('set-cookie')).toContain(
      `Path=/api/v1/auth/browser-link/${challengeId}`,
    )
    expect(second.headers.get('set-cookie')).toContain(
      `Path=/api/v1/auth/browser-link/${secondChallengeId}`,
    )
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')
    expect(first.headers.get('set-cookie')).toContain('Max-Age=300')
    expect(first.headers.get('set-cookie')).not.toContain(secondChallengeId)
    expect(second.headers.get('set-cookie')).not.toContain(challengeId)
  })

  test('requires the challenge verifier for status and passes only that verifier to the service', async () => {
    const statusCalls: Array<{ id: string; verifier: string | undefined }> = []
    const app = createRoutes({
      browserLinkService: {
        getStatus: async (id: string, verifier: string | undefined) => {
          statusCalls.push({ id, verifier })
          if (!verifier) return null
          return { state: 'approved' as const, expiresAt: new Date(expiry) }
        },
      },
    })

    const missing = await app.request(`/auth/browser-link/${challengeId}/status`)
    expect(missing.status).toBe(401)

    const present = await app.request(`/auth/browser-link/${challengeId}/status`, {
      headers: { Cookie: 'web_app_demo_browser_link=verifier-one' },
    })
    expect(present.status).toBe(200)
    await expect(present.json()).resolves.toEqual({ status: 'approved', expiresAt: expiry })
    expect(statusCalls).toEqual([
      { id: challengeId, verifier: undefined },
      { id: challengeId, verifier: 'verifier-one' },
    ])
    expect(present.headers.get('cache-control')).toBe('no-store')
  })

  test('redeem carries request provenance and clears only the challenge verifier cookie', async () => {
    const redeemCalls: Array<{
      id: string
      verifier: string | undefined
      metadata: { userAgent?: string; ipAddress?: string }
    }> = []
    const app = createRoutes({
      browserLinkService: {
        redeem: async (
          id: string,
          verifier: string | undefined,
          metadata: { userAgent?: string; ipAddress?: string },
        ) => {
          redeemCalls.push({ id, verifier, metadata })
          return {
            user: {
              id: principal.id,
              email: principal.email,
              displayName: principal.displayName,
              role: principal.role,
              createdAt: principal.createdAt,
            },
            accessToken: 'access-token',
            refreshTokenToSet: 'refresh-token',
          }
        },
      },
    })

    const response = await app.request(`/auth/browser-link/${challengeId}/redeem`, {
      method: 'POST',
      headers: {
        Cookie: 'web_app_demo_browser_link=verifier-one',
        Origin: origin,
        'User-Agent': 'Mozilla/5.0 synthetic',
        'Do-Connecting-Ip': '203.0.113.10',
      },
    })

    expect(response.status).toBe(200)
    expect(redeemCalls).toEqual([{
      id: challengeId,
      verifier: 'verifier-one',
      metadata: {
        userAgent: 'Mozilla/5.0 synthetic',
        ipAddress: '203.0.113.10',
      },
    }])
    const setCookie = response.headers.get('set-cookie')
    expect(setCookie).toContain('web_app_demo_refresh=refresh-token')
    expect(setCookie).toContain('Path=/api/v1/auth')
    expect(setCookie).toContain('web_app_demo_browser_link=;')
    expect(setCookie).toContain(`Path=/api/v1/auth/browser-link/${challengeId}`)
    expect(setCookie).toContain('Max-Age=0')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

function createRoutes(overrides: {
  browserLinkService?: Partial<BrowserLinkService>
  env?: AppEnv
} = {}) {
  const requireAuth = createRequireAuth(async () => principal)
  const routes = createAuthRoutes({
    env: overrides.env ?? env,
    service: {} as AuthService,
    telegramService: {} as TelegramAuthService,
    maxService: {} as MaxAuthService,
    browserLinkService: overrides.browserLinkService as BrowserLinkService,
    requireAuth,
  })
  routes.onError(handleError)
  return routes
}

function startResponse(id: string, verifier: string): BrowserLinkStartResponse & { verifier: string } {
  return {
    challengeId: id,
    displayCode: id.slice(0, 6),
    expiresAt: expiry,
    startParam: `browser_${id}`,
    verifier,
  }
}
