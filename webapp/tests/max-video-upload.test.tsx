import { expect, test } from 'bun:test'
import { MAX_DIRECT_VIDEO_MAX_BYTES } from '@web-app-demo/contracts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  createIdempotencyKey,
  finalizeMaxVideo,
  reserveMaxVideo,
  validateVideoFile,
} from '../src/features/max-video-upload/api'
import { VideoComposer } from '../src/features/max-video-upload/VideoComposer'
import { reservationOccurredAt } from '../src/features/max-video-upload/date'
import { uploadVideoToMax } from '../src/features/max-video-upload/xhr-upload'
import { ApiRequestError, type AuthenticatedTransport } from '../src/platform/api'

function file(name: string, size = 10, type = 'video/mp4') {
  const selected = new File([new Uint8Array(Math.min(size, 10))], name, { type })
  Object.defineProperty(selected, 'size', { value: size })
  return selected
}

test('accepts only supported video extensions and the 250 MB cap', () => {
  expect(MAX_DIRECT_VIDEO_MAX_BYTES).toBe(250_000_000)
  for (const size of [72_300_000, 249_999_999, 250_000_000]) {
    expect(validateVideoFile(file('first.mp4', size))).toEqual({ ok: true })
  }
  for (const size of [250_000_001, 250 * 1024 * 1024]) {
    expect(validateVideoFile(file('first.mp4', size))).toEqual({ ok: false, code: 'too_large' })
  }
  expect(validateVideoFile(file('first.mp4'))).toEqual({ ok: true })
  expect(validateVideoFile(file('first.MOV', 10, ''))).toEqual({ ok: true })
  expect(validateVideoFile(file('first.mov', 10, 'video/quicktime'))).toEqual({ ok: true })
  expect(validateVideoFile(file('first.mp4', 10, 'application/octet-stream'))).toEqual({ ok: false, code: 'unsupported_format' })
  expect(validateVideoFile(file('first.avi'))).toEqual({ ok: false, code: 'unsupported_format' })
  expect(validateVideoFile(file('first.webm', MAX_DIRECT_VIDEO_MAX_BYTES + 1))).toEqual({ ok: false, code: 'too_large' })
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
    familyTimezone: 'UTC',
    onCancel: () => undefined,
    onSuccess: () => undefined,
    transport,
  }))
  expect(markup).toContain('Загрузить видео')
  expect(markup).toContain('Добавьте подпись')
  expect(markup).toContain('data-video-state="idle"')
  expect(markup).toContain('memoly-video-v2-form-card')
  expect(markup).toContain('MP4, MOV, MKV или WebM · до 250 МБ')
  expect(markup).toContain('Подпись')
  expect(markup).not.toContain('localStorage')
  expect(markup).not.toContain('sessionStorage')
})

test('interactive family today reserves at now instead of future noon UTC', async () => {
  const OriginalDate = globalThis.Date
  const fixedNowIso = '2026-09-21T08:00:00.000Z'
  const fixedNowMs = OriginalDate.parse(fixedNowIso)
  class FixedDate extends OriginalDate {
    constructor(value?: string | number) { super(value === undefined ? fixedNowIso : value) }
    static now() { return fixedNowMs }
  }
  globalThis.Date = FixedDate as unknown as DateConstructor
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const transport = interactiveTransport((path, body) => {
    requests.push({ path, body })
    return Promise.resolve({ state: 'reserved', sessionId: 'session-1', expiresAt: '2026-09-20T12:00:00.000Z', uploadUrl: 'https://upload.max.test/opaque', uploadToken: 'token-1' })
  })
  const xhrs: FakeUploadXHR[] = []
  installUploadXHR(xhrs)
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(VideoComposer, {
      childId: 'child-1', familyId: 'family-1', familyTimezone: 'UTC', onCancel: () => undefined,
      onSuccess: () => undefined, transport,
    })))
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && ['Сохранить', 'Повторить', 'Повторить попытку'].includes(textOf(node)))
    expect(date.value).toBe('2026-09-21')
    fileInput.files = [file('today.mp4', 24)]
    await act(async () => invoke(fileInput, 'onChange'))
    caption.value = 'Сегодня'
    await act(async () => invoke(caption, 'onChange'))

    await act(async () => {
      await invoke(save(), 'onClick')
      await flushInteractive()
    })

    const reserve = requests.find(({ path }) => path.endsWith('/reserve'))
    expect(reserve).toBeDefined()
    expect(reserve?.body.occurredAt).toBe(fixedNowIso)
    expect(new OriginalDate(String(reserve?.body.occurredAt)).getTime()).toBeLessThanOrEqual(fixedNowMs)
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    restoreUploadXHR()
    globalThis.Date = OriginalDate
  }
  expect(reservationOccurredAt('2026-09-22', 'UTC', new OriginalDate(fixedNowIso))).toBeNull()
})

