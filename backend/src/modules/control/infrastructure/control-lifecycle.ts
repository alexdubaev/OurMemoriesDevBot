import { createHash } from 'node:crypto'
import { Prisma } from '../../../generated/prisma/client'
import { acquireUserAuthenticationAuthorityLock, type DbClient, userAuthorityTransitionTransactionOptions } from '../../../db'

const USER_PURGE_GRACE_MS = 30 * 24 * 60 * 60 * 1000

type LifecycleState = 'active' | 'trashed' | 'purging' | 'purged'
type FamilyState = 'active' | 'deleting' | 'deleted'
type Role = 'full' | 'viewer'
type Tx = Parameters<Parameters<DbClient['$transaction']>[0]>[0]

export type UserDeletionPreview = {
  targetId: string
  targetVersion: number
  state: LifecycleState
  families: number
  activeFamilies: number
  members: number
  memories: number
  storageUsedBytes: string
  fingerprint: string
  confirmation: string
}

export type FamilyDeletionPreview = {
  familyId: string
  targetVersion: number
  state: FamilyState
  members: number
  memories: number
  storageUsedBytes: string
  fingerprint: string
  confirmation: string
}

export type LifecycleResult = {
  operation: 'user_trashed' | 'user_restored' | 'family_purge_started'
  targetId: string
  deletionId?: string
  state: LifecycleState | FamilyState
  purgeAfter?: string
}

export class ControlLifecycleFailure extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ControlLifecycleFailure'
  }
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function assertUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ControlLifecycleFailure('invalid_command', `${label} must be a UUID`)
  }
}

function assertConfirmation(value: string, targetId: string) {
  if (value !== targetId) throw new ControlLifecycleFailure('confirmation_mismatch', 'Confirmation does not match the target')
}

function protectTarget(targetId: string, protectedIds: readonly string[]) {
  if (protectedIds.includes(targetId)) throw new ControlLifecycleFailure('protected_account', 'Configured Control owners cannot be deleted')
}

function payloadHash(operation: string, targetId: string, fingerprint: string, confirmation: string) {
  return digest({ operation, targetId, fingerprint, confirmation })
}

async function userPreview(db: DbClient | Tx, userId: string): Promise<UserDeletionPreview> {
  const [user] = await db.$queryRaw<Array<{ id: string; version: number; state: LifecycleState }>>`
    SELECT id, control_version AS version, control_state::text AS state
      FROM users WHERE id = ${userId}::uuid
  `
  if (!user) throw new ControlLifecycleFailure('not_found', 'User not found')
  const rows = await db.$queryRaw<Array<{ families: bigint; activeFamilies: bigint; members: bigint; memories: bigint; storageUsedBytes: bigint; scope: string }>>`
    WITH owned AS (
      SELECT f.id, f.control_version, f.status::text AS state, f.storage_used_bytes
        FROM families f WHERE f.owner_user_id = ${userId}::uuid
    ), impact_members AS (
      SELECT fm.family_id, fm.user_id, fm.role::text AS role, fm.version, fm.membership_epoch,
             f.control_version, f.status::text AS family_state
        FROM family_members fm JOIN families f ON f.id = fm.family_id
       WHERE fm.revoked_at IS NULL AND f.status = 'active'
         AND (fm.user_id = ${userId}::uuid OR f.owner_user_id = ${userId}::uuid)
    ), scope AS (
      SELECT jsonb_build_object(
        'owned', COALESCE((SELECT jsonb_agg(jsonb_build_array(id, control_version, state) ORDER BY id) FROM owned), '[]'::jsonb),
        'members', COALESCE((SELECT jsonb_agg(jsonb_build_array(family_id, user_id, role, version, membership_epoch, control_version, family_state) ORDER BY family_id, user_id) FROM impact_members), '[]'::jsonb)
      ) AS value
    )
    SELECT (SELECT COUNT(*) FROM owned)::bigint AS families,
           (SELECT COUNT(*) FROM owned WHERE state = 'active')::bigint AS "activeFamilies",
           (SELECT COUNT(*) FROM impact_members)::bigint AS members,
           (SELECT COUNT(*) FROM memories m JOIN owned f ON f.id = m.family_id WHERE m.deleted_at IS NULL)::bigint AS memories,
           COALESCE((SELECT SUM(storage_used_bytes) FROM owned), 0)::bigint AS "storageUsedBytes",
           scope.value::text AS scope
      FROM scope
  `
  const row = rows[0]!
  const fingerprint = digest({ targetId: user.id, targetVersion: user.version, state: user.state, scope: JSON.parse(row.scope), families: Number(row.families), activeFamilies: Number(row.activeFamilies), members: Number(row.members), memories: Number(row.memories), storageUsedBytes: row.storageUsedBytes.toString() })
  return {
    targetId: user.id,
    targetVersion: user.version,
    state: user.state,
    families: Number(row.families),
    activeFamilies: Number(row.activeFamilies),
    members: Number(row.members),
    memories: Number(row.memories),
    storageUsedBytes: row.storageUsedBytes.toString(),
    fingerprint,
    confirmation: user.id,
  }
}

