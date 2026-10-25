import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { PrivateStorage } from '../../../storage'
import { mediaPurgeObjectKeys } from '../../media'

type Tx = Parameters<Parameters<DbClient['$transaction']>[0]>[0]
type Runtime = { db: DbClient; storage: PrivateStorage }
type FamilyOperation = { id: string; familyId: string; purgeStage: string; purgeCursor: string | null; keysCapturedAt: Date | null }
type UserOperation = { id: string; targetUserId: string; purgeStage: string; purgeCursor: string | null }

const IN_FLIGHT_AND_PUT_SAFETY_MS = 16 * 60 * 1000
const MAX_BATCH = 100

async function lifecycleLock(tx: Tx) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('control-user-lifecycle', 0))`)
}

function errorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error &&
      ['not_found', 'invalid_request', 'forbidden', 'unavailable', 'conflict'].includes(String(error.code))) {
    return `storage_${String(error.code)}`
  }
  return 'storage_unavailable'
}

function retryAt(attempts: number, now: Date) {
  return new Date(now.getTime() + Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 12)))
}

async function startExpiredUserOperations(db: DbClient, now: Date, limit: number) {
  const due = await db.controlUserDeletion.findMany({
    where: { restoredAt: null, purgeAfter: { lte: now }, purgeStage: 'waiting' },
    orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }], take: limit,
    select: { id: true, targetUserId: true },
  })
  for (const deletion of due) {
    await db.$transaction(async (tx) => {
      await lifecycleLock(tx)
      const [user] = await tx.$queryRaw<Array<{ id: string; control_state: string }>>`
        SELECT id, control_state::text FROM users WHERE id = ${deletion.targetUserId}::uuid FOR NO KEY UPDATE
      `
      if (!user || user.control_state === 'active' || user.control_state === 'purged') return
      const cycle = await tx.controlUserDeletion.findFirst({
        where: { id: deletion.id, targetUserId: deletion.targetUserId, restoredAt: null, purgeAfter: { lte: now }, purgeStage: 'waiting' },
      })
      if (!cycle) return
      const links = await tx.controlUserDeletionFamily.findMany({
        where: { deletionId: cycle.id }, select: { familyId: true }, orderBy: { familyId: 'asc' },
      })
      const familyIds = links.map(({ familyId }) => familyId)
      if (familyIds.length) await tx.$queryRaw`SELECT id FROM families WHERE id = ANY(${familyIds}::uuid[]) ORDER BY id FOR UPDATE`
      const existing = await tx.controlFamilyDeletion.findMany({ where: { familyId: { in: familyIds } }, select: { familyId: true } })
      const existingIds = new Set(existing.map(({ familyId }) => familyId))
      for (const familyId of familyIds) {
        if (!existingIds.has(familyId)) {
          await tx.controlFamilyDeletion.create({ data: {
            familyId, actorUserId: cycle.targetUserId, requestedAt: now,
            notBefore: new Date(now.getTime() + IN_FLIGHT_AND_PUT_SAFETY_MS),
          } })
        }
      }
      if (familyIds.length) {
        await tx.family.updateMany({ where: { id: { in: familyIds }, status: 'active' }, data: { status: 'deleting' } })
      }
      await tx.user.update({ where: { id: cycle.targetUserId }, data: { controlState: 'purging' } })
      await tx.controlUserDeletion.update({ where: { id: cycle.id }, data: { purgeStage: 'families', lastErrorCode: null } })
    }, { timeout: 15_000 })
  }
}

async function captureFamilyKeys(db: DbClient, operation: FamilyOperation, now: Date, batchSize: number) {
  await db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    const [family] = await tx.$queryRaw<Array<{ id: string; owner_user_id: string; status: string }>>`
      SELECT id, owner_user_id, status::text FROM families WHERE id = ${operation.familyId}::uuid FOR UPDATE
    `
    if (!family || family.status === 'active') return
    const current = await tx.controlFamilyDeletion.findUnique({ where: { id: operation.id } })
    if (!current || current.purgedAt || current.keysCapturedAt) return
    const assets = await tx.mediaAsset.findMany({
      where: { familyId: operation.familyId, ...(operation.purgeCursor ? { id: { gt: operation.purgeCursor } } : {}) },
      orderBy: { id: 'asc' }, take: batchSize,
      include: { variants: { select: { objectKey: true } }, reservation: { select: { expiresAt: true } } },
    })
    if (assets.length) {
      const safeAt = new Date(now.getTime() + IN_FLIGHT_AND_PUT_SAFETY_MS)
      for (const asset of assets) {
        const notBefore = asset.reservation?.expiresAt && asset.reservation.expiresAt > safeAt ? asset.reservation.expiresAt : safeAt
        const keys = mediaPurgeObjectKeys({ originalKey: asset.originalKey, mediaKind: asset.mediaKind, variants: asset.variants })
        await tx.controlStorageDelete.createMany({
          data: keys.map((objectKey) => ({ operationId: operation.id, familyId: operation.familyId, objectKey, notBefore })),
          skipDuplicates: true,
        })
      }
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeCursor: assets.at(-1)!.id, lastErrorCode: null } })
      return
    }
    await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { keysCapturedAt: now, purgeStage: 'objects', purgeCursor: null, lastErrorCode: null } })
  }, { timeout: 15_000 })
}

async function deleteOperationObjects(runtime: Runtime, operationId: string, now: Date, batchSize: number) {
  const rows = await runtime.db.controlStorageDelete.findMany({
    where: { operationId, completedAt: null, notBefore: { lte: now }, nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: batchSize,
  })
  for (const row of rows) {
    const claimed = await runtime.db.controlStorageDelete.updateMany({
      where: { id: row.id, completedAt: null, nextAttemptAt: { lte: now } },
      data: { attempts: { increment: 1 }, nextAttemptAt: retryAt(row.attempts + 1, now) },
    })
    if (claimed.count !== 1) continue
    try {
      await runtime.storage.deleteObject(row.objectKey)
      await runtime.db.controlStorageDelete.updateMany({ where: { id: row.id, completedAt: null }, data: { completedAt: now, lastErrorCode: null } })
    } catch (error) {
      await runtime.db.controlStorageDelete.updateMany({ where: { id: row.id, completedAt: null }, data: { lastErrorCode: errorCode(error) } })
    }
  }
}

async function eraseFamilyArchive(db: DbClient, operation: FamilyOperation, now: Date) {
  await db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    const family = await tx.family.findUnique({ where: { id: operation.familyId }, select: { ownerUserId: true, status: true } })
    if (!family || family.status === 'active') return
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${family.ownerUserId}::uuid FOR NO KEY UPDATE`
    await tx.$queryRaw`SELECT id FROM families WHERE id = ${operation.familyId}::uuid FOR UPDATE`
    const current = await tx.controlFamilyDeletion.findUnique({ where: { id: operation.id } })
    if (!current?.keysCapturedAt || current.purgedAt) return
    const unfinished = await tx.controlStorageDelete.count({ where: { operationId: operation.id, completedAt: null } })
    if (unfinished || current.notBefore > now) {
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'objects' } })
      return
    }
    await tx.$queryRaw`SELECT set_config('app.control_family_purge_operation', ${operation.id}, true)`
    await tx.$executeRaw`DELETE FROM "max_video_legacy_retention" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "max_video_references" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "telegram_video_references" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "max_memory_backup_attachments" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "max_memory_backups" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "max_video_upload_sessions" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`UPDATE "children" SET "avatar_media_id" = NULL, "avatar_crop" = NULL WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "max_outbound_sources" WHERE "family_id" = ${operation.familyId}::uuid`
    const inboxIds = await tx.$queryRaw<Array<{ inbox_id: string }>>`
      SELECT "inbox_id" FROM "max_sources" WHERE "family_id" = ${operation.familyId}::uuid
    `
    if (inboxIds.length) {
      const ids = inboxIds.map(({ inbox_id }) => inbox_id)
      await tx.$executeRaw`UPDATE "max_inbox" SET "encrypted_payload" = ''::bytea, "encryption_iv" = ''::bytea,
        "encryption_auth_tag" = ''::bytea, "status" = 'processed', "processed_at" = COALESCE("processed_at", ${now})
        WHERE "id" = ANY(${ids}::uuid[])`
      await tx.$executeRaw`DELETE FROM "max_outgoing_responses" WHERE "inbox_id" = ANY(${ids}::uuid[])`
      await tx.$executeRaw`DELETE FROM "max_sources" WHERE "inbox_id" = ANY(${ids}::uuid[])`
      await tx.$executeRaw`DELETE FROM "max_channel_decisions" WHERE "origin_inbox_id" = ANY(${ids}::uuid[])`
      await tx.$executeRaw`DELETE FROM "task_outbox" WHERE "type" = 'max:process' AND "payload"->>'inboxId' = ANY(${ids}::text[]) AND "status" <> 'processing'`
    }
    await tx.$executeRaw`DELETE FROM "caption_requests" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "upload_reservations" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "gifts" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "memories" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "albums" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "media_assets" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "children" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "family_invites" WHERE "family_id" = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "family_members" WHERE "family_id" = ${operation.familyId}::uuid AND "user_id" <> ${family.ownerUserId}::uuid`
    await tx.$executeRaw`UPDATE "family_members" SET "family_display_name" = NULL, "revoked_at" = COALESCE("revoked_at", ${now})
      WHERE "family_id" = ${operation.familyId}::uuid AND "user_id" = ${family.ownerUserId}::uuid`
    await tx.family.update({ where: { id: operation.familyId }, data: {
      name: 'Удалённый архив', status: 'deleted', maxBackupChatId: null, maxBackupNextSendAt: null,
      storageUsedBytes: 0n, storageReservedBytes: 0n,
    } })
    await tx.controlAccessSnapshot.deleteMany({ where: { familyId: operation.familyId } })
    await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'purged', purgedAt: now, lastErrorCode: null } })
  }, { timeout: 30_000 })
}

async function captureUserAvatarKeys(db: DbClient, operation: UserOperation, now: Date, batchSize: number) {
  await db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${operation.targetUserId}::uuid FOR NO KEY UPDATE`
    const avatars = await tx.userAvatar.findMany({
      where: { userId: operation.targetUserId, ...(operation.purgeCursor ? { id: { gt: operation.purgeCursor } } : {}) },
      orderBy: { id: 'asc' }, take: batchSize,
    })
    const notBeforeFloor = new Date(now.getTime() + IN_FLIGHT_AND_PUT_SAFETY_MS)
    if (avatars.length) {
      await tx.controlStorageDelete.createMany({
        data: avatars.map((avatar) => ({ operationId: operation.id, userId: operation.targetUserId, objectKey: avatar.objectKey,
          notBefore: avatar.expiresAt > notBeforeFloor ? avatar.expiresAt : notBeforeFloor })),
        skipDuplicates: true,
      })
      await tx.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeCursor: avatars.at(-1)!.id, lastErrorCode: null } })
      return
    }
    await tx.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'profile_objects', purgeCursor: null, lastErrorCode: null } })
  }, { timeout: 15_000 })
}

