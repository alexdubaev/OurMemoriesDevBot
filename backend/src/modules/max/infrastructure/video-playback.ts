import { createHash } from 'node:crypto'
import { MAX_DIRECT_VIDEO_MAX_BYTES, type MaxVideoPosterReadiness, type MaxVideoReadiness } from '@web-app-demo/contracts'

import type { BackendRuntime } from '../../../runtime'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { MediaFailure } from '../../media'
import type { MaxApiPort, MaxVideoRendition } from '../application/ports'
import { MaxProviderError } from './max-api'
import { isAllowedMaxVideoUrl, selectMaxVideoRendition } from './video-rendition'

export function createMaxVideoPlayback(options: { runtime: BackendRuntime; api: MaxApiPort }) {
  const maxBytes = options.runtime.env.MAX_VIDEO_MAX_BYTES ?? MAX_DIRECT_VIDEO_MAX_BYTES
  const familyAccess = createPrismaFamilyAccess(options.runtime.prisma)
  const resolve = async (scope: FamilyScope, referenceId: string, signal?: AbortSignal): Promise<{ readiness: MaxVideoReadiness; url?: string; thumbnailUrl?: string | null }> => {
      await familyAccess.requireMember(scope)
      const reference = await options.runtime.prisma.maxVideoReference.findFirst({ where: { id: referenceId, familyId: scope.familyId }, select: {
        id: true, familyId: true, attachmentPosition: true, providerAttachmentId: true,
        source: { select: { messageId: true, senderSubject: true, recipientId: true, originalMessageId: true, originalChannelId: true, familyId: true, memoryId: true } },
        outboundSource: { select: { messageId: true, recipientId: true, familyId: true } },
        memory: { select: { id: true, familyId: true, status: true, deletedAt: true } },
      } })
      const source = reference?.source ?? reference?.outboundSource
      if (!reference || !source || source.familyId !== scope.familyId ||
        (reference.source && reference.source.memoryId !== reference.memory.id) || reference.memory.familyId !== scope.familyId ||
        reference.memory.status !== 'published' || reference.memory.deletedAt !== null) throw new MediaFailure('not_found', 'Медиа не найдено')

      const isForward = Boolean(reference.source?.originalMessageId && reference.source.originalChannelId !== null)
      const isEnvelopeForward = Boolean(reference.source?.originalMessageId && reference.source.originalChannelId === null)
      let expectedSenderId: string | null = null
      if (!isForward) {
        try {
          expectedSenderId = reference.source ? reference.source.senderSubject : await resolveOutboundSender(options.api, signal)
        } catch (error) {
          if (signal?.aborted) throw error
          return { readiness: { state: 'unknown', recheckable: true } }
        }
      }

      let resolved
      try {
        resolved = await options.api.getMessage(isForward ? reference.source!.originalMessageId! : source.messageId, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        return { readiness: { state: 'unknown', recheckable: true } }
      }
      const providerPosition = reference.source ? reference.attachmentPosition : 0
      const current = (isEnvelopeForward ? resolved.forwardedAttachments : resolved.attachments)?.[providerPosition]
      const expectedMessageId = isForward ? reference.source!.originalMessageId! : source.messageId
      const expectedRecipientId = isForward ? String(reference.source!.originalChannelId) : String(source.recipientId)
      if (resolved.messageId !== expectedMessageId || resolved.recipientId !== expectedRecipientId ||
          (isForward ? resolved.recipientType !== 'channel' : resolved.senderId !== expectedSenderId) ||
          (isEnvelopeForward && resolved.forwardedFrom?.messageId !== reference.source!.originalMessageId)) throw new MediaFailure('not_found', 'Медиа не найдено')
      if (!current || current.kind !== 'video' || current.providerAttachmentId !== reference.providerAttachmentId) {
        throw new MediaFailure('not_found', 'Медиа не найдено')
      }

      if (typeof options.api.getVideo !== 'function') return { readiness: { state: 'unknown', recheckable: true } }
      let video
      try {
        video = await options.api.getVideo(current.currentToken, signal)
      } catch (error) {
        if (signal?.aborted) throw error
        return { readiness: isVideoProcessing(error) ? { state: 'processing', recheckable: true } : { state: 'unknown', recheckable: true } }
      }
      const rendition = selectRendition(video.renditions, maxBytes)
      if (!rendition) return { readiness: { state: 'unknown', recheckable: true } }
      return { readiness: { state: 'ready', recheckable: false }, url: rendition.url, thumbnailUrl: video.thumbnailUrl ?? null }
  }
  return {
    async readiness(scope: FamilyScope, referenceId: string, signal?: AbortSignal) {
      return (await resolve(scope, referenceId, signal)).readiness
    },
    async posterReadiness(scope: FamilyScope, referenceId: string): Promise<MaxVideoPosterReadiness> {
      await familyAccess.requireMember(scope)
      const reference = await options.runtime.prisma.maxVideoReference.findFirst({ where: {
        id: referenceId, familyId: scope.familyId, memory: { familyId: scope.familyId, status: 'published', deletedAt: null },
      }, select: { id: true, familyId: true, thumbnailMediaId: true, thumbnailMedia: { select: {
        id: true, originalStatus: true, deletedAt: true,
        variants: { where: { variant: 'display' }, select: { objectKey: true, mime: true, byteSize: true, sha256: true } },
      } } } })
      if (!reference) throw new MediaFailure('not_found', 'Медиа не найдено')
      const display = reference.thumbnailMedia?.variants[0]
      if (reference.thumbnailMedia && reference.thumbnailMedia.deletedAt === null && reference.thumbnailMedia.originalStatus === 'stored' && display) {
        return { state: 'ready', posterPath: `/api/v1/families/${scope.familyId}/media/${reference.thumbnailMedia.id}/content?variant=display` }
      }
      const task = await options.runtime.prisma.taskOutbox.findUnique({ where: {
        type_dedupeKey: { type: 'max:video-poster', dedupeKey: `max-video-poster:${reference.id}` },
      }, select: { status: true } })
      return task?.status === 'pending' || task?.status === 'processing' ? { state: 'pending' } : { state: 'failed' }
    },
    async content(scope: FamilyScope, referenceId: string, rangeHeader: string | undefined, method: 'GET' | 'HEAD', signal?: AbortSignal) {
      const result = await resolve(scope, referenceId, signal)
      if (result.readiness.state === 'processing') throw new MediaFailure('video_processing', 'Видео обрабатывается')
      if (result.readiness.state === 'unknown') throw new MediaFailure('video_readiness_unknown', 'Готовность видео пока неизвестна')
      if (result.readiness.state === 'unavailable') throw new MediaFailure('video_unavailable', 'Медиа недоступно')
      return fetchCdnVideo(result.url!, rangeHeader, method, maxBytes, signal)
    },
    async poster(scope: FamilyScope, referenceId: string, signal?: AbortSignal) {
      void signal
      await familyAccess.requireMember(scope)
      const reference = await options.runtime.prisma.maxVideoReference.findFirst({ where: {
        id: referenceId, familyId: scope.familyId, memory: { familyId: scope.familyId, status: 'published', deletedAt: null },
      }, select: { id: true, thumbnailMedia: { select: { id: true, familyId: true, originalStatus: true, deletedAt: true,
        variants: { where: { variant: 'display' }, select: { objectKey: true, mime: true, byteSize: true, sha256: true } },
      } } } })
      const display = reference?.thumbnailMedia?.variants[0]
      if (!reference?.thumbnailMedia || reference.thumbnailMedia.familyId !== scope.familyId || reference.thumbnailMedia.deletedAt !== null ||
          reference.thumbnailMedia.originalStatus !== 'stored' || !display) return null
      const stored = await options.runtime.privateStorage.storage.readObject({ key: display.objectKey })
      if (!stored) return null
      const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer())
      return {
        body: bytes,
        contentType: display.mime as 'image/jpeg' | 'image/png' | 'image/webp',
        contentLength: bytes.byteLength,
        etag: `"${display.sha256}"`,
      }
    },
  }
}

