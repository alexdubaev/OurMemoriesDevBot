import {
  apiErrorSchema,
  avatarResponseSchema,
  avatarUploadParamsSchema,
  createAvatarUploadRequestSchema,
  createAvatarUploadResponseSchema,
  finalizeAvatarUploadRequestSchema,
  updateAvatarCropRequestSchema,
} from '@web-app-demo/contracts'
import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import type { AvatarCrop } from '@web-app-demo/contracts'
import { bodyLimit } from 'hono/body-limit'

import { errorResponse, requestIdFrom, validationErrorHook } from '../../../http/errors'
import type { AuthHttpEnv } from '../../auth'
import type { AvatarsService } from '../application/avatars-service'
import { executeUploads } from './errors'

const errorContent = {
  'application/json': {
    schema: apiErrorSchema,
  },
}

const bearerSecurity = [{ BearerAuth: [] }]

const createAvatarUploadRoute = createRoute({
  method: 'post',
  path: '/avatar',
  security: bearerSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: createAvatarUploadRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: createAvatarUploadResponseSchema } },
      description: 'Presigned upload ticket for a new avatar',
    },
    422: { content: errorContent, description: 'Invalid payload' },
    401: { content: errorContent, description: 'Authentication required' },
    413: { content: errorContent, description: 'Request body is too large' },
    429: { content: errorContent, description: 'Too many requests' },
  },
})

const getAvatarRoute = createRoute({
  method: 'get',
  path: '/avatar',
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: avatarResponseSchema } },
      description: 'The current avatar, or null when there is none',
    },
    401: { content: errorContent, description: 'Authentication required' },
    429: { content: errorContent, description: 'Too many requests' },
  },
})

const deleteAvatarRoute = createRoute({
  method: 'delete',
  path: '/avatar',
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: avatarResponseSchema } },
      description: 'Avatar removed; idempotent',
    },
    401: { content: errorContent, description: 'Authentication required' },
    429: { content: errorContent, description: 'Too many requests' },
  },
})

type CreateUploadsRoutesOptions = {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  service: AvatarsService
}

export function createUploadsRoutes({ requireAuth, service }: CreateUploadsRoutesOptions) {
  const routes = new OpenAPIHono<AuthHttpEnv>({ defaultHook: validationErrorHook })

  routes.use('*', requireAuth)

  routes.post('/avatar/preview', bodyLimit({ maxSize: 20_128_768, onError: (c) => c.json(errorResponse('PAYLOAD_TOO_LARGE', 'Размер запроса превышает допустимый', requestIdFrom(c)), 413) }), async (c) => {
    const declared = c.req.header('content-type')?.toLowerCase() ?? ''
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(declared)) {
      return c.json(errorResponse('UPLOAD_REJECTED', 'Формат фотографии не поддерживается', requestIdFrom(c)), 415)
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength < 64 || bytes.byteLength > 20_000_000) return c.json(errorResponse('UPLOAD_REJECTED', 'Размер фотографии не подходит', requestIdFrom(c)), 422)
    try {
      const preview = await service.normalizePreview(bytes, declared)
      return new Response(preview.bytes.slice().buffer as ArrayBuffer, { status: 200, headers: {
        'Content-Type': preview.contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      } })
    } catch {
      return c.json(errorResponse('UPLOAD_REJECTED', 'Фотографию не удалось открыть', requestIdFrom(c)), 422)
    }
  })

  routes.get('/avatar/content', async (c) => {
    const result = await executeUploads(() => service.currentAvatarContent(c.var.user.id))
    return new Response(result.bytes.slice().buffer as ArrayBuffer, { status: 200, headers: {
      'Content-Type': result.contentType,
      'Content-Length': String(result.bytes.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } })
  })

  routes.openapi(createAvatarUploadRoute, async (c) => {
    const result = await executeUploads(() =>
      service.createUpload(c.var.user.id, c.req.valid('json')),
    )
    return c.json(result, 201)
  })

  routes.post('/avatar/:uploadId/finalize', async (c) => {
    const params = avatarUploadParamsSchema.safeParse(c.req.param())
    if (!params.success) return c.json(errorResponse('INVALID_INPUT', 'Проверьте запрос загрузки', requestIdFrom(c)), 422)
    const raw = await c.req.text()
    let avatarCrop: AvatarCrop | undefined
    if (raw.trim()) {
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { return c.json(errorResponse('INVALID_INPUT', 'Проверьте фотографию профиля', requestIdFrom(c)), 422) }
      const body = finalizeAvatarUploadRequestSchema.safeParse(parsed)
      if (!body.success) return c.json(errorResponse('INVALID_INPUT', 'Проверьте фотографию профиля', requestIdFrom(c)), 422)
      avatarCrop = body.data.avatarCrop
    }
    const result = await executeUploads(() => service.finalizeUpload(c.var.user.id, params.data.uploadId, avatarCrop))
    return c.json(result, 200)
  })

  routes.post('/avatar/crop', async (c) => {
    const parsed = updateAvatarCropRequestSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json(errorResponse('INVALID_INPUT', 'Проверьте фотографию профиля', requestIdFrom(c)), 422)
    const result = await executeUploads(() => service.updateCrop(c.var.user.id, parsed.data))
    return c.json(result, 200)
  })

  routes.openapi(getAvatarRoute, async (c) => {
    return c.json(await service.getAvatar(c.var.user.id), 200)
  })

  routes.openapi(deleteAvatarRoute, async (c) => {
    return c.json(await service.removeAvatar(c.var.user.id), 200)
  })

  return routes
}