test('interactive future date is rejected before reserve', async () => {
  const browser = installInteractiveDom()
  const requests: string[] = []
  const transport = interactiveTransport((path) => {
    requests.push(path)
    return Promise.resolve({ state: 'reserved', sessionId: 'session-1', expiresAt: '2026-09-20T12:00:00.000Z', uploadUrl: 'https://upload.max.test/opaque', uploadToken: 'token-1' })
  })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(VideoComposer, {
      childId: 'child-1', familyId: 'family-1', familyTimezone: 'UTC', onCancel: () => undefined,
      onSuccess: () => undefined, transport,
    })))
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && ['Сохранить', 'Повторить', 'Повторить попытку'].includes(textOf(node)))
    fileInput.files = [file('future-date.mp4', 24)]
    await act(async () => invoke(fileInput, 'onChange'))
    caption.value = 'Будущая дата'
    await act(async () => invoke(caption, 'onChange'))
    date.value = '2999-01-01'
    await act(async () => invoke(date, 'onChange'))

    await act(async () => {
      await invoke(save(), 'onClick')
      await flushInteractive()
    })

    expect(requests).toHaveLength(0)
    expect(textOf(browser.container)).toContain('Дата видео не может быть в будущем.')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('idempotency keys are opaque and fresh for retries', () => {
  const first = createIdempotencyKey()
  const second = createIdempotencyKey()
  expect(first).not.toBe(second)
  expect(first).toMatch(/^[a-z0-9-]{16,}$/i)
})

test('interactive processing retry reuses the uploaded session and disables the picker while saving', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  const reserve = deferred<{
    state: 'reserved'
    sessionId: string
    expiresAt: string
    uploadUrl: string
    uploadToken: string
  }>()
  let finalizeCount = 0
  const transport = interactiveTransport((path, body) => {
    requests.push({ path, body })
    if (path.endsWith('/reserve')) return reserve.promise
    finalizeCount += 1
    return Promise.resolve(finalizeCount === 1
      ? { state: 'processing', sessionId: 'session-1', retryable: true, code: 'attachment_not_ready' }
      : { state: 'finalized', sessionId: 'session-1', memoryId: 'memory-1' })
  })
  const xhrs: FakeUploadXHR[] = []
  installUploadXHR(xhrs)
  let successCount = 0
  const root = createRoot(browser.container)

  try {
    await act(async () => {
      root.render(createElement(VideoComposer, {
        childId: 'child-1', familyId: 'family-1', familyTimezone: 'UTC', onCancel: () => undefined,
        onSuccess: () => { successCount += 1 }, transport,
      }))
    })
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && ['Сохранить', 'Повторить', 'Повторить попытку'].includes(textOf(node)))
    const selected = file('retry.mp4', 24)
    fileInput.files = [selected]
    await act(async () => invoke(fileInput, 'onChange'))
    caption.value = 'Первый ролик'
    await act(async () => invoke(caption, 'onChange'))
    await act(async () => invoke(save(), 'onClick'))
    expect(fileInput.disabled).toBe(true)
    expect(requests.filter(({ path }) => path.endsWith('/reserve'))).toHaveLength(1)

    await act(async () => {
      reserve.resolve({ state: 'reserved', sessionId: 'session-1', expiresAt: '2026-09-20T12:00:00.000Z', uploadUrl: 'https://upload.max.test/opaque', uploadToken: 'token-1' })
      await flushInteractive()
    })
    expect(xhrs).toHaveLength(1)
    xhrs[0]?.complete()
    await act(async () => { await flushInteractive() })
    expect(finalizeCount).toBe(1)
    expect(fileInput.disabled).toBe(false)
    expect(textOf(browser.container)).toContain('Видео ещё обрабатывается')

    await act(async () => invoke(save(), 'onClick'))
    await act(async () => { await flushInteractive() })
    expect(finalizeCount).toBe(2)
    expect(requests.filter(({ path }) => path.endsWith('/reserve'))).toHaveLength(1)
    expect(xhrs).toHaveLength(1)
    expect(requests.filter(({ path }) => path.includes('/finalize')).map(({ body }) => body.uploadToken)).toEqual(['token-1', 'token-1'])
    expect(textOf(browser.container)).toContain('Сохранено в семейную ленту')
    expect(successCount).toBe(0)
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Перейти в ленту'), 'onClick'))
    expect(successCount).toBe(1)
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    restoreUploadXHR()
  }
})