async function familyPreview(db: DbClient | Tx, familyId: string): Promise<FamilyDeletionPreview> {
  const [row] = await db.$queryRaw<Array<{
    id: string; version: number; state: FamilyState; members: bigint; memories: bigint; storageUsedBytes: bigint; membersScope: string
  }>>`
    SELECT f.id, f.control_version AS version, f.status::text AS state,
           (SELECT COUNT(*) FROM family_members fm WHERE fm.family_id = f.id AND fm.revoked_at IS NULL)::bigint AS members,
           (SELECT COUNT(*) FROM memories m WHERE m.family_id = f.id AND m.deleted_at IS NULL)::bigint AS memories,
           f.storage_used_bytes AS "storageUsedBytes",
           COALESCE((SELECT jsonb_agg(jsonb_build_array(fm.user_id, fm.role::text, fm.version, fm.membership_epoch) ORDER BY fm.user_id)
                       FROM family_members fm WHERE fm.family_id = f.id AND fm.revoked_at IS NULL), '[]'::jsonb)::text AS "membersScope"
      FROM families f WHERE f.id = ${familyId}::uuid
  `
  if (!row) throw new ControlLifecycleFailure('not_found', 'Family not found')
  const fingerprint = digest({ familyId: row.id, targetVersion: row.version, state: row.state, membersScope: JSON.parse(row.membersScope), members: Number(row.members), memories: Number(row.memories), storageUsedBytes: row.storageUsedBytes.toString() })
  return {
    familyId: row.id,
    targetVersion: row.version,
    state: row.state,
    members: Number(row.members),
    memories: Number(row.memories),
    storageUsedBytes: row.storageUsedBytes.toString(),
    fingerprint,
    confirmation: row.id,
  }
}

export function previewUserDeletion(db: DbClient, userId: string, _protectedIds: readonly string[]) {
  assertUuid(userId, 'userId')
  return userPreview(db, userId)
}

export function previewFamilyDeletion(db: DbClient, familyId: string) {
  assertUuid(familyId, 'familyId')
  return familyPreview(db, familyId)
}

