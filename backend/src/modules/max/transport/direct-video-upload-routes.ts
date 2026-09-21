import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'

import { AppError, validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import { toFamilyAppError } from '../../families'
import { MaxDirectUploadFailure, type DirectVideoUploadReserveInput } from '../application/direct-video-upload'

const bearerSecurity = [{ BearerAuth: [] }]
const json = <Schema extends z.ZodType>(schema: Schema) => ({ 'application/json': { schema } })
const familyParams = z.object({ familyId: z.uuid() }).strict()
const sessionParams = z.object({ familyId: z.uuid(), sessionId: z.uuid() }).strict()
const caption = z.string().min(1).refine((value) => [...value].length <= 4_000, 'Caption must be at most 4000 Unicode code points')
const reserveBody = z.object({
  childId: z.uuid(), body: caption, occurredAt: z.string().datetime({ offset: true }),
  fileName: z.string().min(1).max(255), fileSize: z.number().int().positive().max(250 * 1024 * 1024),
  mimeType: z.enum(['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm']),
  idempotencyKey: z.string().min(1).max(128),
}).strict()
const finalizeBody = z.object({ uploadToken: z.string().min(1).max(4_096) }).strict()
const reserveResponse = z.object({ state: z.enum(['reserved', 'existing']), sessionId: z.uuid(), expiresAt: z.string().datetime(), uploadUrl: z.string().url().optional(), uploadToken: z.string().optional() }).strict()
const finalizeResponse = z.object({
  state: z.enum(['finalized', 'processing', 'expired', 'failed']), sessionId: z.uuid(), memoryId: z.uuid().optional(),
  memory: z.unknown().optional(), retryable: z.boolean().optional(), code: z.string().optional(),
}).strict()
const errors = {
  401: { content: json(z.unknown()), description: 'Authentication required' },
  403: { content: json(z.unknown()), description: 'Family role does not allow this action' },
  404: { content: json(z.unknown()), description: 'Upload session not found' },
  409: { content: json(z.unknown()), description: 'Upload session conflict' },
  422: { content: json(z.unknown()), description: 'Invalid payload' },
  503: { content: json(z.unknown()), description: 'Retryable provider failure' },
} as const

const reserveRoute = createRoute({
  method: 'post', path: '/families/{familyId}/max-video-uploads/reserve', security: bearerSecurity,
  request: { params: familyParams, body: { content: json(reserveBody) } },
  responses: { ...errors, 201: { content: json(reserveResponse), description: 'Reserved MAX video upload' } },
})
const finalizeRoute = createRoute({
  method: 'post', path: '/families/{familyId}/max-video-uploads/{sessionId}/finalize', security: bearerSecurity,
  request: { params: sessionParams, body: { content: json(finalizeBody) } },
  responses: { ...errors, 200: { content: json(finalizeResponse), description: 'Published memory or retryable state' } },
})

export function createMaxDirectVideoUploadRoutes(options: {
  requireAuth: import('hono').MiddlewareHandler<AuthHttpEnv>
  service: ReturnType<typeof import('../application/direct-video-upload').createMaxDirectVideoUploadService>
}) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })
  routes.use('/families/*', options.requireAuth)
  routes.openapi(reserveRoute, async (c) => {
    const params = c.req.valid('param')
    const input = c.req.valid('json') as DirectVideoUploadReserveInput
    try {
      return c.json(await options.service.reserve(scope(c.var.user, params.familyId), input), 201)
    } catch (error) {
      if (error instanceof MaxDirectUploadFailure && error.code === 'reserve_not_found_membership') {
        console.warn('max_video_reserve_not_found_membership')
      }
      if (error instanceof MaxDirectUploadFailure && error.code === 'reserve_not_found_child') {
        console.warn('max_video_reserve_not_found_child')
      }
      throw toAppError(toFamilyAppError(error))
    }
  })
  routes.openapi(finalizeRoute, async (c) => {
    const params = c.req.valid('param')
    try {
      return c.json(await options.service.finalize(scope(c.var.user, params.familyId), params.sessionId, c.req.valid('json').uploadToken), 200)
    } catch (error) {
      throw toAppError(toFamilyAppError(error))
    }
  })
  return routes
}

function scope(user: AuthHttpEnv['Variables']['user'], familyId: string) {
  return { familyId, principal: { userId: user.id, sessionId: user.sessionId } }
}

function toAppError(error: unknown): Error {
  if (!(error instanceof MaxDirectUploadFailure)) return error instanceof Error ? error : new Error('MAX upload failed')
  if (error.kind === 'invalid_input') return new AppError(422, 'INVALID_INPUT', 'Проверьте правильность заполнения полей')
  if (error.kind === 'forbidden') return new AppError(403, 'FORBIDDEN', 'Действие недоступно')
  if (error.code === 'reserve_not_found_membership') return new AppError(404, 'MAX_VIDEO_MEMBERSHIP_NOT_FOUND', 'Семья не найдена')
  if (error.code === 'reserve_not_found_child') return new AppError(404, 'MAX_VIDEO_CHILD_NOT_FOUND', 'Профиль ребёнка не найден')
  if (error.kind === 'not_found') return new AppError(404, 'NOT_FOUND', 'Сессия загрузки не найдена')
  if (error.kind === 'retryable') return new AppError(503, 'UPLOAD_NOT_COMPLETED', 'Видео ещё обрабатывается, повторите попытку')
  return new AppError(409, error.code === 'upload_expired' ? 'UPLOAD_EXPIRED' : 'CONFLICT', 'Сессия загрузки больше недоступна')
}
