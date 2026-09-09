import { randomUUID } from 'node:crypto'

import type { ApiErrorCode, ApiErrorResponse } from '@web-app-demo/contracts'
import type { Context, MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError, type ZodIssue } from 'zod'

export type RequestContextEnv = {
  Variables: {
    requestId: string
  }
}

export class AppError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly diagnosticDetails?: unknown,
  ) {
    super(message)
  }
}

export function createRequestContext(): MiddlewareHandler<RequestContextEnv> {
  return createMiddleware<RequestContextEnv>(async (c, next) => {
    const requestId = randomUUID()
    c.set('requestId', requestId)
    c.header('X-Request-Id', requestId)
    await next()
  })
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  fieldErrors?: Record<string, string>,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
      ...(fieldErrors === undefined ? {} : { fieldErrors }),
    },
  }
}

type ValidationHookResult = { success: true } | { success: false; error: ZodError }

export function validationErrorResponse(issues: ZodIssue[], requestId: string) {
  const fieldErrors = Object.fromEntries(issues.map((issue) => [
    issue.path.length > 0 ? issue.path.join('.') : '_root',
    'Некорректное значение',
  ]))
  return errorResponse(
    'INVALID_INPUT',
    'Проверьте правильность заполнения полей',
    requestId,
    fieldErrors,
  )
}

export function validationErrorHook(result: ValidationHookResult, c: Context) {
  if (!result.success) {
    return c.json(validationErrorResponse(result.error.issues, requestIdFrom(c)), 422)
  }
}

export function handleError(error: Error, c: Context) {
  const requestId = requestIdFrom(c)
  if (error instanceof AppError) {
    if (error.diagnosticDetails !== undefined) {
      console.error('Request failed', {
        requestId,
        status: error.status,
        code: error.code,
        details: error.diagnosticDetails,
      })
    }
    return c.json(errorResponse(error.code, error.message, requestId), error.status)
  }

  if (error instanceof ZodError) {
    return c.json(validationErrorResponse(error.issues, requestId), 422)
  }

  if (error instanceof HTTPException) {
    console.error('Request failed', { requestId, status: error.status, error })
    return c.json(errorResponse('BAD_REQUEST', 'Некорректный запрос', requestId), error.status)
  }

  console.error('Request failed', { requestId, error })
  return c.json(errorResponse('INTERNAL_ERROR', 'Не удалось обработать запрос', requestId), 500)
}

export function requestIdFrom(c: Context): string {
  const requestId = (c.var as { requestId?: unknown }).requestId
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : randomUUID()
}
