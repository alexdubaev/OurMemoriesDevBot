import { expect, test } from 'bun:test'
import { act, createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import {
  composerDateOnly,
  composerOccurredAt,
  validateComposerFiles,
  validatePhotoFiles,
} from '../src/features/composer'
import { PhotoComposer } from '../src/features/composer/PhotoComposer'
import { verifyComposerFile } from '../src/features/composer/api'
import type { AuthenticatedTransport } from '../src/platform/api'
import { ApiRequestError } from '../src/platform/api'

function sizedFile(name: string, size: number, type = 'video/mp4') {
  const synthetic = file(name, 128, type)
  Object.defineProperty(synthetic, 'size', { value: size })
  return synthetic
}

function file(name: string, size = 128, type = 'image/jpeg') {
  const bytes = new Uint8Array(size)
  const signature = type === 'image/png' ? Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    : type === 'image/webp' ? new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP')])
    : type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence' ? new Uint8Array([0, 0, 0, 0, ...new TextEncoder().encode('ftypheic')])
      : type === 'video/mp4' || type === 'video/quicktime' || type === 'video/x-quicktime' ? new Uint8Array([0, 0, 0, 0, ...new TextEncoder().encode(type === 'video/mp4' ? 'ftypisom' : 'ftypqt  ')])
        : Uint8Array.of(0xff, 0xd8, 0xff)
  bytes.set(signature.slice(0, size))
  return new File([bytes], name, { type })
}

test('accepts one to ten supported photos and rejects video or an eleventh photo', () => {
  expect(validatePhotoFiles([file('one.jpg')])).toEqual({ ok: true })
  expect(validatePhotoFiles(Array.from({ length: 10 }, (_, index) => file(`${index}.png`, 128, 'image/png')))).toEqual({ ok: true })
  expect(validatePhotoFiles([file('clip.mp4', 128, 'video/mp4')])).toEqual({ ok: false, code: 'unsupported_format' })
  expect(validatePhotoFiles(Array.from({ length: 11 }, (_, index) => file(`${index}.jpg`)))).toEqual({ ok: false, code: 'too_many' })
})

function installMaxUpload() {
  const prior = globalThis.XMLHttpRequest
  let uploads = 0
  const names: string[] = []
  class FakeXHR {
    upload = { addEventListener: () => undefined }
    status = 200
    listeners: Record<string, () => void> = {}
    open() {}
    send(form: FormData) { uploads += 1; names.push((form.get('data') as File).name); queueMicrotask(() => this.listeners.load?.()) }
    abort() { this.listeners.abort?.() }
    addEventListener(name: string, listener: () => void) { this.listeners[name] = listener }
  }
  // @ts-expect-error focused browser transport double
  globalThis.XMLHttpRequest = FakeXHR
  return { count: () => uploads, names: () => names, restore: () => { globalThis.XMLHttpRequest = prior } }
}

function mixedTransport(requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }>) {
  let photoIndex = 0
  let videoIndex = 0
  const photoIds = ['00000000-0000-7000-8000-000000000031', '00000000-0000-7000-8000-000000000033']
  const videoIds = ['00000000-0000-7000-8000-000000000032', '00000000-0000-7000-8000-000000000034']
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
      if (path.endsWith('/max-video-uploads/reserve')) {
        const id = videoIds[videoIndex++]!
        return { state: 'reserved', sessionId: id, expiresAt: '2026-09-22T00:05:00.000Z', uploadUrl: 'https://max.test/opaque', uploadToken: 'opaque-token' } as never
      }
      if (path.includes('/max-video-uploads/') && path.endsWith('/finalize')) return { state: 'finalized', sessionId: path.split('/').at(-2) } as never
      if (path.endsWith('/uploads')) {
        const index = photoIndex++
        return { assetId: photoIds[index], upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: photoIds[Number(path.match(/upload-(\d+)/)?.[1] ?? 0)] } } as never
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  return transport
}

for (const names of [
  ['one.jpg', 'two.mp4'],
  ['one.jpg', 'two.mp4', 'three.jpg'],
  ['one.jpg', 'two.mp4', 'three.jpg', 'four.mp4'],
]) {
  test(`mixed ${names.join('+')} preserves order and creates one Memory`, async () => {
    const browser = installInteractiveDom()
    const max = installMaxUpload()
    const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
    const transport = mixedTransport(requests)
    const priorFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(null, { status: 200 })
    const root = createRoot(browser.container)
    try {
      await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
      const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
      input.files = names.map((name) => name.endsWith('.mp4') ? file(name, 128, 'video/mp4') : file(name))
      await act(async () => invoke(input, 'onChange'))
      await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
      const creates = requests.filter(({ path }) => path.endsWith('/memories'))
      expect(creates).toHaveLength(1)
      const expected = names.map((name, index) => name.endsWith('.mp4') ? { source: 'max', sessionId: index === 1 ? '00000000-0000-7000-8000-000000000032' : '00000000-0000-7000-8000-000000000034' } : { source: 'private_storage', mediaId: index === 0 ? '00000000-0000-7000-8000-000000000031' : '00000000-0000-7000-8000-000000000033' })
      expect(creates[0]?.body).toMatchObject({ kind: 'media', attachments: expected })
      expect(requests.filter(({ path }) => path.endsWith('/max-video-uploads/reserve')).every(({ body }) => body.mode === 'attachment')).toBe(true)
      expect(requests.filter(({ path }) => path.endsWith('/uploads'))).toHaveLength(names.filter((name) => name.endsWith('.jpg')).length)
      expect(max.count()).toBe(names.filter((name) => name.endsWith('.mp4')).length)
    } finally { await act(async () => root.unmount()); browser.restore(); max.restore(); globalThis.fetch = priorFetch }
  })
}

