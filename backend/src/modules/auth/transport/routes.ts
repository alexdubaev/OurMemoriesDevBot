import {
  apiErrorSchema,
  browserLinkApproveRequestSchema,
  browserLinkApproveResponseSchema,
  browserLinkChallengeParamsSchema,
  browserLinkStartResponseSchema,
  browserLinkStatusResponseSchema,
  cookieAuthResponseSchema,
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  cookieRefreshResponseSchema,
  maxAuthRequestSchema,
  meResponseSchema,
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
import type { MaxAuthService } from '../application/max-auth-service'
import type { BrowserLinkService } from '../application/browser-link-service'
import { userDtoFromPrincipal } from '../domain/user'
import { executeAuth } from './errors'
import type { AuthHttpEnv } from './middleware'

const refreshCookieName = 'web_app_demo_refresh'
const browserLinkCookieName = 'web_app_demo_browser_link'
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
    422: { content: errorResponseContent, description: 'Invalid payload' },
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
    422: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid refresh session' },
    403: { content: errorResponseContent, description: 'Untrusted browser origin' },
  },
})

const maxRoute = createRoute({
  method: 'post',
  path: '/auth/max',
  request: { body: { content: { 'application/json': { schema: maxAuthRequestSchema } } } },
  responses: {
    ...authWriteErrorResponses,
    200: {
      content: { 'application/json': { schema: cookieAuthResponseSchema } },
      description: 'Verified MAX identity and application session',
    },
    422: { content: errorResponseContent, description: 'Invalid payload' },
    401: { content: errorResponseContent, description: 'Invalid, expired, or replayed initData' },
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
    422: { content: errorResponseContent, description: 'Invalid payload' },
    403: { content: errorResponseContent, description: 'Untrusted browser origin' },
  },
})

const meRoute = createRoute({
  method: 'get',
  path: '/auth/me',
  security: [{ BearerAuth: [] }],
  responses: {
    200: { content: { 'application/json': { schema: meResponseSchema } }, description: 'Current authenticated user' },
    401: { content: errorResponseContent, description: 'Authentication required' },
  },
})

const browserLinkStartRoute = createRoute({
  method: 'post',
  path: '/auth/browser-link/start',
  responses: {
    ...authWriteErrorResponses,
    200: { content: { 'application/json': { schema: browserLinkStartResponseSchema } }, description: 'Browser login challenge' },
    403: { content: errorResponseContent, description: 'Untrusted browser origin' },
  },
})

const browserLinkStatusRoute = createRoute({
  method: 'get',
  path: '/auth/browser-link/{id}/status',
  request: { params: browserLinkChallengeParamsSchema },
  responses: {
    200: { content: { 'application/json': { schema: browserLinkStatusResponseSchema } }, description: 'Browser login challenge status' },
    401: { content: errorResponseContent, description: 'Challenge verifier required' },
    404: { content: errorResponseContent, description: 'Challenge not found' },
  },
})

const browserLinkApproveRoute = createRoute({
  method: 'post',
  path: '/auth/browser-link/{id}/approve',
  security: [{ BearerAuth: [] }],
  request: {
    params: browserLinkChallengeParamsSchema,
    body: { content: { 'application/json': { schema: browserLinkApproveRequestSchema } } },
  },
  responses: {
    ...authWriteErrorResponses,
    200: { content: { 'application/json': { schema: browserLinkApproveResponseSchema } }, description: 'Approved browser login challenge' },
    401: { content: errorResponseContent, description: 'MAX session or launch data invalid' },
  },
})

const browserLinkRedeemRoute = createRoute({
  method: 'post',
  path: '/auth/browser-link/{id}/redeem',
  request: { params: browserLinkChallengeParamsSchema },
  responses: {
    ...authWriteErrorResponses,
    200: { content: { 'application/json': { schema: cookieAuthResponseSchema } }, description: 'Browser application session' },
    401: { content: errorResponseContent, description: 'Challenge verifier required or invalid' },
    403: { content: errorResponseContent, description: 'Untrusted browser origin' },
  },
})

