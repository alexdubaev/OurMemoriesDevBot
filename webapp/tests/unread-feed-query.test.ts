import { expect, test } from 'bun:test'
import { feedQueryKeys } from '../src/features/feed/queries'
import { loadFeed } from '../src/features/feed/api'
import type { AuthenticatedTransport } from '../src/platform/api'

test('normal and unread feed keep family, account, filter, epoch and cursor context distinct', async () => {
  const normal = feedQueryKeys.list('family-a', 'all', false, 'account-a', 2, 0)
  const unread = feedQueryKeys.list('family-a', 'all', true, 'account-a', 2, 1)
  expect(normal).not.toEqual(unread)
  expect(unread).not.toEqual(feedQueryKeys.list('family-b', 'all', true, 'account-a', 2, 1))
  expect(unread).not.toEqual(feedQueryKeys.list('family-a', 'photo', true, 'account-a', 2, 1))
  expect(unread).not.toEqual(feedQueryKeys.list('family-a', 'all', true, 'account-b', 2, 1))
  expect(unread).not.toEqual(feedQueryKeys.list('family-a', 'all', true, 'account-a', 3, 1))
  expect(unread).not.toEqual(feedQueryKeys.list('family-a', 'all', true, 'account-a', 2, 2))

  const paths: string[] = []
  const transport = { request: async (path: string) => {
    paths.push(path)
    return { items: [], nextCursor: null }
  } } as unknown as AuthenticatedTransport
  await loadFeed(transport, 'family-a', 'photo', 'unread-cursor', undefined, true)
  await loadFeed(transport, 'family-a', 'photo', 'normal-cursor')
  expect(paths).toEqual([
    '/api/v1/families/family-a/memories?limit=20&kind=photo&cursor=unread-cursor&unreadOnly=true',
    '/api/v1/families/family-a/memories?limit=20&kind=photo&cursor=normal-cursor',
  ])
})
