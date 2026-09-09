import { z } from 'zod'

const uuid = z.uuid()

export const memoryKindSchema = z.enum(['note', 'photo', 'video', 'voice'])
export const memoryStatusSchema = z.enum(['processing', 'published', 'failed', 'deleted'])

const plainTextSchema = z.string().superRefine((value, context) => {
  if ([...value].length > 8_000) {
    context.addIssue({ code: 'custom', message: 'Текст не может быть длиннее 8 000 символов' })
  }
})

const occurredAtSchema = z.string().datetime({ offset: true })

const memoryBaseInputSchema = z.object({
  childId: uuid,
  body: plainTextSchema,
  occurredAt: occurredAtSchema,
}).strict()

export const createMemoryRequestSchema = z.discriminatedUnion('kind', [
  memoryBaseInputSchema.extend({ kind: z.literal('note'), body: plainTextSchema.min(1) }).strict(),
  memoryBaseInputSchema.extend({
    kind: z.literal('photo'),
    mediaIds: z.array(uuid).min(1).max(10),
  }).strict(),
  memoryBaseInputSchema.extend({
    kind: z.literal('video'),
    mediaIds: z.array(uuid).length(1),
  }).strict(),
  memoryBaseInputSchema.extend({
    kind: z.literal('voice'),
    mediaIds: z.array(uuid).length(1),
  }).strict(),
])

export const updateMemoryRequestSchema = z.object({
  body: plainTextSchema,
  occurredAt: occurredAtSchema,
  expectedVersion: z.number().int().positive(),
}).strict()

export const listMemoriesQuerySchema = z.object({
  childId: uuid.optional(),
  kind: memoryKindSchema.optional(),
  cursor: z.string().min(1).max(2_048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()

export const setLikeRequestSchema = z.object({ liked: z.boolean() }).strict()
export const memoryParamsSchema = z.object({ familyId: uuid, memoryId: uuid }).strict()
export const memoriesFamilyParamsSchema = z.object({ familyId: uuid }).strict()
export const ifMatchVersionHeadersSchema = z.object({
  'if-match': z.coerce.number().int().positive(),
})
export const mediaDtoSchema = z.object({
  id: uuid,
  kind: z.enum(['photo', 'video', 'voice']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  renditionStatus: z.enum(['pending', 'ready', 'failed']),
  previewPath: z.string().nullable(),
  displayPath: z.string().nullable(),
  playbackPath: z.string().nullable(),
  originalDownloadPath: z.string(),
  waveform: z.array(z.number()).nullable(),
}).strict()

export const memoryDtoSchema = z.object({
  id: uuid,
  familyId: uuid,
  childId: uuid,
  author: z.object({ id: uuid, name: z.string() }).strict(),
  kind: memoryKindSchema,
  body: z.string(),
  occurredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  version: z.number().int().positive(),
  status: memoryStatusSchema,
  attachments: z.array(mediaDtoSchema),
  likes: z.object({ count: z.number().int().nonnegative(), likedByMe: z.boolean() }).strict(),
  capabilities: z.object({ edit: z.boolean(), delete: z.boolean(), like: z.boolean() }).strict(),
}).strict()

export const memoryPageSchema = z.object({
  items: z.array(memoryDtoSchema),
  nextCursor: z.string().nullable(),
}).strict()

export const likeResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  likedByMe: z.boolean(),
}).strict()

export type MemoryKind = z.infer<typeof memoryKindSchema>
export type MemoryStatus = z.infer<typeof memoryStatusSchema>
export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>
export type ListMemoriesQuery = z.infer<typeof listMemoriesQuerySchema>
export type MemoryDto = z.infer<typeof memoryDtoSchema>
export type MediaDto = z.infer<typeof mediaDtoSchema>
export type MemoryPage = z.infer<typeof memoryPageSchema>
export type LikeResponse = z.infer<typeof likeResponseSchema>
