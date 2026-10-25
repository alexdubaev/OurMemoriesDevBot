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
  sort: z.enum(['createdAt','name','activeMembers','storageUsedBytes','lastObservedAt']).optional(),
  status: z.enum(['active','deleting','deleted']).optional(),
  maxState: z.enum(['configured','disconnected','unconfigured']).optional(),
  userState: z.enum(['active','trashed','purging']).optional(),
}).strict()

export const controlOverviewSchema = z.object({
  serverNow: isoDate,
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  accountsTotal: count,
  accountsActive: count,
  accountsTrashed: count,
  accountsPurging: count,
  accountsWithFamily: count,
  familiesActive: count,
  activeMemberships: count,
  invitePending: count,
  validSessions: count,
  accountsWithoutFamily: count,
  familyStorageUsedBytes: bytes,
  activeUsers: controlSampleSchema(count),
  registrations: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count }).strict()),
  activity: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: count.nullable() }).strict()),
}).strict()
export const controlMeSchema = z.object({ allowed: z.literal(true), serverNow: isoDate, features: z.array(z.enum(['read','csv_export'])) }).strict()

export const controlLifecycleErrorCodeSchema = z.enum([
  'profile_cleanup_failed', 'archive_cleanup_failed', 'storage_timeout', 'storage_not_found',
  'storage_invalid_request', 'storage_forbidden', 'storage_unavailable',
])

export const controlFamilyRowSchema = z.object({
  id: z.string().uuid(), name: boundedText.nullable(), childName: boundedText.nullable(),
  ownerName: boundedText.nullable(), status: z.enum(['active','deleting','deleted']), createdAt: isoDate,
  lifecycleState: z.enum(['active','trashed','purging','purged','inactive']), deletionId: z.string().uuid().nullable(),
  purgeAfter: isoDate.nullable(), operationStatus: z.string().max(48).nullable(),
  errorCode: controlLifecycleErrorCodeSchema.nullable(),
  activeMembers: count, storageUsedBytes: bytes, storageReservedBytes: bytes,
  quotaBytes: bytes.nullable(), publishedMemories: count, mediaAttachments: count,
  maxState: z.enum(['configured','disconnected','unconfigured']).nullable(), lastObservedAt: isoDate.nullable(),
  maxLastCheckedAt: isoDate.nullable(), maxVerificationAgeSeconds: count.nullable(),
}).strict()

export const controlUserRowSchema = z.object({
  id: z.string().uuid(), displayName: boundedText.nullable(), createdAt: isoDate,
  lifecycleState: z.enum(['active','trashed','purging','purged']), deletionId: z.string().uuid().nullable(),
  purgeAfter: isoDate.nullable(), operationStatus: z.string().max(48).nullable(),
  errorCode: controlLifecycleErrorCodeSchema.nullable(),
  activeFamilies: count, familyNames: z.array(boundedText).max(5), moreFamilies: count,
  lastSessionCreatedAt: isoDate.nullable(), lastActivityAt: isoDate.nullable(),
  lastActivitySurface:z.enum(['max_mini_app','pwa','browser']).nullable(),
}).strict()

export const controlUserDeletionPreviewSchema = z.object({
  targetId: z.string().uuid(), targetVersion: count,
  state: z.enum(['active','trashed','purging','purged']),
  deletionId: z.string().uuid().nullable(), purgeAfter: isoDate.nullable(),
  operationStatus: z.string().max(48).nullable(), errorCode: controlLifecycleErrorCodeSchema.nullable(),
  families: count, activeFamilies: count, members: count, memories: count, storageUsedBytes: bytes,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirmation: z.string().uuid(),
  protectedAccount: z.boolean(), canTrash: z.boolean(), canRestore: z.boolean(), serverNow: isoDate,
}).strict()

export const controlFamilyDeletionPreviewSchema = z.object({
  familyId: z.string().uuid(), targetVersion: count, state: z.enum(['active','deleting','deleted']),
  members: count, memories: count, storageUsedBytes: bytes,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirmation: z.string().uuid(), serverNow: isoDate,
}).strict()

export const controlLifecycleResultSchema = z.object({
  operation: z.enum(['user_trashed','user_restored','family_purge_started']),
  targetId: z.string().uuid(), deletionId: z.string().uuid().optional(),
  state: z.enum(['active','trashed','purging','purged','deleting']), purgeAfter: isoDate.optional(),
}).strict()

