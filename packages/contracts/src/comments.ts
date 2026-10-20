import { z } from 'zod'
import { avatarCropSchema } from './avatar-crop'
import {
  backendMediaPathSchema,
  ifMatchVersionHeadersSchema,
  memoryParamsSchema,
  memoriesFamilyParamsSchema,
} from './memories'

export const commentBodySchema = z
  .string()
  .transform((value) => value.replace(/\r\n/g, '\n').trim())
  .superRefine((value, ctx) => {
    if (
      value.includes('\0') ||
      [...value].length < 1 ||
      [...value].length > 2000
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Комментарий должен содержать от 1 до 2 000 символов без NUL',
      })
  })
export const createCommentRequestSchema = z
  .object({ body: commentBodySchema })
  .strict()
export const updateCommentRequestSchema = z
  .object({
    body: commentBodySchema,
    expectedVersion: z.number().int().positive(),
  })
  .strict()
export const deleteCommentHeadersSchema = ifMatchVersionHeadersSchema
export const commentsParamsSchema = memoryParamsSchema
export const commentParamsSchema = memoryParamsSchema
  .extend({ commentId: z.uuid() })
  .strict()
export const commentSummariesParamsSchema = memoriesFamilyParamsSchema
export const listCommentsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict()
export const commentSummariesRequestSchema = z
  .object({
    memoryIds: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Публикации не должны повторяться',
      ),
  })
  .strict()
const commentAvatarPathSchema = backendMediaPathSchema.refine(
  (path) =>
    /^\/api\/v1\/families\/[^/]+\/media\/avatars\/[^/]+\/[^/]+\/content$/.test(
      path,
    ),
  'Only private member avatars are allowed',
)
export const commentDtoSchema = z
  .object({
    id: z.uuid(),
    familyId: z.uuid(),
    memoryId: z.uuid(),
    author: z
      .object({
        id: z.uuid(),
        name: z.string(),
        avatarPath: commentAvatarPathSchema.nullable(),
        avatarCrop: avatarCropSchema.nullable(),
      })
      .strict(),
    body: commentBodySchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    version: z.number().int().positive(),
    capabilities: z.object({ edit: z.boolean(), delete: z.boolean() }).strict(),
  })
  .strict()
export const commentSummarySchema = z
  .object({
    memoryId: z.uuid(),
    count: z.number().int().nonnegative(),
    capabilities: z.object({ read: z.boolean(), create: z.boolean() }).strict(),
  })
  .strict()
export const commentPageSchema = z
  .object({
    items: z.array(commentDtoSchema).max(50),
    nextCursor: z.string().max(2048).nullable(),
    summary: commentSummarySchema,
  })
  .strict()
export const commentMutationResponseSchema = z
  .object({ comment: commentDtoSchema, summary: commentSummarySchema })
  .strict()
export const deleteCommentResponseSchema = z
  .object({ deletedId: z.uuid(), summary: commentSummarySchema })
  .strict()
export const commentSummariesResponseSchema = z
  .object({ items: z.array(commentSummarySchema).max(50) })
  .strict()
export type CommentDto = z.infer<typeof commentDtoSchema>
export type CommentSummary = z.infer<typeof commentSummarySchema>
export type CommentPage = z.infer<typeof commentPageSchema>
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>
export type UpdateCommentRequest = z.infer<typeof updateCommentRequestSchema>
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>
export type CommentMutationResponse = z.infer<
  typeof commentMutationResponseSchema
>
export type CommentSummariesRequest = z.infer<
  typeof commentSummariesRequestSchema
>
export type CommentSummariesResponse = z.infer<
  typeof commentSummariesResponseSchema
>
