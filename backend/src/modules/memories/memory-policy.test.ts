import { describe, expect, test } from 'bun:test'

import {
  decodeMemoryCursor,
  decodeUnreadMemoryCursor,
  encodeMemoryCursor,
  encodeUnreadMemoryCursor,
  validateMemoryCursorContext,
  validateUnreadMemoryCursorContext,
} from './domain/memory-cursor'

const secret = '0123456789abcdef'.repeat(4)
const familyId = '018f01d8-0c2a-7c25-bf83-ae68985c7e90'

describe('memory cursor policy', () => {
  test('round-trips the signed family, filters, snapshot, and keyset boundary', () => {
    const cursor = encodeMemoryCursor({
      familyId,
      filters: { childId: null, kind: 'note' },
      snapshotWatermark: '42',
      before: { occurredAt: '2026-09-08T10:00:00.000Z', id: '018f01d8-0c2a-7c25-bf83-ae68985c7e92' },
      expiresAt: '2026-09-09T10:15:00.000Z',
    }, secret)

    const claims = decodeMemoryCursor(cursor, secret, new Date('2026-09-09T10:10:00.000Z'))

    expect(claims.familyId).toBe(familyId)
    expect(claims.filters).toEqual({ childId: null, kind: 'note' })
    expect(claims.snapshotWatermark).toBe('42')
  })

  test('fails closed for tampering, expiry, and family or filter mismatches', () => {
    const cursor = encodeMemoryCursor({
      familyId,
      filters: { childId: null, kind: 'note' },
      snapshotWatermark: '42',
      before: { occurredAt: '2026-09-08T10:00:00.000Z', id: '018f01d8-0c2a-7c25-bf83-ae68985c7e92' },
      expiresAt: '2026-09-09T10:15:00.000Z',
    }, secret)

    expect(() => decodeMemoryCursor(`${cursor}x`, secret, new Date('2026-09-09T10:10:00.000Z'))).toThrow()
    expect(() => decodeMemoryCursor(cursor, secret, new Date('2026-09-09T10:15:00.000Z'))).toThrow()
    const claims = decodeMemoryCursor(cursor, secret, new Date('2026-09-09T10:10:00.000Z'))
    expect(() => validateMemoryCursorContext(claims, {
      familyId: '018f01d8-0c2a-7c25-bf83-ae68985c7e93',
      filters: { childId: null, kind: 'note' },
    })).toThrow()
    expect(() => validateMemoryCursorContext(claims, {
      familyId,
      filters: { childId: null, kind: 'voice' },
    })).toThrow()
  })

  test('unread cursor has a separate signature and binds current user, family, filters and epoch', () => {
    const userId = '018f01d8-0c2a-7c25-bf83-ae68985c7e94'
    const input = { familyId, userId, filters: { childId: null, kind: 'note' as const },
      snapshotPublicationOrdinal: '14', baselineOrdinal: '4', orderVersion: '0', membershipEpoch: 2,
      before: { occurredAt: '2026-09-08T10:00:00.000Z', id: '018f01d8-0c2a-7c25-bf83-ae68985c7e92' },
      expiresAt: '2026-09-09T10:15:00.000Z' }
    const encoded = encodeUnreadMemoryCursor(input, secret)
    const claims = decodeUnreadMemoryCursor(encoded, secret, new Date('2026-09-09T10:10:00.000Z'))
    expect(claims).toMatchObject({ version: 3, ...input })
    expect(() => decodeMemoryCursor(encoded, secret)).toThrow()
    expect(() => decodeUnreadMemoryCursor(`${encoded}x`, secret)).toThrow()
    expect(() => validateUnreadMemoryCursorContext(claims, { familyId, userId: 'other-user', filters: input.filters })).toThrow()
    expect(() => validateUnreadMemoryCursorContext(claims, { familyId: 'other-family', userId, filters: input.filters })).toThrow()
    expect(() => validateUnreadMemoryCursorContext(claims, { familyId, userId,
      filters: { childId: null, kind: 'voice' } })).toThrow()
  })
})