test('MAX reserve canonicalizes MOV/MP4 metadata and accepts signed WebM', async () => {
  const browser = installInteractiveDom()
  const max = installMaxUpload()
  const priorFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const transport = mixedTransport(requests)
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const webm = new File([Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, ...new TextEncoder().encode('webm')), new Uint8Array(128)], 'clip.webm', { type: 'application/octet-stream' })
    input.files = [file('one.jpg'), file('misnamed.mov', 128, 'video/mp4'), webm]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    const reserves = requests.filter(({ path }) => path.endsWith('/max-video-uploads/reserve')).map(({ body }) => body)
    expect(reserves).toHaveLength(2)
    expect(reserves.map((body) => [body.fileName, body.mimeType])).toEqual([['misnamed.mp4', 'video/mp4'], ['clip.webm', 'video/webm']])
    expect(max.names()).toEqual(['misnamed.mov', 'clip.webm'])
    expect(requests.filter(({ path }) => path.endsWith('/memories'))).toHaveLength(1)
    expect(max.count()).toBe(2)
  } finally { await act(async () => root.unmount()); browser.restore(); max.restore(); globalThis.fetch = priorFetch }
})

test('MAX finalize retry and lost create response keep one session, bytes, and exact create key', async () => {
  const browser = installInteractiveDom()
  const max = installMaxUpload()
  const priorFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const base = mixedTransport(requests)
  let maxFinalize = 0
  let createCount = 0
  let cancelCount = 0
  const transport: AuthenticatedTransport = {
    ...base,
    request: async (path, schema, options) => {
      if (path.includes('/max-video-uploads/') && path.endsWith('/finalize') && maxFinalize++ === 0) {
        requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
        return { state: 'processing', sessionId: '00000000-0000-7000-8000-000000000032', retryable: true } as never
      }
      if (path.endsWith('/memories') && createCount++ === 0) {
        requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
        throw new Error('response lost')
      }
      return base.request(path, schema, options)
    },
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => { cancelCount += 1 }, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg'), file('two.mp4', 128, 'video/mp4'), file('three.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    expect(requests.filter(({ path }) => path.endsWith('/memories'))).toHaveLength(0)
    const retry = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430')
    await act(async () => { invoke(retry(), 'onClick'); await flushInteractive() })
    expect(requests.filter(({ path }) => path.endsWith('/memories'))).toHaveLength(1)
    expect(textOf(browser.container)).toContain('Повторите сохранение этой же заявки')
    expect(findAll(browser.container, (node) => node.tagName === 'BUTTON' && (node.attributes['aria-label'] === 'Назад' || textOf(node).includes('\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f')))).toHaveLength(0)
    expect(cancelCount).toBe(0)
    await act(async () => { invoke(retry(), 'onClick'); await flushInteractive() })
    const creates = requests.filter(({ path }) => path.endsWith('/memories'))
    expect(creates).toHaveLength(2)
    expect(creates[1]?.body).toEqual(creates[0]?.body)
    expect(creates[1]?.headers).toEqual(creates[0]?.headers)
    expect(requests.filter(({ path }) => path.endsWith('/max-video-uploads/reserve'))).toHaveLength(1)
    expect(requests.filter(({ path }) => path.includes('/max-video-uploads/') && path.endsWith('/finalize'))).toHaveLength(2)
    expect(requests.filter(({ path }) => path.endsWith('/uploads'))).toHaveLength(2)
    expect(max.count()).toBe(1)
  } finally { await act(async () => root.unmount()); browser.restore(); max.restore(); globalThis.fetch = priorFetch }
})

test('cancel and back are disabled while a create response is unresolved', async () => {
  const browser = installInteractiveDom()
  const priorFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  let resolveCreate!: (value: { id: string }) => void
  let cancelCount = 0
  const transport: AuthenticatedTransport = {
    request: async (path) => {
      if (path.endsWith('/uploads')) return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: 'upload-1', method: 'PUT', url: 'https://storage.test/one', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      if (path.includes('/finalize')) return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never
      return new Promise<{ id: string }>((resolve) => { resolveCreate = resolve }) as never
    }, raw: async () => new Response(),
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => { cancelCount += 1 }, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    const cancel = findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c')
    const back = findOne(browser.container, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === '\u041d\u0430\u0437\u0430\u0434')
    expect(cancel.disabled).toBe(true)
    expect(back.disabled).toBe(true)
    await act(async () => { invoke(cancel, 'onClick'); invoke(back, 'onClick') })
    expect(cancelCount).toBe(0)
    await act(async () => { resolveCreate({ id: 'memory-1' }); await flushInteractive() })
  } finally { await act(async () => root.unmount()); browser.restore(); globalThis.fetch = priorFetch }
})

test('editing caption and date after video finalize reuses the MAX session and uploads', async () => {
  const browser = installInteractiveDom()
  const max = installMaxUpload()
  const priorFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const base = mixedTransport(requests)
  let photoReserves = 0
  const transport: AuthenticatedTransport = {
    ...base,
    request: async (path, schema, options) => {
      if (path.endsWith('/uploads') && photoReserves++ === 1) throw new Error('photo unavailable')
      return base.request(path, schema, options)
    },
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg'), file('two.mp4', 128, 'video/mp4'), file('three.jpg')]
    await act(async () => invoke(input, 'onChange'))
    const publish = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c'))
    await act(async () => { invoke(publish(), 'onClick'); await flushInteractive() })
    expect(requests.filter(({ path }) => path.endsWith('/memories'))).toHaveLength(0)
    const back = findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u044f\u043c')
    await act(async () => invoke(back, 'onClick'))
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    caption.value = 'Updated caption'
    await act(async () => invoke(caption, 'onChange'))
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    date.value = '2026-09-20'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => { invoke(publish(), 'onClick'); await flushInteractive() })
    expect(requests.filter(({ path }) => path.endsWith('/max-video-uploads/reserve'))).toHaveLength(1)
    expect(requests.filter(({ path }) => path.includes('/max-video-uploads/') && path.endsWith('/finalize'))).toHaveLength(1)
    expect(max.count()).toBe(1)
    expect(String(requests.filter(({ path }) => path.endsWith('/memories'))[0]?.body.occurredAt)).toBe('2026-09-20T12:00:00.000Z')
    expect(requests.filter(({ path }) => path.endsWith('/memories'))[0]?.body).toMatchObject({ body: 'Updated caption' })
    expect(requests.filter(({ path }) => path.endsWith('/max-video-uploads/reserve'))[0]?.body.body).toBe('')
  } finally { await act(async () => root.unmount()); browser.restore(); max.restore(); globalThis.fetch = priorFetch }
})

