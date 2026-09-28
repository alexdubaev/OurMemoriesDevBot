import { MaxProviderError } from './max-api'

const MAX_MEDIA_HOSTS = new Set(['i.oneme.ru', 'fd.oneme.ru', 'a.oneme.ru'])
const MAX_VIDEO_CDN_HOST = /^maxvd[0-9]+\.okcdn\.ru$/i

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class MaxMediaDownloadError extends MaxProviderError {
  constructor() { super(); this.name = 'MaxMediaDownloadError' }
}

export type MaxDownloadedMedia = {
  bytes: Uint8Array
  contentType: string | null
  contentLength: number
}

export type MaxVideoStream = {
  body: ReadableStream<Uint8Array>
  contentType: 'video/mp4' | 'video/quicktime'
  contentLength: number
  /** A body error can be wrapped by the private-storage adapter; retain its classification. */
  failure: () => MaxProviderError | MaxMediaDownloadError | null
}

/** The CDN response is passed to private storage as a stream. No video-sized Uint8Array is allocated. */
export function createMaxVideoStreamDownload(options: { fetch?: FetchLike; timeoutMs?: number; bodyTimeoutMs?: number } = {}) {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 15 * 60_000
  return async (url: string, maxBytes: number, callerSignal?: AbortSignal): Promise<MaxVideoStream> => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !isAllowedMediaUrl(url, true)) throw new MaxMediaDownloadError()
    const controller = new AbortController()
    const abortCaller = () => controller.abort()
    callerSignal?.addEventListener('abort', abortCaller, { once: true })
    if (callerSignal?.aborted) controller.abort()
    const headerTimeout = setTimeout(() => controller.abort(), timeoutMs)
    let bodyTimeout: ReturnType<typeof setTimeout> | undefined
    let abortBody: (() => void) | undefined
    const cleanup = () => {
      clearTimeout(headerTimeout)
      clearTimeout(bodyTimeout)
      callerSignal?.removeEventListener('abort', abortCaller)
      if (abortBody) controller.signal.removeEventListener('abort', abortBody)
    }
    let response: Response
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit', referrer: '', headers: {}, signal: controller.signal })
    } catch {
      cleanup()
      throw new MaxProviderError(undefined, true)
    }
    clearTimeout(headerTimeout)
    if (controller.signal.aborted) {
      cleanup()
      void response.body?.cancel().catch(() => undefined)
      throw new MaxProviderError(undefined, true)
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      cleanup()
      void response.body?.cancel().catch(() => undefined)
      throw new MaxProviderError(undefined, true, response.status)
    }
    const declared = response.headers.get('content-length')
    const length = declared && /^[0-9]+$/.test(declared) ? Number(declared) : NaN
    const mime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (response.status !== 200 || !response.body || !Number.isSafeInteger(length) || length <= 0 || length > maxBytes ||
      (mime !== 'video/mp4' && mime !== 'video/quicktime')) {
      cleanup()
      void response.body?.cancel().catch(() => undefined)
      throw new MaxMediaDownloadError()
    }
    if (!callerSignal) bodyTimeout = setTimeout(() => controller.abort(), bodyTimeoutMs)
    const reader = response.body.getReader()
    abortBody = () => { void reader.cancel().catch(() => undefined) }
    controller.signal.addEventListener('abort', abortBody, { once: true })
    let total = 0
    let streamFailure: MaxProviderError | MaxMediaDownloadError | null = null
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const next = await reader.read()
          if (next.done) {
            cleanup()
            if (total !== length) {
              streamFailure = new MaxProviderError(undefined, true)
              stream.error(streamFailure)
            } else stream.close()
            return
          }
          total += next.value.byteLength
          if (total > length || total > maxBytes) {
            streamFailure = new MaxMediaDownloadError()
            cleanup()
            void reader.cancel().catch(() => undefined)
            stream.error(streamFailure)
            return
          }
          stream.enqueue(next.value)
        } catch {
          streamFailure = new MaxProviderError(undefined, true)
          cleanup()
          stream.error(streamFailure)
        }
      },
      cancel(reason) {
        cleanup()
        return reader.cancel(reason).catch(() => undefined)
      },
    })
    return { body, contentType: mime, contentLength: length, failure: () => streamFailure }
  }
}

export function createMaxMediaDownload(options: { fetch?: FetchLike; timeoutMs?: number } = {}) {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  return async (url: string, maxBytes: number, callerSignal?: AbortSignal): Promise<MaxDownloadedMedia> => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !isAllowedMediaUrl(url, false)) throw new MaxMediaDownloadError()
    const controller = new AbortController()
    const abortCaller = () => controller.abort()
    callerSignal?.addEventListener('abort', abortCaller, { once: true })
    if (callerSignal?.aborted) controller.abort()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: {}, signal: controller.signal })
      if (response.status === 408 || response.status === 429 || response.status >= 500) throw new MaxProviderError(undefined, true, response.status)
      if (!response.ok || response.status >= 300 && response.status < 400 || !response.body) throw new MaxMediaDownloadError()
      const declared = response.headers.get('content-length')
      if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > maxBytes)) throw new MaxMediaDownloadError()
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        for (;;) {
          const next = await reader.read()
          if (next.done) break
          const chunk = next.value
          total += chunk.byteLength
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined)
            throw new MaxMediaDownloadError()
          }
          chunks.push(chunk.slice())
        }
      } finally {
        reader.releaseLock()
      }
      if (total === 0) throw new MaxMediaDownloadError()
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return { bytes, contentType: response.headers.get('content-type'), contentLength: total }
    } catch (error) {
      if (error instanceof MaxProviderError) throw error
      throw new MaxProviderError(undefined, true)
    } finally {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortCaller)
    }
  }
}

function isAllowedMediaUrl(value: string, videoCdn: boolean) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.port === '' &&
      (videoCdn ? MAX_VIDEO_CDN_HOST.test(parsed.hostname) : MAX_MEDIA_HOSTS.has(parsed.hostname))
  } catch { return false }
}
