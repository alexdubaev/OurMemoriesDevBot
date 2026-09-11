import { expect, test } from 'bun:test'

import { shouldCheckForNew, shouldRefreshInitialEmptyFeed } from '../src/features/feed/live-refresh'

test('an initially empty feed keeps checking for newly published memories', () => {
  expect(shouldCheckForNew({ checking: false, hidden: false })).toBe(true)
})

test('a newly found first memory refreshes an initially empty feed', () => {
  expect(shouldRefreshInitialEmptyFeed({ knownFirstId: null, latestFirstId: 'memory' })).toBe(true)
})
