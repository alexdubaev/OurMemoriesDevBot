import { expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MemberAvatarImage } from '../src/features/avatar/member-avatar'
import { AvatarPhoto } from '../src/features/avatar/AvatarPhoto'
import { memberAvatarQueryKeys, memberAvatarQueryOptions, reconcileMemberAvatarCache } from '../src/features/avatar/member-avatar-query'
import type { AuthenticatedTransport } from '../src/platform/api'

const accountId = '11111111-1111-4111-8111-111111111111'
const path = '/api/v1/families/22222222-2222-4222-8222-222222222222/media/avatars/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/content'

test('member avatar byte requests are shared by path within one session and separated by account', async () => {
  const client = new QueryClient()
  let requests = 0
  const transport = { raw: async () => { requests += 1; return new Response(new Blob(['image'], { type: 'image/png' })) } } as AuthenticatedTransport
  const options = memberAvatarQueryOptions(transport, accountId, path)
  const first = await Promise.all(Array.from({ length: 50 }, () => client.fetchQuery(options)))
  expect(requests).toBe(1)
  expect(first.every((blob) => blob === first[0])).toBe(true)
  expect(memberAvatarQueryKeys.path('other-account', path)).not.toEqual(options.queryKey)
  await client.fetchQuery(memberAvatarQueryOptions(transport, 'other-account', path))
  expect(requests).toBe(2)
})

test('member avatar has initials fallback when there is no image', () => {
  const html = renderToStaticMarkup(createElement(MemberAvatarImage, { avatarPath: null, className: 'family-member-avatar', name: 'Дмитрий' }))
  expect(html).toContain('family-member-avatar')
  expect(html).toContain('Д')
  expect(html).not.toContain('<img')
})

test('the canonical crop renderer applies identical normalized image bounds and leaves legacy null crops unchanged', () => {
  const crop = { x: 0.25, y: 0.1, width: 0.5, height: 0.8 }
  const current = renderToStaticMarkup(createElement(AvatarPhoto, { src: '/avatar', crop, className: 'avatar' }))
  const legacy = renderToStaticMarkup(createElement(AvatarPhoto, { src: '/avatar', crop: null, className: 'avatar' }))
  expect(current).toContain('width:200%;height:125%;left:-50%;top:-12.5%')
  expect(current).toContain('object-fit:fill')
  expect(legacy).not.toContain('width:200%')
  expect(legacy).toContain('object-cover')
})

test('avatar mutation discards old bytes and invalidates feed data for replacement or deletion', async () => {
  const client = new QueryClient()
  const feedKey = ['session', 'feed', 'family', 'all']
  client.setQueryData(memberAvatarQueryKeys.path(accountId, path), new Blob(['old']))
  client.setQueryData(feedKey, { pages: [{ items: [] }] })
  await reconcileMemberAvatarCache(client)
  expect(client.getQueryData(memberAvatarQueryKeys.path(accountId, path))).toBeUndefined()
  expect(client.getQueryState(feedKey)?.isInvalidated).toBe(true)
})
