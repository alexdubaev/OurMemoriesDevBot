import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FamilyResponse } from '@web-app-demo/contracts'

import { FamilySettingsPage } from '../src/features/memoly-ui/FamilySettingsPage'
import { FamilyArchivePage } from '../src/features/memoly-ui/FamilyArchivePage'
import { FamilyInvitesPage } from '../src/features/memoly-ui/FamilyInvitesPage'
import { familySettingsChanges } from '../src/features/memoly-ui/family-settings-model'

const family: FamilyResponse['family'] = { id: '11111111-1111-4111-8111-111111111111', name: 'Наша семья', timezone: 'Europe/Moscow', ownerUserId: '22222222-2222-4222-8222-222222222222' }

test('family settings change set trims the name and includes changed supported fields only', () => {
  expect(familySettingsChanges(family, ' Наша семья ', 'Europe/Moscow')).toBeNull()
  expect(familySettingsChanges(family, 'Семья Софии', 'Europe/Moscow')).toEqual({ name: 'Семья Софии' })
  expect(familySettingsChanges(family, 'Наша семья', 'UTC')).toEqual({ timezone: 'UTC' })
  expect(familySettingsChanges(family, 'Другая семья', 'UTC')).toEqual({ name: 'Другая семья', timezone: 'UTC' })
})

test('family settings form displays current values and canonical help', () => {
  const html = renderToStaticMarkup(createElement(FamilySettingsPage, { family, busy: false, onBack: () => undefined, onRefresh: () => undefined, onSave: async () => undefined }))
  expect(html).toContain('data-slot="family-settings-page"')
  expect(html).toContain('value="Наша семья"')
  expect(html).toContain('Europe/Moscow')
  expect(html).toContain('Часовой пояс используется для дат')
  expect(html).toContain('Сохранить')
})

test('family archive renders real quota and error states without sample values', () => {
  const ready = renderToStaticMarkup(createElement(FamilyArchivePage, { usage: { usedBytes: 1024 ** 3, quotaBytes: 2 * 1024 ** 3 }, usageFailed: false, onBack: () => undefined, onRefresh: () => undefined }))
  expect(ready).toContain('data-slot="family-archive-page"')
  expect(ready).toContain('1 ГБ')
  expect(ready).toContain('50%')
  const error = renderToStaticMarkup(createElement(FamilyArchivePage, { usage: null, usageFailed: true, onBack: () => undefined, onRefresh: () => undefined }))
  expect(error).toContain('Не удалось загрузить объём архива')
  expect(error).toContain('Повторить загрузку')
})

test('active invitations list has empty and populated states and existing invite entry', () => {
  const callbacks = { busy: false, onBack: () => undefined, onInvite: () => undefined, onRevoke: async () => undefined }
  const empty = renderToStaticMarkup(createElement(FamilyInvitesPage, { ...callbacks, invites: [] }))
  expect(empty).toContain('Нет активных приглашений')
  expect(empty).toContain('Пригласить родственника')
  const populated = renderToStaticMarkup(createElement(FamilyInvitesPage, { ...callbacks, invites: [{ id: '33333333-3333-4333-8333-333333333333', role: 'viewer', inviteeDisplayName: 'Бабушка Оля', expiresAt: '2026-09-25T12:00:00Z', createdAt: '2026-09-22T12:00:00Z' }] }))
  expect(populated).toContain('Бабушка Оля')
  expect(populated).toContain('Просмотр')
  expect(populated).toContain('Отозвать')
})
