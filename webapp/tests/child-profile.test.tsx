import { expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { FamilyResponse } from '@web-app-demo/contracts'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChildProfile } from '../src/features/family/ChildProfile'
import { FamilyOnboarding } from '../src/features/family/FamilyOnboarding'
import type { AuthenticatedTransport } from '../src/platform/api'

const child: NonNullable<FamilyResponse['child']> = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'София',
  birthDate: '2024-05-20',
  sex: 'girl',
  avatarMediaId: '55555555-5555-4555-8555-555555555555',
  avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
  version: 1,
  isComplete: true,
}

const actions = {
  onBack: () => undefined,
  onEdit: () => undefined,
  onChangePhoto: () => undefined,
  onOpenAge: () => undefined,
}

test('child profile shows real child data and the existing protected avatar URL', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: 'blob:protected-child-avatar',
    canEdit: true,
    child,
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: false,
  }))

  expect(markup).toContain('data-slot="child-profile"')
  expect(markup).toContain('class="child-hero ds-card ds-card--prominent"')
  expect(markup).toContain('class="child-action-row ds-row"')
  expect(markup).toContain('Дополнительные действия профиля ребёнка')
  expect(markup).not.toContain('Наше маленькое')
  expect(markup).toContain('София')
  expect(markup).toContain('Родилась 20 мая 2024')
  expect(markup).toContain('src="blob:protected-child-avatar"')
  expect(markup).toContain('Редактировать профиль')
  expect(markup).toContain('Сменить фото')
  expect(markup).toContain('Возраст и дата рождения')
  expect(markup).not.toContain('/api/v1/families/')
})

test('viewer can open the child profile without owner actions', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: null,
    canEdit: false,
    child,
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: false,
  }))

  expect(markup).toContain('Профиль ребёнка')
  expect(markup).toContain('data-slot="avatar-letter"')
  expect(markup).not.toContain('Редактировать профиль')
  expect(markup).not.toContain('Сменить фото')
  expect(markup).toContain('Возраст и дата рождения')
})

test('age details use the child birth date and keep edit behind permissions', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: null,
    canEdit: false,
    child,
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: true,
  }))

  expect(markup).toContain('Возраст обновляется автоматически')
  expect(markup).toContain('Полных месяцев')
  expect(markup).not.toContain('Изменить данные')
})

test('missing optional birth date and photo remain readable without a dead age action', () => {
  const markup = renderToStaticMarkup(createElement(ChildProfile, {
    ...actions,
    avatarUrl: null,
    canEdit: false,
    child: { ...child, name: 'Имя ребёнка с очень длинным составным именем', birthDate: null, sex: null, avatarMediaId: null },
    familyTimezone: 'Europe/Moscow',
    showAgeDetails: false,
  }))

  expect(markup).toContain('Имя ребёнка с очень длинным составным именем')
  expect(markup).toContain('Дата рождения не указана')
  expect(markup).toContain('data-slot="avatar-letter"')
  expect(markup).not.toContain('Возраст и дата рождения')
})

