import { describe, expect, test } from 'bun:test'

import { familyCalendarDate, isBirthDateOnOrBeforeFamilyToday } from './family-date'

describe('family calendar dates', () => {
  test('uses the family timezone rather than UTC for the current calendar day', () => {
    const now = new Date('2026-09-10T21:30:00.000Z')

    expect(familyCalendarDate('Europe/Moscow', now)).toBe('2026-09-11')
    expect(isBirthDateOnOrBeforeFamilyToday('2026-09-11', 'Europe/Moscow', now)).toBe(true)
    expect(isBirthDateOnOrBeforeFamilyToday('2026-09-12', 'Europe/Moscow', now)).toBe(false)
  })

  test('rejects impossible date-only values without converting them through UTC', () => {
    const now = new Date('2026-09-10T21:30:00.000Z')

    expect(isBirthDateOnOrBeforeFamilyToday('2024-02-29', 'Europe/Moscow', now)).toBe(true)
    expect(isBirthDateOnOrBeforeFamilyToday('2023-02-29', 'Europe/Moscow', now)).toBe(false)
  })
})
