import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import type { FamilyInviteDto, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'

import {
  familyCalendarDate,
  feedChildSubtitle,
  formatChildAge,
  inviteIssueCode,
  inviteIssueMessage,
  isBirthDateOnOrBeforeFamilyToday,
  familyMemberName,
  roleLabel,
} from '../src/features/family/model'
import { FamilyPresentation } from '../src/features/memoly-ui/FamilyPresentation'

describe('family presentation model', () => {
  test('renders invite controls only when supplied family capability permits invite', () => {
    const markup = renderToStaticMarkup(createElement(FamilyPresentation, familyProps({ canInvite: false })))

    expect(markup).not.toContain('Пригласить близкого')
    expect(markup).not.toContain('Создать приглашение')
  })

  test('uses the shared child header and real family identity', () => {
    const markup = renderToStaticMarkup(createElement(FamilyPresentation, familyProps()))

    expect(markup).toContain('data-child-header-mode="family"')
    expect(markup).toContain('aria-label="Настройки"')
    expect(markup).toContain('Варя')
    expect(markup).toContain('Наша семья')
  })

  test('renders pending invite values without exposing a raw token', () => {
    const rawToken = 'invite_raw_token_must_not_be_rendered'
    const markup = renderToStaticMarkup(createElement(FamilyPresentation, familyProps({
      invites: [{ ...invite, rawToken }],
      canInvite: true,
    })))

    expect(markup).toContain(invite.inviteeDisplayName!)
    expect(markup).not.toContain(rawToken)
  })

  test('formats date-only ages in the family timezone without browser-local drift', () => {
    const now = new Date('2026-09-10T21:30:00.000Z')
    expect(familyCalendarDate('Europe/Moscow', now)).toBe('2026-09-11')
    expect(isBirthDateOnOrBeforeFamilyToday('2024-09-11', 'Europe/Moscow', now)).toBe(true)
    expect(isBirthDateOnOrBeforeFamilyToday('2026-09-12', 'Europe/Moscow', now)).toBe(false)
    expect(formatChildAge('2026-09-11', 'Europe/Moscow', now)).toBe('0 дней')
    expect(formatChildAge('2026-08-11', 'Europe/Moscow', now)).toBe('1 месяц')
    expect(formatChildAge('2024-09-11', 'Europe/Moscow', now)).toBe('2 года')
    expect(formatChildAge('2024-08-11', 'Europe/Moscow', now)).toBe('2 года 1 месяц')
  })

  test('handles date-only month and leap-year boundaries', () => {
    const now = new Date('2025-03-01T12:00:00.000Z')
    expect(formatChildAge('2025-02-02', 'UTC', now)).toBe('27 дней')
    expect(formatChildAge('2025-01-31', 'UTC', now)).toBe('1 месяц')
    expect(formatChildAge('2024-02-29', 'UTC', now)).toBe('1 год')
    expect(formatChildAge('2025-03-02', 'UTC', now)).toBeNull()
    expect(formatChildAge('not-a-date', 'UTC', now)).toBeNull()
  })

  test('formats feed-header ages with Russian plurals from a fixed date', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')

    expect(formatChildAge('2026-09-09', 'UTC', now)).toBe('1 день')
    expect(formatChildAge('2026-09-08', 'UTC', now)).toBe('2 дня')
    expect(formatChildAge('2026-09-05', 'UTC', now)).toBe('5 дней')
    expect(formatChildAge('2026-08-10', 'UTC', now)).toBe('1 месяц')
    expect(formatChildAge('2026-07-10', 'UTC', now)).toBe('2 месяца')
    expect(formatChildAge('2026-04-10', 'UTC', now)).toBe('5 месяцев')
    expect(formatChildAge('2025-09-10', 'UTC', now)).toBe('1 год')
    expect(formatChildAge('2024-09-10', 'UTC', now)).toBe('2 года')
    expect(formatChildAge('2021-09-10', 'UTC', now)).toBe('5 лет')
    expect(formatChildAge('2024-02-10', 'UTC', now)).toBe('2 года 7 месяцев')
    expect(formatChildAge('not-a-date', 'UTC', now)).toBeNull()
  })

  test('uses an age rather than an ISO birth date in the feed header', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')

    expect(feedChildSubtitle('2024-02-10', 'UTC', now)).toBe('2 года 7 месяцев')
    expect(feedChildSubtitle('not-a-date', 'UTC', now)).toBe('Профиль ребёнка')
    expect(feedChildSubtitle(null, 'UTC', now)).toBe('Профиль ребёнка')
    expect(feedChildSubtitle('2026-09-11', 'UTC', now)).toBe('Профиль ребёнка')
  })

  test('keeps invite errors distinct without turning unknown failures into not found', () => {
    expect(inviteIssueMessage('INVITE_REVOKED')).toContain('отозвано')
    expect(inviteIssueMessage('INVITE_EXPIRED')).toContain('истёк')
    expect(inviteIssueMessage('INVITE_USED')).toContain('использовано')
    expect(inviteIssueMessage('ALREADY_IN_FAMILY')).toContain('другой семье')
    expect(inviteIssueMessage('NETWORK')).toContain('соединение')
    expect(inviteIssueMessage('SOMETHING_NEW')).toBe('Не удалось обработать приглашение. Попробуйте ещё раз.')
    expect(inviteIssueCode({ code: 'INVITE_USED' })).toBe('INVITE_USED')
    expect(inviteIssueCode(new TypeError('fetch failed'))).toBe('NETWORK')
    expect(inviteIssueCode(new Error('unexpected parse failure'))).toBe('UNKNOWN')
  })

  test('keeps aliases and human role labels inside the family UI', () => {
    expect(familyMemberName({ familyDisplayName: 'Бабушка Оля', displayName: 'Ольга' }))
      .toBe('Бабушка Оля')
    expect(familyMemberName({ familyDisplayName: null, displayName: 'Ольга' })).toBe('Ольга')
    expect(roleLabel('full', true)).toBe('Владелец')
    expect(roleLabel('full', false)).toBe('Полный доступ')
    expect(roleLabel('viewer', false)).toBe('Просмотр')
  })
})

