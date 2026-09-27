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
  unreadOnly: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
}).strict()

export const seenMemoriesRequestSchema = z.object({
  memoryIds: z.array(uuid).min(1).max(50),
  expectedMembershipEpoch: z.number().int().positive().safe(),
}).strict()

export const setLikeRequestSchema = z.object({ liked: z.boolean() }).strict()
export const memoryParamsSchema = z.object({ familyId: uuid, memoryId: uuid }).strict()
export const memoriesFamilyParamsSchema = z.object({ familyId: uuid }).strict()
export const ifMatchVersionHeadersSchema = z.object({
  'if-match': z.coerce.number().int().positive(),
})

export const backendMediaPathSchema = z.string().superRefine((value, context) => {
  if (!value.startsWith('/api/v1/') || value.startsWith('//') || value.includes('\\') || value.includes('#')) {
    context.addIssue({ code: 'custom', message: 'Media path must be a relative backend API path' })
    return
  }

  let decoded = value
  try {
    for (let pass = 0; pass < 2; pass += 1) decoded = decodeURIComponent(decoded)
  } catch {
    context.addIssue({ code: 'custom', message: 'Media path contains invalid encoding' })
    return
  }
  const pathOnly = decoded.split('?', 1)[0] ?? ''
  if (decoded.includes('\\') || pathOnly.split('/').includes('..')) {
    context.addIssue({ code: 'custom', message: 'Media path must not contain traversal segments' })
    return
  }

  const uuidSegment = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  const contentPath = new RegExp(`^/api/v1/families/${uuidSegment}/media/${uuidSegment}/content$`)
  const maxVideoPath = new RegExp(`^/api/v1/families/${uuidSegment}/media/max-videos/${uuidSegment}/content$`)
  if (!contentPath.test(pathOnly) && !maxVideoPath.test(pathOnly)) {
    context.addIssue({ code: 'custom', message: 'Media path must target the authenticated media endpoint' })
    return
  }

  const query = value.includes('?') ? value.slice(value.indexOf('?') + 1) : ''
  const parameters = new URLSearchParams(query)
  if (parameters.size > 1 || parameters.getAll('variant').length > 1) {
    context.addIssue({ code: 'custom', message: 'Media path contains duplicate query parameters' })
    return
  }
  for (const [name, parameterValue] of parameters) {
    if (maxVideoPath.test(pathOnly) || name !== 'variant' || !['preview', 'display', 'playback', 'original'].includes(parameterValue)) {
      context.addIssue({ code: 'custom', message: 'Media path contains an unsupported query parameter' })
      return
    }
  }
})

export const mediaDtoSchema = z.object({
  id: uuid,
  source: z.literal('private_storage'),
  kind: z.enum(['photo', 'video', 'voice']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  renditionStatus: z.enum(['pending', 'ready', 'failed']),
  previewPath: backendMediaPathSchema.nullable(),
  displayPath: backendMediaPathSchema.nullable(),
  playbackPath: backendMediaPathSchema.nullable(),
  originalDownloadPath: backendMediaPathSchema,
  waveform: z.array(z.number().min(0).max(1)).length(48).nullable(),
}).strict()

export const maxVideoAttachmentSchema = z.object({
  id: uuid,
  source: z.literal('max'),
  kind: z.literal('video'),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  playbackPath: backendMediaPathSchema,
}).strict()

const telegramVideoOpenPathSchema = z.string().superRefine((value, context) => {
  const uuidSegment = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  const path = new RegExp(`^/api/v1/families/${uuidSegment}/memories/${uuidSegment}/telegram-video$`)
  if (!path.test(value)) {
    context.addIssue({ code: 'custom', message: 'Telegram video action must be a relative family memory path' })
  }
})

/**
 * A Telegram-only video deliberately has no object key, file id, storage URL, or playback path.
 * The client can ask the guarded action for an opaque bot deep link; the bot resolves the actual
 * file reference only after it receives a private-chat update from the current member.
 */
export const telegramVideoAttachmentSchema = z.object({
  id: uuid,
  source: z.literal('telegram'),
  kind: z.literal('video'),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  thumbnailPath: backendMediaPathSchema.nullable(),
  openInTelegramPath: telegramVideoOpenPathSchema,
}).strict()

export const memoryAttachmentSchema = z.union([mediaDtoSchema, telegramVideoAttachmentSchema, maxVideoAttachmentSchema])

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
  attachments: z.array(memoryAttachmentSchema),
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

/** The URL contains only a short-lived opaque navigation pointer, never a Telegram file id. */
export const telegramVideoOpenResponseSchema = z.object({
  telegramDeepLink: z.string().url().max(512),
}).strict()

export type MemoryKind = z.infer<typeof memoryKindSchema>
export type MemoryStatus = z.infer<typeof memoryStatusSchema>
export type CreateMemoryRequest = z.infer<typeof createMemoryRequestSchema>
export type UpdateMemoryRequest = z.infer<typeof updateMemoryRequestSchema>
export type ListMemoriesQuery = z.infer<typeof listMemoriesQuerySchema>
export type SeenMemoriesRequest = z.infer<typeof seenMemoriesRequestSchema>
export type MemoryDto = z.infer<typeof memoryDtoSchema>
export type MediaDto = z.infer<typeof mediaDtoSchema>
export type MaxVideoAttachment = z.infer<typeof maxVideoAttachmentSchema>
export type TelegramVideoAttachment = z.infer<typeof telegramVideoAttachmentSchema>
export type MemoryAttachment = z.infer<typeof memoryAttachmentSchema>
export type MemoryPage = z.infer<typeof memoryPageSchema>
export type LikeResponse = z.infer<typeof likeResponseSchema>
export type TelegramVideoOpenResponse = z.infer<typeof telegramVideoOpenResponseSchema>
