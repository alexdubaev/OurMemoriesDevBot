import {
  commentMutationResponseSchema,
  commentPageSchema,
  commentSummariesResponseSchema,
  deleteCommentResponseSchema,
  type CommentSummary,
  type UpdateCommentRequest,
} from '@web-app-demo/contracts'
import type { AuthenticatedTransport } from '@/platform/api'
import type { CommentCreateAttempt } from './state'

const familyMemoryPath = (familyId: string, memoryId: string) => `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}`
const commentsPath = (familyId: string, memoryId: string) => `${familyMemoryPath(familyId, memoryId)}/comments`

export function loadComments(transport: AuthenticatedTransport, familyId: string, memoryId: string, cursor?: string | null, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', cursor)
  return transport.request(`${commentsPath(familyId, memoryId)}?${params}`, commentPageSchema, { signal })
}

export function createComment(transport: AuthenticatedTransport, familyId: string, memoryId: string, attempt: CommentCreateAttempt, signal?: AbortSignal) {
  return transport.request(commentsPath(familyId, memoryId), commentMutationResponseSchema, {
    method: 'POST', body: { body: attempt.body }, headers: { 'Idempotency-Key': attempt.idempotencyKey }, signal, timeoutMs: 15_000,
  })
}

export function updateComment(transport: AuthenticatedTransport, familyId: string, memoryId: string, commentId: string, input: UpdateCommentRequest, signal?: AbortSignal) {
  return transport.request(`${commentsPath(familyId, memoryId)}/${encodeURIComponent(commentId)}`, commentMutationResponseSchema, { method: 'PATCH', body: input, signal, timeoutMs: 15_000 })
}

export async function deleteComment(transport: AuthenticatedTransport, familyId: string, memoryId: string, commentId: string, version: number, signal?: AbortSignal) {
  return transport.request(`${commentsPath(familyId, memoryId)}/${encodeURIComponent(commentId)}`, deleteCommentResponseSchema, { method: 'DELETE', headers: { 'If-Match': String(version) }, signal, timeoutMs: 15_000 })
}

export async function loadCommentSummaries(transport: AuthenticatedTransport, familyId: string, memoryIds: string[], signal?: AbortSignal): Promise<CommentSummary[]> {
  if (memoryIds.length === 0 || memoryIds.length > 50) throw new RangeError('Comment summaries require 1 to 50 memory IDs')
  const result = await transport.request(`/api/v1/families/${encodeURIComponent(familyId)}/memories/comment-summaries`, commentSummariesResponseSchema, { method: 'POST', body: { memoryIds }, signal })
  return result.items
}