test('interactive reserve failure keeps the selected file and form values for retry', async () => {
  const browser = installInteractiveDom()
  const requests: string[] = []
  let reserveCount = 0
  const transport = interactiveTransport((path) => {
    requests.push(path)
    if (path.endsWith('/reserve')) {
      reserveCount += 1
      if (reserveCount === 1) return Promise.reject(new Error('network unavailable'))
      return Promise.resolve({ state: 'reserved', sessionId: 'session-retry', expiresAt: '2026-09-20T12:00:00.000Z', uploadUrl: 'https://upload.max.test/retry', uploadToken: 'token-retry' })
    }
    return Promise.resolve({ state: 'finalized', sessionId: 'session-retry', memoryId: 'memory-retry' })
  })
  const xhrs: FakeUploadXHR[] = []
  installUploadXHR(xhrs)
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(VideoComposer, {
      childId: 'child-1', familyId: 'family-1', familyTimezone: 'UTC', onCancel: () => undefined,
      onSuccess: () => undefined, transport,
    })))
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && ['Сохранить', 'Повторить', 'Повторить попытку'].includes(textOf(node)))
    fileInput.files = [file('reserve-retry.mp4', 24)]
    await act(async () => invoke(fileInput, 'onChange'))
    caption.value = 'Сохранить после сети'
    await act(async () => invoke(caption, 'onChange'))
    date.value = '2026-09-19'
    await act(async () => invoke(date, 'onChange'))

    await act(async () => {
      await invoke(save(), 'onClick')
      await flushInteractive()
    })
    expect(textOf(browser.container)).toContain('Не удалось подготовить сохранение видео')
    expect(textOf(browser.container)).toContain('Код: reserve_network_error')
    const reserveError = findOne(browser.container, (node) => node.attributes['data-save-stage'] === 'reserve')
    expect(reserveError.attributes['data-save-error-code']).toBe('reserve_network_error')
    expect(caption.value).toBe('Сохранить после сети')
    expect(date.value).toBe('2026-09-19')

    await act(async () => invoke(save(), 'onClick'))
    await act(async () => { await flushInteractive() })
    expect(reserveCount).toBe(2)
    expect(xhrs).toHaveLength(1)
    xhrs[0]?.complete()
    await act(async () => { await flushInteractive() })
    expect(requests.filter((path) => path.endsWith('/finalize'))).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    restoreUploadXHR()
  }
})

