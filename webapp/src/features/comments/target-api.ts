import {
  albumEntryCommentMutationResponseSchema, albumEntryCommentPageSchema, albumEntryDiscussionSummarySchema,
  deleteAlbumEntryCommentResponseSchema, type AlbumEntryDiscussionSummary, type UpdateCommentRequest,
} from '@web-app-demo/contracts'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { createComment, deleteComment, loadComments, updateComment } from './api'
import type { AlbumCommentScope, CommentCreateAttempt, CommentScope, DiscussionComment, DiscussionPage, DiscussionSummary } from './state'

type AlbumIdentity = { familyId: string; albumId: string; entryId: string }
export const albumDiscussionPath = (scope: AlbumIdentity) => `/api/v1/families/${encodeURIComponent(scope.familyId)}/albums/${encodeURIComponent(scope.albumId)}/entries/${encodeURIComponent(scope.entryId)}`
export function discussionChanged() { return new ApiRequestError(409, 'ALBUM_DISCUSSION_CHANGED', 'Глава очищена. Откройте историю заново.') }
export function isDiscussionChanged(error: unknown) { return error instanceof ApiRequestError && error.code === 'ALBUM_DISCUSSION_CHANGED' }
function assertIdentity(scope: AlbumIdentity, result: AlbumIdentity) {
  if (scope.familyId !== result.familyId || scope.albumId !== result.albumId || scope.entryId !== result.entryId) throw discussionChanged()
}
function assertGeneration(scope: AlbumCommentScope, result: AlbumIdentity & { discussionGeneration: number }) {
  assertIdentity(scope, result)
  if (scope.discussionGeneration !== result.discussionGeneration) throw discussionChanged()
}
export async function loadAlbumDiscussion(transport: AuthenticatedTransport, scope: AlbumIdentity, signal?: AbortSignal): Promise<AlbumEntryDiscussionSummary> {
  const result = await transport.request(`${albumDiscussionPath(scope)}/discussion`, albumEntryDiscussionSummarySchema, { signal, timeoutMs: 15_000 })
  assertIdentity(scope, result)
  return result
}
export async function loadTargetComments(transport: AuthenticatedTransport, scope: CommentScope, cursor?: string | null, signal?: AbortSignal): Promise<DiscussionPage> {
  if (scope.target !== 'albumEntry') return loadComments(transport, scope.familyId, scope.memoryId, cursor, signal)
  const query = new URLSearchParams({ limit: '20', discussionGeneration: String(scope.discussionGeneration) })
  if (cursor) query.set('cursor', cursor)
  try {
    const page = await transport.request(`${albumDiscussionPath(scope)}/comments?${query}`, albumEntryCommentPageSchema, { signal, timeoutMs: 15_000 })
    assertGeneration(scope, page.summary)
    page.items.forEach((comment) => assertGeneration(scope, comment))
    return page
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) throw discussionChanged()
    throw error
  }
}
export async function createTargetComment(transport: AuthenticatedTransport, scope: CommentScope, attempt: CommentCreateAttempt, signal?: AbortSignal): Promise<{ comment: DiscussionComment; summary: DiscussionSummary }> {
  if (scope.target !== 'albumEntry') return createComment(transport, scope.familyId, scope.memoryId, attempt, signal)
  try {
    const result = await transport.request(`${albumDiscussionPath(scope)}/comments`, albumEntryCommentMutationResponseSchema, {
      method: 'POST', body: { body: attempt.body, discussionGeneration: scope.discussionGeneration }, headers: { 'Idempotency-Key': attempt.idempotencyKey }, signal, timeoutMs: 15_000,
    })
    assertGeneration(scope, result.comment); assertGeneration(scope, result.summary)
    return result
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.code === 'VERSION_CONFLICT') throw discussionChanged()
    throw error
  }
}
export async function updateTargetComment(transport: AuthenticatedTransport, scope: CommentScope, commentId: string, input: UpdateCommentRequest, signal?: AbortSignal): Promise<{ comment: DiscussionComment; summary: DiscussionSummary }> {
  if (scope.target !== 'albumEntry') return updateComment(transport, scope.familyId, scope.memoryId, commentId, input, signal)
  const result = await transport.request(`${albumDiscussionPath(scope)}/comments/${encodeURIComponent(commentId)}`, albumEntryCommentMutationResponseSchema, { method: 'PATCH', body: { ...input, discussionGeneration: scope.discussionGeneration }, signal, timeoutMs: 15_000 })
  assertGeneration(scope, result.comment); assertGeneration(scope, result.summary)
  return result
}
export async function deleteTargetComment(transport: AuthenticatedTransport, scope: CommentScope, commentId: string, version: number, signal?: AbortSignal): Promise<{ deletedId: string; summary: DiscussionSummary }> {
  if (scope.target !== 'albumEntry') return deleteComment(transport, scope.familyId, scope.memoryId, commentId, version, signal)
  const result = await transport.request(`${albumDiscussionPath(scope)}/comments/${encodeURIComponent(commentId)}?discussionGeneration=${scope.discussionGeneration}`, deleteAlbumEntryCommentResponseSchema, { method: 'DELETE', headers: { 'If-Match': String(version) }, signal, timeoutMs: 15_000 })
  assertGeneration(scope, result.summary)
  return result
}
