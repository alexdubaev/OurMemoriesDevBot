import { CancelledError, useInfiniteQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import type { InfiniteData } from '@tanstack/react-query'
import type { CommentPage } from '@web-app-demo/contracts'
import type { AuthenticatedTransport } from '@/platform/api'
import { privateCacheIdentityGeneration, privateFamilyCacheGeneration, isActivePrivateCacheIdentity } from '@/platform/persistence/private-cache'
import { loadCommentSummaries, loadComments } from './api'
import type { CommentScope } from './state'

export const commentsQueryKeys = {
  all: ['session', 'comments'] as const,
  summaries: (familyId: string, accountId: string, epoch: number, memoryIds: readonly string[]) => [...commentsQueryKeys.all, familyId, accountId, epoch, 'summaries', ...memoryIds] as const,
  list: (familyId: string, accountId: string, epoch: number, memoryId: string) => [...commentsQueryKeys.all, familyId, accountId, epoch, 'list', memoryId] as const,
}

export function useCommentSummaries(transport: AuthenticatedTransport, familyId: string, accountId: string, membershipEpoch: number, memoryIds: string[], active: boolean) {
  const client = useQueryClient()
  const activeRef = useRef(active)
  const scopeRef = useRef({ familyId, accountId, membershipEpoch })
  useLayoutEffect(() => {
    const previous = scopeRef.current
    if (previous.familyId !== familyId || previous.accountId !== accountId || previous.membershipEpoch !== membershipEpoch || !active) {
      removeCommentScopeQueries(client, previous.familyId, previous.accountId, previous.membershipEpoch)
    }
    activeRef.current = active
    scopeRef.current = { familyId, accountId, membershipEpoch }
    return () => {
      activeRef.current = false
      removeCommentScopeQueries(client, familyId, accountId, membershipEpoch)
    }
  }, [active, accountId, client, familyId, membershipEpoch])
  const groups: string[][] = []
  for (let index = 0; index < memoryIds.length; index += 50) groups.push(memoryIds.slice(index, index + 50))
  const queries = useQueries({ queries: groups.map((ids) => {
    const identity = privateCacheIdentityGeneration()
    const family = privateFamilyCacheGeneration(accountId, familyId)
    return {
      queryKey: commentsQueryKeys.summaries(familyId, accountId, membershipEpoch, ids),
      enabled: active && Boolean(accountId) && ids.length > 0,
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const summaries = await loadCommentSummaries(transport, familyId, ids, signal)
        const current = scopeRef.current
        if (!activeRef.current || current.familyId !== familyId || current.accountId !== accountId || current.membershipEpoch !== membershipEpoch ||
          !isActivePrivateCacheIdentity(accountId, identity) || privateFamilyCacheGeneration(accountId, familyId) !== family) throw new CancelledError()
        return summaries
      },
    }
  }) })
  const byMemory = new Map<string, number | undefined>()
  for (const query of queries) for (const summary of query.data ?? []) byMemory.set(summary.memoryId, summary.count)
  return byMemory
}

export function useCommentsList(transport: AuthenticatedTransport, scope: CommentScope, enabled: boolean, lease: { current: boolean }) {
  const identity = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(scope.accountId, scope.familyId)
  return useInfiniteQuery<CommentPage, Error, InfiniteData<CommentPage>, ReturnType<typeof commentsQueryKeys.list>, string | null>({
    queryKey: commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId),
    enabled,
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
    refetchOnWindowFocus: enabled,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const page = await loadComments(transport, scope.familyId, scope.memoryId, pageParam, signal)
      if (!lease.current || !isActivePrivateCacheIdentity(scope.accountId, identity) || privateFamilyCacheGeneration(scope.accountId, scope.familyId) !== familyGeneration) throw new CancelledError()
      return page
    },
  })
}

export function useInvalidateComments() {
  const client = useQueryClient()
  return (scope: CommentScope) => client.invalidateQueries({ queryKey: commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), exact: true })
}

export async function cancelCommentSummaryQueries(client: import('@tanstack/react-query').QueryClient, familyId: string, accountId: string, epoch: number, memoryId: string) {
  const prefix = [...commentsQueryKeys.all, familyId, accountId, epoch, 'summaries']
  const matching = client.getQueryCache().findAll({ queryKey: prefix }).filter((query) => query.queryKey.slice(6).includes(memoryId))
  await Promise.all(matching.map((query) => client.cancelQueries({ queryKey: query.queryKey, exact: true })))
}

export function writeCommentSummary(client: import('@tanstack/react-query').QueryClient, familyId: string, accountId: string, epoch: number, summary: import('@web-app-demo/contracts').CommentSummary) {
  const entries = client.getQueriesData<import('@web-app-demo/contracts').CommentSummary[]>({ queryKey: [...commentsQueryKeys.all, familyId, accountId, epoch, 'summaries'] })
  for (const [key, data] of entries) {
    if (!key.slice(6).includes(summary.memoryId)) continue
    client.setQueryData(key, (data ?? []).some((item) => item.memoryId === summary.memoryId)
      ? data!.map((item) => item.memoryId === summary.memoryId ? summary : item)
      : [...(data ?? []), summary])
  }
}

export function invalidateCommentSummaryForMemory(client: import('@tanstack/react-query').QueryClient, scope: CommentScope) {
  const queries = client.getQueryCache().findAll({ queryKey: [...commentsQueryKeys.all, scope.familyId, scope.accountId, scope.membershipEpoch, 'summaries'] })
  return Promise.all(queries.filter((query) => query.queryKey.slice(6).includes(scope.memoryId)).map((query) => client.invalidateQueries({ queryKey: query.queryKey, exact: true })))
}

export function removeCommentScopeQueries(client: import('@tanstack/react-query').QueryClient, familyId: string, accountId: string, epoch: number) {
  client.removeQueries({ predicate: ({ queryKey }) => queryKey[0] === 'session' && queryKey[1] === 'comments' &&
    queryKey[2] === familyId && queryKey[3] === accountId && queryKey[4] === epoch })
}
