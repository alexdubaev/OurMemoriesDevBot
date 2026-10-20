import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  apiErrorSchema,
  commentMutationResponseSchema,
  commentPageSchema,
  commentSummariesRequestSchema,
  commentSummariesResponseSchema,
  commentsParamsSchema,
  commentSummariesParamsSchema,
  createCommentRequestSchema,
  idempotencyKeyHeadersSchema,
  listCommentsQuerySchema,
} from '@web-app-demo/contracts'
import type { ZodType } from 'zod'
import {
  errorResponse,
  requestIdFrom,
  validationErrorResponse,
} from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { CommentService } from '../application/comment-service'
import { executeComment } from './comment-errors'

const json = <Schema extends ZodType>(schema: Schema) => ({
  'application/json': { schema },
})
const errors = {
  400: { content: json(apiErrorSchema), description: 'Invalid input' },
  401: { content: json(apiErrorSchema), description: 'Session required' },
  404: { content: json(apiErrorSchema), description: 'Unavailable target' },
  409: { content: json(apiErrorSchema), description: 'Idempotency conflict' },
  413: { content: json(apiErrorSchema), description: 'Body too large' },
  429: { content: json(apiErrorSchema), description: 'Rate limit' },
} as const
const security = [{ BearerAuth: [] }]
const path = '/families/{familyId}/memories/{memoryId}/comments'
const list = createRoute({
  method: 'get',
  path,
  security,
  request: { params: commentsParamsSchema, query: listCommentsQuerySchema },
  responses: {
    ...errors,
    200: { content: json(commentPageSchema), description: 'Comments page' },
  },
})
const create = createRoute({
  method: 'post',
  path,
  security,
  request: {
    params: commentsParamsSchema,
    headers: idempotencyKeyHeadersSchema,
    body: { content: json(createCommentRequestSchema), required: true },
  },
  responses: {
    ...errors,
    200: {
      content: json(commentMutationResponseSchema),
      description: 'Fresh authorized replay',
    },
    201: {
      content: json(commentMutationResponseSchema),
      description: 'Created',
    },
  },
})
const summaries = createRoute({
  method: 'post',
  path: '/families/{familyId}/memories/comment-summaries',
  security,
  request: {
    params: commentSummariesParamsSchema,
    body: { content: json(commentSummariesRequestSchema), required: true },
  },
  responses: {
    ...errors,
    200: {
      content: json(commentSummariesResponseSchema),
      description: 'Accessible memories only',
    },
  },
})

export const commentPrivacyMiddleware: MiddlewareHandler<AuthHttpEnv> = async (
  c,
  next,
) => {
  if (
    /^\/api\/v1\/families\/[^/]+\/memories\/(?:comment-summaries|[^/]+\/comments(?:\/[^/]+)?)\/?$/.test(
      c.req.path,
    )
  )
    c.header('Cache-Control', 'private, no-store')
  await next()
}
export function createCommentRoutes({
  requireAuth,
  service,
}: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: CommentService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(
          validationErrorResponse(result.error.issues, requestIdFrom(c)),
          400,
        )
    },
  })
  routes.use('/families/:familyId/memories/:memoryId/comments', requireAuth)
  routes.use('/families/:familyId/memories/comment-summaries', requireAuth)
  const limit = bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) =>
      c.json(
        errorResponse(
          'BAD_REQUEST',
          'Слишком большой запрос',
          requestIdFrom(c),
        ),
        413,
      ),
  })
  routes.use('/families/:familyId/memories/:memoryId/comments', limit)
  routes.use('/families/:familyId/memories/comment-summaries', limit)
  const scope = (user: AuthHttpEnv['Variables']['user'], familyId: string) => ({
    principal: { userId: user.id, sessionId: user.sessionId },
    familyId,
  })
  routes.openapi(summaries, async (c) =>
    c.json(
      await executeComment(() =>
        service.summaries(
          scope(c.var.user, c.req.valid('param').familyId),
          c.req.valid('json').memoryIds,
        ),
      ),
    ),
  )
  routes.openapi(list, async (c) =>
    c.json(
      await executeComment(() => {
        const p = c.req.valid('param')
        return service.list(
          scope(c.var.user, p.familyId),
          p.memoryId,
          c.req.valid('query'),
        )
      }),
    ),
  )
  routes.openapi(create, async (c) => {
    const p = c.req.valid('param')
    const result = await executeComment(() =>
      service.create(
        scope(c.var.user, p.familyId),
        p.memoryId,
        c.req.valid('json'),
        c.req.valid('header')['idempotency-key'],
      ),
    )
    return c.json(
      { comment: result.comment, summary: result.summary },
      result.replayed ? 200 : 201,
    )
  })
  return routes
}
