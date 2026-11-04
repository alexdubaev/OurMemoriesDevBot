import { commentBodySchema, type CommentDto, type CommentSummary } from '@web-app-demo/contracts'
import type { InfiniteData } from '@tanstack/react-query'


type MemberCommentScope = { familyId: string; accountId: string; membershipEpoch: number }
export type MemoryCommentScope = MemberCommentScope & { target?: 'memory'; memoryId: string }
export type AlbumCommentScope = MemberCommentScope & { target: 'albumEntry'; albumId: string; entryId: string; discussionGeneration: number }
export type CommentScope = MemoryCommentScope | AlbumCommentScope
// The panel renders common fields; each API keeps its own strict target identity.
export type DiscussionComment = Omit<CommentDto, 'memoryId'>
export type DiscussionSummary = Omit<CommentSummary, 'memoryId'>
export type DiscussionPage = { items: DiscussionComment[]; nextCursor: string | null; summary: DiscussionSummary }
export function commentTargetKey(scope: CommentScope) {
  return scope.target === 'albumEntry' ? `albumEntry:${scope.albumId}:${scope.entryId}:${scope.discussionGeneration}` : `memory:${scope.memoryId}`
}
export function commentScopeKey(scope: CommentScope) { return `${scope.accountId}:${scope.familyId}:${scope.membershipEpoch}:${commentTargetKey(scope)}` }

export type CommentCreateAttempt = Readonly<{
  body: string
  idempotencyKey: string
}>

export const COMMENT_ACTIVE_REFRESH_MS = 30_000
export const COMMENT_IDLE_REFRESH_MS = 60_000
export const COMMENT_IDLE_AFTER_MS = 120_000
const COMMENT_RETRY_BASE_MS = 5_000
const COMMENT_RETRY_MAX_MS = 5 * 60_000

export function commentRetryDelay(failureCount: number, retryAfterMs?: number) {
  const exponent = Math.max(0, Math.min(8, failureCount - 1))
  const backoff = Math.min(COMMENT_RETRY_MAX_MS, COMMENT_RETRY_BASE_MS * 2 ** exponent)
  return Math.max(backoff, retryAfterMs ?? 0)
}

export function commentRetryReady(now: number, retryAt: number, retryAfterAt: number, force: boolean) {
  return now >= retryAfterAt && (force || now >= retryAt)
}

export function normalizeCommentBody(body: string) {
  return commentBodySchema.parse(body)
}

export function createCommentAttempt(body: string, idempotencyKey: string = crypto.randomUUID()): CommentCreateAttempt {
  return Object.freeze({ body: normalizeCommentBody(body), idempotencyKey })
}

export function isCurrentCommentScope(expected: CommentScope, current: CommentScope | null, mounted: boolean) {
  return mounted && current !== null && expected.familyId === current.familyId && expected.accountId === current.accountId &&
    expected.membershipEpoch === current.membershipEpoch && commentTargetKey(expected) === commentTargetKey(current)
}

export function isCurrentCommentRead(expectedRevision: number, currentRevision: number, mutationPaused: boolean, scopeIsCurrent: boolean) {
  return !mutationPaused && scopeIsCurrent && expectedRevision === currentRevision
}

export function mergeCommentPages(pages: readonly DiscussionComment[][]) {
  const unique = new Map<string, DiscussionComment>()
  for (const page of pages) for (const item of page) {
    const existing = unique.get(item.id)
    if (!existing || item.version >= existing.version) unique.set(item.id, item)
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
}

export function compareCommentPosition(left: Pick<DiscussionComment, 'createdAt' | 'id'>, right: Pick<DiscussionComment, 'createdAt' | 'id'>) {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)
}

/**
 * Replace the latest authoritative range with pages fetched from the head through its
 * overlap boundary. Preserve every remaining older server window and its real cursor.
 */
export function reconcileLatestCommentPages(
  existing: InfiniteData<DiscussionPage, string | null> | undefined,
  refreshedPages: DiscussionPage[],
  refreshedPageParams: Array<string | null>,
): InfiniteData<DiscussionPage, string | null> {
  if (refreshedPages.length === 0) return existing ?? { pages: [], pageParams: [] }
  if (!existing || existing.pages.length === 0) return { pages: refreshedPages, pageParams: refreshedPageParams }

  const refreshedOldest = refreshedPages.at(-1)!.items.at(-1)
  if (!refreshedOldest) return { pages: refreshedPages, pageParams: refreshedPageParams }
  const pages = [...refreshedPages]
  const pageParams: Array<string | null> = [...refreshedPageParams]
  const refreshedIds = new Set(refreshedPages.flatMap((page) => page.items.map((item) => item.id)))
  const continuation = refreshedPages.at(-1)!.nextCursor
  let firstTail = true
  if (continuation) existing.pages.forEach((page, index) => {
    const items = page.items.filter((item) => compareCommentPosition(item, refreshedOldest) < 0 && !refreshedIds.has(item.id))
    if (items.length === 0) return
    pages.push({ ...page, items, summary: refreshedPages[0]!.summary })
    pageParams.push(firstTail ? continuation : existing.pageParams[index] ?? null)
    firstTail = false
  })
  return { pages, pageParams }
}

/** Replace one server-cursor window without flattening its older cached windows. */
export function reconcileCommentWindow(
  existing: InfiniteData<DiscussionPage, string | null>,
  page: DiscussionPage,
  pageParam: string | null,
  upperBoundary: DiscussionComment | null,
): InfiniteData<DiscussionPage, string | null> {
  const pageIndex = existing.pageParams.findIndex((param) => param === pageParam)
  if (pageIndex < 0) return existing
  const prefix = existing.pages.slice(0, pageIndex)
  const prefixIds = new Set(prefix.flatMap((part) => part.items.map((item) => item.id)))
  const withinUpper = (item: DiscussionComment) => !upperBoundary || compareCommentPosition(item, upperBoundary) < 0
  const authoritative = page.items.filter((item) => withinUpper(item) && !prefixIds.has(item.id))
  const refreshedOldest = authoritative.at(-1)
  const pages = [...prefix, { ...page, items: authoritative }]
  const pageParams = [...existing.pageParams.slice(0, pageIndex), pageParam]

  // A null continuation means the refreshed window now covers the entire remainder.
  if (page.nextCursor !== null && refreshedOldest) {
    for (let index = pageIndex + 1; index < existing.pages.length; index += 1) {
      const oldPage = existing.pages[index]!
      const items = oldPage.items.filter((item) => compareCommentPosition(item, refreshedOldest) < 0)
      if (items.length === 0) continue
      pages.push({ ...oldPage, items, summary: page.summary })
      pageParams.push(index === pageIndex + 1 ? page.nextCursor : existing.pageParams[index] ?? null)
    }
  }
  return { pages, pageParams }
}