test('interactive reserve HTTP errors show only the safe application code', async () => {
  const browser = installInteractiveDom()
  const transport = interactiveTransport((path) => path.endsWith('/reserve')
    ? Promise.reject(new ApiRequestError(404, 'NOT_FOUND', 'private backend details'))
    : Promise.resolve({ state: 'finalized', sessionId: 'session-1', memoryId: 'memory-1' }))
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(VideoComposer, {
      childId: 'child-1', familyId: 'family-1', familyTimezone: 'UTC', onCancel: () => undefined,
      onSuccess: () => undefined, transport,
    })))
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && ['Сохранить', 'Повторить', 'Повторить попытку'].includes(textOf(node)))
    fileInput.files = [file('reserve-not-found.mp4', 24)]
    await act(async () => invoke(fileInput, 'onChange'))
    caption.value = 'Безопасный код'
    await act(async () => invoke(caption, 'onChange'))

    await act(async () => {
      await invoke(save(), 'onClick')
      await flushInteractive()
    })

    expect(textOf(browser.container)).toContain('Код: reserve_http_404 / not_found')
    expect(textOf(browser.container)).not.toContain('private backend details')
    const reserveError = findOne(browser.container, (node) => node.attributes['data-save-stage'] === 'reserve')
    expect(reserveError.attributes['data-save-error-code']).toBe('reserve_http_404')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('provider-side XHR abort is an upload error and leaves the composer retryable', async () => {
  const browser = installInteractiveDom()
  const reserve = deferred<{
    state: 'reserved'
    sessionId: string
    expiresAt: string
    uploadUrl: string
    uploadToken: string
  }>()
  const transport = interactiveTransport((path) => path.endsWith('/reserve')
    ? reserve.promise
    : Promise.resolve({ state: 'finalized', sessionId: 'session-1', memoryId: 'memory-1' }))
  const xhrs: FakeUploadXHR[] = []
  installUploadXHR(xhrs)
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(VideoComposer, {
      childId: 'child-1', familyId: 'family-1', familyTimezone: 'UTC', onCancel: () => undefined,
      onSuccess: () => undefined, transport,
    })))
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && ['Сохранить', 'Повторить', 'Повторить попытку'].includes(textOf(node)))
    fileInput.files = [file('provider-abort.mp4', 24)]
    await act(async () => invoke(fileInput, 'onChange'))
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    caption.value = 'Повторить загрузку'
    await act(async () => invoke(caption, 'onChange'))
    await act(async () => invoke(save(), 'onClick'))
    await act(async () => {
      reserve.resolve({ state: 'reserved', sessionId: 'session-1', expiresAt: '2026-09-20T12:00:00.000Z', uploadUrl: 'https://upload.max.test/provider-abort', uploadToken: 'token-1' })
      await flushInteractive()
    })
    expect(xhrs).toHaveLength(1)
    xhrs[0]?.abort()
    await act(async () => { await flushInteractive() })
    expect(textOf(browser.container)).toContain('Не удалось загрузить видео')
    expect(save().disabled).toBe(false)
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    restoreUploadXHR()
  }
})

