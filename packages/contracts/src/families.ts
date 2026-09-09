import { z } from 'zod'
import { userSchema } from './auth'

export const familyRoleSchema = z.enum(['full', 'viewer'])

const trimmedName = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum)

const ianaTimezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}, 'Invalid IANA timezone')

const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      date <= new Date()
  }, 'Birth date must be a real date and cannot be in the future')

export const createFamilyRequestSchema = z
  .object({
    name: trimmedName(1, 80).default('Наша семья'),
    timezone: ianaTimezoneSchema,
    child: z
      .object({
        displayName: trimmedName(1, 60),
        birthDate: birthDateSchema.optional(),
      })
      .strict(),
  })
  .strict()

export const createInviteRequestSchema = z
  .object({
    role: familyRoleSchema.default('viewer'),
  })
  .strict()

const inviteTokenSchema = z.string().min(32).max(128)

export const acceptInviteRequestSchema = z
  .object({
    token: inviteTokenSchema,
  })
  .strict()

export const invitePreviewRequestSchema = acceptInviteRequestSchema

export const updateMemberRoleRequestSchema = z
  .object({
    role: familyRoleSchema,
  })
  .strict()

export const familyMemberSchema = z
  .object({
    userId: z.uuid(),
    displayName: z.string().nullable(),
    role: familyRoleSchema,
    isOwner: z.boolean(),
    joinedAt: z.string().datetime(),
  })
  .strict()

export const familySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
    ownerUserId: z.uuid(),
  })
  .strict()

export const familyParamsSchema = z.object({ familyId: z.uuid() }).strict()
export const familyMemberParamsSchema = familyParamsSchema.extend({ userId: z.uuid() }).strict()
export const familyInviteParamsSchema = familyParamsSchema.extend({ inviteId: z.uuid() }).strict()

export const childSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  birthDate: z.string().nullable(),
}).strict()

export const familyResponseSchema = z.object({
  family: familySchema,
  child: childSchema,
}).strict()

export const familyMembersResponseSchema = z.object({
  items: z.array(familyMemberSchema),
}).strict()

export const familyMemberResponseSchema = z.object({
  membership: familyMemberSchema,
}).strict()

export const createInviteResponseSchema = z.object({
  id: z.uuid(),
  rawToken: inviteTokenSchema,
  role: familyRoleSchema,
  expiresAt: z.string().datetime(),
}).strict()

export const invitePreviewResponseSchema = z.object({
  family: familySchema.pick({ id: true, name: true }),
  role: familyRoleSchema,
  expiresAt: z.string().datetime(),
}).strict()

export const acceptInviteResponseSchema = z.object({
  family: familySchema,
  membership: familyMemberSchema,
}).strict()

export const familyMeResponseSchema = z.object({
  user: userSchema,
  activeFamily: z.object({
    id: z.uuid(),
    name: z.string(),
    role: familyRoleSchema,
    isOwner: z.boolean(),
  }).strict().nullable(),
  limits: z.object({ activeFamiliesMaximum: z.literal(1) }).strict(),
}).strict()

export type FamilyRole = z.infer<typeof familyRoleSchema>
export type CreateFamilyRequest = z.infer<typeof createFamilyRequestSchema>
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>
export type FamilyMemberDto = z.infer<typeof familyMemberSchema>
export type FamilyDto = z.infer<typeof familySchema>
export type FamilyResponse = z.infer<typeof familyResponseSchema>
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>
export type InvitePreviewResponse = z.infer<typeof invitePreviewResponseSchema>
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>
export type FamilyMeResponse = z.infer<typeof familyMeResponseSchema>
