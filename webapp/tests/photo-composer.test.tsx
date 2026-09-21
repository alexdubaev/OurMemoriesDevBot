import { expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import {
  composerDateOnly,
  composerOccurredAt,
  validatePhotoFiles,
} from '../src/features/composer'
import { PhotoComposer } from '../src/features/composer/PhotoComposer'
import type { AuthenticatedTransport } from '../src/platform/api'
import { ApiRequestError } from '../src/platform/api'

function file(name: string, size = 128, type = 'image/jpeg') {
  return new File([new Uint8Array(size)], name, { type })
}

test('accepts one to ten supported photos and rejects video or an eleventh photo', () => {
  expect(validatePhotoFiles([file('one.jpg')])).toEqual({ ok: true })
  expect(validatePhotoFiles(Array.from({ length: 10 }, (_, index) => file(`${index}.png`, 128, 'image/png')))).toEqual({ ok: true })
  expect(validatePhotoFiles([file('clip.mp4', 128, 'video/mp4')])).toEqual({ ok: false, code: 'unsupported_format' })
  expect(validatePhotoFiles(Array.from({ length: 11 }, (_, index) => file(`${index}.jpg`)))).toEqual({ ok: false, code: 'too_many' })
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
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Сохранить')
    input.files = [file('one.jpg'), file('two.jpg')]
    await act(async () => invoke(input, 'onChange'))
    caption.value = 'На море'
    await act(async () => invoke(caption, 'onChange'))
    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })

    expect(requests.filter(({ path }) => path.endsWith('/uploads'))).toHaveLength(2)
    expect(requests.filter(({ path }) => path.includes('/finalize'))).toHaveLength(2)
    const memoryRequests = requests.filter(({ path }) => path.endsWith('/memories'))
    expect(memoryRequests).toHaveLength(1)
    expect(memoryRequests[0]?.body).toMatchObject({ kind: 'photo', childId: '00000000-0000-7000-8000-000000000001', body: 'На море', mediaIds: ['00000000-0000-7000-8000-000000000001', '00000000-0000-7000-8000-000000000002'] })
    expect(memoryRequests[0]?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) })
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
  const transport: AuthenticatedTransport = {
    request: async (path, _schema, options) => {
      if (path.endsWith('/uploads')) {
        reserveCount += 1
        reserveKeys.push(String((options?.headers as Record<string, string> | undefined)?.['Idempotency-Key']))
        if (reserveCount === 1) throw new Error('offline')
        return { assetId: '00000000-0000-7000-8000-000000000001', upload: { uploadId: '00000000-0000-7000-8000-000000000003', method: 'PUT', url: 'https://storage.test/asset-1', headers: { 'Content-Type': 'image/jpeg' }, contentLength: 128, expiresAt: '2026-09-22T00:00:00.000Z' }, reservationExpiresAt: '2026-09-22T00:05:00.000Z' } as never
      }
      if (path.includes('/finalize')) return { asset: { id: '00000000-0000-7000-8000-000000000001' } } as never
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
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Сохранить')
    input.files = [file('retry.jpg')]
    await act(async () => invoke(input, 'onChange'))
    caption.value = 'Сохрани дату'
    await act(async () => invoke(caption, 'onChange'))
    date.value = '2026-09-20'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })

    expect(textOf(browser.container)).toContain('Не удалось подготовить сохранение')
    expect(input.files).toHaveLength(1)
    expect(caption.value).toBe('Сохрани дату')
    expect(date.value).toBe('2026-09-20')

    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive() })
    expect(reserveCount).toBe(2)
    expect(reserveKeys[0]).toBeTruthy()
    expect(reserveKeys[1]).toBe(reserveKeys[0])
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
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Сохранить')
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

test('replays one idempotent photo upload when finalize reports the missing object', async () => {
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
    const save = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Сохранить')
    input.files = [file('retry-after-missing.jpg')]
    await act(async () => invoke(input, 'onChange'))
    await act(async () => { await invoke(save(), 'onClick'); await flushInteractive(); await flushInteractive() })

    expect(reserves).toBe(2)
    expect(finalizes).toBe(2)
    expect(successCount).toBe(1)
    expect(textOf(browser.container)).toContain('Сохранено в семейную ленту')
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
    const cancel = () => findOne(browser.container, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Отмена')
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
      parentNode: null, childNodes: [], style: {}, attributes: {}, listeners: new Map(), value: '', type: '', disabled: false, files: [], textContent: '',
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
