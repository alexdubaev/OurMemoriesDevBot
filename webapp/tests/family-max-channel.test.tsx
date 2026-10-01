import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { familyMaxChannelStatusSchema } from '@web-app-demo/contracts'
import { FamilyMaxChannelCard } from '../src/features/memoly-ui/FamilyPresentation'
import { loadFamilyMaxChannelStatus } from '../src/features/family/api'
import { canManageFamilyMaxChannel } from '../src/features/family/useFamilyMaxChannelStatus'
import type { AuthenticatedTransport } from '../src/platform/api'

const familyId = '11111111-1111-4111-8111-111111111111'
const renderCard = (state: 'unconfigured' | 'connected' | 'disconnected' | 'permission_problem', canManage: boolean) => renderToStaticMarkup(createElement(FamilyMaxChannelCard, {
  status: { state, title: state === 'connected' ? 'Синтетический канал' : null, canManage: true },
  loading: false, error: false, canManage, onRetry: () => undefined,
}))

test('channel status API uses the authenticated family endpoint and validated contract', async () => {
  let requestedPath = ''
  const transport: AuthenticatedTransport = {
    request: async (path, schema) => {
      requestedPath = path
      return schema.parse({ state: 'connected', title: 'Синтетический канал', canManage: true })
    },
    raw: async () => { throw new Error('unexpected raw request') },
  }
  const result = await loadFamilyMaxChannelStatus(transport, familyId)
  expect(requestedPath).toBe(`/api/v1/families/${familyId}/max-channel`)
  expect(familyMaxChannelStatusSchema.parse(result)).toEqual({ state: 'connected', title: 'Синтетический канал', canManage: true })
})

test('channel overview presents each server status and never offers a management action', () => {
  const unconfiguredManager = renderCard('unconfigured', true)
  expect(unconfiguredManager).toContain('Добавьте memoLy-бота администратором вашего канала')
  expect(renderCard('unconfigured', false)).toContain('Канал пока не подключён')
  expect(renderCard('connected', false)).toContain('Синтетический канал')
  expect(renderCard('connected', false)).toContain('Подключён')
  expect(renderCard('disconnected', true)).toContain('Бот удалён из канала')
  expect(renderCard('permission_problem', true)).toContain('Нужно вернуть права администратора')
  for (const markup of [unconfiguredManager, renderCard('unconfigured', false), renderCard('permission_problem', false)]) {
    expect(markup).not.toContain('<button')
  }
})

test('channel management requires both the current full role and server permission', () => {
  const permitted = { state: 'unconfigured' as const, title: null, canManage: true }
  expect(canManageFamilyMaxChannel('full', permitted)).toBe(true)
  expect(canManageFamilyMaxChannel('viewer', permitted)).toBe(false)
  expect(canManageFamilyMaxChannel('full', { ...permitted, canManage: false })).toBe(false)
  expect(canManageFamilyMaxChannel('full', null)).toBe(false)
})

test('channel section separates loading and retryable error states', () => {
  const loading = renderToStaticMarkup(createElement(FamilyMaxChannelCard, { status: null, loading: true, error: false, canManage: true, onRetry: () => undefined }))
  const error = renderToStaticMarkup(createElement(FamilyMaxChannelCard, { status: null, loading: false, error: true, canManage: true, onRetry: () => undefined }))
  expect(loading).toContain('Загружаем состояние канала')
  expect(error).toContain('Не удалось загрузить состояние канала')
  expect(error).toContain('Повторить')
})