type CreateAuthRoutesOptions = {
  env: AppEnv
  service: AuthService
  telegramService: TelegramAuthService
  maxService: MaxAuthService
  browserLinkService: BrowserLinkService
  requireAuth: import('hono').MiddlewareHandler<AuthHttpEnv>
}

export function createAuthRoutes({ env, service, telegramService, maxService, browserLinkService, requireAuth }: CreateAuthRoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  routes.use('/auth/me', requireAuth)
  routes.use('/auth/browser-link/:id/approve', requireAuth)

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

  routes.openapi(maxRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const result = await executeAuth(() => maxService.exchange(
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

  routes.openapi(meRoute, (c) => c.json({
    user: userDtoFromPrincipal(c.var.user),
    externalIdentityProvider: c.var.user.externalIdentity?.provider ?? null,
  }, 200))

  routes.openapi(browserLinkStartRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const result = await browserLinkService.start()
    setBrowserLinkCookie(c, result.challengeId, result.verifier, env)
    const { verifier: _verifier, ...response } = result
    noStore(c)
    return c.json(response, 200)
  })

  routes.openapi(browserLinkStatusRoute, async (c) => {
    const challengeId = c.req.valid('param').id
    const result = await browserLinkService.getStatus(
      challengeId,
      getBrowserLinkCookie(c),
    )
    if (!result) throw new AppError(401, 'UNAUTHORIZED', 'Challenge verifier is required')
    noStore(c)
    return c.json({ status: result.state, expiresAt: result.expiresAt.toISOString() }, 200)
  })

  routes.openapi(browserLinkApproveRoute, async (c) => {
    const input = c.req.valid('json')
    const result = await executeAuth(() => browserLinkService.approve(
      c.req.valid('param').id,
      c.var.user,
      input.initData,
      input.approved,
    ))
    noStore(c)
    return c.json(result, 200)
  })

  routes.openapi(browserLinkRedeemRoute, async (c) => {
    assertTrustedCookieOrigin(c, env)
    const challengeId = c.req.valid('param').id
    const result = await executeAuth(() => browserLinkService.redeem(
      challengeId,
      getBrowserLinkCookie(c),
      requestMetadata(c, env),
    ))
    setRefreshCookie(c, result.refreshTokenToSet, env)
    deleteBrowserLinkCookie(c, challengeId, env)
    const { refreshTokenToSet: _refreshTokenToSet, ...response } = result
    noStore(c)
    return c.json(response, 200)
  })

  return routes
}

function noStore(c: Context) {
  c.header('Cache-Control', 'no-store')
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

function getBrowserLinkCookie(c: Context) {
  return getCookie(c, browserLinkCookieName)
}

function assertTrustedCookieOrigin(c: Context, env: AppEnv) {
  if (!env.COOKIE_SECURE) return
  const origin = c.req.header('origin')
  if (!origin || !env.CORS_ORIGINS.includes(origin)) {
    throw new AppError(403, 'FORBIDDEN', 'Источник запроса не разрешён')
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

function setBrowserLinkCookie(c: Context, challengeId: string, verifier: string, env: AppEnv) {
  setCookie(c, browserLinkCookieName, verifier, {
    httpOnly: true,
    maxAge: 5 * 60,
    path: browserLinkCookiePath(challengeId),
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'None' : 'Lax',
  })
}

function deleteBrowserLinkCookie(c: Context, challengeId: string, env: AppEnv) {
  deleteCookie(c, browserLinkCookieName, {
    path: browserLinkCookiePath(challengeId),
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'None' : 'Lax',
  })
}

function browserLinkCookiePath(challengeId: string) {
  const validChallengeId = browserLinkChallengeParamsSchema.parse({ id: challengeId }).id
  return `/api/v1/auth/browser-link/${validChallengeId}`
}
