import { z } from 'zod'
import { ifMatchVersionHeadersSchema, memoryAttachmentSchema } from './memories'

const uuid = z.uuid().toLowerCase()
const text = (max: number) => z.string().transform((v) => v.trim()).superRefine((v, ctx) => {
  if ([...v].length > max || v.includes('\0')) ctx.addIssue({ code: 'custom', message: `Text must be at most ${max} Unicode code points` })
})
export const albumKindSchema = z.enum(['year', 'events', 'workshop', 'free'])
export const albumSourceKindSchema = z.enum(['memory', 'private_storage', 'max_video', 'telegram_video'])
export const albumEntryCategorySchema = z.enum(['drawing', 'applique', 'craft', 'building', 'other'])
export const albumDateSchema = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('unknown'), value: z.null() }).strict(),
  z.object({ precision: z.literal('year'), value: z.string().regex(/^\d{4}$/) }).strict(),
  z.object({ precision: z.literal('month'), value: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict(),
  z.object({ precision: z.literal('day'), value: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/) }).strict(),
]).superRefine((date, ctx) => {
  if (date.precision !== 'day') return
  const [year, month, day] = date.value.split('-').map(Number)
  const parsed = new Date(0)
  parsed.setUTCHours(0, 0, 0, 0)
  parsed.setUTCFullYear(year!, month! - 1, day!)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Date is not a valid calendar day' })
  }
})

export const albumParamsSchema = z.object({ familyId: uuid, albumId: uuid }).strict()
export const albumEntryParamsSchema = albumParamsSchema.extend({ entryId: uuid }).strict()
export const listAlbumsQuerySchema = z.object({
  kind: albumKindSchema.optional(),
  filter: z.enum(['all', 'template', 'custom']).default('all'),
  /** Only albums of this child (free family albums have no child and are excluded). */
  childId: uuid.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict()
export const createAlbumRequestSchema = z.object({
  kind: albumKindSchema,
  title: text(80).pipe(z.string().min(1)),
  description: text(2000).nullable().optional(),
  childId: uuid.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.kind !== 'free' && !value.childId) ctx.addIssue({ code: 'custom', path: ['childId'], message: 'This album kind requires a child' })
  if (value.kind === 'free' && value.childId) ctx.addIssue({ code: 'custom', path: ['childId'], message: 'Free albums use family context' })
})
export const updateAlbumRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: text(80).pipe(z.string().min(1)).optional(),
  description: text(2000).nullable().optional(),
  coverSourceId: uuid.nullable().optional(),
}).strict()
export const albumIfMatchHeadersSchema = ifMatchVersionHeadersSchema
export const listAlbumEntriesQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(96).default(48),
  year: z.coerce.number().int().min(1).max(9999).optional(),
  category: albumEntryCategorySchema.optional(),
}).strict()
export const createAlbumEntryRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  kind: z.enum(['event', 'work']),
  title: text(120).nullable().optional(),
  caption: text(8000).nullable().optional(),
  childQuote: text(8000).nullable().optional(),
  category: albumEntryCategorySchema.nullable().optional(),
  date: albumDateSchema.optional(),
  sources: z.array(z.object({ memoryId: uuid, sourceKind: albumSourceKindSchema, sourceId: uuid }).strict()).max(96).default([])
    .refine((items) => new Set(items.map((v) => `${v.memoryId}:${v.sourceKind}:${v.sourceId}`)).size === items.length, 'Duplicate sources are not allowed'),
}).strict()
export const updateAlbumEntryRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: text(120).nullable().optional(),
  caption: text(8000).nullable().optional(),
  childQuote: text(8000).nullable().optional(),
  category: albumEntryCategorySchema.nullable().optional(),
  date: albumDateSchema.optional(),
}).strict()
export const clearAlbumEntryRequestSchema = z.object({ expectedVersion: z.number().int().positive() }).strict()
export const albumSourceSelectionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  sources: z.array(z.object({ memoryId: uuid, sourceKind: albumSourceKindSchema, sourceId: uuid }).strict()).max(96)
    .refine((items) => new Set(items.map((v) => `${v.memoryId}:${v.sourceKind}:${v.sourceId}`)).size === items.length, 'Duplicate sources are not allowed'),
}).strict()
export const reorderAlbumEntryRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  entryId: uuid,
  beforeEntryId: uuid.nullable(),
}).strict()
const calendarFilterSchema = z.string().regex(/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0); date.setUTCHours(0, 0, 0, 0); date.setUTCFullYear(year!, (month ?? 1) - 1, day ?? 1)
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 1) - 1 && date.getUTCDate() === (day ?? 1)
}, 'Invalid calendar date')
export const mediaPickerQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  kind: z.enum(['photo', 'video', 'voice', 'note']).optional(),
  from: calendarFilterSchema.optional(),
  to: calendarFilterSchema.optional(),
}).strict()

