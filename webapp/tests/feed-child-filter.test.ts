import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type { AlbumDto, ChildDto, MemoryDto, MemoryPage } from '@web-app-demo/contracts'

import { childFilterChips, composerInitialChildIds, missingChildFilterId, normalizeChildFilter } from '../src/features/feed/child-filter'
import { ApiRequestError } from '../src/platform/api'
import { loadFeed } from '../src/features/feed/api'
import { childAlbumsQueryKey, missingChildAlbumTemplates, orderChildAlbums } from '../src/features/feed/child-albums'
import { feedQueryKeys, matchesReactionFeedScope, removeMemoryFromCachedFeeds, shouldRetryFeedQuery } from '../src/features/feed/queries'
import { isPersistableQueryKey, removePrivateFamilyQueries } from '../src/platform/persistence/private-cache'
import type { AuthenticatedTransport } from '../src/platform/api'
import type { HttpRequestOptions } from '../src/platform/api/http-client'

const familyId = '019c0000-0000-7000-8000-000000000001'
const accountId = '019c0000-0000-7000-8000-0000000000f1'
const crop = { x: 0, y: 0, width: 1, height: 1 }
const child = (id: string, name: string, birthDate: string): ChildDto => ({
  id, name, birthDate, sex: 'girl', avatarMediaId: null, avatarCrop: crop, version: 1, isComplete: true,
})
// Server order: oldest birth date first.
const lilya = child('019c0000-0000-7000-8000-0000000000a1', 'Лиля', '2021-02-03')
const misha = child('019c0000-0000-7000-8000-0000000000a2', 'Миша', '2023-04-05')
const removedChildId = '019c0000-0000-7000-8000-0000000000a9'

describe('child filter state', () => {
  test('keeps a child of this family, «Без отметки» and «Все»', () => {
    expect(normalizeChildFilter(misha.id, [lilya, misha])).toBe(misha.id)
    expect(normalizeChildFilter('untagged', [lilya, misha])).toBe('untagged')
    expect(normalizeChildFilter(null, [lilya, misha])).toBeNull()
  })

  test('an unknown or removed child falls back to «Все»', () => {
    expect(normalizeChildFilter(removedChildId, [lilya, misha])).toBeNull()
    expect(normalizeChildFilter(42, [lilya, misha])).toBeNull()
    expect(normalizeChildFilter(undefined, [lilya, misha])).toBeNull()
  })

  test('a one-child family never filters', () => {
    expect(normalizeChildFilter(lilya.id, [lilya])).toBeNull()
    expect(normalizeChildFilter('untagged', [lilya])).toBeNull()
  })

  test('«Без отметки» is dropped for a member who may not see it', () => {
    expect(normalizeChildFilter('untagged', [lilya, misha], { allowUntagged: false })).toBeNull()
  })
})

describe('a 404 on a filtered child', () => {
  const notFound = new ApiRequestError(404, 'NOT_FOUND', 'Профиль ребёнка не найден')

  test('names the removed child, so the page falls back to «Все» instead of leaving the family', () => {
    expect(missingChildFilterId(notFound, removedChildId)).toBe(removedChildId)
  })

  test('without a child filter, for «Без отметки» or another error it stays a loss of access', () => {
    expect(missingChildFilterId(notFound, null)).toBeNull()
    expect(missingChildFilterId(notFound, 'untagged')).toBeNull()
    expect(missingChildFilterId(new ApiRequestError(403, 'FORBIDDEN', 'Нет доступа'), misha.id)).toBeNull()
    expect(missingChildFilterId(new Error('network'), misha.id)).toBeNull()
  })
})

describe('child filter chips', () => {
  test('two children: «Все», then children in server order, then «Без отметки» when shown', () => {
    expect(childFilterChips([lilya, misha], true).map((chip) => chip.label)).toEqual(['Все', 'Лиля', 'Миша', 'Без отметки'])
    expect(childFilterChips([lilya, misha], true).map((chip) => chip.value)).toEqual([null, lilya.id, misha.id, 'untagged'])
  })

  test('«Без отметки» is absent when hidden', () => {
    expect(childFilterChips([lilya, misha], false).map((chip) => chip.label)).toEqual(['Все', 'Лиля', 'Миша'])
  })

  test('a one-child family has no chips', () => {
    expect(childFilterChips([lilya], true)).toEqual([])
  })
})

describe('composer preselection', () => {
  test('from a child filter that child is selected; from «Все» or «Без отметки» none', () => {
    expect(composerInitialChildIds(lilya.id, [lilya, misha])).toEqual([lilya.id])
    expect(composerInitialChildIds(null, [lilya, misha])).toEqual([])
    expect(composerInitialChildIds('untagged', [lilya, misha])).toEqual([])
    expect(composerInitialChildIds(removedChildId, [lilya, misha])).toEqual([])
  })
})

