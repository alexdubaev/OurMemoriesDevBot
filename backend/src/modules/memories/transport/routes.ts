import {
  apiErrorSchema,
  createMemoryRequestSchema,
  idempotencyKeyHeadersSchema,
  ifMatchVersionHeadersSchema,
  likeResponseSchema,
  listMemoriesQuerySchema,
  memoriesFamilyParamsSchema,
  memoryDtoSchema,
  memoryPageSchema,
  memoryParamsSchema,
  setLikeRequestSchema,
  telegramVideoOpenResponseSchema,
  updateMemoryRequestSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import type { ZodType } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { MemoryService } from '../application/memory-service'
import type { TelegramVideoDeliveryService } from '../../telegram/application/video-delivery'
import { executeMemory } from './errors'

const bearerSecurity = [{ BearerAuth: [] }]
const json = <Schema extends ZodType>(schema: Schema) => ({ 'application/json': { schema } })
const errors = {
  401: { content: json(apiErrorSchema), description: 'Authentication required' },
  403: { content: json(apiErrorSchema), description: 'Family role does not allow this action' },
  404: { content: json(apiErrorSchema), description: 'Memory not found' },
  409: { content: json(apiErrorSchema), description: 'Memory state conflict' },
  422: { content: json(apiErrorSchema), description: 'Invalid payload or cursor' },
} as const

const listRoute = createRoute({
  method: 'get', path: '/families/{familyId}/memories', security: bearerSecurity,
  request: { params: memoriesFamilyParamsSchema, query: listMemoriesQuerySchema },
  responses: { ...errors, 200: { content: json(memoryPageSchema), description: 'Family feed page' } },
})
const createRouteDefinition = createRoute({
  method: 'post', path: '/families/{familyId}/memories', security: bearerSecurity,
  request: {
    params: memoriesFamilyParamsSchema,
    headers: idempotencyKeyHeadersSchema,
    body: { content: json(createMemoryRequestSchema) },
  },
  responses: {
    ...errors,
    200: { content: json(memoryDtoSchema), description: 'Idempotent replay' },
    201: { content: json(memoryDtoSchema), description: 'Created memory' },
  },
})
const getRoute = createRoute({
  method: 'get', path: '/families/{familyId}/memories/{memoryId}', security: bearerSecurity,
  request: { params: memoryParamsSchema },
  responses: { ...errors, 200: { content: json(memoryDtoSchema), description: 'Family memory' } },
})
const updateRoute = createRoute({
  method: 'patch', path: '/families/{familyId}/memories/{memoryId}', security: bearerSecurity,
  request: { params: memoryParamsSchema, body: { content: json(updateMemoryRequestSchema) } },
  responses: { ...errors, 200: { content: json(memoryDtoSchema), description: 'Updated memory' } },
})
const deleteRoute = createRoute({
  method: 'delete', path: '/families/{familyId}/memories/{memoryId}', security: bearerSecurity,
  request: { params: memoryParamsSchema, headers: ifMatchVersionHeadersSchema },
  responses: { ...errors, 204: { description: 'Soft-deleted memory' } },
})
const likeRoute = createRoute({
  method: 'put', path: '/families/{familyId}/memories/{memoryId}/like', security: bearerSecurity,
  request: { params: memoryParamsSchema, body: { content: json(setLikeRequestSchema) } },
  responses: { ...errors, 200: { content: json(likeResponseSchema), description: 'Idempotent like state' } },
})
const telegramVideoRoute = createRoute({
  method: 'post', path: '/families/{familyId}/memories/{memoryId}/telegram-video', security: bearerSecurity,
  request: { params: memoryParamsSchema },
  responses: { ...errors, 200: { content: json(telegramVideoOpenResponseSchema), description: 'Opaque Telegram navigation pointer' } },
})

export function createMemoryRoutes({
  requireAuth,
  service,
  telegramVideoDelivery,
}: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: MemoryService
  telegramVideoDelivery: TelegramVideoDeliveryService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('/families/*', requireAuth)
  routes.openapi(listRoute, async (c) => c.json(await executeMemory(() =>
    service.list(scope(c.var.user, c.req.valid('param').familyId), c.req.valid('query')),
  )))
  routes.openapi(createRouteDefinition, async (c) => {
    const result = await executeMemory(() => service.create(
      scope(c.var.user, c.req.valid('param').familyId),
      c.req.valid('json'),
      c.req.valid('header')['idempotency-key'],
    ))
    return c.json(result.memory, result.replayed ? 200 : 201)
  })
  routes.openapi(getRoute, async (c) => c.json(await executeMemory(() => {
    const params = c.req.valid('param')
    return service.get(scope(c.var.user, params.familyId), params.memoryId)
  })))
  routes.openapi(updateRoute, async (c) => c.json(await executeMemory(() => {
    const params = c.req.valid('param')
    return service.update(scope(c.var.user, params.familyId), params.memoryId, c.req.valid('json'))
  })))
  routes.openapi(deleteRoute, async (c) => {
    const params = c.req.valid('param')
    await executeMemory(() => service.delete(
      scope(c.var.user, params.familyId),
      params.memoryId,
      c.req.valid('header')['if-match'],
    ))
    return c.body(null, 204)
  })
  routes.openapi(likeRoute, async (c) => c.json(await executeMemory(() => {
    const params = c.req.valid('param')
    return service.setLike(scope(c.var.user, params.familyId), params.memoryId, c.req.valid('json').liked)
  })))
  routes.openapi(telegramVideoRoute, async (c) => c.json(await executeMemory(() => {
    const params = c.req.valid('param')
    return telegramVideoDelivery.request(scope(c.var.user, params.familyId), params.memoryId)
  })))
  return routes
}

function scope(user: AuthHttpEnv['Variables']['user'], familyId: string) {
  return { principal: { userId: user.id, sessionId: user.sessionId }, familyId }
}