export const albumSourceDtoSchema = z.object({
  id: uuid,
  memoryId: uuid,
  sourceKind: albumSourceKindSchema,
  sourceId: uuid,
  kind: z.enum(['photo', 'video', 'voice', 'note']),
  available: z.boolean(),
  attachment: memoryAttachmentSchema.nullable(),
  body: z.string().nullable(),
  occurredAt: z.string().datetime().nullable(),
}).strict()
export const albumDtoSchema = z.object({
  id: uuid,
  kind: albumKindSchema,
  templateVersion: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  childId: uuid.nullable(),
  version: z.number().int().positive(),
  cover: albumSourceDtoSchema.nullable(),
  entryCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  capabilities: z.object({ edit: z.boolean(), delete: z.boolean() }).strict(),
}).strict()
export const albumEntryDtoSchema = z.object({
  id: uuid,
  kind: z.enum(['month', 'event', 'work']),
  monthNumber: z.number().int().min(1).max(12).nullable(),
  title: z.string().nullable(),
  caption: z.string().nullable(),
  childQuote: z.string().nullable(),
  category: albumEntryCategorySchema.nullable(),
  date: albumDateSchema,
  version: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  sources: z.array(albumSourceDtoSchema).max(96),
  aggregateVersion: z.number().int().positive(),
  capabilities: z.object({ edit: z.boolean(), delete: z.boolean() }).strict(),
}).strict()
export const albumPageSchema = z.object({ items: z.array(albumDtoSchema).max(50), nextCursor: z.string().nullable() }).strict()
export const albumEntryPageSchema = z.object({ items: z.array(albumEntryDtoSchema).max(96), nextCursor: z.string().nullable() }).strict()
export const albumResponseSchema = z.object({ album: albumDtoSchema }).strict()
export const albumEntryResponseSchema = z.object({ entry: albumEntryDtoSchema }).strict()
export const albumMutationSchema = z.object({ album: albumDtoSchema, replayed: z.boolean() }).strict()
export const albumEntryMutationSchema = z.object({ entry: albumEntryDtoSchema, replayed: z.boolean() }).strict()
export const mediaPickerItemSchema = z.object({
  memoryId: uuid,
  kind: z.enum(['photo', 'video', 'voice', 'note', 'media']),
  occurredAt: z.string().datetime(),
  sources: z.array(albumSourceDtoSchema).max(10),
}).strict()
export const mediaPickerPageSchema = z.object({ items: z.array(mediaPickerItemSchema).max(50), nextCursor: z.string().nullable() }).strict()
export const workshopGroupsSchema = z.object({ groups: z.array(z.object({ year: z.number().int().min(1).max(9999).nullable(), month: z.number().int().min(1).max(12).nullable(), count: z.number().int().positive() }).strict()) }).strict()

export type AlbumKind = z.infer<typeof albumKindSchema>
export type AlbumSourceKind = z.infer<typeof albumSourceKindSchema>
export type AlbumDto = z.infer<typeof albumDtoSchema>
export type AlbumEntryDto = z.infer<typeof albumEntryDtoSchema>
export type CreateAlbumRequest = z.infer<typeof createAlbumRequestSchema>
export type AlbumSourceSelection = z.infer<typeof albumSourceSelectionSchema>
export type ListAlbumsQuery = z.infer<typeof listAlbumsQuerySchema>
export type ListAlbumEntriesQuery = z.infer<typeof listAlbumEntriesQuerySchema>
export type UpdateAlbumRequest = z.infer<typeof updateAlbumRequestSchema>
export type CreateAlbumEntryRequest = z.infer<typeof createAlbumEntryRequestSchema>
export type UpdateAlbumEntryRequest = z.infer<typeof updateAlbumEntryRequestSchema>
