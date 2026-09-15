import type { BackendRuntime } from '../../../runtime'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { MediaFailure } from '../../media'
import type { MaxApiPort, MaxVideoRendition } from '../application/ports'
import { MaxProviderError } from './max-api'

const allowedCdnHost = /^maxvd[0-9]+\.okcdn\.ru$/i
const maxHeight = 720
const fallbackMaxBytes = 250_000_000

export function createMaxVideoPlayback(options: { runtime: BackendRuntime; api: MaxApiPort }) {
  const maxBytes = options.runtime.env.MAX_VIDEO_MAX_BYTES ?? fallbackMaxBytes
  const familyAccess = createPrismaFamilyAccess(options.runtime.prisma)
  return {
    async content(scope: FamilyScope, referenceId: string, rangeHeader: string | undefined, method: 'GET' | 'HEAD', signal?: AbortSignal) {
      await familyAccess.requireMember(scope)
      const reference = await options.runtime.prisma.maxVideoReference.findFirst({ where: { id: referenceId, familyId: scope.familyId }, select: {
        id: true, familyId: true, attachmentPosition: true, providerAttachmentId: true,
        source: { select: { messageId: true, senderSubject: true, recipientId: true, familyId: true, memoryId: true } },
        memory: { select: { id: true, familyId: true, status: true, deletedAt: true } },
      } })
      if (!reference || reference.source.familyId !== scope.familyId || reference.source.memoryId !== reference.memory.id || reference.memory.familyId !== scope.familyId ||
        reference.memory.status !== 'published' || reference.memory.deletedAt !== null) throw new MediaFailure('not_found', 'Медиа не найдено')

      let resolved
      try {
        resolved = await options.api.getMessage(reference.source.messageId, signal)
      } catch (error) {
        if (isTerminalProviderShape(error)) throw new MediaFailure('unsupported_media', 'Медиа недоступно')
        throw error
      }
      const current = resolved.attachments[reference.attachmentPosition]
      if (resolved.attachments.length !== 1 || reference.attachmentPosition !== 0 || !current || current.kind !== 'video' || resolved.messageId !== reference.source.messageId ||
        resolved.senderId !== reference.source.senderSubject || resolved.recipientId !== String(reference.source.recipientId) ||
        current.providerAttachmentId !== reference.providerAttachmentId) throw new MediaFailure('not_found', 'Медиа не найдено')

      if (typeof options.api.getVideo !== 'function') throw new MediaFailure('unsupported_media', 'Медиа недоступно')
      let video
      try {
        video = await options.api.getVideo(current.currentToken, signal)
      } catch (error) {
        if (isTerminalProviderShape(error)) throw new MediaFailure('unsupported_media', 'Медиа недоступно')
        throw error
      }
      const rendition = selectRendition(video.renditions)
      if (!rendition) throw new MediaFailure('unsupported_media', 'Медиа недоступно')
      return fetchCdnVideo(rendition.url, rangeHeader, method, maxBytes, signal)
    },
  }
}

export function selectRendition(renditions: MaxVideoRendition[]) {
  return renditions
    .filter((item) => isAllowedCdnUrl(item.url) && isMp4Url(item.url) && item.height !== null && item.height > 0 && item.height <= maxHeight)
    .sort((a, b) => (b.height! - a.height!) || ((b.width ?? 0) - (a.width ?? 0)))[0] ?? null
}

