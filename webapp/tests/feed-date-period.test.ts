import { expect, test } from 'bun:test'
import { feedDateBounds } from '../src/features/feed/date-period'

test('converts family civil periods to half-open UTC bounds across year rollover and DST', () => {
  expect(feedDateBounds({ mode: 'range', fromYear: 2024, fromMonth: 12, toYear: 2025, toMonth: 1 }, 'Europe/Moscow'))
    .toEqual({ occurredFrom: '2024-11-30T21:00:00.000Z', occurredBefore: '2025-01-31T21:00:00.000Z' })
  expect(feedDateBounds({ mode: 'day', date: '2026-03-29' }, 'Europe/Berlin'))
    .toEqual({ occurredFrom: '2026-03-28T23:00:00.000Z', occurredBefore: '2026-03-29T22:00:00.000Z' })
  expect(feedDateBounds({ mode: 'day', date: '2018-11-04' }, 'America/Sao_Paulo'))
    .toEqual({ occurredFrom: '2018-11-04T03:00:00.000Z', occurredBefore: '2018-11-05T02:00:00.000Z' })
})

test('rejects a reversed month range', () => {
  expect(() => feedDateBounds({ mode: 'range', fromYear: 2026, fromMonth: 2, toYear: 2026, toMonth: 1 }, 'UTC')).toThrow()
})
