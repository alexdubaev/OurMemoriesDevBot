import { z } from 'zod'
import { ifMatchVersionHeadersSchema } from './memories'

export const MAX_ACTIVE_GIFTS = 200

const giftUuidSchema = z.uuid().toLowerCase()
const isoSchema = z.string().datetime({ offset: true })
const versionSchema = z.number().int().positive()

export function isAllowedGiftUrl(value: string): boolean {
  if (/[\p{Cc}\s]/u.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

export const giftTitleSchema = z.string().trim().min(1).max(120)
export const giftUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(isAllowedGiftUrl, 'Нужна ссылка на товар, которая начинается с http:// или https://')
export const giftPriceSchema = z.string().trim().min(1).max(30)

export const giftMetadataRequestSchema = z.object({ url: giftUrlSchema }).strict()
export const giftMetadataResponseSchema = z.object({
  status: z.enum(['ready', 'partial', 'unavailable', 'unsupported']),
  title: giftTitleSchema.nullable(),
  price: giftPriceSchema.nullable(),
  photo: z.object({ contentType: z.literal('image/webp'), dataBase64: z.string().max(700_000) }).strict().nullable(),
}).strict().superRefine((response, context) => {
  if (response.status === 'ready' && (!response.title || !response.photo)) {
    context.addIssue({ code: 'custom', message: 'Ready metadata must include a title and photo' })
  }
  if (response.status === 'partial' && !response.title && !response.photo) {
    context.addIssue({ code: 'custom', message: 'Partial metadata must include a title or photo' })
  }
  if ((response.status === 'unavailable' || response.status === 'unsupported')
    && (response.title || response.price || response.photo)) {
    context.addIssue({ code: 'custom', message: 'Unavailable metadata must be empty' })
  }
})

export const giftsParamsSchema = z.object({ familyId: giftUuidSchema }).strict()
export const giftParamsSchema = z.object({ familyId: giftUuidSchema, giftId: giftUuidSchema }).strict()

export const giftReservationDtoSchema = z
  .object({
    userId: z.uuid(),
    name: z.string(),
    reservedAt: isoSchema,
    boughtAt: isoSchema.nullable(),
  })
  .strict()

export const giftDtoSchema = z
  .object({
    id: z.uuid(),
    childId: z.uuid(),
    title: giftTitleSchema,
    url: giftUrlSchema,
    price: giftPriceSchema.nullable(),
    photoMediaId: z.uuid(),
    createdBy: z.object({ userId: z.uuid(), name: z.string() }).strict(),
    reservation: giftReservationDtoSchema.nullable(),
    version: versionSchema,
    createdAt: isoSchema,
    updatedAt: isoSchema,
  })
  .strict()

/** Unbought gifts by createdAt desc, then bought gifts by boughtAt desc. */
export const giftListResponseSchema = z.object({ gifts: z.array(giftDtoSchema) }).strict()

export const createGiftRequestSchema = z
  .object({
    title: giftTitleSchema,
    url: giftUrlSchema,
    price: giftPriceSchema.optional(),
    photoMediaId: giftUuidSchema,
  })
  .strict()

export const updateGiftRequestSchema = z
  .object({
    expectedVersion: versionSchema,
    title: giftTitleSchema.optional(),
    url: giftUrlSchema.optional(),
    price: giftPriceSchema.nullable().optional(),
    photoMediaId: giftUuidSchema.optional(),
  })
  .strict()

/** Body for reserve, cancel reservation, mark bought and unmark bought. */
export const giftVersionRequestSchema = z.object({ expectedVersion: versionSchema }).strict()
export const deleteGiftHeadersSchema = ifMatchVersionHeadersSchema
export const giftMutationResponseSchema = z.object({ gift: giftDtoSchema }).strict()

export type GiftReservationDto = z.infer<typeof giftReservationDtoSchema>
export type GiftDto = z.infer<typeof giftDtoSchema>
export type GiftListResponse = z.infer<typeof giftListResponseSchema>
export type CreateGiftRequest = z.infer<typeof createGiftRequestSchema>
export type UpdateGiftRequest = z.infer<typeof updateGiftRequestSchema>
export type GiftVersionRequest = z.infer<typeof giftVersionRequestSchema>
export type GiftMutationResponse = z.infer<typeof giftMutationResponseSchema>
export type GiftMetadataRequest = z.infer<typeof giftMetadataRequestSchema>
export type GiftMetadataResponse = z.infer<typeof giftMetadataResponseSchema>
