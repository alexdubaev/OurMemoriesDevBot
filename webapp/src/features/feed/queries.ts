import type { MemoryDto, MemoryPage } from '@web-app-demo/contracts'
import { QueryClient, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import type { AuthenticatedTransport } from '@/platform/api'
import { sessionQueryKeys } from '@/features/auth'
import type { FeedFilter } from './presentation'
import { deleteMemory, loadFeed, setMemoryLike } from './api'

export const feedQueryKeys = {
  all: [...sessionQueryKeys.all, 'feed'] as const,
  list: (familyId: string, filter: FeedFilter) => [...feedQueryKeys.all, familyId, filter] as const,
}

export function useFeedQuery(transport: AuthenticatedTransport, familyId: string, filter: FeedFilter) {
  return useInfiniteQuery({
    queryKey: feedQueryKeys.list(familyId, filter),
    queryFn: ({ pageParam, signal }) => loadFeed(transport, familyId, filter, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 20_000,
  })
}

export function useMemoryLike(transport: AuthenticatedTransport, familyId: string, filter: FeedFilter) {
  const client = useQueryClient()
  const key = feedQueryKeys.list(familyId, filter)
  return useMutation({
    mutationFn: ({ memoryId, liked }: { memoryId: string; liked: boolean }) => setMemoryLike(transport, familyId, memoryId, liked),
    onMutate: async ({ memoryId, liked }) => {
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData(key)
      client.setQueryData(key, (current: { pages: MemoryPage[]; pageParams: unknown[] } | undefined) => current && ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          items: page.items.map((memory) => memory.id !== memoryId ? memory : likedMemory(memory, liked)),
        })),
      }))
      return { previous }
    },
    onError: (_error, _input, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
}

type FeedCache = { pages: MemoryPage[]; pageParams: unknown[] }
type FeedSnapshot = Array<[readonly unknown[], FeedCache | undefined]>

export function useMemoryDelete(
  transport: AuthenticatedTransport,
  familyId: string,
  onFailure: () => void,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ memoryId, version }: { memoryId: string; version: number }) =>
      deleteMemory(transport, familyId, memoryId, version),
    onMutate: async ({ memoryId }) => {
      await client.cancelQueries({ queryKey: [...feedQueryKeys.all, familyId] })
      return removeMemoryFromCachedFeeds(client, familyId, memoryId)
    },
    onError: (_error, _input, snapshot) => {
      restoreMemoryFeedSnapshots(client, snapshot)
      onFailure()
    },
  })
}

export function removeMemoryFromCachedFeeds(queryClient: QueryClient, familyId: string, memoryId: string): FeedSnapshot {
  const matches = queryClient.getQueriesData<FeedCache>({ queryKey: [...feedQueryKeys.all, familyId] })
  for (const [key, current] of matches) {
    if (!current) continue
    queryClient.setQueryData<FeedCache>(key, {
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        items: page.items.filter((memory) => memory.id !== memoryId),
      })),
    })
  }
  return matches
}

function restoreMemoryFeedSnapshots(queryClient: QueryClient, snapshots: FeedSnapshot | undefined) {
  for (const [key, value] of snapshots ?? []) queryClient.setQueryData(key, value)
}

function likedMemory(memory: MemoryDto, liked: boolean): MemoryDto {
  const prior = memory.likes.likedByMe
  return { ...memory, likes: { likedByMe: liked, count: Math.max(0, memory.likes.count + (liked === prior ? 0 : liked ? 1 : -1)) } }
}
