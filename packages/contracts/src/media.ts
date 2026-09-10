import { z } from 'zod'

import { backendMediaPathSchema } from './memories'
import { uploadTicketSchema } from './uploads'

const uuid = z.uuid()
const minMediaBytes = 64

export const mediaPurposeSchema = z.enum(['memory', 'child_avatar'])
export const privateMediaKindSchema = z.enum(['photo', 'video', 'voice'])
export const mediaOriginalStatusSchema = z.enum(['pending', 'stored', 'failed'])
export const mediaRenditionStatusSchema = z.enum(['pending', 'ready', 'failed'])
export const mediaVariantSchema = z.enum(['preview', 'display', 'playback', 'original'])

const photoContentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])
const videoContentTypeSchema = z.enum(['video/mp4', 'video/quicktime'])
const voiceContentTypeSchema = z.enum(['audio/ogg', 'audio/opus', 'audio/webm', 'audio/mp4'])

export const reserveMediaUploadRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    purpose: mediaPurposeSchema,
    kind: z.literal('photo'),
    contentType: photoContentTypeSchema,
    byteSize: z.number().int().min(minMediaBytes).max(20_000_000),
  }).strict(),
  z.object({
    purpose: z.literal('memory'),
    kind: z.literal('video'),
    contentType: videoContentTypeSchema,
    byteSize: z.number().int().min(minMediaBytes).max(100_000_000),
  }).strict(),
  z.object({
    purpose: z.literal('memory'),
    kind: z.literal('voice'),
    contentType: voiceContentTypeSchema,
    byteSize: z.number().int().min(minMediaBytes).max(20_000_000),
  }).strict(),
])

export const reserveMediaUploadResponseSchema = z.object({
  assetId: uuid,
  upload: uploadTicketSchema,
  reservationExpiresAt: z.string().datetime(),
}).strict()

export const mediaAssetDtoSchema = z.object({
  id: uuid,
  purpose: mediaPurposeSchema,
  kind: privateMediaKindSchema,
  originalStatus: mediaOriginalStatusSchema,
  renditionStatus: mediaRenditionStatusSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable(),
  waveform: z.array(z.number().min(0).max(1)).length(48).nullable(),
  previewPath: backendMediaPathSchema.nullable(),
  displayPath: backendMediaPathSchema.nullable(),
  playbackPath: backendMediaPathSchema.nullable(),
  originalDownloadPath: backendMediaPathSchema,
}).strict()

export const finalizeMediaUploadResponseSchema = z.object({ asset: mediaAssetDtoSchema }).strict()

export const mediaFamilyParamsSchema = z.object({ familyId: uuid }).strict()
export const mediaUploadParamsSchema = z.object({ familyId: uuid, uploadId: uuid }).strict()
export const mediaContentParamsSchema = z.object({ familyId: uuid, mediaId: uuid }).strict()
export const mediaContentQuerySchema = z.object({
  variant: mediaVariantSchema.default('display'),
}).strict()

export type MediaPurpose = z.infer<typeof mediaPurposeSchema>
export type PrivateMediaKind = z.infer<typeof privateMediaKindSchema>
export type MediaOriginalStatus = z.infer<typeof mediaOriginalStatusSchema>
export type MediaRenditionStatus = z.infer<typeof mediaRenditionStatusSchema>
export type MediaVariant = z.infer<typeof mediaVariantSchema>
export type ReserveMediaUploadRequest = z.infer<typeof reserveMediaUploadRequestSchema>
export type ReserveMediaUploadResponse = z.infer<typeof reserveMediaUploadResponseSchema>
export type MediaAssetDto = z.infer<typeof mediaAssetDtoSchema>
export type FinalizeMediaUploadResponse = z.infer<typeof finalizeMediaUploadResponseSchema>
