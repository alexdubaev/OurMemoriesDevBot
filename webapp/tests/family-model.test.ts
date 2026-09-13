import { describe, expect, test } from 'bun:test'

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