export const controlFamilyMemberSchema = z.object({ userId:z.string().uuid(), displayName:boundedText.nullable(), alias:boundedText.nullable(), role:z.enum(['full','viewer']), isOwner:z.boolean(), joinedAt:isoDate }).strict()
export const controlInviteSchema = z.object({ id:z.string().uuid(), state:z.enum(['pending','accepted','expired','revoked']), createdAt:isoDate, expiresAt:isoDate }).strict()
export const controlMembershipSchema = z.object({ familyId:z.string().uuid(), familyName:boundedText.nullable(), alias:boundedText.nullable(), role:z.enum(['full','viewer']), isOwner:z.boolean(), joinedAt:isoDate }).strict()

export const controlPageSchema = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item), nextCursor: z.string().max(2048).nullable(),
}).strict()

export const controlSourceSchema = z.object({
  id: z.enum(['product_db','postgres_size','media_storage','backup_storage','host_filesystem','service_probes','max_binding_state','release_evidence']), kind: z.enum(['product_db','postgres_size','media_storage','backup_storage','host_filesystem','service_probes','max_binding_state','release_evidence']), status: z.enum(['ok', 'stale', 'error', 'not_configured', 'unsupported', 'insufficient_history']),
  observedAt: isoDate.nullable(), lastAttemptAt: isoDate.nullable(), errorCode: z.enum(['timeout','unavailable','invalid_payload','permission_denied','unknown']).nullable(),
}).strict()

export const controlEventSchema = z.object({
  id: z.string().min(1).max(100), type: z.enum(['family_created', 'membership_joined', 'memory_published', 'source_state_changed']),
  occurredAt: isoDate, familyId: z.string().uuid().nullable(), familyName: boundedText.nullable(),
}).strict()

export const controlSystemSchema = z.object({
  serverNow: isoDate,
  backend: controlSampleSchema(z.object({ live: z.boolean(), ready: z.boolean(), readinessProbeLatencyMs:count.nullable() }).strict()),
  postgresSizeBytes: controlSampleSchema(bytes),
  staticEntry: controlSampleSchema(z.object({ available:z.boolean(), probeLatencyMs:count.nullable() }).strict()),
  worker: controlSampleSchema(z.object({ progressAt: isoDate.nullable() }).strict()),
  scheduler: controlSampleSchema(z.object({ progressAt: isoDate.nullable() }).strict()),
  outbox: controlSampleSchema(z.object({ pending: count, oldestDueAgeSeconds: count.nullable() }).strict()),
  release: controlSampleSchema(z.object({ backendSha:z.string().regex(/^[0-9a-f]{40}$/), staticSha:z.string().regex(/^[0-9a-f]{40}$/), migrationCatalogCount:count, migrationStatus:z.literal('up_to_date'), lastSuccessfulReleaseAt:isoDate }).strict()),
}).strict()

export const controlStorageSchema = z.object({
  familyAccounting: controlSampleSchema(z.object({ resourceId:z.string().max(80), parentResourceId:z.string().max(80).nullable(), scopeLabel:boundedText, accountingBasis:boundedText, capacityKind:z.enum(['physical','configured_budget','unknown']), usedBytes: bytes, reservedBytes:bytes, quotaBytes: bytes.nullable(), capacityBytes:bytes.nullable(), availableBytes:bytes.nullable() }).strict()),
  mediaStorage: controlSampleSchema(z.object({ resourceId:z.string().max(80), parentResourceId:z.string().max(80).nullable(), scopeLabel:boundedText, accountingBasis:boundedText, capacityKind:z.enum(['physical','configured_budget','unknown']), usedBytes: bytes, capacityBytes:bytes.nullable(), availableBytes:bytes.nullable() }).strict()),
  hostFilesystem: controlSampleSchema(z.object({ resourceId:z.string().max(80), parentResourceId:z.string().max(80).nullable(), scopeLabel:boundedText, accountingBasis:boundedText, capacityKind:z.enum(['physical','configured_budget','unknown']), usedBytes: bytes, capacityBytes:bytes.nullable(), availableBytes: bytes.nullable() }).strict()),
  postgres: controlSampleSchema(z.object({ resourceId:z.string().max(80), parentResourceId:z.string().max(80).nullable(), scopeLabel:boundedText, accountingBasis:boundedText, capacityKind:z.enum(['physical','configured_budget','unknown']), usedBytes: bytes, capacityBytes:bytes.nullable(), availableBytes:bytes.nullable() }).strict()),
  backup: controlSampleSchema(z.object({ resourceId:z.string().max(80), parentResourceId:z.string().max(80).nullable(), scopeLabel:boundedText, accountingBasis:boundedText, capacityKind:z.enum(['physical','configured_budget','unknown']), usedBytes:bytes, entries:count, capacityBytes:bytes.nullable(), availableBytes:bytes.nullable(), artifactAt:isoDate.nullable(), validation:z.enum(['valid','invalid','unknown']), restoreTestAt:isoDate.nullable() }).strict()),
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
