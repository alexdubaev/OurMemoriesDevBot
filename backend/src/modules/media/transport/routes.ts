import {
  apiErrorSchema, finalizeMediaUploadResponseSchema, idempotencyKeyHeadersSchema, maxVideoReadinessSchema, mediaContentParamsSchema,
  mediaContentQuerySchema, mediaFamilyParamsSchema, mediaUploadParamsSchema,
  reserveMediaUploadRequestSchema, reserveMediaUploadResponseSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import { z, type ZodType } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { AuthenticatedPrincipal, AuthHttpEnv } from '../../auth'
import type { MediaService } from '../application/media-service'
import type { MaxVideoPlayback } from '../application/ports'
import { MediaFailure } from '../domain/errors'
import { executeMedia } from './errors'

const security = [{ BearerAuth: [] }]
const mediaAccessCookieName = 'our_memories_media_access'
const mediaAccessCookieTtlSeconds = 5 * 60
const json = <S extends ZodType>(schema: S) => ({ 'application/json': { schema } })
const errors = { 401: { content: json(apiErrorSchema), description: 'Authentication required' },
  403: { content: json(apiErrorSchema), description: 'Forbidden' },
  404: { content: json(apiErrorSchema), description: 'Not found' },
  409: { content: json(apiErrorSchema), description: 'Upload incomplete' },
  413: { content: json(apiErrorSchema), description: 'Quota exceeded' },
  415: { content: json(apiErrorSchema), description: 'Unsupported media' },
  422: { content: json(apiErrorSchema), description: 'Invalid media' },
  503: { content: json(apiErrorSchema), description: 'Storage unavailable' } } as const
const reserveRoute = createRoute({ method: 'post', path: '/families/{familyId}/uploads', security,
  request: { params: mediaFamilyParamsSchema, headers: idempotencyKeyHeadersSchema.partial(), body: { content: json(reserveMediaUploadRequestSchema) } },
  responses: { ...errors, 201: { content: json(reserveMediaUploadResponseSchema), description: 'Reserved' } } })
const finalizeRoute = createRoute({ method: 'post', path: '/families/{familyId}/uploads/{uploadId}/finalize', security,
  request: { params: mediaUploadParamsSchema }, responses: { ...errors,
    200: { content: json(finalizeMediaUploadResponseSchema), description: 'Finalized' } } })
const maxVideoContentParamsSchema = z.object({ familyId: z.string().uuid(), referenceId: z.string().uuid() }).strict()

export function createMediaRoutes({ authenticateMediaAccess, cookieSecure, requireAuth, service, maxVideoPlayback }: {
  authenticateMediaAccess: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>
  cookieSecure: boolean
  requireAuth: MiddlewareHandler<AuthHttpEnv>
    service: MediaService
    maxVideoPlayback?: MaxVideoPlayback
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  const contentAuth = createMediaContentAuth(authenticateMediaAccess)
  routes.use('/families/*', (c, next) => isContentPath(c.req.path) ? contentAuth(c, next) : requireAuth(c, next))
  routes.openapi(reserveRoute, async (c) => c.json(await executeMedia(() => service.reserve(scope(c), c.req.valid('json'), c.req.valid('header')['idempotency-key'])), 201))
  routes.openapi(finalizeRoute, async (c) => c.json(await executeMedia(() => service.finalize(scope(c), c.req.valid('param').uploadId))))
  routes.post('/families/:familyId/media/playback-session', async (c) => {
    await executeMedia(() => service.authorizePlaybackSession(scope(c)))
    const accessToken = bearerToken(c.req.header('authorization'))
    setCookie(c, mediaAccessCookieName, accessToken!, {
      httpOnly: true,
      maxAge: mediaAccessCookieTtlSeconds,
      path: `/api/v1/families/${c.req.param('familyId')}/media/`,
      secure: cookieSecure,
      sameSite: cookieSecure ? 'None' : 'Lax',
    })
    return c.body(null, 204)
  })
  const content = async (c: any, head: boolean) => {
    const params = mediaContentParamsSchema.parse(c.req.param())
    const query = mediaContentQuerySchema.parse(c.req.query())
    try {
      const result = await executeMedia(() => service.content(scope(c), params.mediaId, query.variant, c.req.header('Range')))
      c.header('Content-Type', result.contentType)
      c.header('Accept-Ranges', 'bytes')
      c.header('Cache-Control', 'private, no-store')
      c.header('Cross-Origin-Resource-Policy', 'same-origin')
      c.header('Referrer-Policy', 'no-referrer')
      if (result.range) {
        c.header('Content-Range', `bytes ${result.range.start}-${result.range.end}/${result.contentLength}`)
        c.header('Content-Length', String(result.range.end - result.range.start + 1))
        return c.body(head ? null : result.body, 206)
      }
      c.header('Content-Length', String(result.contentLength))
      return c.body(head ? null : result.body, 200)
    } catch (error) {
      if (error instanceof Error && (error as any).status === 416) {
        const total = (error as any).diagnosticDetails?.total
        c.header('Content-Range', `bytes */${typeof total === 'number' ? total : 0}`)
      }
      throw error
    }
  }
  const maxVideoContent = async (c: any, head: boolean) => {
    if (!maxVideoPlayback) return c.json({ error: { code: 'NOT_FOUND', message: 'Маршрут не найден' } }, 404)
    const params = maxVideoContentParamsSchema.parse(c.req.param())
    try {
      const result = await executeMedia(() => maxVideoPlayback.content({ ...scope(c), familyId: params.familyId }, params.referenceId, c.req.header('Range'), head ? 'HEAD' : 'GET', c.req.raw.signal))
      c.header('Content-Type', result.contentType)
      c.header('Accept-Ranges', 'bytes')
      c.header('Cache-Control', 'private, no-store')
      c.header('Cross-Origin-Resource-Policy', 'same-origin')
      c.header('Referrer-Policy', 'no-referrer')
      if (result.range) {
        c.header('Content-Range', `bytes ${result.range.start}-${result.range.end}/${result.range.total}`)
        c.header('Content-Length', String(result.bodyLength))
        return c.body(head ? null : result.body, 206)
      }
      c.header('Content-Length', String(result.bodyLength))
      return c.body(head ? null : result.body, 200)
    } catch (error) {
      if (error instanceof Error && (error as any).status === 416) {
        const total = (error as any).diagnosticDetails?.total
        c.header('Content-Range', `bytes */${typeof total === 'number' ? total : 0}`)
      }
      throw error
    }
  }
  routes.get('/families/:familyId/media/max-videos/:referenceId/readiness', async (c) => {
    if (!maxVideoPlayback) return c.json({ error: { code: 'NOT_FOUND', message: 'Маршрут не найден' } }, 404)
    const params = maxVideoContentParamsSchema.parse(c.req.param())
    const readiness = await executeMedia(() => maxVideoPlayback.readiness({ ...scope(c), familyId: params.familyId }, params.referenceId, c.req.raw.signal))
    c.header('Cache-Control', 'private, no-store')
    return c.json(maxVideoReadinessSchema.parse(readiness))
  })
  const memberAvatarContent = async (c: any, head: boolean) => {
    const params = z.object({ familyId: z.uuid(), userId: z.uuid(), avatarId: z.uuid() }).strict().parse(c.req.param())
    const result = await executeMedia(() => service.memberAvatarContent(scope(c), params.userId, params.avatarId, head))
    c.header('Content-Type', result.contentType)
    c.header('Content-Length', String(result.contentLength))
    c.header('Cache-Control', 'private, no-store')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    c.header('Referrer-Policy', 'no-referrer')
    return c.body(result.body, 200)
  }
  routes.get('/families/:familyId/media/avatars/:userId/:avatarId/content', (c) => memberAvatarContent(c, false))
  routes.on('HEAD', '/families/:familyId/media/avatars/:userId/:avatarId/content', (c) => memberAvatarContent(c, true))
  routes.get('/families/:familyId/media/max-videos/:referenceId/content', (c) => maxVideoContent(c, false))
  routes.on('HEAD', '/families/:familyId/media/max-videos/:referenceId/content', (c) => maxVideoContent(c, true))
  routes.get('/families/:familyId/media/:mediaId/content', (c) => content(c, false))
  routes.on('HEAD', '/families/:familyId/media/:mediaId/content', (c) => content(c, true))
  return routes
}

function createMediaContentAuth(authenticate: (accessToken: string | undefined) => Promise<AuthenticatedPrincipal>) {
  return createMiddleware<AuthHttpEnv>(async (c, next) => {
    const token = bearerToken(c.req.header('authorization')) ?? getCookie(c, mediaAccessCookieName)
    c.set('user', await authenticate(token))
    await next()
  })
}

function bearerToken(authorization: string | undefined) {
  if (!authorization?.startsWith('Bearer ')) return undefined
  return authorization.slice('Bearer '.length)
}

function isContentPath(path: string) {
  return /^\/api\/v1\/families\/[0-9a-f-]+\/media\/(?:[0-9a-f-]+|max-videos\/[0-9a-f-]+|avatars\/[0-9a-f-]+\/[0-9a-f-]+)\/content$/i.test(path) ||
    /^\/api\/v1\/families\/[0-9a-f-]+\/media\/max-videos\/[0-9a-f-]+\/readiness$/i.test(path)
}

function scope(c: any) { return { principal: { userId: c.var.user.id, sessionId: c.var.user.sessionId }, familyId: c.req.param('familyId') } }
