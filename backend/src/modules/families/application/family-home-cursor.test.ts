import { describe, expect, test } from 'bun:test'

import { decodeFamilyHomeCursor, encodeFamilyHomeCursor } from './family-home-cursor'

describe('family home cursor', () => {
  const secret = 'test-secret'
  const now = new Date('2026-09-27T10:00:00.000Z')
  const snapshot = 'list-snapshot'
  const position = { rank: 1 as const, name: 'Семья', familyId: '00000000-0000-4000-8000-000000000001' }

  test('binds position to user and list snapshot', () => {
    const cursor = encodeFamilyHomeCursor(position, 'user-a', snapshot, secret, now)
    expect(decodeFamilyHomeCursor(cursor, 'user-a', snapshot, secret, now)).toEqual(position)
    expect(() => decodeFamilyHomeCursor(cursor, 'user-b', snapshot, secret, now))
      .toThrow('Некорректный курсор')
    expect(() => decodeFamilyHomeCursor(cursor, 'user-a', 'changed', secret, now))
      .toThrow('Список семей изменился')
  })

  test('rejects tampering and expiration', () => {
    const cursor = encodeFamilyHomeCursor(position, 'user-a', snapshot, secret, now)
    expect(() => decodeFamilyHomeCursor(`${cursor}x`, 'user-a', snapshot, secret, now))
      .toThrow('Некорректный курсор')
    expect(() => decodeFamilyHomeCursor(cursor, 'user-a', snapshot, secret,
      new Date(now.getTime() + 16 * 60_000)))
      .toThrow('Список семей изменился')
  })
})