const familyResponse: FamilyResponse = {
  family: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Наша семья',
    ownerUserId: '22222222-2222-4222-8222-222222222222',
    timezone: 'Europe/Moscow',
  },
  child: {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Варя',
    birthDate: '2024-02-10',
    sex: 'girl',
    avatarMediaId: null,
    avatarCrop: null,
    version: 1,
    isComplete: true,
  },
}

const member: FamilyMemberDto = {
  userId: familyResponse.family.ownerUserId,
  displayName: 'Александр',
  familyDisplayName: null,
  role: 'full',
  isOwner: true,
  joinedAt: '2026-09-01T00:00:00.000Z',
  version: 1,
}

const invite: FamilyInviteDto = {
  id: '44444444-4444-4444-8444-444444444444',
  role: 'viewer',
  inviteeDisplayName: 'Бабушка Оля',
  expiresAt: '2026-09-20T00:00:00.000Z',
  createdAt: '2026-09-17T00:00:00.000Z',
}

function familyProps(overrides: Partial<ComponentProps<typeof FamilyPresentation>> = {}) {
  return {
    familyResponse,
    members: [member],
    invites: [],
    childAvatarUrl: null,
    usage: { usedBytes: 320 * 1024 * 1024, quotaBytes: 2 * 1024 * 1024 * 1024 },
    usageFailed: false,
    inviteReady: null,
    copyState: 'idle' as const,
    busy: false,
    canInvite: true,
    canEditChild: true,
    canLeaveFamily: false,
    memberActions: { [member.userId]: { canEditAlias: false, canManageRole: false, canRemove: false } },
    onRefreshUsage: () => undefined,
    onEditChild: () => undefined,
    onCreateInvite: async () => undefined,
    onCopyInvite: async () => undefined,
    onShareInvite: async () => undefined,
    onCloseInvite: () => undefined,
    onRevokeInvite: async () => undefined,
    onUpdateMember: async () => undefined,
    onRemoveMember: async () => undefined,
    onLeaveFamily: async () => undefined,
    ...overrides,
  }
}
