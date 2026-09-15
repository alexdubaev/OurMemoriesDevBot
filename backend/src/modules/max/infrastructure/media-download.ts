import { MaxProviderError } from './max-api'

const MAX_MEDIA_HOSTS = new Set(['i.oneme.ru', 'fd.oneme.ru'])

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class MaxMediaDownloadError extends MaxProviderError {
  constructor() { super(); this.name = 'MaxMediaDownloadError' }
}

export type MaxDownloadedMedia = {
  bytes: Uint8Array
  contentType: string | null
  contentLength: number
}

export function createMaxMediaDownload(options: { fetch?: FetchLike; timeoutMs?: number } = {}) {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000
  return async (url: string, maxBytes: number, callerSignal?: AbortSignal): Promise<MaxDownloadedMedia> => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !isAllowedMediaUrl(url)) throw new MaxMediaDownloadError()
    const controller = new AbortController()
    const abortCaller = () => controller.abort()
    callerSignal?.addEventListener('abort', abortCaller, { once: true })
    if (callerSignal?.aborted) controller.abort()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: {}, signal: controller.signal })
      if (response.status === 408 || response.status === 429 || response.status >= 500) throw new MaxProviderError()
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
      throw new MaxProviderError()
    } finally {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortCaller)
    }
  }
}

function isAllowedMediaUrl(value: string) {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.port === '' && MAX_MEDIA_HOSTS.has(parsed.hostname)
  } catch { return false }
}
