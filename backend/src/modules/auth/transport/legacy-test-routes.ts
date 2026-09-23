import {
  cookieLogoutRequestSchema,
  cookieRefreshRequestSchema,
  loginRequestSchema,
  passwordResetConfirmRequestSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  tokenLogoutRequestSchema,
  tokenRefreshRequestSchema,
} from '@web-app-demo/contracts'
import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from '../../../env'
import { AppError } from '../../../http/errors'
import type { AuthService } from '../application/auth-service'
import { userDtoFromPrincipal } from '../domain/user'
import { executeAuth } from './errors'
import type { AuthHttpEnv } from './middleware'

const refreshCookieName = 'web_app_demo_refresh'

/**
 * Compatibility harness for pre-Block-01 integration tests. Production composition never mounts
 * this router; `createApp` also rejects the test-only option when NODE_ENV=production.
 */
export function createLegacyAuthTestRoutes({
  env,
  requireAuth,
  service,
}: {
  env: AppEnv
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: AuthService
}) {
  const routes = new Hono<AuthHttpEnv>()

  routes.post('/register', async (c) => {
    assertTrustedOrigin(c, env)
    const result = await executeAuth(async () => service.register(
      registerRequestSchema.parse(await c.req.json()), metadata(c),
    ))
    setRefresh(c, result.refreshToken, env)
    return c.json(withoutRefresh(result), 201)
  })
  routes.post('/token/register', async (c) => c.json(await executeAuth(async () => service.register(
    registerRequestSchema.parse(await c.req.json()), metadata(c),
  )), 201))
  routes.post('/login', async (c) => {
    assertTrustedOrigin(c, env)
    const result = await executeAuth(async () => service.login(
      loginRequestSchema.parse(await c.req.json()), metadata(c),
    ))
    setRefresh(c, result.refreshToken, env)
    return c.json(withoutRefresh(result), 200)
  })
  routes.post('/token/login', async (c) => c.json(await executeAuth(async () => service.login(
    loginRequestSchema.parse(await c.req.json()), metadata(c),
  )), 200))
  routes.post('/refresh', async (c) => {
    assertTrustedOrigin(c, env)
    cookieRefreshRequestSchema.parse(await optionalJson(c))
    const result = await executeAuth(() => service.refresh(getCookie(c, refreshCookieName), metadata(c)))
    setRefresh(c, result.refreshToken, env)
    return c.json(withoutRefresh(result), 200)
  })
  routes.post('/token/refresh', async (c) => {
    const input = tokenRefreshRequestSchema.parse(await c.req.json())
    return c.json(await executeAuth(() => service.refresh(input.refreshToken, metadata(c))), 200)
  })
  routes.get('/me', requireAuth, (c) => c.json({ user: userDtoFromPrincipal(c.var.user) }, 200))
  routes.post('/logout', async (c) => {
    assertTrustedOrigin(c, env)
    cookieLogoutRequestSchema.parse(await optionalJson(c))
    await executeAuth(() => service.logout(getCookie(c, refreshCookieName)))
    deleteRefresh(c, env)
    return c.body(null, 204)
  })
  routes.post('/token/logout', async (c) => {
    const input = tokenLogoutRequestSchema.parse(await c.req.json())
    await executeAuth(() => service.logout(input.refreshToken))
    return c.body(null, 204)
  })
  routes.post('/password-reset/request', async (c) => c.json(await executeAuth(async () =>
    service.requestPasswordReset(passwordResetRequestSchema.parse(await c.req.json())),
  ), 202))
  routes.post('/password-reset/confirm', async (c) => {
    await executeAuth(async () => service.confirmPasswordReset(
      passwordResetConfirmRequestSchema.parse(await c.req.json()),
    ))
    deleteRefresh(c, env)
    return c.body(null, 204)
  })
  return routes
}

function metadata(c: Context) {
  return { userAgent: c.req.header('user-agent') }
}

async function optionalJson(c: Context) {
  const text = await c.req.text()
  return text ? JSON.parse(text) : {}
}

function assertTrustedOrigin(c: Context, env: AppEnv) {
  if (!env.COOKIE_SECURE) return
  const origin = c.req.header('origin')
  if (!origin || !env.CORS_ORIGINS.includes(origin)) {
    throw new AppError(403, 'FORBIDDEN', 'Источник запроса не разрешён')
  }
}

function setRefresh(c: Context, token: string, env: AppEnv) {
  setCookie(c, refreshCookieName, token, {
    httpOnly: true,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    path: '/api',
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'None' : 'Lax',
  })
}

function deleteRefresh(c: Context, env: AppEnv) {
  deleteCookie(c, refreshCookieName, {
    path: '/api', secure: env.COOKIE_SECURE, sameSite: env.COOKIE_SECURE ? 'None' : 'Lax',
  })
}

function withoutRefresh<T extends { refreshToken: string }>(value: T) {
  const { refreshToken: _refreshToken, ...response } = value
  return response
}
