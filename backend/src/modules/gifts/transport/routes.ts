import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  apiErrorSchema,
  createGiftRequestSchema,
  deleteGiftHeadersSchema,
  giftListResponseSchema,
  giftMutationResponseSchema,
  giftParamsSchema,
  giftsParamsSchema,
  giftVersionRequestSchema,
  idempotencyKeyHeadersSchema,
  updateGiftRequestSchema,
} from '@web-app-demo/contracts'
import type { ZodType } from 'zod'
import { errorResponse, requestIdFrom, validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { GiftService } from '../application/gift-service'
import { executeGift } from './errors'

const json = <Schema extends ZodType>(schema: Schema) => ({ 'application/json': { schema } })
const errors = {
  401: { content: json(apiErrorSchema), description: 'Session required' },
  403: { content: json(apiErrorSchema), description: 'Family role does not allow this action' },
  404: { content: json(apiErrorSchema), description: 'Family or gift is unavailable' },
  409: { content: json(apiErrorSchema), description: 'Reservation, version or idempotency conflict' },
  413: { content: json(apiErrorSchema), description: 'Body too large' },
  422: { content: json(apiErrorSchema), description: 'Invalid input, unusable photo or list limit' },
  429: { content: json(apiErrorSchema), description: 'Rate limit' },
} as const
const security = [{ BearerAuth: [] }]
const listPath = '/families/{familyId}/gifts'
const giftPath = `${listPath}/{giftId}`
const mutation = { content: json(giftMutationResponseSchema), description: 'Fresh gift' }
const versionBody = { body: { content: json(giftVersionRequestSchema), required: true } }

const list = createRoute({
  method: 'get', path: listPath, security,
  request: { params: giftsParamsSchema },
  responses: { ...errors, 200: { content: json(giftListResponseSchema), description: 'Family gift list' } },
})
const create = createRoute({
  method: 'post', path: listPath, security,
  request: {
    params: giftsParamsSchema,
    headers: idempotencyKeyHeadersSchema,
    body: { content: json(createGiftRequestSchema), required: true },
  },
  responses: { ...errors, 200: { ...mutation, description: 'Idempotent replay' }, 201: { ...mutation, description: 'Created gift' } },
})
const update = createRoute({
  method: 'patch', path: giftPath, security,
  request: { params: giftParamsSchema, body: { content: json(updateGiftRequestSchema), required: true } },
  responses: { ...errors, 200: mutation },
})
const remove = createRoute({
  method: 'delete', path: giftPath, security,
  request: { params: giftParamsSchema, headers: deleteGiftHeadersSchema },
  responses: { ...errors, 204: { description: 'Gift, its reservation and its photo are removed' } },
})
const reserve = createRoute({
  method: 'post', path: `${giftPath}/reservation`, security,
  request: { params: giftParamsSchema, ...versionBody },
  responses: { ...errors, 200: mutation },
})
const cancelReservation = createRoute({
  method: 'delete', path: `${giftPath}/reservation`, security,
  request: { params: giftParamsSchema, ...versionBody },
  responses: { ...errors, 200: mutation },
})
const markBought = createRoute({
  method: 'post', path: `${giftPath}/purchase`, security,
  request: { params: giftParamsSchema, ...versionBody },
  responses: { ...errors, 200: mutation },
})
const unmarkBought = createRoute({
  method: 'delete', path: `${giftPath}/purchase`, security,
  request: { params: giftParamsSchema, ...versionBody },
  responses: { ...errors, 200: mutation },
})

/** Gift lists and their reservations are family-private; no shared cache may keep them. */
export const giftPrivacyMiddleware: MiddlewareHandler = async (c, next) => {
  if (/^\/api\/v1\/families\/[^/]+\/gifts(?:\/[^/]+(?:\/(?:reservation|purchase))?)?\/?$/.test(c.req.path))
    c.header('Cache-Control', 'private, no-store')
  await next()
}

export function createGiftRoutes({
  requireAuth,
  service,
}: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: GiftService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  const limit = bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json(errorResponse('BAD_REQUEST', 'Слишком большой запрос', requestIdFrom(c)), 413),
  })
  for (const path of ['/families/:familyId/gifts', '/families/:familyId/gifts/*']) {
    routes.use(path, requireAuth)
    routes.use(path, limit)
  }
  const scope = (user: AuthHttpEnv['Variables']['user'], familyId: string) => ({
    principal: { userId: user.id, sessionId: user.sessionId },
    familyId,
  })

  routes.openapi(list, async (c) =>
    c.json(await executeGift(() => service.list(scope(c.var.user, c.req.valid('param').familyId))), 200))
  routes.openapi(create, async (c) => {
    const result = await executeGift(() => service.create(
      scope(c.var.user, c.req.valid('param').familyId),
      c.req.valid('json'),
      c.req.valid('header')['idempotency-key'],
    ))
    return c.json({ gift: result.gift }, result.replayed ? 200 : 201)
  })
  routes.openapi(update, async (c) => {
    const p = c.req.valid('param')
    const gift = await executeGift(() => service.update(scope(c.var.user, p.familyId), p.giftId, c.req.valid('json')))
    return c.json({ gift }, 200)
  })
  routes.openapi(remove, async (c) => {
    const p = c.req.valid('param')
    await executeGift(() => service.remove(scope(c.var.user, p.familyId), p.giftId, c.req.valid('header')['if-match']))
    return c.body(null, 204)
  })
  routes.openapi(reserve, async (c) => {
    const p = c.req.valid('param')
    const gift = await executeGift(() => service.reserve(scope(c.var.user, p.familyId), p.giftId, c.req.valid('json').expectedVersion))
    return c.json({ gift }, 200)
  })
  routes.openapi(cancelReservation, async (c) => {
    const p = c.req.valid('param')
    const gift = await executeGift(() =>
      service.cancelReservation(scope(c.var.user, p.familyId), p.giftId, c.req.valid('json').expectedVersion))
    return c.json({ gift }, 200)
  })
  routes.openapi(markBought, async (c) => {
    const p = c.req.valid('param')
    const gift = await executeGift(() => service.markBought(scope(c.var.user, p.familyId), p.giftId, c.req.valid('json').expectedVersion))
    return c.json({ gift }, 200)
  })
  routes.openapi(unmarkBought, async (c) => {
    const p = c.req.valid('param')
    const gift = await executeGift(() => service.unmarkBought(scope(c.var.user, p.familyId), p.giftId, c.req.valid('json').expectedVersion))
    return c.json({ gift }, 200)
  })
  return routes
}
