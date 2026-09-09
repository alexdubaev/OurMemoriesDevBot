import { describe, expect, test } from 'bun:test'

import {
  decodeMemoryCursor,
  encodeMemoryCursor,
  validateMemoryCursorContext,
} from './domain/memory-cursor'

const secret = '0123456789abcdef'.repeat(4)
const familyId = '018f01d8-0c2a-7c25-bf83-ae68985c7e90'

describe('memory cursor policy', () => {
  test('round-trips the signed family, filters, snapshot, and keyset boundary', () => {
    const cursor = encodeMemoryCursor({
      familyId,
      filters: { childId: null, kind: 'note' },
      snapshot: { occurredAt: '2026-09-09T10:00:00.000Z', id: '018f01d8-0c2a-7c25-bf83-ae68985c7e91' },
      before: { occurredAt: '2026-09-08T10:00:00.000Z', id: '018f01d8-0c2a-7c25-bf83-ae68985c7e92' },
      expiresAt: '2026-09-09T10:15:00.000Z',
    }, secret)

    const claims = decodeMemoryCursor(cursor, secret, new Date('2026-09-09T10:10:00.000Z'))

    expect(claims.familyId).toBe(familyId)
    expect(claims.filters).toEqual({ childId: null, kind: 'note' })
    expect(claims.snapshot.id).toBe('018f01d8-0c2a-7c25-bf83-ae68985c7e91')
  })

  test('fails closed for tampering, expiry, and family or filter mismatches', () => {
    const cursor = encodeMemoryCursor({
      familyId,
      filters: { childId: null, kind: 'note' },
      snapshot: { occurredAt: '2026-09-09T10:00:00.000Z', id: '018f01d8-0c2a-7c25-bf83-ae68985c7e91' },
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
})