async function finalizeUser(db: DbClient, operation: UserOperation, now: Date) {
  await db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${operation.targetUserId}::uuid FOR NO KEY UPDATE`
    const current = await tx.controlUserDeletion.findUnique({ where: { id: operation.id } })
    if (!current || current.restoredAt || current.purgeAfter > now) return
    const linked = await tx.controlUserDeletionFamily.findMany({ where: { deletionId: operation.id }, select: { familyId: true } })
    if (linked.length) {
      const complete = await tx.controlFamilyDeletion.count({ where: { familyId: { in: linked.map(({ familyId }) => familyId) }, purgedAt: null } })
      if (complete > 0) {
        await tx.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'families' } })
        return
      }
    }
    const pending = await tx.controlStorageDelete.count({ where: { operationId: operation.id, completedAt: null } })
    if (pending) {
      await tx.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'profile_objects' } })
      return
    }
    await tx.userAvatar.deleteMany({ where: { userId: operation.targetUserId } })
    await tx.authSession.deleteMany({ where: { userId: operation.targetUserId } })
    await tx.passwordResetToken.deleteMany({ where: { userId: operation.targetUserId } })
    await tx.externalIdentity.deleteMany({ where: { userId: operation.targetUserId } })
    await tx.browserLoginChallenge.deleteMany({ where: { approvedUserId: operation.targetUserId } })
    await tx.idempotencyRecord.deleteMany({ where: { actorUserId: operation.targetUserId } })
    await tx.controlAccessSnapshot.deleteMany({ where: { userId: operation.targetUserId } })
    await tx.familyMember.updateMany({ where: { userId: operation.targetUserId }, data: { familyDisplayName: null } })
    await tx.user.update({ where: { id: operation.targetUserId }, data: {
      displayName: null, email: null, passwordHash: null, welcomeShownAt: null, role: 'user', controlState: 'purged',
    } })
    await tx.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'purged', purgedAt: now, lastErrorCode: null } })
  }, { timeout: 30_000 })
}

async function processUserOperations(runtime: Runtime, now: Date, batchSize: number) {
  const operations = await runtime.db.controlUserDeletion.findMany({
    where: { restoredAt: null, purgeAfter: { lte: now }, purgeStage: { not: 'purged' } },
    orderBy: [{ purgeAfter: 'asc' }, { id: 'asc' }], take: 1,
    select: { id: true, targetUserId: true, purgeStage: true, purgeCursor: true },
  })
  for (const operation of operations) {
    const linked = await runtime.db.controlUserDeletionFamily.findMany({ where: { deletionId: operation.id }, select: { familyId: true } })
    if (operation.purgeStage === 'families') {
      const familyOps = await runtime.db.controlFamilyDeletion.findMany({ where: { familyId: { in: linked.map(({ familyId }) => familyId) }, purgedAt: null }, take: 1 })
      if (familyOps[0]) continue
      await runtime.db.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'profile_keys' } })
    }
    if (operation.purgeStage === 'profile_keys') await captureUserAvatarKeys(runtime.db, operation, now, batchSize)
    if (operation.purgeStage === 'profile_objects') {
      await deleteOperationObjects(runtime, operation.id, now, batchSize)
      await finalizeUser(runtime.db, operation, now)
    }
  }
}

export async function runControlDeletionMaintenance(runtime: Runtime, now = new Date(), requestedBatchSize = 20) {
  const batchSize = Math.max(1, Math.min(MAX_BATCH, Math.trunc(requestedBatchSize)))
  await startExpiredUserOperations(runtime.db, now, batchSize)
  const familyOperations = await runtime.db.controlFamilyDeletion.findMany({
    where: { purgedAt: null }, orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }], take: 1,
    select: { id: true, familyId: true, purgeStage: true, purgeCursor: true, keysCapturedAt: true },
  })
  for (const operation of familyOperations) {
    if (operation.purgeStage === 'capture_media') await captureFamilyKeys(runtime.db, operation, now, batchSize)
    if (operation.purgeStage === 'objects' || operation.purgeStage === 'capture_media') {
      await deleteOperationObjects(runtime, operation.id, now, batchSize)
      const remaining = await runtime.db.controlStorageDelete.count({ where: { operationId: operation.id, completedAt: null } })
      const refreshed = await runtime.db.controlFamilyDeletion.findUnique({ where: { id: operation.id }, select: { keysCapturedAt: true } })
      if (refreshed?.keysCapturedAt && remaining === 0) await eraseFamilyArchive(runtime.db, operation, now)
    }
  }
  await processUserOperations(runtime, now, batchSize)
}
