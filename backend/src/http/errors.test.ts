import { expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  createRequestContext,
  handleError,
  type RequestContextEnv,
  validationErrorHook,
} from './errors'

test('creates a server request id and uses it for error response and diagnostic correlation', async () => {
  const logged: unknown[][] = []
  const consoleError = spyOn(console, 'error').mockImplementation((...args) => logged.push(args))
  const app = new Hono<RequestContextEnv>()
  app.use('*', createRequestContext())
  app.get('/failure', () => {
    throw new Error('database diagnostic must not reach the client')
  })
  app.onError(handleError)

  try {
    const response = await app.request('/failure', {
      headers: { 'X-Request-Id': 'client-controlled-value' },
    })
    const body = await response.json() as any

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Не удалось обработать запрос',
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    })
    expect(body.error.requestId).not.toBe('client-controlled-value')
    expect(response.headers.get('X-Request-Id')).toBe(body.error.requestId)
    expect(JSON.stringify(logged)).toContain(body.error.requestId)
    expect(JSON.stringify(body)).not.toContain('database diagnostic')
  } finally {
    consoleError.mockRestore()
  }
})

test('maps invalid input to a safe 422 response with field errors', () => {
  const parsed = z.object({ child: z.object({ displayName: z.string().min(1) }) })
    .safeParse({ child: { displayName: '' } })
  if (parsed.success) throw new Error('fixture must be invalid')
  let captured: { body: unknown; status: number } | undefined
  const context = {
    var: { requestId: '01993b24-7e7d-7000-8000-000000000002' },
    json: (body: unknown, status: number) => {
      captured = { body, status }
      return new Response()
    },
  } as any

  validationErrorHook(parsed, context)

  expect(captured).toEqual({
    status: 422,
    body: {
      error: {
        code: 'INVALID_INPUT',
        message: 'Проверьте правильность заполнения полей',
        requestId: '01993b24-7e7d-7000-8000-000000000002',
        fieldErrors: { 'child.displayName': 'Некорректное значение' },
      },
    },
  })
})
