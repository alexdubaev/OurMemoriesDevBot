import { CancelledError, useInfiniteQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ApiRequestError } from '@/platform/api'
import type { InfiniteData } from '@tanstack/react-query'
import type { CommentDto, CommentPage } from '@web-app-demo/contracts'
import type { AuthenticatedTransport } from '@/platform/api'
import { privateCacheIdentityGeneration, privateFamilyCacheGeneration, isActivePrivateCacheIdentity } from '@/platform/persistence/private-cache'
import { loadCommentSummaries, loadComments } from './api'
import type { CommentScope } from './state'
import { commentRetryDelay, commentRetryReady, compareCommentPosition, isCurrentCommentRead, reconcileCommentWindow, reconcileLatestCommentPages } from './state'

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

export function useCommentsList(transport: AuthenticatedTransport, scope: CommentScope, enabled: boolean, lease: { current: boolean }, beforeWrite?: () => void) {
  const identity = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(scope.accountId, scope.familyId)
  const client = useQueryClient()
  const key = useMemo(() => commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), [scope.accountId, scope.familyId, scope.memoryId, scope.membershipEpoch])
  const list = useInfiniteQuery<CommentPage, Error, InfiniteData<CommentPage>, ReturnType<typeof commentsQueryKeys.list>, string | null>({
    queryKey: key,
    enabled: false,
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async () => { throw new CancelledError() },
  })

  const [readError, setReadError] = useState<Error | null>(null)
  const [, setReadPending] = useState(false)
  const [fetchingOlder, setFetchingOlder] = useState(false)
  const mutationPaused = useRef(false)
  const revision = useRef(0)
  const activeController = useRef<AbortController | null>(null)
  const activeReadKind = useRef<'refresh' | 'older' | null>(null)
  const activeReadRevision = useRef(-1)
  const queue = useRef<{ running: Promise<void> | null; refresh: boolean; forceRefresh: boolean; olderRequested: boolean; olderCursor?: string | null }>(
    { running: null, refresh: false, forceRefresh: false, olderRequested: false },
  )
  const failureCount = useRef(0)
  const [retryAt, setRetryAt] = useState(0)
  const retryAtRef = useRef(0)
  const retryAfterAt = useRef(0)
  const upperBoundaries = useRef(new Map<string, CommentDto | null>())
  const scopeKey = `${scope.familyId}\u0000${scope.accountId}\u0000${scope.membershipEpoch}\u0000${scope.memoryId}`
  const currentScopeKey = useRef(scopeKey)
  const canReadNow = useCallback(() => typeof document !== 'undefined' && typeof navigator !== 'undefined' && !document.hidden && navigator.onLine, [])

  const valid = useCallback((expectedRevision: number) => isCurrentCommentRead(expectedRevision, revision.current, mutationPaused.current, lease.current && currentScopeKey.current === scopeKey &&
    revision.current === expectedRevision && isActivePrivateCacheIdentity(scope.accountId, identity) &&
    privateFamilyCacheGeneration(scope.accountId, scope.familyId) === familyGeneration), [familyGeneration, identity, lease, scope.accountId, scope.familyId, scopeKey])

  useLayoutEffect(() => {
    currentScopeKey.current = scopeKey
    upperBoundaries.current.clear()
    upperBoundaries.current.set('', null)
  }, [scopeKey])

  useEffect(() => {
    if (!list.data) return
    list.data.pageParams.forEach((rawPageParam, index) => {
      const pageParam = rawPageParam as string | null
      const token = pageParam ?? ''
      if (upperBoundaries.current.has(token)) return
      const upper = index === 0 ? null : list.data?.pages[index - 1]?.items.at(-1) ?? null
      upperBoundaries.current.set(token, upper)
    })
  }, [list.data])

  const perform = useCallback(async (kind: 'refresh' | 'older', cursor?: string | null) => {
    if (mutationPaused.current || !enabled || !lease.current || !canReadNow()) return
    const data = client.getQueryData<InfiniteData<CommentPage, string | null>>(key)
    if (kind === 'older' && (!data?.pages.length || (cursor === undefined && !data.pages.at(-1)?.nextCursor))) return
    const before = data?.pages[0]?.items[0] ?? null
    const expectedRevision = ++revision.current
    const controller = new AbortController()
    activeController.current = controller
    activeReadKind.current = kind
    activeReadRevision.current = expectedRevision
    setReadError(null)
    setReadPending(!data)
    setFetchingOlder(kind === 'older')
    await client.cancelQueries({ queryKey: key, exact: true })
    try {
      if (kind === 'refresh') {
        let nextCursor: string | null = null
        let previousUpper: CommentDto | null = null
        const pages: CommentPage[] = []
        const params: Array<string | null> = []
        let reachedBoundary = before === null
        while (true) {
          let chunk = 0
          while (chunk < 10) {
            if (!canReadNow()) throw new CancelledError()
            const pageParam = nextCursor
            const upperForPage = pageParam === null ? null : previousUpper
            const page = await loadComments(transport, scope.familyId, scope.memoryId, pageParam, controller.signal)
            if (!valid(expectedRevision)) throw new CancelledError()
            if (pageParam !== null) upperBoundaries.current.set(pageParam, upperForPage)
            pages.push(page); params.push(pageParam)
            if (page.items.length > 0) {
              const upper = page.items.at(-1)!
              previousUpper = upper
              if (before && compareCommentPosition(upper, before) <= 0) reachedBoundary = true
            } else if (page.nextCursor === null) reachedBoundary = true
            nextCursor = page.nextCursor
            chunk += 1
            if (reachedBoundary || !nextCursor) break
          }
          if (reachedBoundary || !nextCursor) break
          // Yield between bounded bridge batches while retaining the verified cursor chain.
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          if (!valid(expectedRevision) || !canReadNow()) throw new CancelledError()
        }
        const reconciled = reconcileLatestCommentPages(data, pages, params)
        await cancelCommentSummaryQueries(client, scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
        if (!valid(expectedRevision)) throw new CancelledError()
        if (valid(expectedRevision)) {
          beforeWrite?.()
          client.setQueryData(key, reconciled)
          const authoritativeSummary = pages[0]?.summary
          if (authoritativeSummary) writeCommentSummary(client, scope.familyId, scope.accountId, scope.membershipEpoch, authoritativeSummary)
          reconciled.pageParams.forEach((rawParam, index) => {
            const param = rawParam ?? ''
            if (index < pages.length) {
              upperBoundaries.current.set(param, index === 0 ? null : pages[index - 1]?.items.at(-1) ?? null)
            } else if (index === pages.length) {
              upperBoundaries.current.set(param, pages.at(-1)?.items.at(-1) ?? null)
            } else if (!upperBoundaries.current.has(param)) {
              upperBoundaries.current.set(param, reconciled.pages[index - 1]?.items.at(-1) ?? null)
            }
          })
          failureCount.current = 0; retryAtRef.current = 0; retryAfterAt.current = 0; setRetryAt(0)
        }
      } else {
        if (!canReadNow()) throw new CancelledError()
        const current = client.getQueryData<InfiniteData<CommentPage, string | null>>(key)
        const next = cursor ?? current?.pages.at(-1)?.nextCursor ?? null
        if (!next || !current) return
        const requestedWindowIndex = cursor === undefined ? -1 : current.pageParams.findIndex((item) => item === cursor)
        if (cursor !== undefined && requestedWindowIndex < 0) return
        const page = await loadComments(transport, scope.familyId, scope.memoryId, next, controller.signal)
        if (!valid(expectedRevision)) throw new CancelledError()
        await cancelCommentSummaryQueries(client, scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
        if (!valid(expectedRevision)) throw new CancelledError()
        const pageIndex = current.pageParams.findIndex((item) => item === next)
        if (pageIndex < 0) {
          const ids = new Set(current.pages.flatMap((part) => part.items.map((item) => item.id)))
          const appended = { ...page, items: page.items.filter((item) => !ids.has(item.id)) }
          const boundary = current.pages.at(-1)?.items.at(-1) ?? null
          beforeWrite?.()
          client.setQueryData<InfiniteData<CommentPage, string | null>>(key, { pages: [...current.pages, appended], pageParams: [...current.pageParams, next] })
          writeCommentSummary(client, scope.familyId, scope.accountId, scope.membershipEpoch, page.summary)
          upperBoundaries.current.set(next, boundary)
          if (page.nextCursor && page.items.at(-1)) upperBoundaries.current.set(page.nextCursor, page.items.at(-1)!)
          failureCount.current = 0; retryAtRef.current = 0; retryAfterAt.current = 0; setRetryAt(0)
        } else {
          const upper = upperBoundaries.current.has(next)
            ? upperBoundaries.current.get(next) ?? null
            : current.pages[Math.max(0, pageIndex - 1)]?.items.at(-1) ?? null
          upperBoundaries.current.set(next, upper)
          const reconciled = reconcileCommentWindow(current, page, next, upper)
          beforeWrite?.(); client.setQueryData(key, reconciled)
          writeCommentSummary(client, scope.familyId, scope.accountId, scope.membershipEpoch, page.summary)
          if (page.nextCursor && page.items.at(-1)) upperBoundaries.current.set(page.nextCursor, page.items.at(-1)!)
          const resultIndex = reconciled.pageParams.findIndex((item) => item === next)
          for (let index = resultIndex + 2; index < reconciled.pageParams.length; index += 1) {
            const param = reconciled.pageParams[index]
            if (param !== null && !upperBoundaries.current.has(param)) upperBoundaries.current.set(param, reconciled.pages[index - 1]?.items.at(-1) ?? null)
          }
          failureCount.current = 0; retryAtRef.current = 0; retryAfterAt.current = 0; setRetryAt(0)
        }
      }
    } catch (cause) {
      if (!(cause instanceof CancelledError) && valid(expectedRevision)) {
        const failure = cause instanceof Error ? cause : new Error('Unable to load comments')
        failureCount.current += 1
        const now = Date.now()
        retryAtRef.current = now + commentRetryDelay(failureCount.current)
        if (failure instanceof ApiRequestError && failure.retryAfterMs !== undefined) retryAfterAt.current = Math.max(retryAfterAt.current, now + failure.retryAfterMs)
        setRetryAt(Math.max(retryAtRef.current, retryAfterAt.current))
        setReadError(failure)
      }
    } finally {
      if (activeController.current === controller) { activeController.current = null; activeReadKind.current = null; activeReadRevision.current = -1 }
      if (valid(expectedRevision)) { setReadPending(false); setFetchingOlder(false) }
    }
  }, [beforeWrite, canReadNow, client, enabled, key, lease, scope.accountId, scope.familyId, scope.membershipEpoch, scope.memoryId, transport, valid])

  const enqueue = useCallback((kind: 'refresh' | 'older', cursor?: string | null, force = false) => {
    if (kind === 'refresh' && activeReadKind.current === 'refresh' && activeReadRevision.current === revision.current && !queue.current.refresh) return queue.current.running ?? Promise.resolve()
    if (kind === 'refresh') { queue.current.refresh = true; queue.current.forceRefresh ||= force }
    else { queue.current.olderRequested = true; queue.current.olderCursor = cursor }
    if (queue.current.running) return queue.current.running
    const running = (async () => {
      while (queue.current.refresh || queue.current.olderRequested) {
        if (mutationPaused.current) { queue.current.refresh = false; queue.current.olderRequested = false; queue.current.olderCursor = undefined; break }
        const nextKind = queue.current.refresh ? 'refresh' : 'older'
        const nextCursor = nextKind === 'older' ? queue.current.olderCursor : undefined
        const forceRefresh = queue.current.forceRefresh
        if (nextKind === 'refresh') { queue.current.refresh = false; queue.current.forceRefresh = false }
        else { queue.current.olderRequested = false; queue.current.olderCursor = undefined }
        if (!commentRetryReady(Date.now(), retryAtRef.current, retryAfterAt.current, nextKind === 'refresh' && forceRefresh)) continue
        await perform(nextKind, nextCursor)
      }
    })()
    queue.current.running = running
    void running.finally(() => {
      if (queue.current.running !== running) return
      queue.current.running = null
      if (queue.current.refresh) void enqueue('refresh', undefined, queue.current.forceRefresh)
      else if (queue.current.olderRequested) void enqueue('older', queue.current.olderCursor)
    })
    return running
  }, [perform])

  const refreshCurrentWindow = useCallback((force = false) => enqueue('refresh', undefined, force), [enqueue])
  const loadOlder = useCallback(() => enqueue('older'), [enqueue])
  const refreshOlderWindow = useCallback((cursor: string | null) => enqueue('older', cursor), [enqueue])
  const suspendBackgroundReads = useCallback(() => {
    revision.current += 1
    activeController.current?.abort()
    queue.current.refresh = false; queue.current.forceRefresh = false; queue.current.olderRequested = false; queue.current.olderCursor = undefined
    setReadPending(false); setFetchingOlder(false)
    void client.cancelQueries({ queryKey: key, exact: true })
  }, [client, key])
  const beginMutation = useCallback(() => {
    mutationPaused.current = true
    revision.current += 1
    activeController.current?.abort()
    queue.current.refresh = false; queue.current.forceRefresh = false; queue.current.olderRequested = false; queue.current.olderCursor = undefined
    setReadPending(false); setFetchingOlder(false)
    void client.cancelQueries({ queryKey: key, exact: true })
  }, [client, key])
  const endMutation = useCallback(() => { mutationPaused.current = false }, [])

  useEffect(() => {
    return () => { activeController.current?.abort(); revision.current += 1 }
  }, [enabled])

    // A skipped read (for example because the tab opened offline or hidden) is
    // still unknown state. Do not let the panel mistake it for an empty list.
    return { ...list, data: list.data, error: readError ?? list.error, isPending: !list.data && !readError, isError: Boolean(readError), isFetchingNextPage: fetchingOlder, hasNextPage: Boolean(list.data?.pages.at(-1)?.nextCursor), retryAt, refreshCurrentWindow, refreshOlderWindow, loadOlder, beginMutation, endMutation, suspendBackgroundReads }
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
