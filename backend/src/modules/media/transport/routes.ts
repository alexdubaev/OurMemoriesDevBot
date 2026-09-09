import {
  apiErrorSchema, finalizeMediaUploadResponseSchema, mediaContentParamsSchema,
  mediaContentQuerySchema, mediaFamilyParamsSchema, mediaUploadParamsSchema,
  reserveMediaUploadRequestSchema, reserveMediaUploadResponseSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import type { ZodType } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { MediaService } from '../application/media-service'
import { MediaFailure } from '../domain/errors'
import { executeMedia } from './errors'

const security = [{ BearerAuth: [] }]
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
  request: { params: mediaFamilyParamsSchema, body: { content: json(reserveMediaUploadRequestSchema) } },
  responses: { ...errors, 201: { content: json(reserveMediaUploadResponseSchema), description: 'Reserved' } } })
const finalizeRoute = createRoute({ method: 'post', path: '/families/{familyId}/uploads/{uploadId}/finalize', security,
  request: { params: mediaUploadParamsSchema }, responses: { ...errors,
    200: { content: json(finalizeMediaUploadResponseSchema), description: 'Finalized' } } })

export function createMediaRoutes({ requireAuth, service }: { requireAuth: MiddlewareHandler<AuthHttpEnv>; service: MediaService }) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('/families/*', requireAuth)
  routes.openapi(reserveRoute, async (c) => c.json(await executeMedia(() => service.reserve(scope(c), c.req.valid('json'))), 201))
  routes.openapi(finalizeRoute, async (c) => c.json(await executeMedia(() => service.finalize(scope(c), c.req.valid('param').uploadId))))
  const content = async (c: any, head: boolean) => {
    const params = mediaContentParamsSchema.parse(c.req.param())
    const query = mediaContentQuerySchema.parse(c.req.query())
    try {
      const result = await executeMedia(() => service.content(scope(c), params.mediaId, query.variant, c.req.header('Range')))
      c.header('Content-Type', result.contentType)
      c.header('Accept-Ranges', 'bytes')
      c.header('Cache-Control', 'private, no-store')
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
  routes.get('/families/:familyId/media/:mediaId/content', (c) => content(c, false))
  routes.on('HEAD', '/families/:familyId/media/:mediaId/content', (c) => content(c, true))
  return routes
}

function scope(c: any) { return { principal: { userId: c.var.user.id, sessionId: c.var.user.sessionId }, familyId: c.req.param('familyId') } }
