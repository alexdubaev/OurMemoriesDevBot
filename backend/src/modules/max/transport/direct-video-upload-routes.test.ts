import { expect, spyOn, test } from 'bun:test'
import { OpenAPIHono } from '@hono/zod-openapi'

import { handleError } from '../../../http/errors'
import type { AuthHttpEnv, AuthenticatedPrincipal } from '../../auth'
import { MaxDirectUploadFailure, createMaxDirectVideoUploadService } from '../application/direct-video-upload'
import { createMaxDirectVideoUploadRoutes } from './direct-video-upload-routes'

const familyId = '11111111-1111-4111-8111-111111111111'
const childId = '33333333-3333-4333-8333-333333333333'
const user: AuthenticatedPrincipal = {
  id: '22222222-2222-4222-8222-222222222222', email: null, displayName: null, role: 'user',
  createdAt: '2026-09-20T10:00:00.000Z', sessionId: 'session-1', externalIdentity: null,
}

const input = {
  childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z', fileName: 'clip.mp4',
  fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'request-1',
}

type DirectVideoUploadService = ReturnType<typeof createMaxDirectVideoUploadService>

function appFor(service: DirectVideoUploadService) {
  const requireAuth: import('hono').MiddlewareHandler<AuthHttpEnv> = async (c, next) => {
    c.set('user', user)
    await next()
  }
  const app = new OpenAPIHono<AuthHttpEnv>()
  app.route('/', createMaxDirectVideoUploadRoutes({ requireAuth, service }))
  app.onError(handleError)
  return app
}

function failingService(code: string, message: string): DirectVideoUploadService {
  return {
    reserve: async () => { throw new MaxDirectUploadFailure('not_found', message, code) },
    finalize: async () => { throw new Error('not used') },
  } as DirectVideoUploadService
}

async function reserve(app: ReturnType<typeof appFor>) {
  return app.request(`/families/${familyId}/max-video-uploads/reserve`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  })
}

test('returns distinct safe codes for the two Reserve pre-session not-found branches', async () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {})

  try {
    const membership = await reserve(appFor(failingService('reserve_not_found_membership', 'Семья не найдена')))
    expect(membership.status).toBe(404)
    expect(await membership.json()).toMatchObject({ error: { code: 'MAX_VIDEO_MEMBERSHIP_NOT_FOUND', message: 'Семья не найдена' } })

    const child = await reserve(appFor(failingService('reserve_not_found_child', 'Профиль ребёнка не найден')))
    expect(child.status).toBe(404)
    expect(await child.json()).toMatchObject({ error: { code: 'MAX_VIDEO_CHILD_NOT_FOUND', message: 'Профиль ребёнка не найден' } })

    expect(warn.mock.calls).toEqual([
      ['max_video_reserve_not_found_membership'],
      ['max_video_reserve_not_found_child'],
    ])
  } finally {
    warn.mockRestore()
  }
})
