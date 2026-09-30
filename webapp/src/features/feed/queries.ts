import type { MemoryDto, MemoryPage, MemoryReaction } from '@web-app-demo/contracts'
import { QueryClient, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import { toast } from 'sonner'

import type { AuthenticatedTransport } from '@/platform/api'
import { sessionQueryKeys } from '@/features/auth'
import type { FeedFilter } from './presentation'
import { deleteMemory, loadFeed, loadMemory, setMemoryReaction } from './api'
import { MemoryReactionQueue, reactionCountsAfterChange } from './reaction-queue'

export const feedQueryKeys = {
  all: [...sessionQueryKeys.all, 'feed'] as const,
  list: (familyId: string, filter: FeedFilter, unreadOnly = false, accountId = '', membershipEpoch = 0, cycle = 0) =>
    [...feedQueryKeys.all, familyId, filter, unreadOnly, accountId, membershipEpoch, cycle] as const,
}

export function useFeedQuery(transport: AuthenticatedTransport, familyId: string, filter: FeedFilter, unreadOnly = false, accountId = '', membershipEpoch = 0, cycle = 0) {
  return useInfiniteQuery({
    queryKey: feedQueryKeys.list(familyId, filter, unreadOnly, accountId, membershipEpoch, cycle),
    queryFn: ({ pageParam, signal }) => loadFeed(transport, familyId, filter, pageParam, signal, unreadOnly),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: unreadOnly ? Infinity : 20_000,
    refetchOnWindowFocus: !unreadOnly,
  })
}

export function useMemoryReaction(transport: AuthenticatedTransport, familyId: string, accountId = '', membershipEpoch = 0) {
  const client = useQueryClient()
  const queues = useRef(new Map<string, MemoryReactionQueue>())
  const revisions = useRef(new Map<string, number>())
  const apply = useCallback((memoryId: string, reaction: MemoryReaction | null, counts?: MemoryDto['reactionCounts'], confirmed?: MemoryReaction | null) => {
    const feeds = client.getQueriesData<FeedCache>({ queryKey: [...feedQueryKeys.all, familyId] }).filter(([key]) => matchesReactionFeedScope(key, familyId, accountId, membershipEpoch))
    for (const [key, feed] of feeds) {
      if (!feed) continue
      client.setQueryData<FeedCache>(key, updateReactionInFeed(feed, memoryId, reaction, counts, confirmed))
    }
  }, [accountId, client, familyId, membershipEpoch])
  const setReaction = useCallback((memoryId: string, reaction: MemoryReaction | null) => {
    const queueKey = `${familyId}:${accountId}:${membershipEpoch}:${memoryId}`
    const revision = (revisions.current.get(queueKey) ?? 0) + 1
    revisions.current.set(queueKey, revision)
    const feeds = client.getQueriesData<FeedCache>({ queryKey: [...feedQueryKeys.all, familyId] }).filter(([key]) => matchesReactionFeedScope(key, familyId, accountId, membershipEpoch))
    const memory = feeds
      .flatMap(([, feed]) => feed?.pages.flatMap((page) => page.items) ?? []).find((item) => item.id === memoryId)
    if (!memory) return
    let queue = queues.current.get(queueKey)
    if (!queue) {
      const predicate = (query: { queryKey: readonly unknown[] }) => matchesReactionFeedScope(query.queryKey, familyId, accountId, membershipEpoch)
      queue = new MemoryReactionQueue(
        memory.currentUserReaction,
        memory.reactionCounts,
        (next) => setMemoryReaction(transport, familyId, memoryId, next),
        (desired, counts, confirmed) => {
          void client.cancelQueries({ predicate })
          apply(memoryId, desired, counts, confirmed)
        },
        () => {
          toast.error('Не удалось сохранить реакцию')
          const failedRevision = revisions.current.get(queueKey)
          void loadMemory(transport, familyId, memoryId).then((authoritative) => {
            if (revisions.current.get(queueKey) !== failedRevision) return
            const feeds = client.getQueriesData<FeedCache>({ queryKey: [...feedQueryKeys.all, familyId] })
            const repaired = reconcileReactionCaches(feeds, familyId, accountId, membershipEpoch, memoryId, authoritative, failedRevision!, revisions.current.get(queueKey) ?? 0)
            for (const [key, cache] of repaired) client.setQueryData(key, cache)
          }).catch(() => undefined)
        },
      )
      queues.current.set(queueKey, queue)
      void client.cancelQueries({ predicate })
    }
    void queue.submit(reaction).finally(() => {
      if (queues.current.get(queueKey) === queue) queues.current.delete(queueKey)
    })
  }, [accountId, apply, client, familyId, membershipEpoch, transport])
  return { setReaction }
}

type FeedCache = { pages: MemoryPage[]; pageParams: unknown[] }
type FeedSnapshot = Array<[readonly unknown[], FeedCache | undefined]>

export function matchesReactionFeedScope(key: readonly unknown[], familyId: string, accountId: string, membershipEpoch: number) {
  return key[0] === 'session' && key[1] === 'feed' && key[2] === familyId && key[5] === accountId && key[6] === membershipEpoch
}

export function updateReactionInFeed(cache: FeedCache, memoryId: string, reaction: MemoryReaction | null, counts?: MemoryDto['reactionCounts'], confirmed?: MemoryReaction | null): FeedCache {
  return { ...cache, pages: cache.pages.map((page) => ({
    ...page,
    items: page.items.map((memory) => memory.id !== memoryId ? memory : reactionMemory(memory, reaction, counts, confirmed)),
  })) }
}

export function reconcileReactionCaches(
  entries: Array<[readonly unknown[], FeedCache | undefined]>,
  familyId: string,
  accountId: string,
  membershipEpoch: number,
  memoryId: string,
  authoritative: Pick<MemoryDto, 'reactionCounts' | 'currentUserReaction'>,
  failedRevision: number,
  currentRevision: number,
) {
  if (failedRevision !== currentRevision) return []
  return entries.flatMap(([key, cache]) => !cache || !matchesReactionFeedScope(key, familyId, accountId, membershipEpoch)
    ? []
    : [[key, { ...cache, pages: cache.pages.map((page) => ({
      ...page,
      items: page.items.map((memory) => memory.id !== memoryId ? memory : {
        ...memory,
        reactionCounts: authoritative.reactionCounts,
        currentUserReaction: authoritative.currentUserReaction,
        likes: { likedByMe: authoritative.currentUserReaction === 'heart', count: Object.values(authoritative.reactionCounts).reduce((total, count) => total + count, 0) },
      }),
    })) }]] as Array<[readonly unknown[], FeedCache]>)
}

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

function reactionMemory(memory: MemoryDto, reaction: MemoryReaction | null, counts?: MemoryDto['reactionCounts'], confirmed?: MemoryReaction | null): MemoryDto {
  if (counts && confirmed !== undefined) {
    const optimisticCounts = reactionCountsAfterChange(counts, confirmed, reaction)
    return { ...memory, reactionCounts: optimisticCounts, currentUserReaction: reaction, likes: { likedByMe: reaction === 'heart', count: Object.values(optimisticCounts).reduce((sum, count) => sum + count, 0) } }
  }
  const nextCounts = reactionCountsAfterChange(memory.reactionCounts, memory.currentUserReaction, reaction)
  return {
    ...memory,
    reactionCounts: nextCounts,
    currentUserReaction: reaction,
    likes: { likedByMe: reaction === 'heart', count: Object.values(nextCounts).reduce((sum, count) => sum + count, 0) },
  }
}
