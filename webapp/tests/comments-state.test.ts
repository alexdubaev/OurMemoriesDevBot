import { describe, expect, it } from 'bun:test'

import { commentRetryDelay, commentRetryReady, createCommentAttempt, isCurrentCommentRead, mergeCommentPages, normalizeCommentBody, reconcileCommentWindow, reconcileLatestCommentPages } from '../src/features/comments/state'
import type { CommentDto, CommentPage } from '@web-app-demo/contracts'
import type { InfiniteData } from '@tanstack/react-query'

const comment = (id: string, createdAt: string, version = 1, body = 'hi'): CommentDto => ({
  id, familyId: 'f', memoryId: 'm', author: { id: 'a', name: 'Alex', avatarPath: null, avatarCrop: null }, body,
  createdAt, updatedAt: createdAt, version, capabilities: { edit: false, delete: false },
})

describe('comments state', () => {
  it('normalizes line endings and outer whitespace with the shared schema', () => {
    expect(normalizeCommentBody('  one\r\ntwo  ')).toBe('one\ntwo')
    expect(() => normalizeCommentBody(' \n ')).toThrow()
    expect(() => normalizeCommentBody('x\0y')).toThrow()
  })

  it('keeps a retry attempt immutable and reuses its exact body and key', () => {
    const attempt = createCommentAttempt('  hello  ', 'attempt-1')
    expect(attempt).toEqual({ body: 'hello', idempotencyKey: 'attempt-1' })
    expect(Object.isFrozen(attempt)).toBe(true)
    expect(() => { (attempt as { body: string }).body = 'changed' }).toThrow()
    expect(attempt).toEqual({ body: 'hello', idempotencyKey: 'attempt-1' })
  })

  it('deduplicates pages by id and keeps the newest version in chronological order', () => {
    expect(mergeCommentPages([[comment('b', '2026-01-02T00:00:00Z')], [comment('a', '2026-01-01T00:00:00Z'), comment('b', '2026-01-02T00:00:00Z', 2, 'edited')]]))
      .toEqual([comment('a', '2026-01-01T00:00:00Z'), comment('b', '2026-01-02T00:00:00Z', 2, 'edited')])
  })

  it('bridges a multi-page burst before replacing the prefix and keeps the real older cursor', () => {
    const old = [comment('c', '2026-01-03T00:00:00Z'), comment('b', '2026-01-02T00:00:00Z'), comment('a', '2026-01-01T00:00:00Z')]
    const existing: InfiniteData<CommentPage, string | null> = {
      pages: [{ items: [old[0]!, old[1]!], nextCursor: 'older-a' }, { items: [old[2]!], nextCursor: null }],
      pageParams: [null, 'older-a'],
    }
    const fresh: CommentPage[] = [
      { items: [comment('n2', '2026-01-05T00:00:00Z'), comment('n1', '2026-01-04T00:00:00Z')], nextCursor: 'bridge-1' },
      { items: [old[0]!, old[1]!], nextCursor: 'bridge-2' },
    ]

    const result = reconcileLatestCommentPages(existing, fresh, [null, 'bridge-1'])
    expect(result.pages.flatMap((page) => page.items).map((item) => item.id)).toEqual(['n2', 'n1', 'c', 'b', 'a'])
    expect(result.pages.at(-1)?.nextCursor).toBeNull()
    expect(result.pageParams).toEqual([null, 'bridge-1', 'bridge-2'])
  })

  it('uses the authoritative prefix to remove deleted rows even when the total count is unchanged', () => {
    const existing: InfiniteData<CommentPage, string | null> = {
      pages: [{ items: [comment('new', '2026-01-03T00:00:00Z'), comment('deleted', '2026-01-02T00:00:00Z')], nextCursor: 'older' }],
      pageParams: [null],
    }
    const fresh: CommentPage[] = [{ items: [comment('new', '2026-01-03T00:00:00Z'), comment('other', '2026-01-01T00:00:00Z')], nextCursor: null }]

    expect(reconcileLatestCommentPages(existing, fresh, [null]).pages.flatMap((page) => page.items).map((item) => item.id)).toEqual(['new', 'other'])
  })

  it('accepts fresh author projection for the same stable id and version', () => {
    const original = comment('same', '2026-01-01T00:00:00Z')
    const refreshed = { ...original, author: { ...original.author, avatarPath: '/fresh-avatar.webp', avatarCrop: { x: 1, y: 2, width: 3, height: 4 } } }
    expect(mergeCommentPages([[original], [refreshed]])).toEqual([refreshed])
  })

  it('replaces only the refreshed older interval and keeps later server windows and cursors', () => {
    const boundary = comment('upper', '2026-01-06T00:00:00Z')
    const prefix = comment('prefix', '2026-01-07T00:00:00Z')
    const resultPage: CommentPage = {
      items: [comment('mid-new', '2026-01-05T00:00:00Z'), comment('mid-old', '2026-01-04T00:00:00Z')],
      nextCursor: 'cursor-new-tail',
    }
    const existing: InfiniteData<CommentPage, string | null> = {
      pages: [
        { items: [prefix, boundary], nextCursor: 'cursor-target' },
        { items: [comment('mid-deleted', '2026-01-05T12:00:00Z'), comment('oldest-mid', '2026-01-04T12:00:00Z')], nextCursor: 'cursor-second-tail' },
        { items: [comment('deep', '2026-01-03T00:00:00Z')], nextCursor: null },
      ],
      pageParams: [null, 'cursor-target', 'cursor-second-tail'],
    }

    const reconciled = reconcileCommentWindow(existing, resultPage, 'cursor-target', boundary)
    expect(reconciled.pages.map((page) => page.items.map((item) => item.id))).toEqual([
      ['prefix', 'upper'], ['mid-new', 'mid-old'], ['deep'],
    ])
    expect(reconciled.pageParams).toEqual([null, 'cursor-target', 'cursor-new-tail'])
    expect(reconciled.pages.at(-1)?.nextCursor).toBeNull()
  })

  it('removes the full older remainder when a refreshed window has no continuation', () => {
    const boundary = comment('upper', '2026-01-03T00:00:00Z')
    const existing: InfiniteData<CommentPage, string | null> = {
      pages: [
        { items: [boundary], nextCursor: 'cursor' },
        { items: [comment('stale', '2026-01-02T00:00:00Z')], nextCursor: 'cursor-2' },
        { items: [comment('deep', '2026-01-01T00:00:00Z')], nextCursor: null },
      ],
      pageParams: [null, 'cursor', 'cursor-2'],
    }
    const reconciled = reconcileCommentWindow(existing, { items: [comment('replacement', '2026-01-02T12:00:00Z')], nextCursor: null }, 'cursor', boundary)
    expect(reconciled.pages.flatMap((page) => page.items).map((item) => item.id)).toEqual(['upper', 'replacement'])
    expect(reconciled.pageParams).toEqual([null, 'cursor'])
  })

  it('uses bounded exponential backoff and treats Retry-After as a minimum', () => {
    expect(commentRetryDelay(1)).toBe(5_000)
    expect(commentRetryDelay(2, 20_000)).toBe(20_000)
    expect(commentRetryDelay(99, 600_000)).toBe(600_000)
    expect(commentRetryDelay(99)).toBe(5 * 60_000)
    expect(commentRetryReady(10_000, 20_000, 30_000, true)).toBe(false)
    expect(commentRetryReady(30_000, 20_000, 30_000, true)).toBe(true)
    expect(commentRetryReady(19_999, 20_000, 0, false)).toBe(false)
  })

  it('rejects stale reads as soon as a mutation advances the revision or pauses reads', () => {
    expect(isCurrentCommentRead(4, 5, false, true)).toBe(false)
    expect(isCurrentCommentRead(5, 5, true, true)).toBe(false)
    expect(isCurrentCommentRead(5, 5, false, true)).toBe(true)
  })
})
