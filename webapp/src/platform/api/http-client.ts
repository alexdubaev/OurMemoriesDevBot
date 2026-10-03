import { apiErrorSchema } from '@web-app-demo/contracts'
import type { z } from 'zod'

// Browser requests stay on the Mini App's origin unless deployment explicitly supplies a
// separate API origin. This lets Funnel forward `/api` without making a phone's `localhost`
// part of the request path.
const defaultApiBaseUrl = (import.meta.env?.VITE_API_URL ?? '').replace(/\/$/, '')

export type HttpRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  rawBody?: BodyInit
  headers?: HeadersInit
  credentials?: RequestCredentials
  /**
   * An abort the transport observes rejects the request with the signal's reason (an
   * `AbortError`) rather than an `ApiRequestError`, so callers cannot mistake a cancelled request
   * for one the backend answered. TanStack Query hands every fetch its own signal; forwarding it
   * lets a superseded query cancel its request instead of leaving it in flight.
   */
  signal?: AbortSignal
  /** Bounds only callers that explicitly opt in; media transfers remain unbounded here. */
  timeoutMs?: number
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  readonly fieldErrors?: Record<string, string>

  constructor(
    status: number,
    code: string,
    message: string,
    options: { requestId?: string; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = options.requestId ?? null
    this.fieldErrors = options.fieldErrors
  }
}

export class HttpClient {
  private readonly baseUrl: string

  constructor(baseUrl = defaultApiBaseUrl) {
    this.baseUrl = baseUrl
  }

  async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options: HttpRequestOptions = {},
  ): Promise<z.infer<TSchema>> {
    return withDeadline(options, async (signal) => {
      const response = await this.rawWithSignal(path, options, signal)
      return schema.parse(await response.json())
    })
  }

  async raw(path: string, options: HttpRequestOptions = {}): Promise<Response> {
    return withDeadline(options, (signal) => this.rawWithSignal(path, options, signal))
  }

  private async rawWithSignal(path: string, options: HttpRequestOptions, signal: AbortSignal): Promise<Response> {
    if (options.body !== undefined && options.rawBody !== undefined) throw new TypeError('body and rawBody cannot be used together')
    const headers = new Headers(options.headers)
    if (options.body !== undefined && options.rawBody === undefined) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: options.credentials ?? 'include',
      headers,
      signal,
      body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })

    if (!response.ok) {
      throw await toApiError(response, signal)
    }

    return response
  }
}

async function withDeadline<T>(options: HttpRequestOptions, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  if (options.timeoutMs === undefined) return operation(options.signal ?? new AbortController().signal)
  const controller = new AbortController()
  const timeoutError = new Error('Request timed out')
  timeoutError.name = 'TimeoutError'
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectCallerAbort!: (reason?: unknown) => void
  const callerAbort = new Promise<never>((_resolve, reject) => { rejectCallerAbort = reject })
  const abortFromCaller = () => {
    const reason = options.signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
    controller.abort(reason)
    rejectCallerAbort(reason)
  }
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError)
      reject(timeoutError)
    }, options.timeoutMs)
  })
  try {
    return await Promise.race([operation(controller.signal), deadline, callerAbort])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

async function toApiError(response: Response, signal?: AbortSignal) {
  const fallbackMessage = `Request failed with status ${response.status}`

  try {
    const parsed = apiErrorSchema.parse(await response.json())
    return new ApiRequestError(response.status, parsed.error.code, parsed.error.message, {
      requestId: parsed.error.requestId,
      fieldErrors: parsed.error.fieldErrors,
    })
  } catch {
    // An abort that lands while the error body is still streaming rejects `json()` with the abort
    // reason. Surface that reason instead of a status-coded error a caller could act on, such as
    // treating a cancelled 401 as an expired session.
    signal?.throwIfAborted()
    return new ApiRequestError(response.status, 'INTERNAL_ERROR', fallbackMessage)
  }
}
