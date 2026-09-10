import { describe, expect, test } from 'bun:test'

import { ageFromBirthDate, formatChildAge, familyMemberName, roleLabel } from '../src/features/family/model'

describe('family presentation model', () => {
  test('derives age from birth date instead of accepting an independently editable age', () => {
    const now = new Date('2026-09-10T12:00:00.000Z')
    expect(ageFromBirthDate('2024-09-10', now)).toBe(2)
    expect(ageFromBirthDate('2024-09-11', now)).toBe(1)
    expect(ageFromBirthDate('not-a-date', now)).toBeNull()
  })

  test('formats date-only ages in the family timezone without browser-local drift', () => {
    const now = new Date('2026-09-10T20:30:00.000Z')
    expect(formatChildAge('2026-09-10', 'Europe/Moscow', now)).toBe('0 дней')
    expect(formatChildAge('2026-08-10', 'Europe/Moscow', now)).toBe('1 месяц')
    expect(formatChildAge('2024-08-10', 'Europe/Moscow', now)).toBe('2 года 1 месяц')
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