async function lifecycleLock(tx: Tx) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('control-user-lifecycle', 0))`)
}

async function lockUsers(tx: Tx, userIds: readonly string[]) {
  const ids = [...new Set(userIds)].sort()
  if (ids.length === 0) return []
  return tx.$queryRaw<Array<{ id: string; state: LifecycleState }>>`
    SELECT id, control_state::text AS state FROM users
     WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE
  `
}

async function findReplay(tx: Tx, input: { actorId: string; key: string; hash: string }) {
  const command = await tx.controlLifecycleCommand.findUnique({
    where: { actorUserId_key: { actorUserId: input.actorId, key: input.key } },
    select: { payloadHash: true, response: true },
  })
  if (!command) return null
  if (command.payloadHash !== input.hash) throw new ControlLifecycleFailure('idempotency_conflict', 'This command key was already used for different data')
  return command.response as unknown as LifecycleResult
}

async function recordCommand(tx: Tx, input: { actorId: string; key: string; operation: string; targetId: string; hash: string; result: LifecycleResult }) {
  await tx.controlLifecycleCommand.create({
    data: { actorUserId: input.actorId, key: input.key, operation: input.operation, targetId: input.targetId, payloadHash: input.hash, response: input.result },
  })
  return input.result
}

export async function trashControlUser(
  db: DbClient,
  input: { actorId: string; targetId: string; protectedIds: readonly string[]; key: string; fingerprint: string; confirmation: string },
  now?: Date,
): Promise<LifecycleResult & { deletionId: string; purgeAfter: string }> {
  assertUuid(input.actorId, 'actorId'); assertUuid(input.targetId, 'targetId'); assertUuid(input.key, 'key')
  protectTarget(input.targetId, input.protectedIds); assertConfirmation(input.confirmation, input.targetId)
  const operation = 'user.trash'
  const hash = payloadHash(operation, input.targetId, input.fingerprint, input.confirmation)
  return db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    await acquireUserAuthenticationAuthorityLock(tx, input.targetId)
    const replay = await findReplay(tx, { actorId: input.actorId, key: input.key, hash })
    if (replay) return replay as LifecycleResult & { deletionId: string; purgeAfter: string }
    const target = await tx.user.findUnique({ where: { id: input.targetId }, select: { controlState: true } })
    if (!target || target.controlState !== 'active') throw new ControlLifecycleFailure('conflict', 'User is not active')

    const currentPreview = await userPreview(tx, input.targetId)
    if (currentPreview.fingerprint !== input.fingerprint) throw new ControlLifecycleFailure('stale_preview', 'Impact changed; preview again')
    const affected = await tx.$queryRaw<Array<{ familyId: string; userId: string; role: Role; version: number; epoch: number }>>`
      SELECT fm.family_id AS "familyId", fm.user_id AS "userId", fm.role::text AS role,
             fm.version, fm.membership_epoch AS epoch
        FROM family_members fm JOIN families f ON f.id = fm.family_id
       WHERE fm.revoked_at IS NULL AND f.status = 'active'
         AND (fm.user_id = ${input.targetId}::uuid OR f.owner_user_id = ${input.targetId}::uuid)
       ORDER BY fm.family_id, fm.user_id
    `
    const lockedUsers = await lockUsers(tx, [input.targetId, ...affected.map(({ userId }) => userId)])
    if (!lockedUsers.some(({ id, state }) => id === input.targetId && state === 'active')) {
      throw new ControlLifecycleFailure('conflict', 'User is not active')
    }
    const familyIds = await tx.$queryRaw<Array<{ id: string; originalStatus: FamilyState }>>`
      SELECT id, status::text AS "originalStatus" FROM families WHERE owner_user_id = ${input.targetId}::uuid ORDER BY id
    `
    const ownedFamilyIds = familyIds.map(({ id }) => id)
    const allFamilyIds = [...new Set([...ownedFamilyIds, ...affected.map(({ familyId }) => familyId)])].sort()
    if (allFamilyIds.length) await tx.$queryRaw`SELECT id FROM families WHERE id = ANY(${allFamilyIds}::uuid[]) ORDER BY id FOR UPDATE`

    const stable = await tx.$queryRaw<Array<{ familyId: string; userId: string; role: Role; version: number; epoch: number }>>`
      SELECT fm.family_id AS "familyId", fm.user_id AS "userId", fm.role::text AS role,
             fm.version, fm.membership_epoch AS epoch
        FROM family_members fm JOIN families f ON f.id = fm.family_id
       WHERE fm.revoked_at IS NULL AND f.status = 'active'
         AND (fm.user_id = ${input.targetId}::uuid OR f.owner_user_id = ${input.targetId}::uuid)
       ORDER BY fm.family_id, fm.user_id
    `
    if (digest(stable.map(({ familyId, userId, role, version, epoch }) => [familyId, userId, role, version, epoch])) !== digest(affected.map(({ familyId, userId, role, version, epoch }) => [familyId, userId, role, version, epoch]))) {
      throw new ControlLifecycleFailure('scope_changed', 'Memberships changed during deletion; retry with a fresh preview')
    }
    const lockedUserIds = new Set([input.targetId, ...affected.map(({ userId }) => userId)])
    if (stable.some(({ userId }) => !lockedUserIds.has(userId))) {
      throw new ControlLifecycleFailure('scope_changed', 'A family member joined during deletion; retry with a fresh preview')
    }
    const lockedPreview = await userPreview(tx, input.targetId)
    if (lockedPreview.fingerprint !== input.fingerprint) throw new ControlLifecycleFailure('stale_preview', 'Impact changed; preview again')
    const actionNow = now ?? new Date()
    const deletion = await tx.controlUserDeletion.create({ data: {
      targetUserId: input.targetId,
      actorUserId: input.actorId,
      deletedAt: actionNow,
      purgeAfter: new Date(actionNow.getTime() + USER_PURGE_GRACE_MS),
    } })

    for (const member of stable) {
      await tx.controlAccessSnapshot.upsert({
        where: { familyId_userId: { familyId: member.familyId, userId: member.userId } },
        create: {
          familyId: member.familyId, userId: member.userId, deletionId: deletion.id, role: member.role,
          expectedRevokedVersion: member.version + 1, expectedRevokedEpoch: member.epoch + 1,
        },
        update: {
          deletionId: deletion.id,
          role: member.role,
          expectedRevokedVersion: member.version + 1,
          expectedRevokedEpoch: member.epoch + 1,
          cancelledAt: null,
          createdAt: actionNow,
        },
      })
      await tx.familyMember.update({
        where: { familyId_userId: { familyId: member.familyId, userId: member.userId } },
        data: { revokedAt: actionNow, version: { increment: 1 }, membershipEpoch: { increment: 1 } },
      })
    }
    if (ownedFamilyIds.length) {
      await tx.controlUserDeletionFamily.createMany({
        data: familyIds.map(({ id: familyId, originalStatus }) => ({
          deletionId: deletion.id, familyId, originalStatus, restoreEligible: originalStatus === 'active',
        })),
      })
      await tx.family.updateMany({
        where: { id: { in: familyIds.filter(({ originalStatus }) => originalStatus === 'active').map(({ id }) => id) }, status: 'active' },
        data: { status: 'deleting', controlVersion: { increment: 1 } },
      })
    }
    await tx.user.update({ where: { id: input.targetId }, data: { controlState: 'trashed', controlVersion: { increment: 1 } } })
    await tx.authSession.updateMany({ where: { userId: input.targetId, revokedAt: null }, data: { revokedAt: actionNow } })
    await tx.passwordResetToken.updateMany({ where: { userId: input.targetId, usedAt: null }, data: { usedAt: actionNow } })
    await tx.browserLoginChallenge.updateMany({
      where: { approvedUserId: input.targetId, state: 'approved', redeemedAt: null },
      data: { state: 'redeemed', redeemedAt: actionNow },
    })
    const result: LifecycleResult & { deletionId: string; purgeAfter: string } = {
      operation: 'user_trashed', targetId: input.targetId, deletionId: deletion.id, state: 'trashed', purgeAfter: deletion.purgeAfter.toISOString(),
    }
    return recordCommand(tx, { actorId: input.actorId, key: input.key, operation, targetId: input.targetId, hash, result })
  }, userAuthorityTransitionTransactionOptions)
}

export async function restoreControlUser(
  db: DbClient,
  input: { actorId: string; targetId: string; protectedIds: readonly string[]; key: string; deletionId: string },
  now?: Date,
): Promise<LifecycleResult> {
  assertUuid(input.actorId, 'actorId'); assertUuid(input.targetId, 'targetId'); assertUuid(input.key, 'key'); assertUuid(input.deletionId, 'deletionId')
  protectTarget(input.targetId, input.protectedIds)
  const operation = 'user.restore'
  const hash = digest({ operation, targetId: input.targetId, deletionId: input.deletionId })
  return db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    await acquireUserAuthenticationAuthorityLock(tx, input.targetId)
    const [target] = await lockUsers(tx, [input.targetId])
    const replay = await findReplay(tx, { actorId: input.actorId, key: input.key, hash })
    if (replay) return replay
    const deletion = await tx.controlUserDeletion.findFirst({
      where: { id: input.deletionId, targetUserId: input.targetId, restoredAt: null },
    })
    if (!deletion || !target || target.state !== 'trashed') throw new ControlLifecycleFailure('stale_deletion_cycle', 'This deletion cycle is no longer restorable')
    const familyIds = await tx.controlUserDeletionFamily.findMany({
      where: { deletionId: deletion.id }, select: { familyId: true, restoreEligible: true }, orderBy: { familyId: 'asc' },
    })
    const ownedFamilyIds = familyIds.map(({ familyId }) => familyId)
    const restoreEligibleIds = familyIds.filter(({ restoreEligible }) => restoreEligible).map(({ familyId }) => familyId)
    const candidateFilter = {
      cancelledAt: null,
      OR: [{ userId: input.targetId }, ...(ownedFamilyIds.length ? [{ familyId: { in: ownedFamilyIds } }] : [])],
    }
    const pendingSnapshots = await tx.controlAccessSnapshot.findMany({
      where: candidateFilter,
      select: { familyId: true, userId: true, role: true, expectedRevokedVersion: true, expectedRevokedEpoch: true },
      orderBy: [{ familyId: 'asc' }, { userId: 'asc' }],
    })
    await lockUsers(tx, [...pendingSnapshots.map(({ userId }) => userId), input.targetId])
    const allFamilyIds = [...new Set([...ownedFamilyIds, ...pendingSnapshots.map(({ familyId }) => familyId)])].sort()
    if (allFamilyIds.length) await tx.$queryRaw`SELECT id FROM families WHERE id = ANY(${allFamilyIds}::uuid[]) ORDER BY id FOR UPDATE`
    const snapshots = await tx.controlAccessSnapshot.findMany({
      where: candidateFilter,
      select: { familyId: true, userId: true, role: true, expectedRevokedVersion: true, expectedRevokedEpoch: true },
      orderBy: [{ familyId: 'asc' }, { userId: 'asc' }],
    })
    const actionNow = now ?? new Date()
    if (deletion.purgeAfter <= actionNow) throw new ControlLifecycleFailure('restore_expired', 'The restore period has ended')

    await tx.user.update({ where: { id: input.targetId }, data: { controlState: 'active', controlVersion: { increment: 1 } } })
    await tx.controlUserDeletion.update({ where: { id: deletion.id }, data: { restoredAt: actionNow } })
    await tx.$queryRaw`SELECT set_config('app.control_user_restore_cycle', ${deletion.id}, true)`
    const independentlyDeleting = restoreEligibleIds.length
      ? await tx.controlFamilyDeletion.findMany({ where: { familyId: { in: restoreEligibleIds } }, select: { familyId: true } })
      : []
    const independentlyDeletingIds = independentlyDeleting.map(({ familyId }) => familyId)
    if (restoreEligibleIds.length) {
      await tx.family.updateMany({
        where: { id: { in: restoreEligibleIds.filter((id) => !independentlyDeletingIds.includes(id)) }, status: 'deleting' },
        data: { status: 'active', controlVersion: { increment: 1 } },
      })
    }

    for (const snapshot of snapshots) {
      const restored = await tx.$executeRaw`
        UPDATE family_members fm
           SET revoked_at = NULL, role = ${snapshot.role}::family_role,
               version = version + 1, membership_epoch = membership_epoch + 1
          FROM families f, users u
         WHERE fm.family_id = ${snapshot.familyId}::uuid
           AND fm.user_id = ${snapshot.userId}::uuid
           AND fm.version = ${snapshot.expectedRevokedVersion}
           AND fm.membership_epoch = ${snapshot.expectedRevokedEpoch}
           AND fm.revoked_at IS NOT NULL
           AND f.id = fm.family_id AND f.status = 'active'
           AND u.id = fm.user_id AND u.control_state = 'active'
      `
      if (Number(restored) > 0) {
        await tx.controlAccessSnapshot.delete({ where: { familyId_userId: { familyId: snapshot.familyId, userId: snapshot.userId } } })
      }
    }
    const result: LifecycleResult = { operation: 'user_restored', targetId: input.targetId, deletionId: deletion.id, state: 'active' }
    return recordCommand(tx, { actorId: input.actorId, key: input.key, operation, targetId: input.targetId, hash, result })
  }, userAuthorityTransitionTransactionOptions)
}

export async function purgeControlFamily(
  db: DbClient,
  input: { actorId: string; targetId: string; protectedIds: readonly string[]; key: string; fingerprint: string; confirmation: string },
  now?: Date,
): Promise<LifecycleResult> {
  assertUuid(input.actorId, 'actorId'); assertUuid(input.targetId, 'targetId'); assertUuid(input.key, 'key')
  assertConfirmation(input.confirmation, input.targetId)
  const operation = 'family.purge'
  const hash = payloadHash(operation, input.targetId, input.fingerprint, input.confirmation)
  return db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    const initial = await tx.family.findUnique({ where: { id: input.targetId }, select: { ownerUserId: true } })
    if (!initial) throw new ControlLifecycleFailure('not_found', 'Family not found')
    const members = await tx.familyMember.findMany({ where: { familyId: input.targetId, revokedAt: null }, select: { userId: true } })
    await lockUsers(tx, [input.actorId, initial.ownerUserId, ...members.map(({ userId }) => userId)])
    await tx.$queryRaw`SELECT id FROM families WHERE id = ${input.targetId}::uuid FOR UPDATE`
    const replay = await findReplay(tx, { actorId: input.actorId, key: input.key, hash })
    if (replay) return replay
    const currentPreview = await familyPreview(tx, input.targetId)
    if (currentPreview.fingerprint !== input.fingerprint) throw new ControlLifecycleFailure('stale_preview', 'Impact changed; preview again')
    if (await tx.controlFamilyDeletion.findUnique({ where: { familyId: input.targetId }, select: { id: true } })) {
      throw new ControlLifecycleFailure('already_purging', 'Family purge has already started')
    }
    const family = await tx.family.findUniqueOrThrow({ where: { id: input.targetId }, select: { status: true, controlVersion: true } })
    const actionNow = now ?? new Date()
    await tx.controlFamilyDeletion.create({ data: { familyId: input.targetId, actorUserId: input.actorId, requestedAt: actionNow } })
    if (family.status === 'active') {
      await tx.family.update({ where: { id: input.targetId }, data: { status: 'deleting', controlVersion: family.controlVersion + 1 } })
    }
    const result: LifecycleResult = { operation: 'family_purge_started', targetId: input.targetId, state: 'deleting' }
    return recordCommand(tx, { actorId: input.actorId, key: input.key, operation, targetId: input.targetId, hash, result })
  }, userAuthorityTransitionTransactionOptions)
}