test('definitive create 422 unlocks editing while reusing finalized attachments', async () => {
  const browser = installInteractiveDom()
  const max = installMaxUpload()
  const priorFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const base = mixedTransport(requests)
  let creates = 0
  const transport: AuthenticatedTransport = {
    ...base,
    request: async (path, schema, options) => {
      if (path.endsWith('/memories') && creates++ === 0) {
        requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
        throw new ApiRequestError(422, 'VALIDATION_ERROR', 'invalid')
      }
      return base.request(path, schema, options)
    },
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg'), file('two.mp4', 128, 'video/mp4')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u044f\u043c'), 'onClick'))
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    expect(caption.disabled).toBe(false)
    caption.value = 'Corrected'
    await act(async () => invoke(caption, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    const posted = requests.filter(({ path }) => path.endsWith('/memories'))
    expect(posted).toHaveLength(2)
    expect(posted[1]?.body.body).toBe('Corrected')
    expect(posted[1]?.headers).not.toEqual(posted[0]?.headers)
    expect(max.count()).toBe(1)
    expect(requests.filter(({ path }) => path.endsWith('/max-video-uploads/reserve'))).toHaveLength(1)
  } finally { await act(async () => root.unmount()); browser.restore(); max.restore(); globalThis.fetch = priorFetch }
})

test('oversize video error reports actual decimal File.size', async () => {
  const browser = installInteractiveDom()
  const transport: AuthenticatedTransport = { request: async () => ({}) as never, raw: async () => new Response() }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [sizedFile('clip.mov', 262_144_000, 'video/quicktime')]
    await act(async () => invoke(input, 'onChange'))
    expect(textOf(browser.container)).toContain('262,1')
    expect(textOf(browser.container)).toContain('250')
    expect(textOf(browser.container).replace(/\s/g, '')).toContain('262144000байт')
    input.files = [sizedFile('edge.mov', 250_000_001, 'video/quicktime')]
    await act(async () => invoke(input, 'onChange'))
    expect(textOf(browser.container).replace(/\s/g, '')).toContain('250000001байт')
  } finally { await act(async () => root.unmount()); browser.restore() }
})

test('mixed selection accepts one to ten photo/video items and rejects eleven or unsupported video', () => {
  expect(validateComposerFiles([file('one.jpg')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('one.jpg'), file('clip.mov', 128, 'video/quicktime')])).toEqual({ ok: true })
  expect(validateComposerFiles(Array.from({ length: 10 }, (_, index) => index % 2 ? file(`${index}.mp4`, 128, 'video/mp4') : file(`${index}.jpg`)))).toEqual({ ok: true })
  expect(validateComposerFiles(Array.from({ length: 11 }, (_, index) => file(`${index}.jpg`))).code).toBe('too_many')
  expect(validateComposerFiles([sizedFile('large.mp4', 250_000_001)]).ok).toBe(false)
  expect(validateComposerFiles([file('unsupported.webm', 128, 'video/webm')]).ok).toBe(true)
  expect(validateComposerFiles([file('wrong.mp4', 128, 'image/jpeg')]).ok).toBe(false)
  expect(validateComposerFiles([file('wrong.jpg', 128, 'video/mp4')]).ok).toBe(false)
  expect(validateComposerFiles([new File([new Uint8Array(128)], 'extension-only.mp4')])).toEqual({ ok: true })
  expect(validatePhotoFiles([file('wrong.jpg', 128, 'image/png')])).toEqual({ ok: false, code: 'unsupported_format' })
  expect(validatePhotoFiles([file('alias.heic', 128, 'image/heif')])).toEqual({ ok: true })
  expect(validatePhotoFiles([file('alias.heif', 128, 'image/heic')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('alias.heic', 128, 'image/heif')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('wrong.jpg', 128, 'image/heif')]).ok).toBe(false)
  expect(validateComposerFiles([file('large.jpg', 20_000_001, 'image/jpeg')])).toEqual({ ok: false, code: 'too_large_photo' })
  expect(validateComposerFiles([file('small.jpg', 63, 'image/jpeg')])).toEqual({ ok: false, code: 'too_small' })
  expect(validateComposerFiles([file('transcoded.heic', 128, 'image/jpeg')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('camera.heif', 128, 'application/octet-stream')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('camera.mov', 128, 'video/x-quicktime')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('burst.heic', 128, 'image/heic-sequence')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('camera.mov', 128, 'video/mov')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('transcoded.mov', 128, 'video/mp4')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('quicktime.mp4', 128, 'video/quicktime')])).toEqual({ ok: true })
})

