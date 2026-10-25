import { expect, test } from 'bun:test'

import {
  decodeMemoryCursor,
  encodeMemoryCursor,
  MemoryCursorError,
  type MemoryCursorFilters,
  validateMemoryCursorContext,
} from './memory-cursor'

const secret = 'synthetic-cursor-secret'
const familyId = '11111111-1111-4111-8111-111111111111'
const base = {
  familyId, snapshotWatermark: '5', before: { id: familyId, occurredAt: '2026-09-08T10:00:00.000Z' },
  expiresAt: '2099-01-01T00:00:00.000Z',
}

test('a cursor issued before the untagged filter keeps working for the unfiltered feed only', () => {
  const legacyFilters = { childId: null, kind: null } as unknown as MemoryCursorFilters
  const decoded = decodeMemoryCursor(encodeMemoryCursor({ ...base, filters: legacyFilters }, secret), secret)
  expect(() => validateMemoryCursorContext(decoded, { familyId, filters: { childId: null, kind: null, untagged: false } })).not.toThrow()
  expect(() => validateMemoryCursorContext(decoded, { familyId, filters: { childId: null, kind: null, untagged: true } }))
    .toThrow(MemoryCursorError)
})

test('an untagged cursor cannot continue the unfiltered feed', () => {
  const cursor = encodeMemoryCursor({ ...base, filters: { childId: null, kind: null, untagged: true } }, secret)
  expect(() => validateMemoryCursorContext(decodeMemoryCursor(cursor, secret), {
    familyId, filters: { childId: null, kind: null, untagged: false },
  })).toThrow('Курсор не соответствует этому запросу')
})
