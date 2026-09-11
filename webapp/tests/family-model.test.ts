import { describe, expect, test } from 'bun:test'

import {
  familyCalendarDate,
  formatChildAge,
  inviteIssueCode,
  inviteIssueMessage,
  isBirthDateOnOrBeforeFamilyToday,
  familyMemberName,
  roleLabel,
} from '../src/features/family/model'

describe('family presentation model', () => {
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
