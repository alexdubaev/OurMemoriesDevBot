import { describe, expect, it } from 'bun:test'

import {
  activatePrivateCacheIdentity,
  eligiblePrivateImage,
  isActivePrivateCacheIdentity,
  isPersistableQueryKey,
  privateCacheIdentityGeneration,
} from '../src/platform/persistence/private-cache'

const familyId = '11111111-1111-4111-8111-111111111111'
const mediaId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const avatarId = '44444444-4444-4444-8444-444444444444'

describe('private cache boundaries', () => {
  it('accepts only same-origin image variants, member avatars and MAX posters', () => {
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`)).toEqual({
      familyId, key: `/api/v1/families/${familyId}/media/${mediaId}/content?variant=display`,
    })
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=original`)).toBeNull()
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=preview&download=1`)).toBeNull()
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/avatars/${memberId}/${avatarId}/content`)).toEqual({
      familyId, key: `/api/v1/families/${familyId}/media/avatars/${memberId}/${avatarId}/content`,
    })
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/max-videos/${mediaId}/poster`)).toEqual({
      familyId, key: `/api/v1/families/${familyId}/media/max-videos/${mediaId}/poster`,
    })
    expect(eligiblePrivateImage('https://cdn.example/private.jpg')).toBeNull()
    expect(eligiblePrivateImage(`/api/v1/families/${familyId}/media/max-videos/${mediaId}/content`)).toBeNull()
  })

  it('persists only explicit feed and presentation query shapes', () => {
    expect(isPersistableQueryKey(['session', 'persistent-ui', 'user-id'])).toBe(true)
    expect(isPersistableQueryKey(['session', 'feed', 'family-id', 'all', false, 'epoch', 'cursor', 'page'])).toBe(true)
    expect(isPersistableQueryKey(['session', 'feed', 'family-id', 'video', false, 'epoch', 'cursor', 'page'])).toBe(false)
    expect(isPersistableQueryKey(['session', 'member-avatar', 'user-id', 'avatar'])).toBe(false)
    expect(isPersistableQueryKey(['session', 'auth', 'me'])).toBe(false)
  })

  it('invalidates old work when the authenticated identity changes', () => {
    const previousGeneration = privateCacheIdentityGeneration()
    const generation = activatePrivateCacheIdentity('user-a')
    expect(generation).toBeGreaterThan(previousGeneration)
    expect(isActivePrivateCacheIdentity('user-a', generation)).toBe(true)
    activatePrivateCacheIdentity('user-b')
    expect(isActivePrivateCacheIdentity('user-a', generation)).toBe(false)
    expect(isActivePrivateCacheIdentity('user-b', generation)).toBe(false)
  })
})
