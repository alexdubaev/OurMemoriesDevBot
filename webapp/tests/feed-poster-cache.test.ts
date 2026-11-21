import { afterEach, expect, spyOn, test } from 'bun:test'
import type { AuthenticatedTransport } from '../src/platform/api'
import { clearIdleFeedPosters, idleAlbumPreviews, idleFeedPhotos, keepIdleFeedPoster, takeIdleFeedPoster } from '../src/platform/media/feed-poster-cache'
import '../src/platform/media/use-private-image-url'
import { PRIVATE_CACHE_MAX_IMAGE_BYTES, activatePrivateCacheIdentity, allowPrivateFamilyCache } from '../src/platform/persistence/private-cache'

const transport = {} as AuthenticatedTransport
const MB = 1024 * 1024

afterEach(() => {
  clearIdleFeedPosters()
  idleFeedPhotos.clear()
  idleAlbumPreviews.clear()
})

test('idle video posters release the oldest URLs beyond the count or byte budget', () => {
  const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  try {
    for (let index = 0; index < 25; index += 1) {
      expect(keepIdleFeedPoster(`p${index}`, transport, { url: `p${index}`, size: 1_000 })).toBe(true)
    }
    expect(revoke.mock.calls).toEqual([['p0']])
    clearIdleFeedPosters()
    revoke.mockClear()

    // Nine 2 MB posters exceed the 16 MB budget: the oldest leave until the rest fit.
    for (let index = 0; index < 9; index += 1) {
      expect(keepIdleFeedPoster(`large${index}`, transport, { url: `large${index}`, size: 2 * MB })).toBe(true)
    }
    expect(revoke.mock.calls).toEqual([['large0']])
    expect(takeIdleFeedPoster('large8', transport)?.url).toBe('large8')
    // Ownership moves to the caller, so clearing the idle cache does not revoke it.
    clearIdleFeedPosters()
    expect(revoke.mock.calls.map(([url]) => url)).not.toContain('large8')
    expect(revoke).toHaveBeenCalledTimes(8)
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
    clock.mockReturnValue(10_000 + 180_001)
    expect(takeIdleFeedPoster('timeout', transport)).toBeNull()
    expect(revoke.mock.calls).toEqual([['before-auth-change'], ['expired']])
  } finally {
    clock.mockRestore()
    revoke.mockRestore()
  }
})

test('the feed photo budget counts blob bytes and holds 60 display-size photos', () => {
  const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  try {
    // A display-size photo is ~250 KB compressed; its decoded pixels are not held by a blob URL.
    for (let index = 0; index < 60; index += 1) {
      expect(idleFeedPhotos.keep(`photo${index}`, transport, { url: `photo${index}`, size: 250 * 1024 })).toBe(true)
    }
    expect(revoke).not.toHaveBeenCalled()
    expect(idleFeedPhotos.take('photo0', transport)?.url).toBe('photo0')
    expect(idleFeedPhotos.take('photo59', transport)?.url).toBe('photo59')

    // The budget is 24 MB of blob bytes: 13 photos of 2 MB leave the oldest one out.
    idleFeedPhotos.clear()
    revoke.mockClear()
    for (let index = 0; index < 13; index += 1) {
      expect(idleFeedPhotos.keep(`big${index}`, transport, { url: `big${index}`, size: 2 * MB })).toBe(true)
    }
    expect(revoke.mock.calls).toEqual([['big0']])
  } finally {
    revoke.mockRestore()
  }
})

test('the feed photo pool keeps at most 60 photos', () => {
  const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  try {
    for (let index = 0; index < 61; index += 1) idleFeedPhotos.keep(`photo${index}`, transport, { url: `photo${index}`, size: 1_000 })
    expect(revoke.mock.calls).toEqual([['photo0']])
  } finally {
    revoke.mockRestore()
  }
})

test('every idle pool refuses an image above the private cache image limit', () => {
  for (const pool of [idleFeedPhotos, idleAlbumPreviews]) {
    expect(pool.keep('too-large', transport, { url: 'too-large', size: PRIVATE_CACHE_MAX_IMAGE_BYTES + 1 })).toBe(false)
    expect(pool.keep('at-limit', transport, { url: 'at-limit', size: PRIVATE_CACHE_MAX_IMAGE_BYTES })).toBe(true)
  }
  expect(keepIdleFeedPoster('too-large', transport, { url: 'too-large', size: PRIVATE_CACHE_MAX_IMAGE_BYTES + 1 })).toBe(false)
})

test('a family switch or a new identity revokes pooled feed photos and album previews', () => {
  const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const familyId = '11111111-1111-4111-8111-111111111111'
  const otherFamilyId = '55555555-5555-4555-8555-555555555555'
  const untouchedFamilyId = '66666666-6666-4666-8666-666666666666'
  const key = (family: string, path: string) => JSON.stringify(['pool-user', family, 1, 0, 'scope', path])
  try {
    activatePrivateCacheIdentity('pool-user')
    allowPrivateFamilyCache('pool-user', familyId, 1)
    idleFeedPhotos.keep(key(familyId, 'photo'), transport, { url: 'family-photo', size: 1_000 })
    idleAlbumPreviews.keep(key(familyId, 'preview'), transport, { url: 'family-preview', size: 1_000 })
    idleFeedPhotos.keep(key(untouchedFamilyId, 'photo'), transport, { url: 'other-photo', size: 1_000 })
    idleAlbumPreviews.keep(key(untouchedFamilyId, 'preview'), transport, { url: 'other-preview', size: 1_000 })

    allowPrivateFamilyCache('pool-user', otherFamilyId, 1)
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(['family-photo', 'family-preview'])

    activatePrivateCacheIdentity(null)
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(['family-photo', 'family-preview', 'other-photo', 'other-preview'])
  } finally {
    activatePrivateCacheIdentity(null)
    revoke.mockRestore()
  }
})
