import { z } from 'zod'
import { userSchema } from './auth'
import { backendMediaPathSchema } from './memories'
import { avatarCropSchema } from './avatar-crop'

export const familyRoleSchema = z.enum(['full', 'viewer'])

export const idempotencyKeyHeadersSchema = z
  .object({ 'idempotency-key': z.uuid() })

const trimmedName = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum)

const familyDisplayNameSchema = z
  .string()
  .transform((value) => value.normalize('NFC').trim())
  .transform((value) => value === '' ? null : value)
  .pipe(z.string().refine(
    (value) => Array.from(value).length <= 64,
    'Family display name must be at most 64 Unicode code points',
  ).refine(
    (value) => !/[\p{Cc}\p{Cf}]/u.test(value),
    'Family display name cannot contain control characters',
  ).nullable())

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
      date.toISOString().slice(0, 10) === value
  }, 'Birth date must be a real calendar date')

export const childSexSchema = z.enum(['boy', 'girl'])

export const childAvatarCropSchema = avatarCropSchema

export const createFamilyRequestSchema = z
  .object({
    name: trimmedName(1, 80).default('Наша семья'),
    timezone: ianaTimezoneSchema,
  })
  .strict()

export const completeChildProfileRequestSchema = z.object({
  name: trimmedName(1, 60),
  birthDate: birthDateSchema,
  sex: childSexSchema,
  avatarMediaId: z.uuid(),
  avatarCrop: childAvatarCropSchema,
  expectedVersion: z.int().positive().nullable().default(null),
}).strict()

const updateChildRequestSchema = z
  .object({
    displayName: trimmedName(1, 60).optional(),
    birthDate: birthDateSchema.nullable().optional(),
    avatarMediaId: z.uuid().optional(),
    avatarCrop: childAvatarCropSchema.optional(),
    expectedVersion: z.int().positive(),
  })
  .strict()
  .refine((input) => (input.avatarMediaId === undefined) === (input.avatarCrop === undefined),
    'Avatar media ID and crop must be provided together')
  .refine((input) => input.displayName !== undefined || input.birthDate !== undefined || input.avatarMediaId !== undefined,
    'At least one child field is required')

export const updateFamilyRequestSchema = z
  .object({
    name: trimmedName(1, 80).optional(),
    timezone: ianaTimezoneSchema.optional(),
    child: updateChildRequestSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one family field is required')

export const createInviteRequestSchema = z
  .object({
    role: familyRoleSchema.default('viewer'),
    inviteeDisplayName: familyDisplayNameSchema.optional(),
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
    role: familyRoleSchema.optional(),
    familyDisplayName: familyDisplayNameSchema.nullable().optional(),
    expectedVersion: z.int().positive(),
  })
  .strict()
  .refine((input) => input.role !== undefined || input.familyDisplayName !== undefined,
    'At least one member field is required')

export const removeMemberRequestSchema = z.object({
  expectedVersion: z.int().positive(),
}).strict()

export const familyMemberSchema = z
  .object({
    userId: z.uuid(),
    avatarPath: backendMediaPathSchema.nullable(),
    avatarCrop: avatarCropSchema.nullable().optional(),
    displayName: z.string().nullable(),
    familyDisplayName: z.string().nullable(),
    role: familyRoleSchema,
    isOwner: z.boolean(),
    joinedAt: z.string().datetime(),
    version: z.int().positive(),
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
  name: z.string(),
  birthDate: z.string().nullable(),
  sex: childSexSchema.nullable(),
  avatarMediaId: z.uuid().nullable(),
  avatarCrop: childAvatarCropSchema.nullable(),
  version: z.int().positive(),
  isComplete: z.boolean(),
}).strict()

export const familyUsageSchema = z.object({ usedBytes: z.number().int().nonnegative(), quotaBytes: z.number().int().positive().nullable() }).strict()

export const familyMaxChannelStatusSchema = z.object({
  state: z.enum(['unconfigured', 'connected', 'disconnected', 'permission_problem']),
  title: z.string().nullable(),
  canManage: z.boolean(),
}).strict()
export type FamilyMaxChannelStatus = z.infer<typeof familyMaxChannelStatusSchema>

export const familyResponseSchema = z.object({
  family: familySchema,
  child: childSchema.nullable(),
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
  inviteeDisplayName: z.string().nullable(),
  expiresAt: z.string().datetime(),
}).strict()

export const familyInviteSchema = z.object({
  id: z.uuid(),
  role: familyRoleSchema,
  inviteeDisplayName: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
}).strict()

export const familyInvitesResponseSchema = z.object({
  items: z.array(familyInviteSchema),
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

export const familyHomeQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2_048).optional(),
}).strict()

export const familyHomeCapabilitiesSchema = z.object({
  canCreateInvite: z.boolean(),
  canManageMembers: z.boolean(),
  canEditChild: z.boolean(),
  canPublishNote: z.boolean(),
  canPublishPhoto: z.boolean(),
  canPublishVoice: z.boolean(),
  canPublishVideo: z.boolean(),
  canUploadChildAvatar: z.boolean(),
}).strict()

export const familyHomeItemSchema = z.object({
  familyId: z.uuid(),
  name: z.string(),
  displaySubtitle: z.string().nullable(),
  childAvatarMediaId: z.uuid().nullable(),
  childAvatarCrop: avatarCropSchema.nullable().optional(),
  isOwner: z.boolean(),
  role: familyRoleSchema,
  setupStatus: z.enum(['needs_child', 'ready']),
  capabilities: familyHomeCapabilitiesSchema,
  unreadCount: z.number().int().nonnegative().safe().nullable(),
  unreadState: z.enum(['ready', 'unavailable', 'not_enabled']),
  membershipEpoch: z.number().int().positive().safe(),
}).strict().refine((item) => (item.unreadState === 'ready') === (item.unreadCount !== null),
  'Only ready unread counts may be numeric')

export const familyHomeResponseSchema = z.object({
  version: z.literal(1),
  ownFamilyId: z.uuid().nullable(),
  ownFamilyStatus: z.enum(['active', 'deleting']).nullable(),
  canCreateOwnFamily: z.boolean(),
  items: z.array(familyHomeItemSchema).max(50),
  nextCursor: z.string().nullable(),
}).strict().refine((response) => (response.ownFamilyId === null) === (response.ownFamilyStatus === null),
  'Own family ID and status must be present together')

export type FamilyHomeQuery = z.infer<typeof familyHomeQuerySchema>
export type FamilyHomeResponse = z.infer<typeof familyHomeResponseSchema>

export type FamilyRole = z.infer<typeof familyRoleSchema>
export type IdempotencyKeyHeaders = z.infer<typeof idempotencyKeyHeadersSchema>
export type CreateFamilyRequest = z.infer<typeof createFamilyRequestSchema>
export type CompleteChildProfileRequest = z.infer<typeof completeChildProfileRequestSchema>
export type UpdateFamilyRequest = z.infer<typeof updateFamilyRequestSchema>
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>
export type RemoveMemberRequest = z.infer<typeof removeMemberRequestSchema>
export type FamilyMemberDto = z.infer<typeof familyMemberSchema>
export type FamilyDto = z.infer<typeof familySchema>
export type FamilyResponse = z.infer<typeof familyResponseSchema>
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>
export type FamilyInviteDto = z.infer<typeof familyInviteSchema>
export type InvitePreviewResponse = z.infer<typeof invitePreviewResponseSchema>
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>
export type FamilyMeResponse = z.infer<typeof familyMeResponseSchema>
export type FamilyUsage = z.infer<typeof familyUsageSchema>
