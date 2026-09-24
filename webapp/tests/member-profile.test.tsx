import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FamilyMemberDto } from '@web-app-demo/contracts'

import { MemberProfile } from '../src/features/memoly-ui/MemberProfile'
import { memberProfileChanges, memberProfileError } from '../src/features/memoly-ui/member-profile-model'
import { ApiRequestError } from '../src/platform/api'

const member: FamilyMemberDto = {
  userId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Дмитрий',
  familyDisplayName: 'Папа',
  role: 'full',
  isOwner: false,
  joinedAt: '2026-09-20T12:00:00.000Z',
  version: 4,
}
const callbacks = { busy: false, onBack: () => undefined, onRefresh: () => undefined, onSave: async () => undefined, onRemove: async () => undefined }

test('owner profile shows account identity and locked role without unsupported mutations', () => {
  const html = renderToStaticMarkup(createElement(MemberProfile, { ...callbacks, member: { ...member, isOwner: true }, actions: { canEditAlias: false, canManageRole: false, canRemove: false } }))
  expect(html).toContain('Профиль владельца')
  expect(html).toContain('Аккаунт: Дмитрий')
  expect(html).toContain('Роль владельца изменить нельзя')
  expect(html).toContain('disabled=""')
  expect(html).not.toContain('Сохранить изменения')
  expect(html).not.toContain('Удалить из семьи')
  expect(html).not.toContain('Изменить фото')
})

test('editable regular member shows real alias, role, joined date and actions', () => {
  const html = renderToStaticMarkup(createElement(MemberProfile, { ...callbacks, member, actions: { canEditAlias: true, canManageRole: true, canRemove: true } }))
  expect(html).toContain('Профиль участника')
  expect(html).toContain('value="Папа"')
  expect(html).toContain('Аккаунт: Дмитрий')
  expect(html).toContain('20 сентября 2026')
  expect(html).toContain('Полный доступ')
  expect(html).toContain('Просмотр')
  expect(html).toContain('Сохранить изменения')
  expect(html).toContain('Удалить из семьи')
})

test('restricted viewer sees profile with no mutation or removal entry', () => {
  const html = renderToStaticMarkup(createElement(MemberProfile, { ...callbacks, member: { ...member, role: 'viewer' }, actions: { canEditAlias: false, canManageRole: false, canRemove: false } }))
  expect(html).toContain('Просмотр')
  expect(html).not.toContain('Сохранить изменения')
  expect(html).not.toContain('Удалить из семьи')
  expect(html).not.toContain('Изменить фото')
})

test('save payload contains only changed fields allowed by production permissions', () => {
  const ownerActions = { canEditAlias: true, canManageRole: true, canRemove: true }
  expect(memberProfileChanges(member, ownerActions, '  Дядя  ', 'viewer')).toEqual({ familyDisplayName: 'Дядя', role: 'viewer' })
  expect(memberProfileChanges(member, ownerActions, 'Папа', 'viewer')).toEqual({ role: 'viewer' })
  expect(memberProfileChanges(member, ownerActions, '   ', 'full')).toEqual({ familyDisplayName: null })
  expect(memberProfileChanges(member, ownerActions, 'Папа', 'full')).toBeNull()
  expect(memberProfileChanges({ ...member, isOwner: true }, ownerActions, 'Новое имя', 'viewer')).toBeNull()
  expect(memberProfileChanges(member, { canEditAlias: false, canManageRole: false, canRemove: false }, 'Новое имя', 'viewer')).toBeNull()
})

test('version conflicts request a refresh while other failures remain retryable', () => {
  const conflict = new ApiRequestError(409, 'VERSION_CONFLICT', 'Changed')
  expect(memberProfileError(conflict, 'save')).toEqual({ conflict: true, message: 'Данные участника изменились. Обновите их перед сохранением.' })
  expect(memberProfileError(conflict, 'remove')).toEqual({ conflict: true, message: 'Данные участника изменились. Обновите их перед удалением.' })
  expect(memberProfileError(new Error('offline'), 'save').conflict).toBe(false)
})
