import { afterEach, expect, spyOn, test } from 'bun:test'
import type { AuthenticatedTransport } from '../src/platform/api'
import { clearIdleFeedPosters, keepIdleFeedPoster, takeIdleFeedPoster } from '../src/platform/media/feed-poster-cache'

const transport = {} as AuthenticatedTransport

afterEach(() => {
  clearIdleFeedPosters()
})

test('idle video posters release the oldest URLs beyond the count or byte budget', () => {
  const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  try {
    for (const id of ['one', 'two', 'three', 'four']) {
      expect(keepIdleFeedPoster(id, transport, { url: id, size: 1_000 })).toBe(true)
    }
    expect(revoke.mock.calls).toEqual([['one']])

    expect(keepIdleFeedPoster('large', transport, { url: 'large', size: 8 * 1024 * 1024 })).toBe(true)
    expect(revoke.mock.calls).toEqual([['one'], ['two'], ['three'], ['four']])
    expect(takeIdleFeedPoster('large', transport)?.url).toBe('large')
    // Ownership moves to the caller, so clearing the idle cache does not revoke it.
    clearIdleFeedPosters()
    expect(revoke).toHaveBeenCalledTimes(4)
    expect(keepIdleFeedPoster('oversize', transport, { url: 'oversize', size: 9 * 1024 * 1024 })).toBe(false)
  } finally {
    revoke.mockRestore()
  }
})

test('an expired or differently authenticated poster cannot be taken over', () => {
  const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const clock = spyOn(Date, 'now').mockReturnValue(10_000)
  try {
    keepIdleFeedPoster('account-change', transport, { url: 'before-auth-change', size: 1_000 })
    expect(takeIdleFeedPoster('account-change', {} as AuthenticatedTransport)).toBeNull()
    keepIdleFeedPoster('timeout', transport, { url: 'expired', size: 1_000 })
    clock.mockReturnValue(20_001)
    expect(takeIdleFeedPoster('timeout', transport)).toBeNull()
    expect(revoke.mock.calls).toEqual([['before-auth-change'], ['expired']])
  } finally {
    clock.mockRestore()
    revoke.mockRestore()
  }
})
