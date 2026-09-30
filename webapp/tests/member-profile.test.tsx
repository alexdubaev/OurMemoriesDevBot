import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FamilyMemberDto } from '@web-app-demo/contracts'

import { MemberProfile } from '../src/features/memoly-ui/MemberProfile'
import { AuthContext, type AuthContextValue } from '../src/features/auth/context'
import { avatarFileErrorMessage, avatarUploadErrorMessage, isMemberSelf, memberProfileChanges, memberProfileError, presentSelfNameOverride, serverConfirmsSelfName } from '../src/features/memoly-ui/member-profile-model'
import { AvatarUploadError } from '../src/features/avatar'
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
const callbacks = { busy: false, currentUserId: 'different-user', onBack: () => undefined, onRefresh: () => undefined, onSave: async () => undefined, onRemove: async () => undefined, onAccountNameSaved: () => undefined }

test('owner profile shows account identity and locked role without unsupported mutations', () => {
  const html = renderToStaticMarkup(createElement(MemberProfile, { ...callbacks, member: { ...member, isOwner: true }, actions: { canEditAlias: false, canManageRole: false, canRemove: false } }))
  expect(html).toContain('Профиль владельца')
  expect(html).toContain('Имя профиля: Дмитрий')
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
  expect(html).toContain('Имя профиля: Дмитрий')
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

test('self identity is independent of owner and access role', () => {
  for (const variation of [
    { isOwner: true, role: 'full' as const },
    { isOwner: false, role: 'full' as const },
    { isOwner: false, role: 'viewer' as const },
  ]) {
    const self = { ...member, ...variation }
    expect(isMemberSelf(self, self.userId)).toBe(true)
  }
  expect(isMemberSelf(member, 'someone-else')).toBe(false)
})

test('owner, full member, and viewer can edit only their own account profile', () => {
  for (const variation of [
    { isOwner: true, role: 'full' as const },
    { isOwner: false, role: 'full' as const },
    { isOwner: false, role: 'viewer' as const },
  ]) {
    const self = { ...member, ...variation }
    const html = renderProfile(self, self.userId, { canEditAlias: false, canManageRole: false, canRemove: false })
    expect(html).toContain('Имя профиля')
    expect(html).toContain('Сохранить имя профиля')
    expect(html).toContain('Добавить фото')
    expect(html).not.toContain('role="radiogroup"')
    expect(html).not.toContain('name="member-role-')
    expect(html).toContain('image/jpeg,image/png,image/heic,image/heif')
    if (variation.isOwner) expect(html).toContain('Роль владельца изменить нельзя')
  }
})

test('a viewer can see their access level but cannot get role controls on their own profile', () => {
  const self = { ...member, role: 'viewer' as const }
  const html = renderProfile(self, self.userId, { canEditAlias: false, canManageRole: false, canRemove: false })

  expect(html).toContain('Имя профиля')
  expect(html).toContain('Сохранить имя профиля')
  expect(html).toContain('Добавить фото')
  expect(html).toContain('Доступ: Просмотр')
  expect(html).not.toContain('role="radiogroup"')
  expect(html).not.toContain('name="member-role-')
  expect(html).not.toContain('Сохранить изменения')
})

test('another member has read-only account details while existing owner controls remain', () => {
  const html = renderProfile(member, 'owner-user', { canEditAlias: true, canManageRole: true, canRemove: true })
  expect(html).toContain('Имя профиля: Дмитрий')
  expect(html).not.toContain('Сохранить имя профиля')
  expect(html).not.toContain('Добавить фото')
  expect(html).toContain('Имя в семье')
  expect(html).toContain('Удалить из семьи')
})

test('a delayed family refresh keeps the latest saved self name until the server confirms it', () => {
  const override = { value: 'Latest name', baseline: 'Old name' }
  const intermediate = [{ ...member, displayName: 'Older in-flight response' }]
  expect(presentSelfNameOverride(intermediate, member.userId, override)[0]?.displayName).toBe('Latest name')
  expect(serverConfirmsSelfName(intermediate, member.userId, override)).toBe(false)

  const confirmed = [{ ...member, displayName: 'Latest name' }]
  expect(serverConfirmsSelfName(confirmed, member.userId, override)).toBe(true)
  expect(presentSelfNameOverride(confirmed, member.userId, override)[0]?.displayName).toBe('Latest name')
})

test('avatar validation and transfer failures have actionable Russian messages by failure reason', () => {
  expect(avatarFileErrorMessage('type')).toContain('Формат')
  expect(avatarFileErrorMessage('too-large')).toContain('5 МБ')
  expect(avatarUploadErrorMessage(new AvatarUploadError('transfer-failed', 'English internal message'))).toContain('Проверьте соединение')
})

function renderProfile(profileMember: FamilyMemberDto, currentUserId: string, actions: { canEditAlias: boolean; canManageRole: boolean; canRemove: boolean }) {
  const auth = { transport: {} } as unknown as AuthContextValue
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(AuthContext.Provider, { value: auth }, createElement(MemberProfile, { ...callbacks, currentUserId, member: profileMember, actions }))))
}
