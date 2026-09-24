import type { MemoryDto } from '@web-app-demo/contracts'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'bun:test'

import { MemoryEditor, NoteComposer } from '../src/features/composer'
import { composerDateOnly, composerOccurredAt } from '../src/features/composer/date'
import type { AuthenticatedTransport } from '../src/platform/api'

const familyId = '11111111-1111-4111-8111-111111111111'
const childId = '22222222-2222-4222-8222-222222222222'
const memoryId = '33333333-3333-4333-8333-333333333333'
const authorId = '44444444-4444-4444-8444-444444444444'

const memory: MemoryDto = {
  id: memoryId,
  familyId,
  childId,
  author: { id: authorId, name: 'Мама' },
  kind: 'note',
  body: 'Исходная заметка',
  occurredAt: '2026-09-20T12:00:00.000Z',
  createdAt: '2026-09-20T12:00:00.000Z',
  version: 7,
  status: 'published',
  attachments: [],
  likes: { count: 0, likedByMe: false },
  capabilities: { edit: true, delete: true, like: true },
}

test('creates a note with an idempotency key and trimmed body', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; method?: string; body?: Record<string, unknown>; headers?: HeadersInit }> = []
  const transport = transportWith(async (path, _schema, options) => {
    requests.push({ path, method: options?.method, body: options?.body as Record<string, unknown>, headers: options?.headers })
    return memory
  })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(NoteComposer, {
      childId, familyId, familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = '  Первый день  '
    await act(async () => invoke(body, 'onChange'))
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    date.value = '2026-09-20'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => { await invoke(findButton(browser.container, 'Опубликовать'), 'onClick'); await flushInteractive() })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ path: `/api/v1/families/${familyId}/memories`, method: 'POST', body: { kind: 'note', childId, body: 'Первый день' } })
    expect(requests[0]?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('converts a past date to an instant that remains that date in Pacific/Kiritimati', () => {
  const occurredAt = composerOccurredAt('2026-09-20', 'Pacific/Kiritimati', new Date('2026-09-21T00:00:00.000Z'))
  expect(occurredAt).not.toBeNull()
  expect(composerDateOnly(occurredAt!, 'Pacific/Kiritimati')).toBe('2026-09-20')
})

test('note publish blocks a second submission while the first is pending', async () => {
  const browser = installInteractiveDom()
  const requests: Array<Record<string, unknown>> = []
  let finishFirst: ((value: MemoryDto) => void) | undefined
  const transport = transportWith(async (_path, _schema, options) => {
    requests.push(options?.body as Record<string, unknown>)
    if (requests.length === 1) return new Promise<MemoryDto>((resolve) => { finishFirst = resolve })
    return memory
  })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(NoteComposer, {
      childId, familyId, familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = 'Не теряй мой текст'
    await act(async () => invoke(body, 'onChange'))
    const publish = findButton(browser.container, 'Опубликовать')
    await act(async () => { invoke(publish, 'onClick'); invoke(publish, 'onClick') })
    expect(requests).toHaveLength(1)
    finishFirst?.(memory)
    await act(async () => flushInteractive())
    expect(textOf(browser.container)).toContain('Заметка сохранена!')
    expect(requests[0]).toMatchObject({ kind: 'note', body: 'Не теряй мой текст' })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('note retry resends the same draft only after a failed publish', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ body: Record<string, unknown>; headers?: HeadersInit }> = []
  const transport = transportWith(async (_path, _schema, options) => {
    requests.push({ body: options?.body as Record<string, unknown>, headers: options?.headers })
    if (requests.length === 1) throw new Error('offline')
    return memory
  })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(NoteComposer, {
      childId, familyId, familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = 'Текст для повтора'
    await act(async () => invoke(body, 'onChange'))
    await act(async () => { invoke(findButton(browser.container, 'Опубликовать'), 'onClick'); await flushInteractive() })
    expect(textOf(browser.container)).toContain('Не удалось сохранить заметку')
    expect(requests).toHaveLength(1)
    await act(async () => { invoke(findButton(browser.container, 'Попробовать снова'), 'onClick'); await flushInteractive() })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(textOf(browser.container)).toContain('Заметка сохранена!')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('rejects a whitespace-only note without clearing its body or date', async () => {
  const browser = installInteractiveDom()
  let requestCount = 0
  const transport = transportWith(async () => { requestCount += 1; return memory })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(NoteComposer, {
      childId, familyId, familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = '   '
    await act(async () => invoke(body, 'onChange'))
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    date.value = '2026-09-19'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => invoke(findButton(browser.container, 'Опубликовать'), 'onClick'))

    expect(requestCount).toBe(0)
    expect(textOf(browser.container)).toContain('Введите текст заметки')
    expect(body.value).toBe('   ')
    expect(date.value).toBe('2026-09-19')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('editor sends only body and date with the memory expectedVersion', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ path: string; method?: string; body?: Record<string, unknown> }> = []
  const transport = transportWith(async (path, _schema, options) => {
    requests.push({ path, method: options?.method, body: options?.body as Record<string, unknown> })
    return memory
  })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(MemoryEditor, {
      memory, familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = 'Обновлённая заметка'
    await act(async () => invoke(body, 'onChange'))
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    date.value = '2026-09-19'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => { await invoke(findButton(browser.container, 'Сохранить'), 'onClick'); await flushInteractive() })

    expect(requests).toEqual([{
      path: `/api/v1/families/${familyId}/memories/${memoryId}`,
      method: 'PATCH',
      body: expect.objectContaining({ body: 'Обновлённая заметка', expectedVersion: 7 }),
    }])
    expect(requests[0]?.body?.occurredAt).toEqual(expect.any(String))
    expect(requests[0]?.body).not.toHaveProperty('kind')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('editor allows an empty body for media captions', async () => {
  const browser = installInteractiveDom()
  const requests: Array<{ body?: Record<string, unknown> }> = []
  const transport = transportWith(async (_path, _schema, options) => {
    requests.push({ body: options?.body as Record<string, unknown> })
    return memory
  })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(MemoryEditor, {
      memory: { ...memory, kind: 'photo', body: 'Подпись' }, familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = ''
    await act(async () => invoke(body, 'onChange'))
    await act(async () => { await invoke(findButton(browser.container, 'Сохранить'), 'onClick'); await flushInteractive() })

    expect(requests[0]?.body).toMatchObject({ body: '' })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('editor keeps body and date visible and explains a version conflict', async () => {
  const browser = installInteractiveDom()
  let conflict = true
  const requests: Array<{ method?: string; body?: Record<string, unknown> }> = []
  const transport = transportWith(async (path, _schema, options) => {
    requests.push({ method: options?.method, body: options?.body as Record<string, unknown> })
    if (options?.method === 'PATCH' && conflict) {
      conflict = false
      throw { status: 409 }
    }
    if (options?.method !== 'PATCH' && path.endsWith(`/memories/${memoryId}`)) return { ...memory, version: 8 }
    return { ...memory, version: 9 }
  })
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(MemoryEditor, {
      memory, familyTimezone: 'UTC', transport, onCancel: () => undefined, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = 'Мой новый текст'
    await act(async () => invoke(body, 'onChange'))
    const date = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'date')
    date.value = '2026-09-18'
    await act(async () => invoke(date, 'onChange'))
    await act(async () => { await invoke(findButton(browser.container, 'Сохранить'), 'onClick'); await flushInteractive() })

    expect(textOf(browser.container)).toContain('Актуальная версия загружена')
    expect(body.value).toBe('Мой новый текст')
    expect(date.value).toBe('2026-09-18')
    expect(requests).toHaveLength(2)

    await act(async () => { await invoke(findButton(browser.container, 'Сохранить'), 'onClick'); await flushInteractive() })
    expect(requests[2]?.body).toMatchObject({ expectedVersion: 8, body: 'Мой новый текст' })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('dirty note cancel asks for confirmation before discarding the draft', async () => {
  const browser = installInteractiveDom()
  let canceled = false
  const transport = transportWith(async () => memory)
  const root = createRoot(browser.container)

  try {
    await act(async () => root.render(createElement(NoteComposer, {
      childId, familyId, familyTimezone: 'UTC', transport, onCancel: () => { canceled = true }, onSuccess: () => undefined,
    })))
    const body = findOne(browser.container, (node) => node.tagName === 'TEXTAREA')
    body.value = 'Черновик'
    await act(async () => invoke(body, 'onChange'))
    browser.setConfirm(false)
    await act(async () => invoke(findOne(browser.container, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === 'Назад'), 'onClick'))

    expect(browser.confirmCalls()).toBe(1)
    expect(canceled).toBe(false)
    expect(body.value).toBe('Черновик')
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

function transportWith(request: AuthenticatedTransport['request']): AuthenticatedTransport {
  return { request, raw: async () => new Response() }
}

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
  let confirmResult = true
  let confirmCount = 0
  const window = { document, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {}, confirm: () => { confirmCount += 1; return confirmResult } }
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true })
  return { container: document.createElement('div'), setConfirm(value: boolean) { confirmResult = value }, confirmCalls: () => confirmCount, restore() { Object.assign(globalThis, { document: priorDocument, window: priorWindow }); delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT } }
}

function createInteractiveDocument(): InteractiveDocument {
  const document = {} as InteractiveDocument
  const make = (name: string): InteractiveNode => {
    const node: InteractiveNode = {
      nodeType: 1, nodeName: name.toUpperCase(), tagName: name.toUpperCase(), ownerDocument: document,
      parentNode: null, childNodes: [], style: { setProperty(name, value) { node.style[name] = value } }, attributes: {}, listeners: new Map(), value: '', type: '', disabled: false, textContent: '',
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

function findButton(container: InteractiveNode, label: string) {
  return findOne(container, (node) => node.tagName === 'BUTTON' && textOf(node) === label)
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