describe('feed list keys with a child filter', () => {
  test('the child filter is the last key element, so «Все» and a child have separate caches', () => {
    const all = feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, null)
    const lilyaKey = feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, lilya.id)
    expect(all.at(-1)).toBeNull()
    expect(lilyaKey.at(-1)).toBe(lilya.id)
    expect(all.slice(0, -1)).toEqual(lilyaKey.slice(0, -1))
    expect(feedQueryKeys.list(familyId, 'all')).toEqual(['session', 'feed', familyId, 'all', false, '', 0, 0, null])
  })

  test('only the unfiltered main feed is persisted', () => {
    expect(isPersistableQueryKey(feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, null))).toBe(true)
    expect(isPersistableQueryKey(feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, lilya.id))).toBe(false)
    expect(isPersistableQueryKey(feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, 'untagged'))).toBe(false)
    expect(isPersistableQueryKey(feedQueryKeys.list(familyId, 'all', true, accountId, 3, 1, null))).toBe(false)
  })

  test('reactions reach a filtered feed of the same account and membership', () => {
    expect(matchesReactionFeedScope(feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, lilya.id), familyId, accountId, 3)).toBe(true)
    expect(matchesReactionFeedScope(feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, 'untagged'), familyId, accountId, 3)).toBe(true)
    expect(matchesReactionFeedScope(feedQueryKeys.list(familyId, 'all', false, accountId, 4, 0, lilya.id), familyId, accountId, 3)).toBe(false)
  })

  test('a deleted memory leaves «Все» and every child feed', () => {
    const client = new QueryClient()
    const memory = { id: '019c0000-0000-7000-8000-0000000000c1' } as MemoryDto
    const other = { id: '019c0000-0000-7000-8000-0000000000c2' } as MemoryDto
    const page = (items: MemoryDto[]): MemoryPage => ({ items, nextCursor: null } as MemoryPage)
    const keys = [null, lilya.id, 'untagged'].map((filter) => feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, filter))
    for (const key of keys) client.setQueryData(key, { pages: [page([memory, other])], pageParams: [null] })
    removeMemoryFromCachedFeeds(client, familyId, memory.id)
    for (const key of keys) {
      expect(client.getQueryData<{ pages: MemoryPage[] }>(key)?.pages[0]?.items.map((item) => item.id)).toEqual([other.id])
    }
  })

  test('losing family access removes the filtered feeds too', async () => {
    const client = new QueryClient()
    const key = feedQueryKeys.list(familyId, 'all', false, accountId, 3, 0, misha.id)
    client.setQueryData(key, { pages: [], pageParams: [] })
    await removePrivateFamilyQueries(client, familyId)
    expect(client.getQueryData(key)).toBeUndefined()
  })
})

describe('feed request with a child filter', () => {
  function recordingTransport() {
    const calls: Array<{ path: string; options?: HttpRequestOptions }> = []
    const transport: AuthenticatedTransport = {
      request: async (path, schema, options) => { calls.push({ path, options }); return schema.parse({ items: [], nextCursor: null }) },
      raw: async () => new Response(null, { status: 204 }),
    }
    return { calls, transport }
  }
  const query = (path: string) => new URL(path, 'https://memoly.invalid').searchParams

  test('a child filter asks the server for that child and the child tags', async () => {
    const { calls, transport } = recordingTransport()
    await loadFeed(transport, familyId, 'all', null, undefined, false, lilya.id)
    expect(query(calls[0]!.path).get('childId')).toBe(lilya.id)
    expect(query(calls[0]!.path).has('untagged')).toBe(false)
    expect(new Headers(calls[0]!.options?.headers).get('X-Memoly-Children')).toBe('1')
  })

  test('«Без отметки» asks for untagged memories, «Все» sends neither filter', async () => {
    const { calls, transport } = recordingTransport()
    await loadFeed(transport, familyId, 'all', null, undefined, true, 'untagged')
    await loadFeed(transport, familyId, 'all', null)
    expect(query(calls[0]!.path).get('untagged')).toBe('true')
    expect(query(calls[0]!.path).get('unreadOnly')).toBe('true')
    expect(query(calls[0]!.path).has('childId')).toBe(false)
    expect(query(calls[1]!.path).has('childId')).toBe(false)
    expect(query(calls[1]!.path).has('untagged')).toBe(false)
  })
})

describe('feed query retries', () => {
  test('403 and 404 stop immediately while transient errors keep the existing retry limit', () => {
    expect(shouldRetryFeedQuery(0, new ApiRequestError(403, 'FORBIDDEN', 'Нет доступа'))).toBe(false)
    expect(shouldRetryFeedQuery(0, new ApiRequestError(404, 'NOT_FOUND', 'Не найдено'))).toBe(false)
    expect(shouldRetryFeedQuery(0, new Error('network'))).toBe(true)
    expect(shouldRetryFeedQuery(2, new Error('network'))).toBe(true)
    expect(shouldRetryFeedQuery(3, new Error('network'))).toBe(false)
  })
})

describe('child page albums', () => {
  const album = (kind: AlbumDto['kind'], createdAt: string) => ({ id: `${kind}-${createdAt}`, kind, createdAt } as AlbumDto)

  test('first year and workshop lead the strip, other albums follow oldest first', () => {
    const ordered = orderChildAlbums([album('events', '2026-03-01T00:00:00.000Z'), album('workshop', '2026-02-01T00:00:00.000Z'), album('events', '2026-01-01T00:00:00.000Z'), album('year', '2026-04-01T00:00:00.000Z')])
    expect(ordered.map((item) => item.id)).toEqual(['year-2026-04-01T00:00:00.000Z', 'workshop-2026-02-01T00:00:00.000Z', 'events-2026-01-01T00:00:00.000Z', 'events-2026-03-01T00:00:00.000Z'])
  })

  test('a Full member is invited to create the missing «Первые 12 месяцев» and «Мастерская»; a viewer is not', () => {
    expect(missingChildAlbumTemplates([], 'full').map((item) => item.title)).toEqual(['Первые 12 месяцев', 'Мастерская'])
    expect(missingChildAlbumTemplates([album('year', '2026-01-01T00:00:00.000Z')], 'full').map((item) => item.title)).toEqual(['Мастерская'])
    expect(missingChildAlbumTemplates([], 'viewer')).toEqual([])
  })

  test('losing family access removes the cached child albums', async () => {
    const client = new QueryClient()
    const key = childAlbumsQueryKey(familyId, accountId, 3, lilya.id)
    client.setQueryData(key, { items: [], nextCursor: null })
    await removePrivateFamilyQueries(client, familyId)
    expect(client.getQueryData(key)).toBeUndefined()
  })
})
