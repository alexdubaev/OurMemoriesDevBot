import { expect, test } from 'bun:test'
import { shouldShowMonthSourceNavigation } from '../src/features/albums/model'

test('recovery pager stays reachable when available count is smaller than the first window', () => {
  expect(shouldShowMonthSourceNavigation({ sourceCount: 18, loadedCount: 24, nextCursor: 'signed-next-page', hasPrevious: false, retryable: false })).toBe(true)
})

test('recovery pager remains available for retry after a failed page request', () => {
  expect(shouldShowMonthSourceNavigation({ sourceCount: 18, loadedCount: 24, nextCursor: null, hasPrevious: false, retryable: true })).toBe(true)
})
