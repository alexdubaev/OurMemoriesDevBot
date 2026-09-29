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

test('mixed composer uploads serially and preserves selected order', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const uploads: Array<() => void> = []
  const originals = ['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002', '00000000-0000-7000-8000-000000000003', '00000000-0000-7000-8000-000000000004']
  let reservation = 0
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
      if (path.endsWith('/uploads')) {
        const index = reservation++
        return { assetId: originals[index], upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': index % 2 ? 'video/mp4' : 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: originals[Number(path.match(/upload-(\d+)/)?.[1] ?? 0)] } } as never
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Promise<Response>((resolve) => uploads.push(() => resolve(new Response(null, { status: 200 }))))
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('a.jpg'), file('b.mp4', 128, 'video/mp4'), file('c.jpg'), file('d.mp4', 128, 'video/mp4')]
    await act(async () => invoke(input, 'onChange'))
    const save = findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать'))
    let saveTask!: Promise<unknown>
    await act(async () => { saveTask = invoke(save, 'onClick'); await flushInteractive() })
    expect(uploads).toHaveLength(1)
    expect(requests.filter(({ path }) => path.endsWith('/uploads'))).toHaveLength(1)
    for (let index = 0; index < 4; index += 1) {
      await act(async () => { uploads[index]!(); await flushInteractive() })
      if (index < 3) {
        expect(uploads).toHaveLength(index + 2)
        expect(requests.filter(({ path }) => path.endsWith('/uploads'))).toHaveLength(index + 2)
      }
    }
    await act(async () => { await saveTask })
    const memory = requests.find(({ path }) => path.endsWith('/memories'))
    expect(memory?.body).toMatchObject({ kind: 'media', mediaIds: originals })
    expect(memory?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('photo + video + photo publishes one media Memory with one caption and event time', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const ids = ['00000000-0000-7000-8000-000000000031', '00000000-0000-7000-8000-000000000032', '00000000-0000-7000-8000-000000000033']
  let next = 0
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
      if (path.endsWith('/uploads')) {
        const index = next++
        return { assetId: ids[index], upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': index === 1 ? 'video/mp4' : 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      const uploadIndex = Number(path.match(/upload-(\d+)\/finalize/)?.[1] ?? 0)
      if (path.includes('/finalize')) return { asset: { id: ids[uploadIndex] } } as never
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
    input.files = [file('a.jpg'), file('b.mp4', 128, 'video/mp4'), file('c.jpg')]
    await act(async () => invoke(input, 'onChange'))
    const caption = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    caption.value = 'На прогулке'
    await act(async () => invoke(caption, 'onChange'))
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    date.value = '2026-09-20'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    const creates = requests.filter(({ path }) => path.endsWith('/memories'))
    expect(creates).toHaveLength(1)
    expect(creates[0]?.body).toMatchObject({ kind: 'media', body: 'На прогулке', occurredAt: expect.any(String), mediaIds: ids })
    expect(creates[0]?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('exactly one photo and one video publish one ordered media Memory', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; body: Record<string, unknown>; headers?: HeadersInit }> = []
  const ids = ['00000000-0000-7000-8000-000000000041', '00000000-0000-7000-8000-000000000042']
  let next = 0
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      requests.push({ path, body: (options?.body ?? {}) as Record<string, unknown>, headers: options?.headers })
      if (path.endsWith('/uploads')) {
        const index = next++
        return { assetId: ids[index], upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': index === 0 ? 'image/jpeg' : 'video/mp4' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: ids[Number(path.match(/upload-(\d+)\/finalize/)?.[1] ?? 0)] } } as never
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
    input.files = [file('one.jpg'), file('two.mp4', 128, 'video/mp4')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    const creates = requests.filter(({ path }) => path.endsWith('/memories'))
    expect(creates).toHaveLength(1)
    expect(creates[0]?.body).toMatchObject({ kind: 'media', mediaIds: ids })
    expect(creates[0]?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('mixed selection accepts one to ten photo/video items and rejects eleven or unsupported video', () => {
  expect(validateComposerFiles([file('one.jpg')])).toEqual({ ok: true })
  expect(validateComposerFiles([file('one.jpg'), file('clip.mov', 128, 'video/quicktime')])).toEqual({ ok: true })
  expect(validateComposerFiles(Array.from({ length: 10 }, (_, index) => index % 2 ? file(`${index}.mp4`, 128, 'video/mp4') : file(`${index}.jpg`)))).toEqual({ ok: true })
  expect(validateComposerFiles(Array.from({ length: 11 }, (_, index) => file(`${index}.jpg`))).code).toBe('too_many')
  expect(validateComposerFiles([file('large.mp4', 100_000_001, 'video/mp4')]).ok).toBe(false)
  expect(validateComposerFiles([file('unsupported.webm', 128, 'video/webm')]).ok).toBe(false)
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
  expect(await verifyComposerFile(mismatchedVideo)).toBeNull()
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
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
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
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
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
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    expect([reserves, puts, finalizes, creates]).toEqual([1, 2, 1, 1])
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
})

test('mixed upload failure waits for all items and blocks publication until retry completes', async () => {
  const browser = installInteractiveDom()
  const creates: Array<Record<string, unknown>> = []
  const ids = ['00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000013']
  const reservationAssets = new Map<string, string>()
  let reservation = 0
  let photoAttempts = 0
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) {
        const index = reservation++
        const assetId = ids[index]!
        reservationAssets.set(`upload-${index}`, assetId)
        return { assetId, upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': index === 0 || index === 2 ? 'image/jpeg' : 'video/mp4' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) {
        const uploadId = path.match(/(upload-\d+)\/finalize/)?.[1] ?? ''
        return { asset: { id: reservationAssets.get(uploadId) } } as never
      }
      if (path.endsWith('/memories')) creates.push(options?.body as Record<string, unknown>)
      return { id: 'memory-1' } as never
    },
    raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/0') && photoAttempts++ === 0) return new Response(null, { status: 400 })
    return new Response(null, { status: 200 })
  }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('fail.jpg'), file('ready.mp4', 128, 'video/mp4')]
    await act(async () => invoke(input, 'onChange'))
    const publish = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать'))
    await act(async () => { await invoke(publish(), 'onClick'); await flushInteractive() })
    expect(creates).toHaveLength(0)
    expect(textOf(browser.container)).toContain('Не удалось загрузить медиа')
    expect(textOf(browser.container)).toContain('Не удалось загрузить фото или видео')
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Вернуться к вложениям'), 'onClick'))
    expect(textOf(browser.container)).toContain('Ошибка загрузки')
    await act(async () => { await invoke(publish(), 'onClick'); await flushInteractive() })
    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({ kind: 'media', mediaIds: [ids[2], ids[1]] })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    globalThis.fetch = originalFetch
  }
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

test('publishes JPEG, QuickTime MOV, transcoded MOV/MP4, and iOS HEIC in selected order as one mixed Memory', async () => {
  const browser = installInteractiveDom()
  const assetIds = [1, 2, 3, 4, 5].map((index) => `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`)
  const reserves: Array<Record<string, unknown>> = []
  let puts = 0
  let finalizes = 0
  const creates: Array<Record<string, unknown>> = []
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) {
        reserves.push(options?.body as Record<string, unknown>)
        const index = reserves.length - 1
        return { assetId: assetIds[index], upload: { uploadId: `upload-${index}`, method: 'PUT', url: `https://storage.test/${index}`, headers: { 'Content-Type': reserves[index]!.contentType }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) { finalizes += 1; return { asset: { id: assetIds[finalizes - 1] } } as never }
      creates.push(options?.body as Record<string, unknown>)
      return { id: 'memory-1' } as never
    }, raw: async () => new Response(),
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { puts += 1; return new Response(null, { status: 200 }) }
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(PhotoComposer, { childId: '00000000-0000-7000-8000-000000000001', familyId: '00000000-0000-7000-8000-000000000002', familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined })))
    const input = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    input.files = [file('first.jpg'), file('clip.mov', 128, 'video/x-quicktime'), file('transcoded.mov', 128, 'video/mp4'), file('quicktime.mp4', 128, 'video/quicktime'), file('last.heic', 128, 'image/heic-sequence')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node).startsWith('Опубликовать')), 'onClick'); await flushInteractive() })
    expect(reserves.map((body) => [body.kind, body.contentType])).toEqual([['photo', 'image/jpeg'], ['video', 'video/quicktime'], ['video', 'video/mp4'], ['video', 'video/quicktime'], ['photo', 'image/heic']])
    expect([puts, finalizes]).toEqual([5, 5])
    expect(creates).toHaveLength(1)
    expect(creates[0]).toMatchObject({ kind: 'media', mediaIds: assetIds })
  } finally { await act(async () => root.unmount()); browser.restore(); globalThis.fetch = originalFetch }
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