test('interactive expired finalize clears stale capability and retries with the selected file', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  let reserveCount = 0
  let finalizeCount = 0
  const transport = interactiveTransport((path, body) => {
    requests.push({ path, body })
    if (path.endsWith('/reserve')) {
      reserveCount += 1
      return Promise.resolve({ state: 'reserved', sessionId: `session-${reserveCount}`, expiresAt: '2026-09-20T12:00:00.000Z', uploadUrl: `https://upload.max.test/${reserveCount}`, uploadToken: `token-${reserveCount}` })
    }
    finalizeCount += 1
    return Promise.resolve(finalizeCount === 1
      ? { state: 'expired', sessionId: 'session-1', retryable: false, code: 'upload_expired' }
      : { state: 'finalized', sessionId: 'session-2', memoryId: 'memory-2' })
  })
  const xhrs: FakeUploadXHR[] = []
  installUploadXHR(xhrs)
  let successCount = 0
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(VideoComposer, {
      childId: 'child-1', familyId: 'family-1', familyTimezone: 'UTC', onCancel: () => undefined,
      onSuccess: () => { successCount += 1 }, transport,
    })))
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && ['Сохранить', 'Повторить', 'Повторить попытку'].includes(textOf(node)))
    caption.value = 'Сохранить дату'
    await act(async () => invoke(caption, 'onChange'))
    date.value = '2026-09-19'
    await act(async () => invoke(date, 'onChange'))

    const chooseAndSave = async (name?: string) => {
      if (name) {
        fileInput.files = [file(name, 24)]
        await act(async () => invoke(fileInput, 'onChange'))
      }
      await act(async () => invoke(save(), 'onClick'))
      await act(async () => { await flushInteractive() })
      xhrs.at(-1)?.complete()
      await act(async () => { await flushInteractive() })
    }
    await chooseAndSave('expired.mp4')
    expect(finalizeCount).toBe(1)
    expect(fileInput.value).toBe('')
    expect(caption.value).toBe('Сохранить дату')
    expect(date.value).toBe('2026-09-19')

    await chooseAndSave()
    expect(reserveCount).toBe(2)
    expect(xhrs).toHaveLength(2)
    expect(finalizeCount).toBe(2)
    expect(textOf(browser.container)).toContain('Сохранено в семейную ленту')
    expect(successCount).toBe(0)
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Перейти в ленту'), 'onClick'))
    expect(successCount).toBe(1)
    const reserveBodies = requests.filter(({ path }) => path.endsWith('/reserve')).map(({ body }) => body)
    expect(reserveBodies.map((body) => body.body)).toEqual(['Сохранить дату', 'Сохранить дату'])
    expect(reserveBodies.map((body) => body.occurredAt)).toEqual(['2026-09-19T12:00:00.000Z', '2026-09-19T12:00:00.000Z'])
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    restoreUploadXHR()
  }
})

type InteractiveNode = {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: InteractiveDocument
  parentNode: InteractiveNode | null
  childNodes: InteractiveNode[]
  style: Record<string, string>
  attributes: Record<string, string>
  listeners: Map<string, Set<(event: Record<string, unknown>) => void>>
  value: string
  type: string
  disabled: boolean
  files: File[]
  textContent: string
  appendChild(child: InteractiveNode): InteractiveNode
  insertBefore(child: InteractiveNode, before: InteractiveNode | null): InteractiveNode
  removeChild(child: InteractiveNode): InteractiveNode
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  addEventListener(name: string, listener: (event: Record<string, unknown>) => void): void
  removeEventListener(name: string, listener: (event: Record<string, unknown>) => void): void
  dispatchEvent(event: Record<string, unknown>): boolean
  focus(): void
}

type InteractiveDocument = {
  nodeType: number
  activeElement: InteractiveNode | null
  body: InteractiveNode
  documentElement: InteractiveNode
  createElement(name: string): InteractiveNode
  createTextNode(value: string): InteractiveNode
  addEventListener(): void
  removeEventListener(): void
}

function interactiveTransport(handler: (path: string, body: Record<string, unknown>) => unknown): AuthenticatedTransport {
  return { request: async (path, _schema, options) => handler(path, options?.body as Record<string, unknown>) as never, raw: async () => new Response() }
}

class FakeUploadXHR {
  static instances: FakeUploadXHR[] = []
  upload = { addEventListener: (name: string, listener: (event: ProgressEvent) => void) => { void name; void listener } }
  status = 200
  private listeners = new Map<string, () => void>()
  open(method: string, url: string) { void method; void url }
  send(body: FormData) { void body; FakeUploadXHR.instances.push(this) }
  abort() { this.listeners.get('abort')?.() }
  addEventListener(name: string, listener: () => void) { this.listeners.set(name, listener) }
  complete() { this.listeners.get('load')?.() }
}