test('child profile editor uses canonical groups and keeps save/back actions wired', async () => {
  const markup = renderToStaticMarkup(createElement(FamilyOnboarding, {
    familyId: '11111111-1111-4111-8111-111111111111',
    familyTimezone: 'Europe/Moscow',
    initialChild: child,
    transport: {
      request: async () => undefined as never,
      raw: async () => new Response(null, { status: 404 }),
    },
    onCancel: () => undefined,
    onCompleted: async () => undefined,
  }))

  expect(markup).toContain('data-slot="child-profile-editor"')
  expect(markup).toContain('Редактировать профиль')
  expect(markup).toContain('child-edit-v2-avatar')
  expect(markup).toContain('child-edit-v2-field surface-inset')
  expect(markup).toContain('child-edit-v2-card surface-raised')
  expect(markup).toContain('child-edit-v2-save')
  expect(markup).toContain('Изменения увидят только участники вашей семьи.')
  expect(markup).toContain('Девочка')
  expect(markup).toContain('Мальчик')
  expect(markup).not.toContain('Не указывать')
  expect(markup).toMatch(/<label[^>]+for="child-avatar"[^>]*>[\s\S]*Заменить фотографию[\s\S]*aria-label="Заменить фотографию ребёнка"/)

  const browser = installInteractiveDom()
  let cancelCount = 0
  const requests: Array<{ path: string; input: unknown }> = []
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(FamilyOnboarding, {
      familyId: '11111111-1111-4111-8111-111111111111',
      familyTimezone: 'Europe/Moscow',
      initialChild: child,
      transport: {
        request: async (path, _schema, input) => {
          requests.push({ path, input })
          return undefined as never
        },
        raw: async () => new Response(null, { status: 404 }),
      },
      onCancel: () => { cancelCount += 1 },
      onCompleted: async () => undefined,
    })))

    const titleBack = findOne(browser.container, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === 'Назад к профилю ребёнка')
    await act(async () => invoke(titleBack, 'onClick'))
    expect(cancelCount).toBe(1)
    expect(findOne(browser.container, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === 'Назад к профилю ребёнка')).toBeDefined()
    const nameInput = findOne(browser.container, (node) => node.attributes.id === 'child-name')
    nameInput.value = 'София после редактирования'
    await act(async () => invoke(nameInput, 'onChange'))
    const boyRadio = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.value === 'boy')
    await act(async () => invoke(boyRadio, 'onChange'))
    await act(async () => { await invoke(findButton(browser.container, 'Сохранить профиль'), 'onClick'); await flushInteractive() })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.path).toContain('/families/11111111-1111-4111-8111-111111111111/child')
    expect(requests[0]?.input).toMatchObject({
      body: {
        name: 'София после редактирования',
        birthDate: child.birthDate,
        sex: 'boy',
        avatarMediaId: child.avatarMediaId,
        avatarCrop: child.avatarCrop,
        expectedVersion: child.version,
      },
    })
  } finally {
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('child profile editor disables the title back action while saving', async () => {
  const browser = installInteractiveDom()
  let resolveRequest!: () => void
  const requestPending = new Promise<never>((resolve) => { resolveRequest = () => resolve(undefined as never) })
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(FamilyOnboarding, {
      familyId: '11111111-1111-4111-8111-111111111111',
      familyTimezone: 'Europe/Moscow',
      initialChild: child,
      transport: {
        request: async () => requestPending,
        raw: async () => new Response(null, { status: 404 }),
      },
      onCancel: () => undefined,
      onCompleted: async () => undefined,
    })))

    await act(async () => {
      invoke(findButton(browser.container, 'Сохранить профиль'), 'onClick')
      await flushInteractive()
    })

    const titleBack = findOne(browser.container, (node) => node.tagName === 'BUTTON' && node.attributes['aria-label'] === 'Назад к профилю ребёнка')
    expect(titleBack.disabled).toBe(true)

    resolveRequest()
    await act(async () => { await flushInteractive() })
    expect(titleBack.disabled).toBe(false)
  } finally {
    resolveRequest?.()
    await act(async () => root.unmount())
    browser.restore()
  }
})