test('ambiguous iPhone files use actual supported signatures, not extension alone', async () => {
  const jpeg = new File([Uint8Array.of(0xff, 0xd8, 0xff, ...Array(61).fill(0))], 'IMG_1.heic', { type: 'image/jpeg' })
  const heic = new File([new Uint8Array([0, 0, 0, 0, ...new TextEncoder().encode('ftypheic'), ...Array(52).fill(0)])], 'IMG_2.heif', { type: 'application/octet-stream' })
  const fake = new File([new TextEncoder().encode('<svg><script></script></svg>'.padEnd(64))], 'IMG_3.heic')
  expect(await verifyComposerFile(jpeg)).toEqual({ kind: 'photo', contentType: 'image/jpeg' })
  expect(await verifyComposerFile(heic)).toEqual({ kind: 'photo', contentType: 'image/heic' })
  expect(await verifyComposerFile(fake)).toBeNull()
  expect(await verifyComposerFile(new File([Uint8Array.of(0xff, 0xd8, 0xff, ...Array(61).fill(0))], 'IMG_4'))).toEqual({ kind: 'photo', contentType: 'image/jpeg' })
  const mismatchedVideo = new File([new Uint8Array([0, 0, 0, 0, ...new TextEncoder().encode('ftypqt  '), ...Array(52).fill(0)])], 'misdeclared.mov', { type: 'video/mp4' })
  expect(await verifyComposerFile(mismatchedVideo)).toEqual({ kind: 'video', contentType: 'video/quicktime' })
})

test('WebM and Matroska require a valid EBML DocType and canonical MIME', async () => {
  const ebml = (docType: string, name: string, type: string) => {
    const value = new TextEncoder().encode(docType)
    return new File([Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x80 | (3 + value.length), 0x42, 0x82, 0x80 | value.length, ...value), new Uint8Array(128)], name, { type })
  }
  const webm = ebml('webm', 'clip.webm', 'application/octet-stream')
  const mkv = ebml('matroska', 'clip.mkv', 'video/x-matroska')
  expect(validateComposerFiles([webm, mkv])).toEqual({ ok: true })
  expect(await verifyComposerFile(webm)).toEqual({ kind: 'video', contentType: 'video/webm' })
  expect(await verifyComposerFile(mkv)).toEqual({ kind: 'video', contentType: 'video/x-matroska' })
  expect(await verifyComposerFile(ebml('unknown', 'bad.webm', 'video/webm'))).toBeNull()
  expect(await verifyComposerFile(new File([new Uint8Array(128)], 'bad.mkv', { type: 'video/x-matroska' }))).toBeNull()
  expect(await verifyComposerFile(new File([Uint8Array.of(0, 0, 0, 0, ...new TextEncoder().encode('ftypzzzz')), new Uint8Array(128)], 'bad.mp4', { type: 'video/mp4' }))).toBeNull()
  const mislabeled = file('video.mov', 128, 'video/mp4')
  expect(await verifyComposerFile(mislabeled)).toEqual({ kind: 'video', contentType: 'video/mp4' })
})

test('preflights every selected signature before reserving any item', async () => {
  const browser = installInteractiveDom()
  let reserves = 0
  let creates = 0
  const transport: AuthenticatedTransport = { request: async (path) => { if (path.endsWith('/uploads')) reserves += 1; if (path.endsWith('/memories')) creates += 1; return {} as never }, raw: async () => new Response() }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('good.jpg'), new File([new TextEncoder().encode('<svg>unsafe</svg>'.padEnd(128))], 'bad.jpg', { type: 'image/jpeg' })]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    expect([reserves, creates]).toEqual([0, 0])
    expect(textOf(browser.container)).toContain('Файл не соответствует поддерживаемому формату')
  } finally { await act(async () => root.unmount()); browser.restore() }
})

test('extensionless generic iPhone JPEG publishes with detected MIME', async () => {
  const browser = installInteractiveDom()
  let reservedType: unknown
  let createdKind: unknown
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) { reservedType = (options?.body as Record<string, unknown>).contentType; return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/photo', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never }
      if (path.includes('/finalize')) return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never
      createdKind = (options?.body as Record<string, unknown>).kind
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [new File([Uint8Array.of(0xff, 0xd8, 0xff, ...Array(125).fill(0))], 'IMG_2026')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    expect([reservedType, createdKind]).toEqual(['image/jpeg', 'photo'])
  } finally { await act(async () => root.unmount()); browser.restore(); globalThis.fetch = originalFetch }
})

