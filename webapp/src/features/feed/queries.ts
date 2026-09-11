import type { MemoryDto, MemoryPage } from '@web-app-demo/contracts'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import type { AuthenticatedTransport } from '@/platform/api'
import type { FeedFilter } from './components'
import { loadFeed, setMemoryLike } from './api'

export const feedQueryKeys = {
  all: ['feed'] as const,
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

function likedMemory(memory: MemoryDto, liked: boolean): MemoryDto {
  const prior = memory.likes.likedByMe
  return { ...memory, likes: { likedByMe: liked, count: Math.max(0, memory.likes.count + (liked === prior ? 0 : liked ? 1 : -1)) } }
}
