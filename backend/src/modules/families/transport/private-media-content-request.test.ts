import { describe, expect, test } from 'bun:test'

import { bypassesFamilyBearerAuth } from './private-media-content-request'

describe('bypassesFamilyBearerAuth', () => {
  const contentPath = '/api/v1/families/4aa5bd66-5d6f-4a64-a07a-f5d6336a93e3/media/154117f2-e6d0-43b1-a61f-6db610c39ef5/content'
  const maxVideoContentPath = '/api/v1/families/4aa5bd66-5d6f-4a64-a07a-f5d6336a93e3/media/max-videos/254117f2-e6d0-43b1-a61f-6db610c39ef5/content'
  const avatarContentPath = '/api/v1/families/4aa5bd66-5d6f-4a64-a07a-f5d6336a93e3/media/avatars/254117f2-e6d0-43b1-a61f-6db610c39ef5/354117f2-e6d0-43b1-a61f-6db610c39ef5/content'

  test('skips the outer Bearer guard only for GET and HEAD private-media content', () => {
    expect(bypassesFamilyBearerAuth('GET', contentPath)).toBe(true)
    expect(bypassesFamilyBearerAuth('HEAD', `${contentPath}?variant=playback`)).toBe(true)
    expect(bypassesFamilyBearerAuth('GET', maxVideoContentPath)).toBe(true)
    expect(bypassesFamilyBearerAuth('HEAD', maxVideoContentPath)).toBe(true)
    expect(bypassesFamilyBearerAuth('GET', avatarContentPath)).toBe(true)
    expect(bypassesFamilyBearerAuth('HEAD', avatarContentPath)).toBe(true)
  })

  test('does not skip the outer Bearer guard for other methods or family routes', () => {
    expect(bypassesFamilyBearerAuth('POST', contentPath)).toBe(false)
    expect(bypassesFamilyBearerAuth('GET', contentPath.replace('/content', '/playback-session'))).toBe(false)
    expect(bypassesFamilyBearerAuth('GET', '/api/v1/families/4aa5bd66-5d6f-4a64-a07a-f5d6336a93e3/members')).toBe(false)
    expect(bypassesFamilyBearerAuth('POST', avatarContentPath)).toBe(false)
    expect(bypassesFamilyBearerAuth('GET', `${avatarContentPath}/extra`)).toBe(false)
  })
})