test('transient 502 PUT retries the same signed URL before finalize and creates once', async () => {
  const browser = installInteractiveDom()
  let reserves = 0
  let puts = 0
  let finalizes = 0
  let creates = 0
  const transport: AuthenticatedTransport = {
    request: async (path) => {
      if (path.endsWith('/uploads')) {
        reserves += 1
        return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/same-url', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) { finalizes += 1; return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never }
      creates += 1
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    expect(String(url)).toBe('https://storage.test/same-url')
    puts += 1
    return new Response(null, { status: puts === 1 ? 502 : 412 })
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    expect([reserves, puts, finalizes, creates]).toEqual([1, 2, 1, 1])
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('lost MAX upload response finalizes the same session without resending bytes', async () => {
  const browser = installInteractiveDom()
  const priorXHR = globalThis.XMLHttpRequest
  const priorFetch = globalThis.fetch
  let uploads = 0
  class FailOnceXHR {
    upload = { addEventListener: () => undefined }
    status = 200
    listeners: Record<string, () => void> = {}
    open() {}
    send() { uploads += 1; queueMicrotask(() => { if (uploads === 1) this.listeners.error?.(); else this.listeners.load?.() }) }
    abort() { this.listeners.abort?.() }
    addEventListener(name: string, listener: () => void) { this.listeners[name] = listener }
  }
  // @ts-expect-error focused browser transport double
  globalThis.XMLHttpRequest = FailOnceXHR
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const transport = mixedTransport(requests)
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg'), file('two.mp4', 128, 'video/mp4')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    expect(requests.filter(({ path }) => path.endsWith('/memories'))).toHaveLength(0)
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430'), 'onClick'); await flushInteractive() })
    expect(requests.filter(({ path }) => path.endsWith('/memories'))).toHaveLength(1)
    expect(requests.filter(({ path }) => path.endsWith('/uploads'))).toHaveLength(1)
    expect(requests.filter(({ path }) => path.endsWith('/max-video-uploads/reserve'))).toHaveLength(1)
    expect(requests.filter(({ path }) => path.includes('/max-video-uploads/') && path.endsWith('/finalize'))).toHaveLength(1)
    expect(uploads).toBe(1)
  } finally { await act(async () => root.unmount()); browser.restore(); globalThis.XMLHttpRequest = priorXHR; globalThis.fetch = priorFetch }
})

test('ambiguous MAX upload stays blocked after processing then expiry until explicit reselection', async () => {
  const browser = installInteractiveDom()
  const priorXHR = globalThis.XMLHttpRequest
  let uploads = 0
  class LostResponseXHR {
    upload = { addEventListener: () => undefined }
    status = 200
    listeners: Record<string, () => void> = {}
    open() {}
    send() { uploads += 1; queueMicrotask(() => this.listeners.error?.()) }
    abort() { this.listeners.abort?.() }
    addEventListener(name: string, listener: () => void) { this.listeners[name] = listener }
  }
  // @ts-expect-error focused browser transport double
  globalThis.XMLHttpRequest = LostResponseXHR
  let reserves = 0
  let finalizes = 0
  let creates = 0
  const transport: AuthenticatedTransport = {
    request: async (path) => {
      if (path.endsWith('/max-video-uploads/reserve')) {
        reserves += 1
        return { state: 'reserved', sessionId: '00000000-0000-7000-8000-000000000032', expiresAt: '2026-09-22T00:05:00.000Z', uploadUrl: 'https://max.test/opaque', uploadToken: 'opaque-token' } as never
      }
      if (path.includes('/max-video-uploads/') && path.endsWith('/finalize')) {
        finalizes += 1
        return finalizes === 1
          ? { state: 'processing', sessionId: '00000000-0000-7000-8000-000000000032', retryable: true, code: 'attachment_not_ready' } as never
          : { state: 'expired', sessionId: '00000000-0000-7000-8000-000000000032', retryable: false, code: 'upload_expired' } as never
      }
      if (path.endsWith('/memories')) creates += 1
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('clip.mp4', 128, 'video/mp4')]
    await act(async () => invoke(input, 'onChange'))
    const publish = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c'))
    const retry = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430')
    await act(async () => { invoke(publish(), 'onClick'); await flushInteractive() })
    await act(async () => { invoke(retry(), 'onClick'); await flushInteractive() })
    expect([reserves, uploads, finalizes, creates]).toEqual([1, 1, 1, 0])
    await act(async () => { invoke(retry(), 'onClick'); await flushInteractive() })
    expect([reserves, uploads, finalizes, creates]).toEqual([1, 1, 2, 0])
    expect(textOf(browser.container)).toContain('\u0423\u0434\u0430\u043b\u0438\u0442\u0435 \u044d\u0442\u043e \u0432\u0438\u0434\u0435\u043e')
    expect(findAll(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430')).toHaveLength(0)
    const back = findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u043a \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u044f\u043c')
    await act(async () => invoke(back, 'onClick'))
    expect(publish().disabled).toBe(true)
    expect([reserves, uploads, finalizes, creates]).toEqual([1, 1, 2, 0])
    const remove = findOne(browser.container, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === '\u0423\u0434\u0430\u043b\u0438\u0442\u044c clip.mp4')
    await act(async () => invoke(remove, 'onClick'))
    expect([reserves, uploads, finalizes, creates]).toEqual([1, 1, 2, 0])
    const picker = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    expect(picker.disabled).toBe(false)
    picker.files = [file('clip.mp4', 128, 'video/mp4')]
    await act(async () => invoke(picker, 'onChange'))
    await act(async () => { invoke(publish(), 'onClick'); await flushInteractive() })
    expect([reserves, uploads]).toEqual([2, 2])
  } finally { await act(async () => root.unmount()); browser.restore(); globalThis.XMLHttpRequest = priorXHR }
})

test('successful MAX transfer processing then expiry never silently reuploads', async () => {
  const browser = installInteractiveDom()
  const max = installMaxUpload()
  let reserves = 0
  let finalizes = 0
  let creates = 0
  const transport: AuthenticatedTransport = {
    request: async (path) => {
      if (path.endsWith('/max-video-uploads/reserve')) {
        reserves += 1
        return { state: 'reserved', sessionId: '00000000-0000-7000-8000-000000000032', expiresAt: '2026-09-22T00:05:00.000Z', uploadUrl: 'https://max.test/opaque', uploadToken: 'opaque-token' } as never
      }
      if (path.includes('/max-video-uploads/') && path.endsWith('/finalize')) {
        finalizes += 1
        return finalizes === 1
          ? { state: 'processing', sessionId: '00000000-0000-7000-8000-000000000032', retryable: true, code: 'attachment_not_ready' } as never
          : { state: 'expired', sessionId: '00000000-0000-7000-8000-000000000032', retryable: false, code: 'upload_expired' } as never
      }
      if (path.endsWith('/memories')) creates += 1
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('clip.mp4', 128, 'video/mp4')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c')), 'onClick'); await flushInteractive() })
    const retry = findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430')
    await act(async () => { invoke(retry, 'onClick'); await flushInteractive() })
    expect([reserves, max.count(), finalizes, creates]).toEqual([1, 1, 2, 0])
    expect(textOf(browser.container)).toContain('\u0423\u0434\u0430\u043b\u0438\u0442\u0435 \u044d\u0442\u043e \u0432\u0438\u0434\u0435\u043e')
    expect(findAll(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === '\u041f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430')).toHaveLength(0)
  } finally { await act(async () => root.unmount()); browser.restore(); max.restore() }
})

test('duplicate finalized asset IDs block the single Memory request', async () => {
  const browser = installInteractiveDom()
  let createCount = 0
  const duplicate = '00000000-0000-7000-8000-000000000021'
  const transport: AuthenticatedTransport = {
    request: async (path) => {
      if (path.endsWith('/uploads')) {
        const index = Math.random().toString(36).slice(2)
        return { assetId: duplicate, upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: duplicate } } as never
      if (path.endsWith('/memories')) createCount += 1
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg'), file('two.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    expect(createCount).toBe(0)
    expect(textOf(browser.container)).toContain('Не удалось подтвердить фотографию')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('keeps the StrictMode rehearsal photo preview URL live', async () => {
  const browser = installInteractiveDom()
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  let nextUrl = 0
  const revoked: string[] = []
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => `blob:photo-preview-${++nextUrl}` })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: (url: string) => { revoked.push(url) } })
  const transport: AuthenticatedTransport = { request: async () => ({}) as never, raw: async () => new Response() }
  const root = createRoot(browser.container)
  let didUnmount = false

  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(PhotoComposer, {
      childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport,
      onCancel: () => undefined, onSuccess: () => undefined,
    }))))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('strict-mode-preview.jpg')]
    await act(async () => invoke(input, 'onChange'))

    const image = findOne(browser.container, (node) => node.tagName === 'IMG' && node.attributes.alt?.startsWith('Выбранное фото'))
    const liveSrc = image.attributes.src
    expect(liveSrc).toBeDefined()
    expect(revoked).not.toContain(liveSrc)
    await act(async () => root.unmount())
    didUnmount = true
    expect(revoked).toContain(liveSrc)
  } finally {
    if (!didUnmount) await act(async () => root.unmount())
    browser.restore()
    if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
})

test('uses family today for the default date and sends today as now, not future noon UTC', () => {
  const now = new Date('2026-09-20T21:30:00.000Z')
  expect(composerOccurredAt('2026-09-21', 'Europe/Moscow', now)).toBe(now.toISOString())
  const moscowPast = composerOccurredAt('2026-09-20', 'Europe/Moscow', now)
  expect(moscowPast).toBe('2026-09-20T09:00:00.000Z')
  expect(composerDateOnly(moscowPast!, 'Europe/Moscow')).toBe('2026-09-20')
  const pacificPast = composerOccurredAt('2026-09-20', 'Pacific/Kiritimati', new Date('2026-09-21T00:00:00.000Z'))
  expect(composerDateOnly(pacificPast!, 'Pacific/Kiritimati')).toBe('2026-09-20')
  expect(composerOccurredAt('2026-09-22', 'Europe/Moscow', now)).toBeNull()
})

test('finalizes every selected photo before creating exactly one idempotent memory', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const uploaded: string[] = []
  let successCount = 0
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
      if (path.endsWith('/uploads')) {
        const assetId = `00000000-0000-7000-8000-00000000000${uploaded.length + 1}`
        uploaded.push(assetId)
        return { assetId, upload: { uploadId: `upload-${uploaded.length}`, method: 'PUT', url: `https://storage.test/${assetId}`, headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: path.includes('upload-1') ? '00000000-0000-7000-8000-000000000001' : '00000000-0000-7000-8000-000000000002' } } as never
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(PhotoComposer, {
      childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport,
      onCancel: () => undefined, onSuccess: () => { successCount += 1 },
    })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать'))
    input.files = [file('one.jpg'), file('two.jpg')]
    await act(async () => invoke(input, 'onChange'))
    caption.value = 'На море'
    await act(async () => invoke(caption, 'onChange'))
    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })

    expect(requests.filter(({ path }) => path.endsWith('/uploads'))).toHaveLength(2)
    expect(requests.filter(({ path }) => path.endsWith('/uploads')).every(({ headers }) => Boolean((headers as Record<string, string>)?.['Idempotency-Key']))).toBe(true)
    expect(requests.filter(({ path }) => path.includes('/finalize'))).toHaveLength(2)
    const memoryRequests = requests.filter(({ path }) => path.endsWith('/memories'))
    expect(memoryRequests).toHaveLength(1)
    expect(memoryRequests[0]?.body).toMatchObject({ kind: 'photo', childId: '00000000-0000-7000-8000-000000000001', body: 'На море', mediaIds: ['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002'] })
    expect(memoryRequests[0]?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) })
    expect(successCount).toBe(0)
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Смотреть в ленте'), 'onClick'))
    expect(successCount).toBe(1)
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('recoverable reserve failure keeps selected files, caption, and date for retry', async () => {
  const browser = installInteractiveDom()
  let reserveCount = 0
  const reserveKeys: string[] = []
  let publishedBody: Record<string, unknown> | null = null
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) {
        reserveCount += 1
        const reserveKey = (options?.headers as Record<string, string>)?.['Idempotency-Key']
        expect(typeof reserveKey).toBe('string')
        reserveKeys.push(reserveKey!)
        if (reserveCount === 1) throw new Error('offline')
        return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/asset-1', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never
      if (path.endsWith('/memories')) publishedBody = options?.body as Record<string, unknown>
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(PhotoComposer, {
      childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport,
      onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать'))
    input.files = [file('retry.jpg')]
    await act(async () => invoke(input, 'onChange'))
    caption.value = 'Сохрани дату'
    await act(async () => invoke(caption, 'onChange'))
    date.value = '2026-09-20'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })

    expect(textOf(browser.container)).toContain('Не удалось подготовить сохранение')
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Вернуться к фото'), 'onClick'))
    expect(findOne(browser.container, (node) => node.attributes['aria-label'] === 'Предпросмотр фотографий')).toBeDefined()

    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })
    expect(reserveCount).toBe(2)
    expect(reserveKeys[1]).toBe(reserveKeys[0])
    expect(publishedBody).toMatchObject({ body: 'Сохрани дату', kind: 'photo' })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('shows the safe photo-finalize code without storage details', async () => {
  const browser = installInteractiveDom()
  const transport: AuthenticatedTransport = {
    request: async (path) => {
      if (path.endsWith('/uploads')) {
        return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/private-object', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) throw new ApiRequestError(415, 'PHOTO_FINALIZE_MEDIA_VERIFICATION_FAILED', 'Файл не соответствует заявленному формату')
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(PhotoComposer, {
      childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport,
      onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать'))
    input.files = [file('failed.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })

    expect(textOf(browser.container)).toContain('Не удалось подтвердить фотографию')
    expect(textOf(browser.container)).toContain('Код: photo_finalize_media_verification_failed')
    expect(textOf(browser.container)).not.toContain('storage.test')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('manual retry starts a fresh reservation after a missing object', async () => {
  const browser = installInteractiveDom()
  let reserves = 0
  let finalizes = 0
  let successCount = 0
  const transport: AuthenticatedTransport = {
    request: async (path) => {
      if (path.endsWith('/uploads')) {
        reserves += 1
        return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/private-object', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) {
        finalizes += 1
        if (finalizes === 1) throw new ApiRequestError(409, 'PHOTO_FINALIZE_OBJECT_MISSING', 'Файл не найден в хранилище')
        return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never
      }
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(PhotoComposer, {
      childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport,
      onCancel: () => undefined, onSuccess: () => { successCount += 1 },
    })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать'))
    input.files = [file('retry-after-missing.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })

    expect(reserves).toBe(1)
    expect(finalizes).toBe(1)
    expect(successCount).toBe(0)
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Попробовать снова'), 'onClick'); await flushInteractive() })

    expect(reserves).toBe(2)
    expect(finalizes).toBe(2)
    expect(successCount).toBe(0)
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Смотреть в ленте'), 'onClick'))
    expect(successCount).toBe(1)
    expect(textOf(browser.container)).toContain('Фото опубликованы!')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('storage-unavailable reserve retry rotates only the released file reservation', async () => {
  const browser = installInteractiveDom()
  const ids = ['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002']
  const reserveKeys: string[] = []
  const puts: string[] = []
  const finalizes: string[] = []
  const creates: Array<Record<string, unknown>> = []
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) {
        const key = (options?.headers as Record<string, string>)['Idempotency-Key']!
        reserveKeys.push(key)
        if (reserveKeys.length === 2) throw new ApiRequestError(503, 'STORAGE_UNAVAILABLE', 'storage unavailable')
        if (reserveKeys.length === 3 && key === reserveKeys[1]) throw new ApiRequestError(409, 'IDEMPOTENCY_CONFLICT', 'released reservation')
        const index = reserveKeys.length === 1 ? 0 : 1
        return { assetId: ids[index], upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) { finalizes.push(path); return { asset: { id: ids[finalizes.length - 1] } } as never }
      creates.push(options?.body as Record<string, unknown>)
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => { puts.push(String(url)); return new Response(null, { status: 200 }) }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('ready.jpg'), file('retry.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    expect(creates).toHaveLength(0)
    expect(textOf(browser.container)).toContain('Хранилище временно недоступно')
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Попробовать снова'), 'onClick'); await flushInteractive() })
    expect(reserveKeys).toHaveLength(3)
    expect(reserveKeys[2]).not.toBe(reserveKeys[1])
    expect(puts).toEqual(['https://storage.test/0', 'https://storage.test/1'])
    expect(finalizes).toHaveLength(2)
    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({ kind: 'photo', mediaIds: ids })
  } finally { await act(async () => root.unmount()); browser.restore(); globalThis.fetch = originalFetch }
})

for (const count of [6, 10]) {
  test(`publishes ${count} ordered JPEG photos as one Memory after every upload finalizes`, async () => {
    const browser = installInteractiveDom()
    const assetIds = Array.from({ length: count }, (_, index) => `00000000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`)
    const reserveBodies: Array<Record<string, unknown>> = []
    const putUrls: string[] = []
    const finalizes: string[] = []
    const creates: Array<Record<string, unknown>> = []
    const transport: AuthenticatedTransport = {
      request: async (path, _schema, options) => {
        if (path.endsWith('/uploads')) {
          reserveBodies.push(options?.body as Record<string, unknown>)
          const index = reserveBodies.length - 1
          return { assetId: assetIds[index], upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
        }
        if (path.includes('/finalize')) {
          finalizes.push(path)
          return { asset: { id: assetIds[finalizes.length - 1] } } as never
        }
        creates.push(options?.body as Record<string, unknown>)
        return { id: 'memory-1' } as never
      }, raw: async () => new Response(),
    }
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => { putUrls.push(String(url)); return new Response(null, { status: 200 }) }
    const root = createRoot(browser.container)
    try {
      await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
      const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
      input.files = Array.from({ length: count }, (_, index) => file(`photo-${index}.jpg`))
      await act(async () => invoke(input, 'onChange'))
      await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
      expect(reserveBodies).toHaveLength(count)
      expect(reserveBodies.every((body) => body.kind === 'photo' && body.contentType === 'image/jpeg')).toBe(true)
      expect(putUrls).toEqual(Array.from({ length: count }, (_, index) => `https://storage.test/${index}`))
      expect(finalizes).toHaveLength(count)
      expect(creates).toHaveLength(1)
      expect(creates[0]).toMatchObject({ kind: 'photo', mediaIds: assetIds })
    } finally { await act(async () => root.unmount()); browser.restore(); globalThis.fetch = originalFetch }
  })
}

test('synthetic 72.3 MB QuickTime MOV and generic MIME are accepted by signature', async () => {
  const mov = sizedFile('clip.mov', 72_300_000, 'video/quicktime')
  expect(validateComposerFiles([mov])).toEqual({ ok: true })
  expect(await verifyComposerFile(mov)).toEqual({ kind: 'video', contentType: 'video/quicktime' })
  const generic = new File([new Uint8Array([0, 0, 0, 0, ...new TextEncoder().encode('ftypqt  '), ...Array(116).fill(0)])], 'clip.mov', { type: 'application/octet-stream' })
  expect(await verifyComposerFile(generic)).toEqual({ kind: 'video', contentType: 'video/quicktime' })
  expect(validateComposerFiles([sizedFile('edge.mp4', 250_000_000)])).toEqual({ ok: true })
  expect(validateComposerFiles([sizedFile('over.mp4', 250_000_001)])).toEqual({ ok: false, code: 'too_large_video' })
  expect(validateComposerFiles([sizedFile('binary.mp4', 262_144_000)])).toEqual({ ok: false, code: 'too_large_video' })
  expect(await verifyComposerFile(new File([new Uint8Array(128)], 'bad.mov', { type: 'video/quicktime' }))).toBeNull()
})

test('expired reservation rotates only its file key and retains the Memory key', async () => {
  const browser = installInteractiveDom()
  const reserveKeys: string[] = []
  const memoryKeys: string[] = []
  let finalizes = 0
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) {
        reserveKeys.push((options?.headers as Record<string, string>)['Idempotency-Key']!)
        return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/same', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) {
        finalizes += 1
        if (finalizes === 1) throw new ApiRequestError(410, 'UPLOAD_EXPIRED', 'Срок загрузки истёк')
        return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never
      }
      memoryKeys.push((options?.headers as Record<string, string>)['Idempotency-Key']!)
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('one.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Попробовать снова'), 'onClick'); await flushInteractive() })
    expect(reserveKeys).toHaveLength(2)
    expect(reserveKeys[1]).not.toBe(reserveKeys[0])
    expect(memoryKeys).toHaveLength(1)
  } finally { await act(async () => root.unmount()); browser.restore(); globalThis.fetch = originalFetch }
})

test('create retry reuses finalized photo and the exact idempotent payload', async () => {
  const browser = installInteractiveDom()
  let uploads = 0
  const creates: Array<{ body: Record<string, unknown>; headers?: HeadersInit }> = []
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) {
        uploads += 1
        return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/private-object', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never
      creates.push({ body: options?.body as Record<string, unknown>, headers: options?.headers })
      if (creates.length === 1) throw new Error('response lost')
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 200 })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(PhotoComposer, {
      childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport,
      onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('retry-create.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    expect(textOf(browser.container)).toContain('Не удалось загрузить фото')
    await act(async () => { invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Попробовать снова'), 'onClick'); await flushInteractive() })
    expect(uploads).toBe(1)
    expect(creates).toHaveLength(2)
    expect(creates[1]).toEqual(creates[0])
    expect(textOf(browser.container)).toContain('Фото опубликованы!')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('asks for confirmation before cancelling a dirty draft', async () => {
  const browser = installInteractiveDom()
  let cancelCount = 0
  let confirmResult = false
  ;(globalThis.window as unknown as { confirm: () => boolean }).confirm = () => confirmResult
  const transport: AuthenticatedTransport = { request: async () => ({}) as never, raw: async () => new Response() }
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(PhotoComposer, {
      childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport,
      onCancel: () => { cancelCount += 1 }, onSuccess: () => undefined,
    })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    const cancel = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === 'Назад')
    input.files = [file('dirty.jpg')]
    await act(async () => invoke(input, 'onChange'))
    caption.value = 'Не потеряй меня'
    await act(async () => invoke(caption, 'onChange'))

    await act(async () => invoke(cancel(), 'onClick'))
    expect(cancelCount).toBe(0)
    expect(caption.value).toBe('Не потеряй меня')

    confirmResult = true
    await act(async () => invoke(cancel(), 'onClick'))
    expect(cancelCount).toBe(1)
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

type InteractiveNode = {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: InteractiveDocument
  parentNode: InteractiveNode | null
  childNodes: InteractiveNode[]
  style: Record<string, string> & { setProperty(name: string, value: string): void }
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
      parentNode: null, childNodes: [], style: { setProperty(name, value) { node.style[name] = value } }, attributes: {}, listeners: new Map(), value: '', type: '', disabled: false, files: [], textContent: '',
      appendChild(child) { child.parentNode = node; node.childNodes.push(child); return child },
      insertBefore(child, before) { child.parentNode = node; const index = before ? node.childNodes.indexOf(before) : -1; if (index < 0) node.childNodes.push(child); else node.childNodes.splice(index, 0, child); return child },
      removeChild(child) { const index = node.childNodes.indexOf(child); if (index >= 0) node.childNodes.splice(index, 1); child.parentNode = null; return child },
      setAttribute(name, value) { node.attributes[name] = value; if (name === 'type') node.type = value; if (name === 'disabled') node.disabled = true },
      removeAttribute(name) { delete node.attributes[name]; if (name === 'disabled') node.disabled = false },
      addEventListener(name, listener) { const entries = node.listeners.get(name) ?? new Set(); entries.add(listener); node.listeners.set(name, entries) },
      removeEventListener(name, listener) { node.listeners.get(name)?.delete(listener) },
      focus() { document.activeElement = node },
    }
    return node
  }
  document.nodeType = 9
  document.createElement = (name) => make(name)
  document.createTextNode = (value) => ({ ...make('#text'), nodeType: 3, nodeName: '#text', tagName: '#text', textContent: value } as InteractiveNode)
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
  const props = propsKey ? node[propsKey as keyof InteractiveNode] as unknown as Record<string, (event: Record<string, unknown>) => void> : null
  const handler = props?.[propName]
  if (!handler) throw new Error(`React prop handler not found: ${propName}`)
  handler({ target: node, currentTarget: node, preventDefault() {}, stopPropagation() {} })
}

async function flushInteractive() {
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