function installUploadXHR(instances: FakeUploadXHR[]) {
  FakeUploadXHR.instances = instances
  // @ts-expect-error browser test double
  globalThis.XMLHttpRequest = FakeUploadXHR
}

function restoreUploadXHR() {
  delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest
}

function installInteractiveDom() {
  const priorDocument = globalThis.document
  const priorWindow = globalThis.window
  const document = createInteractiveDocument()
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} }
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true })
  return { container: document.createElement('div'), restore() { Object.assign(globalThis, { document: priorDocument, window: priorWindow }); delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT } }
}

function createInteractiveDocument(): InteractiveDocument {
  const document = {} as InteractiveDocument
  const make = (name: string): InteractiveNode => {
    const node: InteractiveNode = {
      nodeType: 1, nodeName: name.toUpperCase(), tagName: name.toUpperCase(), ownerDocument: document,
      parentNode: null, childNodes: [], style: { setProperty() {} } as unknown as Record<string, string>, attributes: {}, listeners: new Map(), value: '', type: '', disabled: false, files: [], textContent: '',
      appendChild(child) { child.parentNode = node; node.childNodes.push(child); return child },
      insertBefore(child, before) { child.parentNode = node; const index = before ? node.childNodes.indexOf(before) : -1; if (index < 0) node.childNodes.push(child); else node.childNodes.splice(index, 0, child); return child },
      removeChild(child) { const index = node.childNodes.indexOf(child); if (index >= 0) node.childNodes.splice(index, 1); child.parentNode = null; return child },
      setAttribute(name, value) { node.attributes[name] = value; if (name === 'type') node.type = value; if (name === 'disabled') node.disabled = true },
      removeAttribute(name) { delete node.attributes[name]; if (name === 'disabled') node.disabled = false },
      addEventListener(name, listener) { const entries = node.listeners.get(name) ?? new Set(); entries.add(listener); node.listeners.set(name, entries) },
      removeEventListener(name, listener) { node.listeners.get(name)?.delete(listener) },
      dispatchEvent(input) { const event = input.target ? input : { ...input, target: node, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }; event.currentTarget = node; node.listeners.get(String(event.type))?.forEach((listener) => listener(event)); if (event.bubbles && node.parentNode) node.parentNode.dispatchEvent(event); return true },
      focus() { document.activeElement = node },
    }
    return node
  }
  document.nodeType = 9
  document.createElement = (name) => make(name)
  document.createTextNode = (value) => ({ ...make('#text'), nodeType: 3, nodeName: '#text', tagName: '#text', textContent: value, nodeValue: value } as unknown as InteractiveNode)
  document.body = make('body')
  document.documentElement = make('html')
  document.addEventListener = () => undefined
  document.removeEventListener = () => undefined
  return document
}

function findOne(container: InteractiveNode, predicate: (node: InteractiveNode) => boolean) {
  const found = findAll(container, predicate)[0]
  if (!found) throw new Error('interactive node not found')
  return found
}

function findAll(node: InteractiveNode, predicate: (node: InteractiveNode) => boolean): InteractiveNode[] {
  return [predicate(node) ? node : null, ...node.childNodes.flatMap((child) => findAll(child, predicate))].filter((item): item is InteractiveNode => Boolean(item))
}

function textOf(node: InteractiveNode): string {
  return `${node.textContent}${node.childNodes.map(textOf).join('')}`
}

function invoke(node: InteractiveNode, propName: string) {
  const propsKey = Reflect.ownKeys(node).find((key) => typeof key === 'string' && key.startsWith('__reactProps$'))
  const props = propsKey ? (node[propsKey as keyof InteractiveNode] as unknown as Record<string, (event: Record<string, unknown>) => void>) : null
  const handler = props?.[propName]
  if (!handler) throw new Error(`React prop handler not found: ${propName}`)
  handler({ target: node, currentTarget: node, preventDefault() {}, stopPropagation() {} })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

async function flushInteractive() {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
