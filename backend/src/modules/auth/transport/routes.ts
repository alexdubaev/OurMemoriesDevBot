import {
  apiErrorSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  telegramAuthRequestSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from '../../../env'
import { AppError, validationErrorHook } from '../../../http/errors'
import { clientAddress } from '../../../http/security'
import type { AuthService } from '../application/auth-service'
import type { TelegramAuthService } from '../application/telegram-auth-service'
import { executeAuth } from './errors'
import type { AuthHttpEnv } from './middleware'

const refreshCookieName = 'web_app_demo_refresh'
const errorResponseContent = { 'application/json': { schema: apiErrorSchema } }
const authWriteErrorResponses = {
  413: { content: errorResponseContent, description: 'Request body is too large' },
  429: { content: errorResponseContent, description: 'Too many authentication requests' },
}

const telegramRoute = createRoute({
  method: 'post',
  path: '/auth/telegram',
  request: { body: { content: { 'application/json': { schema: telegramAuthRequestSchema } } } },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: { 'application/json': { schema: cookieAuthResponseSchema } },
      description: 'Verified Telegram identity and application session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid, expired, or replayed initData' },
    403: { content: errorResponseContent, description: 'Untrusted browser origin' },
  },
})

const refreshRoute = createRoute({
  method: 'post',
  path: '/auth/refresh',
  request: { body: { content: { 'application/json': { schema: cookieRefreshRequestSchema } } } },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: { 'application/json': { schema: cookieRefreshResponseSchema } },
      description: 'Rotated application session',
    },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid refresh session' },
    403: { content: errorResponseContent, description: 'Untrusted browser origin' },
  },
})

const logoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  request: { body: { content: { 'application/json': { schema: cookieLogoutRequestSchema } } } },
  responses: {
    ...authWriteErrorResponses,
    204: { description: 'Application session revoked' },
    400: { content: errorResponseContent, description: 'Invalid payload' },
    403: { content: errorResponseContent, description: 'Untrusted browser origin' },
  },
})

type CreateAuthRoutesOptions = {
  env: AppEnv
  service: AuthService
  telegramService: TelegramAuthService
}

export function createAuthRoutes({ env, service, telegramService }: CreateAuthRoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  routes.openapi(telegramRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => telegramService.exchange(
      c.req.valid('json').initData,
      getRefreshCookie(c),
      requestMetadata(c, env),
    ))
    if (result.refreshTokenToSet) setRefreshCookie(c, result.refreshTokenToSet, env)
    const { refreshTokenToSet: _refreshTokenToSet, ...response } = result
    return c.json(response, 200)
  })

  routes.openapi(refreshRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => service.refresh(
      getRefreshCookie(c),
      requestMetadata(c, env),
    ))
    setRefreshCookie(c, result.refreshToken, env)
    const { refreshToken: _refreshToken, ...response } = result
    return c.json(response, 200)
  })

  routes.openapi(logoutRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    await executeAuth(() => service.logout(getRefreshCookie(c)))
    deleteRefreshCookie(c, env)
    return c.body(null, 204)
  })

  return routes
}

function requestMetadata(c: Context, env: AppEnv): { userAgent?: string; ipAddress?: string } {
  const ipAddress = clientAddress(c, {
    trustProxy: env.TRUST_PROXY,
    trustedProxyClientIpHeader: env.TRUSTED_PROXY_CLIENT_IP_HEADER,
    trustedProxyClientIpPosition: env.TRUSTED_PROXY_CLIENT_IP_POSITION,
  })
  return {
    userAgent: c.req.header('user-agent'),
    ipAddress: ipAddress === 'unknown' ? undefined : ipAddress,
  }
}

function getRefreshCookie(c: Context) {
  return getCookie(c, refreshCookieName)
}

function assertTrustedCookieOrigin(c: Context, env: AppEnv) {
  if (!env.COOKIE_SECURE) return
  const origin = c.req.header('origin')
  if (!origin || !env.CORS_ORIGINS.includes(origin)) {
    throw new AppError(403, 'FORBIDDEN', 'Cookie authentication requires a trusted Origin')
  }
}

function setRefreshCookie(c: Context, refreshToken: string, env: AppEnv) {
  setCookie(c, refreshCookieName, refreshToken, {
    httpOnly: true,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    path: '/api/v1/auth',
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'None' : 'Lax',
  })
}

function deleteRefreshCookie(c: Context, env: AppEnv) {
  deleteCookie(c, refreshCookieName, {
    path: '/api/v1/auth',
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'None' : 'Lax',
  })
}
