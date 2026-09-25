import { expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'

import { createRequestContext, handleError } from '../../../http/errors'
import { createMediaRoutes } from './routes'

const familyId = '0196f6f8-6600-7000-8000-000000000001'
const mediaId = '0196f6f8-6600-7000-8000-000000000002'

test('logs only opt-in, redacted private media diagnostics', async () => {
  const logs: unknown[][] = []
  const log = spyOn(console, 'info').mockImplementation((...args) => logs.push(args))
  const service = {
    content: async (_scope: unknown, _mediaId: string, _variant: string, _range: string | undefined, onDiagnostic?: (event: unknown) => void) => {
      onDiagnostic?.({ stage: 'asset', outcome: 'variant_found', purpose: 'child_avatar' })
      onDiagnostic?.({ stage: 'storage', outcome: 'object_found', contentType: 'image/png', byteSize: 24 })
      return { contentType: 'image/png', contentLength: 24, body: new Uint8Array(24), range: null }
    },
  }
  const app = new Hono()
  app.use('*', createRequestContext())
  app.route('/api/v1', createMediaRoutes({
    authenticateMediaAccess: async () => ({ id: 'user-private-id', sessionId: 'session-private-id' }) as never,
    cookieSecure: true,
    requireAuth: async (_context, next) => next(),
    service: service as never,
  }))
  app.onError(handleError)

  try {
    const response = await app.request(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`, {
      headers: {
        Authorization: 'Bearer never-log-this-token',
        'X-Memoly-Private-Media-Diagnostic': '1',
      },
    })

    expect(response.status).toBe(200)
    expect(log).toHaveBeenCalled()
    const serialized = JSON.stringify(logs)
    expect(serialized).toContain('variant_found')
    expect(serialized).toContain('image/png')
    expect(serialized).toContain('authorizationPresent')
    expect(serialized).not.toContain(familyId)
    expect(serialized).not.toContain(mediaId)
    expect(serialized).not.toContain('user-private-id')
    expect(serialized).not.toContain('session-private-id')
    expect(serialized).not.toContain('never-log-this-token')

    log.mockClear()
    const unmarked = await app.request(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`, {
      headers: { Authorization: 'Bearer never-log-this-token' },
    })
    expect(unmarked.status).toBe(200)
    expect(log).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})
