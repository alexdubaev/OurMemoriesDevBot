import type {
  AlbumEntryCommentDto, AlbumEntryCommentSummary, AlbumEntryDiscussionSummary,
  CreateAlbumEntryCommentRequest, SetAlbumEntryReactionRequest, UpdateAlbumEntryCommentRequest,
} from '@web-app-demo/contracts'
import type { FamilyScope } from '../../families'

export type AlbumDiscussionTarget = { albumId: string; entryId: string; discussionGeneration: number }
export type AlbumCommentPosition = { createdAt: string; id: string }
export type AlbumCommentMutation = { comment: AlbumEntryCommentDto; summary: AlbumEntryCommentSummary }
export interface AlbumSocialRepository {
  discussion(scope: FamilyScope, albumId: string, entryId: string): Promise<AlbumEntryDiscussionSummary>
  list(scope: FamilyScope, target: AlbumDiscussionTarget, limit: number, before?: AlbumCommentPosition): Promise<{ items: AlbumEntryCommentDto[]; hasNext: boolean; summary: AlbumEntryCommentSummary }>
  create(scope: FamilyScope, target: AlbumDiscussionTarget, input: CreateAlbumEntryCommentRequest, idempotency: { key: string; payloadHash: string; now: Date }): Promise<AlbumCommentMutation & { replayed: boolean }>
  update(scope: FamilyScope, target: AlbumDiscussionTarget, commentId: string, input: UpdateAlbumEntryCommentRequest): Promise<AlbumCommentMutation>
  delete(scope: FamilyScope, target: AlbumDiscussionTarget, commentId: string, expectedVersion: number): Promise<{ deletedId: string; summary: AlbumEntryCommentSummary }>
  setReaction(scope: FamilyScope, target: AlbumDiscussionTarget, input: SetAlbumEntryReactionRequest): Promise<AlbumEntryDiscussionSummary>
}
