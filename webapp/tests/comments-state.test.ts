import { describe, expect, it } from 'bun:test'

import { createCommentAttempt, mergeCommentPages, normalizeCommentBody } from '../src/features/comments/state'
import type { CommentDto } from '@web-app-demo/contracts'

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
})
