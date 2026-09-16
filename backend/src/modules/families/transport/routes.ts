import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  apiErrorSchema,
  createFamilyRequestSchema,
  completeChildProfileRequestSchema,
  createInviteRequestSchema,
  createInviteResponseSchema,
  familyInviteParamsSchema,
  familyInvitesResponseSchema,
  familyMemberParamsSchema,
  familyMemberResponseSchema,
  familyMembersResponseSchema,
  familyMeResponseSchema,
  familyParamsSchema,
  familyResponseSchema,
  familyUsageSchema,
  idempotencyKeyHeadersSchema,
  invitePreviewRequestSchema,
  invitePreviewResponseSchema,
  removeMemberRequestSchema,
  updateMemberRoleRequestSchema,
  updateFamilyRequestSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import type { ZodType } from 'zod'

import { validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { FamilyService } from '../application/family-service'
import { executeFamily } from './errors'
import { bypassesFamilyBearerAuth } from './private-media-content-request'

const bearerSecurity = [{ BearerAuth: [] }]
const json = <Schema extends ZodType>(schema: Schema) => ({ 'application/json': { schema } })
const errors = {
  422: { content: json(apiErrorSchema), description: 'Invalid payload' },
  401: { content: json(apiErrorSchema), description: 'Authentication required' },
  403: { content: json(apiErrorSchema), description: 'Family role does not allow this action' },
  404: { content: json(apiErrorSchema), description: 'Family resource not found' },
  409: { content: json(apiErrorSchema), description: 'Family state conflict' },
  410: { content: json(apiErrorSchema), description: 'Invitation expired or revoked' },
} as const

const createFamilyRoute = createRoute({
  method: 'post', path: '/families', security: bearerSecurity,
  request: {
    headers: idempotencyKeyHeadersSchema,
    body: { content: json(createFamilyRequestSchema) },
  },
  responses: { ...errors, 201: { content: json(familyResponseSchema), description: 'Created pilot family' } },
})
const meRoute = createRoute({
  method: 'get', path: '/me', security: bearerSecurity,
  responses: { ...errors, 200: { content: json(familyMeResponseSchema), description: 'User and active family context' } },
})
const getFamilyRoute = createRoute({
  method: 'get', path: '/families/{familyId}', security: bearerSecurity,
  request: { params: familyParamsSchema },
  responses: { ...errors, 200: { content: json(familyResponseSchema), description: 'Family visible to member' } },
})
const updateFamilyRoute = createRoute({
  method: 'patch', path: '/families/{familyId}', security: bearerSecurity,
  request: {
    params: familyParamsSchema,
    body: { content: json(updateFamilyRequestSchema) },
  },
  responses: { ...errors, 200: { content: json(familyResponseSchema), description: 'Updated family and child profile' } },
})
const completeChildProfileRoute = createRoute({
  method: 'put', path: '/families/{familyId}/child', security: bearerSecurity,
  request: {
    params: familyParamsSchema,
    body: { content: json(completeChildProfileRequestSchema) },
  },
  responses: { ...errors, 200: { content: json(familyResponseSchema), description: 'Completed child profile' } },
})
const listMembersRoute = createRoute({
  method: 'get', path: '/families/{familyId}/members', security: bearerSecurity,
  request: { params: familyParamsSchema },
  responses: { ...errors, 200: { content: json(familyMembersResponseSchema), description: 'Active family members' } },
})
const createInviteRoute = createRoute({
  method: 'post', path: '/families/{familyId}/invites', security: bearerSecurity,
  request: {
    params: familyParamsSchema,
    headers: idempotencyKeyHeadersSchema,
    body: { content: json(createInviteRequestSchema) },
  },
  responses: { ...errors, 201: { content: json(createInviteResponseSchema), description: 'Created one-use invitation' } },
})
const usageRoute = createRoute({
  method: 'get', path: '/families/{familyId}/usage', security: bearerSecurity,
  request: { params: familyParamsSchema },
  responses: { ...errors, 200: { content: json(familyUsageSchema), description: 'Private family archive usage' } },
})
const listInvitesRoute = createRoute({
  method: 'get', path: '/families/{familyId}/invites', security: bearerSecurity,
  request: { params: familyParamsSchema },
  responses: { ...errors, 200: { content: json(familyInvitesResponseSchema), description: 'Visible pending invitations' } },
})
const previewInviteRoute = createRoute({
  method: 'post', path: '/invites/preview', security: bearerSecurity,
  request: { body: { content: json(invitePreviewRequestSchema) } },
  responses: { ...errors, 200: { content: json(invitePreviewResponseSchema), description: 'Safe invitation preview' } },
})
const acceptInviteRoute = createRoute({
  method: 'post', path: '/invites/accept', security: bearerSecurity,
  request: { body: { content: json(acceptInviteRequestSchema) } },
  responses: { ...errors, 200: { content: json(acceptInviteResponseSchema), description: 'Accepted invitation' } },
})
const revokeInviteRoute = createRoute({
  method: 'delete', path: '/families/{familyId}/invites/{inviteId}', security: bearerSecurity,
  request: { params: familyInviteParamsSchema },
  responses: { ...errors, 204: { description: 'Revoked invitation' } },
})
const updateMemberRoute = createRoute({
  method: 'patch', path: '/families/{familyId}/members/{userId}', security: bearerSecurity,
  request: {
    params: familyMemberParamsSchema,
    body: { content: json(updateMemberRoleRequestSchema) },
  },
  responses: { ...errors, 200: { content: json(familyMemberResponseSchema), description: 'Updated family role' } },
})
const removeMemberRoute = createRoute({
  method: 'delete', path: '/families/{familyId}/members/{userId}', security: bearerSecurity,
  request: {
    params: familyMemberParamsSchema,
    body: { content: json(removeMemberRequestSchema) },
  },
  responses: { ...errors, 204: { description: 'Revoked family membership' } },
})

export function createFamilyRoutes({
  requireAuth,
  service,
}: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: FamilyService
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('/me', requireAuth)
  routes.use('/families', requireAuth)
  routes.use('/families/*', (c, next) => (
    bypassesFamilyBearerAuth(c.req.method, c.req.path) ? next() : requireAuth(c, next)
  ))
  routes.use('/invites/*', requireAuth)

  routes.openapi(meRoute, async (c) => c.json(await executeFamily(() => {
    const { sessionId: _sessionId, externalIdentity: _externalIdentity, ...user } = c.var.user
    return service.getMe(user)
  }), 200))
  routes.openapi(createFamilyRoute, async (c) => c.json(await executeFamily(() =>
    service.createFamily(
      principal(c.var.user),
      c.req.valid('json'),
      c.req.valid('header')['idempotency-key'],
    ),
  ), 201))
  routes.openapi(getFamilyRoute, async (c) => c.json(await executeFamily(() =>
    service.getFamily(scope(c.var.user, c.req.valid('param').familyId)),
  ), 200))
  routes.openapi(updateFamilyRoute, async (c) => c.json(await executeFamily(() =>
    service.updateFamily(
      scope(c.var.user, c.req.valid('param').familyId),
      c.req.valid('json'),
    ),
  ), 200))
  routes.openapi(completeChildProfileRoute, async (c) => c.json(await executeFamily(() =>
    service.completeChildProfile(
      scope(c.var.user, c.req.valid('param').familyId),
      c.req.valid('json'),
    ),
  ), 200))
  routes.openapi(listMembersRoute, async (c) => c.json(await executeFamily(() =>
    service.listMembers(scope(c.var.user, c.req.valid('param').familyId)),
  ), 200))
  routes.openapi(usageRoute, async (c) => c.json(await executeFamily(() =>
    service.getUsage(scope(c.var.user, c.req.valid('param').familyId)),
  ), 200))
  routes.openapi(createInviteRoute, async (c) => c.json(await executeFamily(() =>
    service.createInvite(
      scope(c.var.user, c.req.valid('param').familyId),
      c.req.valid('json'),
      c.req.valid('header')['idempotency-key'],
    ),
  ), 201))
  routes.openapi(listInvitesRoute, async (c) => c.json(await executeFamily(() =>
    service.listInvites(scope(c.var.user, c.req.valid('param').familyId)),
  ), 200))
  routes.openapi(previewInviteRoute, async (c) => c.json(await executeFamily(() =>
    service.previewInvite(principal(c.var.user), c.req.valid('json').token),
  ), 200))
  routes.openapi(acceptInviteRoute, async (c) => c.json(await executeFamily(() =>
    service.acceptInvite(principal(c.var.user), c.req.valid('json').token),
  ), 200))
  routes.openapi(revokeInviteRoute, async (c) => {
    const params = c.req.valid('param')
    await executeFamily(() => service.revokeInvite(scope(c.var.user, params.familyId), params.inviteId))
    return c.body(null, 204)
  })
  routes.openapi(updateMemberRoute, async (c) => {
    const params = c.req.valid('param')
    return c.json(await executeFamily(() => service.updateMemberRole(
      scope(c.var.user, params.familyId), params.userId, c.req.valid('json'),
    )), 200)
  })
  routes.openapi(removeMemberRoute, async (c) => {
    const params = c.req.valid('param')
    await executeFamily(() => service.removeMember(
      scope(c.var.user, params.familyId), params.userId, c.req.valid('json').expectedVersion,
    ))
    return c.body(null, 204)
  })
  return routes
}

function principal(user: AuthHttpEnv['Variables']['user']) {
  return {
    userId: user.id,
    sessionId: user.sessionId,
    externalIdentity: user.externalIdentity ?? null,
  }
}

function scope(user: AuthHttpEnv['Variables']['user'], familyId: string) {
  return { principal: principal(user), familyId }
}
