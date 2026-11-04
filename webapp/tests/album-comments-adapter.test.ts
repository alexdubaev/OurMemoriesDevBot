import { describe, expect, it } from 'bun:test'
import { createCommentAttempt, isCurrentCommentScope, type AlbumCommentScope } from '../src/features/comments/state'
import { commentsQueryKeys, writeTargetCommentSummary } from '../src/features/comments/queries'
import { createTargetComment, deleteTargetComment, loadTargetComments, updateTargetComment } from '../src/features/comments/target-api'
import { ApiRequestError, type AuthenticatedTransport } from '../src/platform/api'
import { QueryClient } from '@tanstack/react-query'
import type { HttpRequestOptions } from '../src/platform/api/http-client'

const albumScope = { familyId: 'family-a', accountId: 'account-a', membershipEpoch: 4, target: 'albumEntry' as const, albumId: 'album-a', entryId: 'entry-a', discussionGeneration: 1 }
describe('album discussion identity', () => {
  it('rejects late state from another entry, album, generation or target', () => {
    expect(isCurrentCommentScope(albumScope, { ...albumScope, entryId: 'entry-b' }, true)).toBe(false)
    expect(isCurrentCommentScope(albumScope, { ...albumScope, albumId: 'album-b' }, true)).toBe(false)
    expect(isCurrentCommentScope(albumScope, { ...albumScope, discussionGeneration: 2 }, true)).toBe(false)
    expect(isCurrentCommentScope(albumScope, { familyId: 'family-a', accountId: 'account-a', membershipEpoch: 4, memoryId: 'entry-a' }, true)).toBe(false)
  })
})

const familyId = '11111111-1111-4111-8111-111111111111'
const albumId = '22222222-2222-4222-8222-222222222222'
const entryId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const target: AlbumCommentScope = { target: 'albumEntry', accountId: userId, familyId, membershipEpoch: 7, albumId, entryId, discussionGeneration: 2 }
const identity = { familyId, albumId, entryId, discussionGeneration: 2 }
const summary = { ...identity, count: 1, capabilities: { read: true, create: true } }
const comment = { ...identity, id: '55555555-5555-4555-8555-555555555555', author: { id: userId, name: 'Synthetic author', avatarPath: null, avatarCrop: null }, body: 'Story discussion', createdAt: '2026-11-04T10:00:00Z', updatedAt: '2026-11-04T10:00:00Z', version: 1, capabilities: { edit: true, delete: true } }
function mockTransport(response: () => unknown, calls: Array<{ path: string; options?: HttpRequestOptions }>): AuthenticatedTransport {
  return { async request(path, schema, options) { calls.push({ path, options }); return schema.parse(response()) }, async raw() { throw new Error('Unexpected raw request') } }
}

describe('typed discussion adapter', () => {
  it('keeps album entry APIs, generation and immutable retry payload separate from feed IDs', async () => {
    const calls: Array<{ path: string; options?: HttpRequestOptions }> = []
    let response: unknown = { comment, summary }
    const transport = mockTransport(() => response, calls)
    const attempt = createCommentAttempt(' Story discussion ', 'same-attempt')
    await createTargetComment(transport, target, attempt)
    await createTargetComment(transport, target, attempt)
    expect(calls.map(({ path }) => path)).toEqual(Array(2).fill(`/api/v1/families/${familyId}/albums/${albumId}/entries/${entryId}/comments`))
    expect(calls.map(({ options }) => options?.body)).toEqual(Array(2).fill({ body: 'Story discussion', discussionGeneration: 2 }))
    expect(calls.map(({ options }) => new Headers(options?.headers).get('Idempotency-Key'))).toEqual(['same-attempt', 'same-attempt'])
    await updateTargetComment(transport, target, comment.id, { body: 'Edited', expectedVersion: 1 })
    expect(calls.at(-1)?.options?.body).toEqual({ body: 'Edited', expectedVersion: 1, discussionGeneration: 2 })
    response = { deletedId: comment.id, summary }
    await deleteTargetComment(transport, target, comment.id, 1)
    expect(calls.at(-1)?.path).toContain(`/${comment.id}?discussionGeneration=2`)
    expect(new Headers(calls.at(-1)?.options?.headers).get('If-Match')).toBe('1')
  })
  it('rejects a response for a different entry or generation and namespaces each private query', async () => {
    const calls: Array<{ path: string; options?: HttpRequestOptions }> = []
    const transport = mockTransport(() => ({ items: [comment], nextCursor: null, summary: { ...summary, discussionGeneration: 3 } }), calls)
    await expect(loadTargetComments(transport, target)).rejects.toMatchObject({ code: 'ALBUM_DISCUSSION_CHANGED' })
    expect(calls[0]?.path).toContain('discussionGeneration=2')
    const key = commentsQueryKeys.forScope(target)
    expect(key).not.toEqual(commentsQueryKeys.list(familyId, userId, 7, entryId))
    for (const changed of [{ ...target, discussionGeneration: 3 }, { ...target, entryId: albumId }, { ...target, accountId: albumId }, { ...target, membershipEpoch: 8 }]) expect(commentsQueryKeys.forScope(changed)).not.toEqual(key)
  })
  it('keeps the existing strict feed endpoint and updates only the matching album summary generation', async () => {
    const calls: Array<{ path: string; options?: HttpRequestOptions }> = []
    const { albumId: unusedAlbum, entryId: unusedEntry, discussionGeneration: unusedGeneration, ...common } = comment
    void unusedAlbum; void unusedEntry; void unusedGeneration
    const feed = { ...common, memoryId: entryId }
    const transport = mockTransport(() => ({ comment: feed, summary: { memoryId: entryId, count: 1, capabilities: summary.capabilities } }), calls)
    await createTargetComment(transport, { accountId: userId, familyId, membershipEpoch: 7, memoryId: entryId }, createCommentAttempt('Story discussion', 'feed-key'))
    expect(calls[0]?.path).toBe(`/api/v1/families/${familyId}/memories/${entryId}/comments`)
    expect(calls[0]?.options?.body).toEqual({ body: 'Story discussion' })
    const client = new QueryClient()
    const discussion = { ...identity, comments: summary, reactionCounts: {}, currentUserReaction: null }
    client.setQueryData(commentsQueryKeys.discussion(target), discussion)
    writeTargetCommentSummary(client, { ...target, discussionGeneration: 1 }, { count: 99, capabilities: summary.capabilities })
    expect(client.getQueryData(commentsQueryKeys.discussion(target))).toEqual(discussion)
    writeTargetCommentSummary(client, target, { count: 2, capabilities: summary.capabilities })
    expect(client.getQueryData(commentsQueryKeys.discussion(target))).toMatchObject({ comments: { count: 2, entryId } })
    client.clear()
  })
  it('marks server generation conflicts as stale without rebasing an old create attempt', async () => {
    const transport: AuthenticatedTransport = { async request() { throw new ApiRequestError(409, 'VERSION_CONFLICT', 'Old generation') }, async raw() { throw new Error('Unexpected') } }
    const attempt = createCommentAttempt('Original', 'original-key')
    await expect(createTargetComment(transport, target, attempt)).rejects.toMatchObject({ code: 'ALBUM_DISCUSSION_CHANGED' })
    expect(attempt).toEqual({ body: 'Original', idempotencyKey: 'original-key' })
  })
})
