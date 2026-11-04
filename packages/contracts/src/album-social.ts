import { z } from 'zod'
import { albumEntryParamsSchema } from './albums'
import {
  commentDtoSchema, commentSummarySchema, createCommentRequestSchema,
  listCommentsQuerySchema, updateCommentRequestSchema,
} from './comments'
import { reactionResponseSchema, setReactionRequestSchema } from './memories'

const generation = z.number().int().positive()
const identity = albumEntryParamsSchema.extend({ discussionGeneration: generation })
export const albumEntryCommentParamsSchema = albumEntryParamsSchema.extend({ commentId: z.uuid().toLowerCase() }).strict()
export const albumEntryDiscussionGenerationQuerySchema = z.object({ discussionGeneration: z.coerce.number().int().positive() }).strict()
export const listAlbumEntryCommentsQuerySchema = listCommentsQuerySchema.extend({ discussionGeneration: z.coerce.number().int().positive() }).strict()
export const createAlbumEntryCommentRequestSchema = createCommentRequestSchema.extend({ discussionGeneration: generation }).strict()
export const updateAlbumEntryCommentRequestSchema = updateCommentRequestSchema.extend({ discussionGeneration: generation }).strict()
export const setAlbumEntryReactionRequestSchema = setReactionRequestSchema.extend({ discussionGeneration: generation }).strict()
export const albumEntryCommentDtoSchema = commentDtoSchema.omit({ memoryId: true }).extend(identity.shape).strict()
export const albumEntryCommentSummarySchema = commentSummarySchema.omit({ memoryId: true }).extend(identity.shape).strict()
export const albumEntryCommentPageSchema = z.object({
  items: z.array(albumEntryCommentDtoSchema).max(50), nextCursor: z.string().max(2048).nullable(), summary: albumEntryCommentSummarySchema,
}).strict()
export const albumEntryCommentMutationResponseSchema = z.object({ comment: albumEntryCommentDtoSchema, summary: albumEntryCommentSummarySchema }).strict()
export const deleteAlbumEntryCommentResponseSchema = z.object({ deletedId: z.uuid(), summary: albumEntryCommentSummarySchema }).strict()
export const albumEntryDiscussionSummarySchema = identity.extend({
  comments: albumEntryCommentSummarySchema,
  reactionCounts: reactionResponseSchema.shape.reactionCounts,
  currentUserReaction: reactionResponseSchema.shape.currentUserReaction,
}).strict()

export type AlbumEntryCommentDto = z.infer<typeof albumEntryCommentDtoSchema>
export type AlbumEntryCommentSummary = z.infer<typeof albumEntryCommentSummarySchema>
export type AlbumEntryCommentPage = z.infer<typeof albumEntryCommentPageSchema>
export type AlbumEntryCommentMutationResponse = z.infer<typeof albumEntryCommentMutationResponseSchema>
export type AlbumEntryDiscussionSummary = z.infer<typeof albumEntryDiscussionSummarySchema>
export type CreateAlbumEntryCommentRequest = z.infer<typeof createAlbumEntryCommentRequestSchema>
export type UpdateAlbumEntryCommentRequest = z.infer<typeof updateAlbumEntryCommentRequestSchema>
export type SetAlbumEntryReactionRequest = z.infer<typeof setAlbumEntryReactionRequestSchema>
export type ListAlbumEntryCommentsQuery = z.infer<typeof listAlbumEntryCommentsQuerySchema>