export async function fetchCdnVideo(url: string, rangeHeader: string | undefined, method: 'GET' | 'HEAD', maxBytes: number, signal?: AbortSignal) {
  if (!isAllowedCdnUrl(url) || !isMp4Url(url)) throw new MediaFailure('unsupported_media', 'Медиа недоступно')
  const range = rangeHeader === undefined ? null : parseRangeHeader(rangeHeader)
  let response: Response
  try {
    response = await fetch(url, {
      method,
      ...(rangeHeader === undefined ? {} : { headers: { Range: rangeHeader } }),
      redirect: 'manual',
      credentials: 'omit',
      referrer: '',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new MediaFailure('storage_unavailable', 'Медиа недоступно')
  }
  if (response.status >= 300 && response.status < 400) { await cancelBody(response.body, signal); throw new MediaFailure('unsupported_media', 'Медиа недоступно') }
  if (range && response.status !== 206) {
    const total = response.status === 416 ? parseUnsatisfiedContentRange(response.headers.get('content-range')) : null
    await cancelBody(response.body, signal)
    throw new MediaFailure('range_not_satisfiable', 'Запрошенный диапазон недоступен', total === null ? undefined : { total })
  }
  if (!range && response.status !== 200) { await cancelBody(response.body, signal); throw new MediaFailure('unsupported_media', 'Медиа недоступно') }
  if ((response.headers.get('content-type') ?? '').split(';', 1)[0]!.trim().toLowerCase() !== 'video/mp4') { await cancelBody(response.body, signal); throw new MediaFailure('unsupported_media', 'Медиа недоступно') }

  const contentLength = parseLength(response.headers.get('content-length'))
  const contentRange = parseContentRange(response.headers.get('content-range'))
  const total = range ? contentRange?.total ?? null : contentLength
  if (!contentLength || contentLength > maxBytes || !total || total > maxBytes ||
    (range && (!contentRange || (range.start !== null && contentRange.start !== range.start) ||
      (range.end !== null && range.start !== null && contentRange.end > range.end) ||
      (range.start === null && range.end !== null && contentLength > range.end) || contentRange.end - contentRange.start + 1 !== contentLength))) {
    await cancelBody(response.body, signal)
    throw new MediaFailure('unsupported_media', 'Медиа недоступно')
  }
  if (method === 'HEAD') {
    await cancelBody(response.body, signal)
    return { body: null, contentType: 'video/mp4', contentLength: total, bodyLength: contentLength, range: range ? { start: contentRange!.start, end: contentRange!.end, total: contentRange!.total } : null }
  }
  if (!response.body) throw new MediaFailure('storage_unavailable', 'Медиа недоступно')
  return { body: guardBody(response.body, contentLength, signal), contentType: 'video/mp4', contentLength: total, bodyLength: contentLength, range: range ? { start: contentRange!.start, end: contentRange!.end, total: contentRange!.total } : null }
}

async function cancelBody(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason
  if (!body) return
  const cancellation = Promise.resolve()
    .then(() => body.cancel())
    .catch(() => undefined) /* provider cancellation failures stay sanitized */
  if (!signal) {
    void cancellation
    return
  }
  let abortListener: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(signal.reason)
    signal.addEventListener('abort', abortListener, { once: true })
  })
  try {
    if (signal.aborted) throw signal.reason
    await Promise.race([cancellation, aborted])
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener)
  }
  if (signal?.aborted) throw signal.reason
}

function guardBody(body: ReadableStream<Uint8Array>, expectedBytes: number, signal?: AbortSignal) {
  const reader = body.getReader()
  let total = 0
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: Awaited<ReturnType<typeof reader.read>>
      try {
        next = await reader.read()
      } catch {
        signal?.removeEventListener('abort', abort)
        controller.error(new MediaFailure('storage_unavailable', 'Медиа недоступно'))
        return
      }
      if (next.done) {
        signal?.removeEventListener('abort', abort)
        if (total !== expectedBytes) {
          controller.error(new MediaFailure('storage_unavailable', 'Медиа недоступно'))
          return
        }
        controller.close()
        return
      }
      total += next.value.byteLength
      if (total > expectedBytes) {
        await reader.cancel().catch(() => undefined)
        signal?.removeEventListener('abort', abort)
        controller.error(new MediaFailure('storage_unavailable', 'Медиа недоступно'))
        return
      }
      controller.enqueue(next.value)
    },
    async cancel(reason) {
      signal?.removeEventListener('abort', abort)
      await reader.cancel(reason).catch(() => undefined)
    },
  })
}

function parseRangeHeader(value: string) {
  if (!/^bytes=\d*-\d*$/.test(value) || value.includes(',')) throw new MediaFailure('range_not_satisfiable', 'Запрошенный диапазон недоступен')
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)!
  const start = match[1] === '' ? null : Number(match[1])
  const end = match[2] === '' ? null : Number(match[2])
  if ((start === null && end === null) || (start !== null && !Number.isSafeInteger(start)) || (end !== null && (!Number.isSafeInteger(end) || end < 0)) || (start !== null && end !== null && start > end)) {
    throw new MediaFailure('range_not_satisfiable', 'Запрошенный диапазон недоступен')
  }
  return { start, end }
}

function parseContentRange(value: string | null) {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/)
  if (!match) return null
  const start = Number(match[1]); const end = Number(match[2]); const total = Number(match[3])
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number.isSafeInteger(total) && start <= end && total > end
    ? { start, end, total } : null
}

function parseUnsatisfiedContentRange(value: string | null) {
  const match = value?.match(/^bytes \*\/(\d+)$/)
  if (!match) return null
  const total = Number(match[1])
  return Number.isSafeInteger(total) && total > 0 ? total : null
}

function parseLength(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null
  const length = Number(value)
  return Number.isSafeInteger(length) && length > 0 ? length : null
}

function isAllowedCdnUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.port && !url.username && !url.password && allowedCdnHost.test(url.hostname) } catch { return false }
}

function isMp4Url(value: string) {
  try { return new URL(value).pathname.toLowerCase().endsWith('.mp4') } catch { return false }
}

function isTerminalProviderShape(error: unknown) {
  return error instanceof MaxProviderError && !error.retryable
}
