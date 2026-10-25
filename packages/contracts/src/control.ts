import { z } from 'zod'

const isoDate = z.string().datetime({ offset: true })
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const bytes = z.string().regex(/^(0|[1-9]\d{0,39})$/)
const boundedText = z.string().max(500)

export const controlSampleSchema = <T extends z.ZodType>(value: T) => z.object({
  value: value.nullable(),
  status: z.enum(['ok', 'stale', 'error', 'not_configured', 'unsupported', 'insufficient_history']),
  sourceId: z.string().min(1).max(80),
  observedAt: isoDate.nullable(),
  lastAttemptAt: isoDate.nullable(),
  staleAfterSeconds: count,
  coverageFrom: isoDate.nullable(),
  coverageRatio: z.number().min(0).max(1).nullable(),
  errorCode: z.enum(['timeout', 'unavailable', 'invalid_payload', 'permission_denied', 'unknown']).nullable(),
}).strict()

export const controlCursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(2048).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['createdAt','name','activeMembers','storageUsedBytes']).optional(),
  status: z.enum(['active','deleting','deleted']).optional(),
  maxState: z.enum(['configured','disconnected','unconfigured']).optional(),
}).strict()

export const controlOverviewSchema = z.object({
  serverNow: isoDate,
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  accountsTotal: count,
  accountsWithFamily: count,
  familiesActive: count,
  activeMemberships: count,
  invitePending: count,
  accountsWithoutFamily: count,
  familyStorageUsedBytes: bytes,
  activeUsers: controlSampleSchema(count),
  registrations: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count }).strict()),
  activity: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: count.nullable() }).strict()),
}).strict()
export const controlMeSchema = z.object({ allowed: z.literal(true), serverNow: isoDate, features: z.array(z.enum(['read','csv_export'])) }).strict()

export const controlFamilyRowSchema = z.object({
  id: z.string().uuid(), name: boundedText.nullable(), childName: boundedText.nullable(),
  ownerName: boundedText.nullable(), status: z.enum(['active','deleting','deleted']), createdAt: isoDate,
  activeMembers: count, storageUsedBytes: bytes, storageReservedBytes: bytes,
  quotaBytes: bytes.nullable(), publishedMemories: count, mediaAttachments: count,
  maxState: z.enum(['configured','disconnected','unconfigured']).nullable(), lastObservedAt: isoDate.nullable(),
}).strict()

export const controlUserRowSchema = z.object({
  id: z.string().uuid(), displayName: boundedText.nullable(), createdAt: isoDate,
  activeFamilies: count, familyNames: z.array(boundedText).max(5), moreFamilies: count,
  lastSessionCreatedAt: isoDate.nullable(), lastActivityAt: isoDate.nullable(),
}).strict()

export const controlFamilyMemberSchema = z.object({ userId:z.string().uuid(), displayName:boundedText.nullable(), alias:boundedText.nullable(), role:z.enum(['full','viewer']), joinedAt:isoDate }).strict()
export const controlInviteSchema = z.object({ id:z.string().uuid(), state:z.enum(['pending','accepted','expired','revoked']), createdAt:isoDate, expiresAt:isoDate }).strict()
export const controlMembershipSchema = z.object({ familyId:z.string().uuid(), familyName:boundedText.nullable(), alias:boundedText.nullable(), role:z.enum(['full','viewer']), joinedAt:isoDate }).strict()

export const controlPageSchema = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item), nextCursor: z.string().max(2048).nullable(),
}).strict()

export const controlSourceSchema = z.object({
  id: z.enum(['product_db','postgres_size','media_storage','host_filesystem','service_probes','max_binding_state','release_evidence']), kind: z.enum(['product_db','postgres_size','media_storage','host_filesystem','service_probes','max_binding_state','release_evidence']), status: z.enum(['ok', 'stale', 'error', 'not_configured', 'unsupported', 'insufficient_history']),
  observedAt: isoDate.nullable(), lastAttemptAt: isoDate.nullable(), errorCode: z.enum(['timeout','unavailable','invalid_payload','permission_denied','unknown']).nullable(),
}).strict()

export const controlEventSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(['family_created', 'membership_joined', 'memory_published', 'source_state_changed']),
  occurredAt: isoDate, familyId: z.string().uuid().nullable(), familyName: boundedText.nullable(),
}).strict()

export const controlSystemSchema = z.object({
  serverNow: isoDate,
  backend: controlSampleSchema(z.object({ live: z.boolean(), ready: z.boolean() }).strict()),
  postgresSizeBytes: controlSampleSchema(bytes),
  staticEntry: controlSampleSchema(z.boolean()),
  worker: controlSampleSchema(z.object({ progressAt: isoDate.nullable() }).strict()),
  scheduler: controlSampleSchema(z.object({ progressAt: isoDate.nullable() }).strict()),
  outbox: controlSampleSchema(z.object({ pending: count, oldestDueAgeSeconds: count.nullable() }).strict()),
}).strict()

export const controlStorageSchema = z.object({
  familyAccounting: controlSampleSchema(z.object({ usedBytes: bytes, reservedBytes: bytes, quotaBytes: bytes.nullable() }).strict()),
  mediaStorage: controlSampleSchema(z.object({ usedBytes: bytes }).strict()),
  hostFilesystem: controlSampleSchema(z.object({ usedBytes: bytes, availableBytes: bytes.nullable() }).strict()),
  postgres: controlSampleSchema(z.object({ usedBytes: bytes }).strict()),
}).strict()

export const controlFamilyDetailSchema = controlFamilyRowSchema.extend({
  members: controlPageSchema(controlFamilyMemberSchema),
  invites: controlPageSchema(controlInviteSchema),
}).strict()

export const controlUserDetailSchema = controlUserRowSchema.extend({
  memberships: controlPageSchema(controlMembershipSchema),
}).strict()

export type ControlOverview = z.infer<typeof controlOverviewSchema>
export type ControlFamilyRow = z.infer<typeof controlFamilyRowSchema>
export type ControlUserRow = z.infer<typeof controlUserRowSchema>
