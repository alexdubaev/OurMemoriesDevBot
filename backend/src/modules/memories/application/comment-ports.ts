import type {
  CommentDto,
  CommentMutationResponse,
  CommentSummary,
  CreateCommentRequest,
} from '@web-app-demo/contracts'
import type { FamilyScope } from '../../families'

export type CommentPosition = { createdAt: string; id: string }
export interface CommentRepository {
  list(
    scope: FamilyScope,
    memoryId: string,
    limit: number,
    before?: CommentPosition,
  ): Promise<{ items: CommentDto[]; hasNext: boolean; summary: CommentSummary }>
  create(
    scope: FamilyScope,
    memoryId: string,
    input: CreateCommentRequest,
    idempotency: { key: string; payloadHash: string; now: Date },
  ): Promise<{
    comment: CommentDto
    summary: CommentSummary
    replayed: boolean
  }>
  update(
    scope: FamilyScope,
    memoryId: string,
    commentId: string,
    input: import('@web-app-demo/contracts').UpdateCommentRequest,
  ): Promise<CommentMutationResponse>
  delete(
    scope: FamilyScope,
    memoryId: string,
    commentId: string,
    expectedVersion: number,
  ): Promise<{ deletedId: string; summary: CommentSummary }>
  summaries(
    scope: FamilyScope,
    memoryIds: string[],
  ): Promise<{ items: CommentSummary[] }>
}