test('child avatar selection opens the shared editor and cancel performs no server mutation', async () => {
  const browser = installInteractiveDom()
  const requests: string[] = []
  const transport: AuthenticatedTransport = {
    request: async (path) => { requests.push(path); return {} as never },
    raw: async () => new Response(null, { status: 404 }),
  }
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test-avatar' })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined })
  const root = createRoot(browser.container)
  try {
    await act(async () => root.render(createElement(FamilyOnboarding, {
      familyId: '11111111-1111-4111-8111-111111111111', familyTimezone: 'Europe/Moscow',
      initialChild: { ...child, avatarMediaId: null }, photoOnly: true, transport,
      onCompleted: async () => undefined,
    })))
    const fileInput = findOne(browser.container, (node) => node.tagName === 'INPUT' && node.type === 'file')
    fileInput.files = [new File([new Uint8Array(128)], 'child.jpg', { type: 'image/jpeg' })]
    await act(async () => invoke(fileInput, 'onChange'))
    const editor = findOne(browser.container, (node) => node.attributes.role === 'dialog' && node.attributes['aria-label'] === 'Редактирование фотографии')
    expect(editor).toBeTruthy()
    expect(textOf(editor)).toContain('Масштаб')
    expect(textOf(editor)).toContain('Сбросить')
    expect(textOf(editor)).toContain('Выбрать другое')
    const cancel = findOne(editor, (node) => node.tagName === 'BUTTON' && textOf(node) === 'Отмена')
    await act(async () => invoke(cancel, 'onClick'))
    expect(findAll(browser.container, (node) => node.attributes.role === 'dialog')).toHaveLength(0)
    expect(requests).toEqual([])
  } finally {
    await act(async () => root.unmount())
    browser.restore()
    if (createObjectUrlDescriptor) Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
})
type InteractiveNode = {
  nodeType: number
  nodeName: string
  tagName: string
  parentNode: InteractiveNode | null
  childNodes: InteractiveNode[]
  style: InteractiveStyle
  attributes: Record<string, string>
  listeners: Map<string, Set<(...args: unknown[]) => void>>
  files: File[]
  value: string
  type: string
  disabled: boolean
  textContent: string
  ownerDocument: InteractiveDocument
  appendChild(child: InteractiveNode): InteractiveNode
  insertBefore(child: InteractiveNode, before: InteractiveNode | null): InteractiveNode
  removeChild(child: InteractiveNode): InteractiveNode
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  addEventListener(name: string, listener: (...args: unknown[]) => void): void
  removeEventListener(name: string, listener: (...args: unknown[]) => void): void
  focus(): void
  [key: string]: unknown
}

type InteractiveStyle = Record<string, string> & {
  setProperty: (name: string, value: string) => void
  removeProperty: (name: string) => void
  getPropertyValue: (name: string) => string
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
  return {
    container: document.createElement('div'),
    restore() {
      Object.assign(globalThis, { document: priorDocument, window: priorWindow })
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
    },
  }
}

function createInteractiveDocument(): InteractiveDocument {
  const document = {} as InteractiveDocument
  const make = (name: string): InteractiveNode => {
    const style = {} as InteractiveStyle
    style.setProperty = (property, value) => { style[property] = value }
    style.removeProperty = (property) => { delete style[property] }
    style.getPropertyValue = (property) => style[property] ?? ''
    const node: InteractiveNode = {
      nodeType: 1, nodeName: name.toUpperCase(), tagName: name.toUpperCase(), ownerDocument: document,
      parentNode: null, childNodes: [], style, attributes: {}, listeners: new Map(), files: [], value: '', type: '', disabled: false, textContent: '',
      appendChild(child) { child.parentNode = node; node.childNodes.push(child); return child },
      insertBefore(child, before) { child.parentNode = node; const index = before ? node.childNodes.indexOf(before) : -1; if (index < 0) node.childNodes.push(child); else node.childNodes.splice(index, 0, child); return child },
      removeChild(child) { const index = node.childNodes.indexOf(child); if (index >= 0) node.childNodes.splice(index, 1); child.parentNode = null; return child },
      setAttribute(attribute, value) { node.attributes[attribute] = value; if (attribute === 'type') node.type = value; if (attribute === 'disabled') node.disabled = true },
      removeAttribute(attribute) { delete node.attributes[attribute]; if (attribute === 'disabled') node.disabled = false },
      addEventListener(eventName, listener) { const entries = node.listeners.get(eventName) ?? new Set(); entries.add(listener); node.listeners.set(eventName, entries) },
      removeEventListener(eventName, listener) { node.listeners.get(eventName)?.delete(listener) },
      focus() { document.activeElement = node },
    }
    return node
  }
  document.nodeType = 9
  document.createElement = (name) => make(name)
  document.createTextNode = (value) => ({ ...make('#text'), nodeType: 3, nodeName: '#text', tagName: '#text', textContent: value })
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
