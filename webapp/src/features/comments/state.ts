import { commentBodySchema, type CommentDto } from '@web-app-demo/contracts'
import type { InfiniteData } from '@tanstack/react-query'
import type { CommentPage } from '@web-app-demo/contracts'

export type CommentScope = {
  familyId: string
  accountId: string
  membershipEpoch: number
  memoryId: string
}

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
    expected.membershipEpoch === current.membershipEpoch && expected.memoryId === current.memoryId
}

export function isCurrentCommentRead(expectedRevision: number, currentRevision: number, mutationPaused: boolean, scopeIsCurrent: boolean) {
  return !mutationPaused && scopeIsCurrent && expectedRevision === currentRevision
}

export function mergeCommentPages(pages: readonly CommentDto[][]) {
  const unique = new Map<string, CommentDto>()
  for (const page of pages) for (const item of page) {
    const existing = unique.get(item.id)
    if (!existing || item.version >= existing.version) unique.set(item.id, item)
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
}

export function compareCommentPosition(left: Pick<CommentDto, 'createdAt' | 'id'>, right: Pick<CommentDto, 'createdAt' | 'id'>) {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id)
}

/**
 * Replace the latest authoritative range with pages fetched from the head through its
 * overlap boundary. Preserve every remaining older server window and its real cursor.
 */
export function reconcileLatestCommentPages(
  existing: InfiniteData<CommentPage, string | null> | undefined,
  refreshedPages: CommentPage[],
  refreshedPageParams: Array<string | null>,
): InfiniteData<CommentPage, string | null> {
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
  existing: InfiniteData<CommentPage, string | null>,
  page: CommentPage,
  pageParam: string | null,
  upperBoundary: CommentDto | null,
): InfiniteData<CommentPage, string | null> {
  const pageIndex = existing.pageParams.findIndex((param) => param === pageParam)
  if (pageIndex < 0) return existing
  const prefix = existing.pages.slice(0, pageIndex)
  const prefixIds = new Set(prefix.flatMap((part) => part.items.map((item) => item.id)))
  const withinUpper = (item: CommentDto) => !upperBoundary || compareCommentPosition(item, upperBoundary) < 0
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
