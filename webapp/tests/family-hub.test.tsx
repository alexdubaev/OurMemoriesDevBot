import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FamilyHomeResponse } from '@web-app-demo/contracts'

import { FamilyHubPage } from '../src/features/family/FamilyHubPage'
import type { AuthenticatedTransport } from '../src/platform/api'

const transport: AuthenticatedTransport = {
  request: async () => { throw new Error('unexpected request') },
  raw: async () => { throw new Error('unexpected request') },
}

const family = (id: number, extra: Partial<FamilyHomeResponse['items'][number]> = {}): FamilyHomeResponse['items'][number] => ({
  familyId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  name: `Семья ${id}`,
  displaySubtitle: null,
  childAvatarMediaId: null,
  isOwner: false,
  role: 'viewer',
  setupStatus: 'ready',
  capabilities: { canCreateInvite: false, canManageMembers: false, canEditChild: false, canPublishNote: false, canPublishPhoto: false, canPublishVoice: false, canPublishVideo: false, canUploadChildAvatar: false },
  unreadCount: 0,
  unreadState: 'ready',
  membershipEpoch: 1,
  ...extra,
})

const home = (items: FamilyHomeResponse['items'], canCreateOwnFamily = false): FamilyHomeResponse => ({
  version: 1, ownFamilyId: items.find((item) => item.isOwner)?.familyId ?? null,
  ownFamilyStatus: items.some((item) => item.isOwner) ? 'active' : null,
  canCreateOwnFamily, items, nextCursor: null,
})

const render = (data: FamilyHomeResponse | null, options: { loading?: boolean; error?: string | null; notice?: string | null } = {}) => renderToStaticMarkup(createElement(FamilyHubPage, {
  home: data, loading: options.loading ?? false, error: options.error ?? null, notice: options.notice ?? null,
  busy: false, loadingMore: false, onRetry: () => undefined, onLoadMore: () => undefined,
  onCreate: () => undefined, onSelect: () => undefined, transport,
}))

test('empty, loading and failed family lists remain distinct', () => {
  expect(render(home([], true))).toContain('Пока здесь нет семей')
  expect(render(home([], true))).toContain('Создать свою семью')
  expect(render(null, { loading: true })).toContain('Загружаем семьи')
  expect(render(null, { loading: true })).not.toContain('Пока здесь нет семей')
  expect(render(null, { error: 'network' })).toContain('Не удалось загрузить семьи')
  expect(render(null, { error: 'network' })).not.toContain('Пока здесь нет семей')
})

test('one invited family never requires creating an album', () => {
  const markup = render(home([family(1)]))
  expect(markup).toContain('Семьи близких')
  expect(markup).not.toContain('Моя семья</h2>')
  expect(markup).not.toContain('Создать свою семью')
})

test('the same card groups owned and invited families without a scenario switch', () => {
  const markup = render(home([family(1, { isOwner: true, role: 'full' }), family(2), family(3)]))
  expect(markup).toContain('Моя семья</h2>')
  expect(markup).toContain('Семьи близких</h2>')
  expect((markup.match(/class="family-hub-card"/g) ?? []).length).toBe(3)
  expect(markup).toContain('Владелец')
  expect(markup).toContain('Просмотр')
})

test('long names, setup, large counts and unavailable counters keep their real meaning', () => {
  const longName = 'Очень длинное название семейного альбома для проверки переноса'
  const markup = render(home([
    family(1, { name: longName, isOwner: true, setupStatus: 'needs_child', unreadCount: 123 }),
    family(2, { unreadCount: null, unreadState: 'unavailable' }),
    family(3, { unreadCount: null, unreadState: 'not_enabled' }),
  ]))
  expect(markup).toContain(longName)
  expect(markup).toContain('Завершить настройку')
  expect(markup).toContain('99+')
  expect(markup).toContain('123 непросмотренных')
  expect(markup).toContain('Счётчик временно недоступен')
  expect(markup).toContain('Счётчик пока не включён')
  expect(markup).not.toContain('0 непросмотренных')
})

test('family subtitle distinguishes otherwise identical card names for screen readers', () => {
  const markup = render(home([
    family(1, { name: 'Наш альбом', displaySubtitle: 'Семья дочери' }),
    family(2, { name: 'Наш альбом', displaySubtitle: 'Семья сына' }),
  ]))
  expect(markup).toContain('aria-label="Наш альбом, Семья дочери, Просмотр.')
  expect(markup).toContain('aria-label="Наш альбом, Семья сына, Просмотр.')
})
