import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  MAX_VIDEO_BYTES,
  createIdempotencyKey,
  finalizeMaxVideo,
  reserveMaxVideo,
  validateVideoFile,
} from '../src/features/max-video-upload/api'
import { VideoComposer } from '../src/features/max-video-upload/VideoComposer'
import { uploadVideoToMax } from '../src/features/max-video-upload/xhr-upload'
import type { AuthenticatedTransport } from '../src/platform/api'

function file(name: string, size = 10, type = 'video/mp4') {
  return new File([new Uint8Array(size)], name, { type })
}

test('accepts only supported video extensions and the 250 MB cap', () => {
  expect(validateVideoFile(file('first.mp4'))).toEqual({ ok: true })
  expect(validateVideoFile(file('first.MOV', 10, ''))).toEqual({ ok: true })
  expect(validateVideoFile(file('first.avi'))).toEqual({ ok: false, code: 'unsupported_format' })
  expect(validateVideoFile(file('first.webm', MAX_VIDEO_BYTES + 1))).toEqual({ ok: false, code: 'too_large' })
})

test('redacts provider URL and token from upload errors and sends no Authorization header', async () => {
  const original = globalThis.XMLHttpRequest
  const requests: Array<{ headers: Record<string, string>; body: FormData }> = []
  class FakeXHR {
    upload = { addEventListener: (_name: string, listener: (event: ProgressEvent) => void) => { listener({ lengthComputable: true, loaded: 3, total: 10 } as ProgressEvent) } }
    status = 500
    responseText = 'provider-token-and-url'
    open() {}
    setRequestHeader(name: string, value: string) { (this.headers ??= {})[name] = value }
    send(body: FormData) { requests.push({ headers: this.headers ?? {}, body }); this.onerror?.({} as ProgressEvent) }
    abort() { this.onabort?.({} as ProgressEvent) }
    headers: Record<string, string> = {}
    onload?: () => void
    onerror?: (event: ProgressEvent) => void
    onabort?: (event: ProgressEvent) => void
    addEventListener(name: string, listener: (event: ProgressEvent) => void) { this[`on${name}` as 'onload' | 'onerror' | 'onabort'] = listener as never }
  }
  // @ts-expect-error test double for the browser API
  globalThis.XMLHttpRequest = FakeXHR
  try {
    const providerUrl = 'https://upload.max.ru/private/path?token=secret-upload-token'
    await expect(uploadVideoToMax(providerUrl, file('clip.mp4'), new AbortController().signal)).rejects.toThrow('Не удалось загрузить видео')
    await expect(uploadVideoToMax(providerUrl, file('clip.mp4'), new AbortController().signal)).rejects.not.toThrow('secret-upload-token')
    expect(requests[0]?.headers).toEqual({})
    expect(requests[0]?.body.get('data')).toBeInstanceOf(File)
  } finally {
    globalThis.XMLHttpRequest = original
  }
})

test('reserve and finalize stay on the authenticated transport boundary', async () => {
  const calls: Array<{ path: string; options?: Record<string, unknown> }> = []
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      calls.push({ path, options: options as Record<string, unknown> })
      return path.endsWith('/reserve')
        ? { state: 'reserved', sessionId: 'session-id', expiresAt: '2026-09-20T12:00:00.000Z', uploadUrl: 'https://upload.max.ru/opaque', uploadToken: 'opaque-token' }
        : { state: 'finalized', sessionId: 'session-id', memoryId: 'memory-id' }
    },
    raw: async () => new Response(),
  }
  const selected = file('clip.mp4', 12)
  await reserveMaxVideo(transport, 'family-id', { childId: 'child-id', body: 'Caption', occurredAt: '2026-09-20T12:00:00.000Z', file: selected, idempotencyKey: 'retry-key' })
  await finalizeMaxVideo(transport, 'family-id', 'session-id', 'opaque-token')
  expect(calls[0]?.options).toMatchObject({ method: 'POST', body: { childId: 'child-id', body: 'Caption', fileSize: 12, idempotencyKey: 'retry-key' } })
  expect(calls[1]?.options).toMatchObject({ method: 'POST', body: { uploadToken: 'opaque-token' } })
  expect(calls[0]?.options?.headers).toBeUndefined()
  expect(calls[1]?.options?.headers).toBeUndefined()
})

test('aborting the XHR rejects with AbortError and does not expose provider details', async () => {
  const original = globalThis.XMLHttpRequest
  class AbortableXHR {
    upload = { addEventListener: () => undefined }
    status = 0
    private listeners: Record<string, () => void> = {}
    open() {}
    send() {}
    abort() { this.listeners.abort?.() }
    addEventListener(name: string, listener: () => void) { this.listeners[name] = listener }
  }
  // @ts-expect-error test double for the browser API
  globalThis.XMLHttpRequest = AbortableXHR
  try {
    const controller = new AbortController()
    const pending = uploadVideoToMax('https://upload.max.ru/opaque?token=redacted', file('clip.mp4'), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  } finally {
    globalThis.XMLHttpRequest = original
  }
})

test('composer has no durable storage path and renders the acceptance form', () => {
  const transport: AuthenticatedTransport = {
    request: async () => ({}) as never,
    raw: async () => new Response(),
  }
  const markup = renderToStaticMarkup(createElement(VideoComposer, {
    childId: 'child-id',
    familyId: 'family-id',
    onCancel: () => undefined,
    onSuccess: () => undefined,
    transport,
  }))
  expect(markup).toContain('Загрузить видео')
  expect(markup).toContain('Добавьте подпись')
  expect(markup).not.toContain('localStorage')
  expect(markup).not.toContain('sessionStorage')
})

test('idempotency keys are opaque and fresh for retries', () => {
  const first = createIdempotencyKey()
  const second = createIdempotencyKey()
  expect(first).not.toBe(second)
  expect(first).toMatch(/^[a-z0-9-]{16,}$/i)
})