async function resolveOutboundSender(api: MaxApiPort, signal?: AbortSignal) {
  let identity
  try {
    identity = await api.getMe(signal)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new MediaFailure('video_readiness_unknown', 'Готовность видео пока неизвестна')
  }
  if (!identity.isBot || !Number.isSafeInteger(identity.userId) || identity.userId <= 0) {
    throw new MediaFailure('unsupported_media', 'Медиа недоступно')
  }
  return String(identity.userId)
}

export function selectRendition(renditions: MaxVideoRendition[], maxBytes = MAX_DIRECT_VIDEO_MAX_BYTES) {
  return selectMaxVideoRendition(renditions, maxBytes)
}

export async function fetchCdnVideo(url: string, rangeHeader: string | undefined, method: 'GET' | 'HEAD', maxBytes: number, signal?: AbortSignal) {
  if (!isAllowedMaxVideoUrl(url)) throw new MediaFailure('unsupported_media', 'Медиа недоступно')
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
    if (response.status !== 416) throw new MediaFailure('video_readiness_unknown', 'Готовность видео пока неизвестна')
    throw new MediaFailure('range_not_satisfiable', 'Запрошенный диапазон недоступен', undefined, total === null ? undefined : { total })
  }
  if (!range && response.status !== 200) { await cancelBody(response.body, signal); throw new MediaFailure('video_readiness_unknown', 'Готовность видео пока неизвестна') }
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
  const cancellationWindow = Promise.resolve().then(() => Promise.resolve())
  try {
    if (signal.aborted) throw signal.reason
    await Promise.race([cancellation, aborted, cancellationWindow])
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

function isVideoProcessing(error: unknown) {
  return error instanceof MaxProviderError && error.code === 'attachment.not.ready' &&
    typeof error.status === 'number' && error.status >= 400 && error.status < 500
}
