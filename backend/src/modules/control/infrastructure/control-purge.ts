import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { PrivateStorage } from '../../../storage'
import { mediaPurgeObjectKeys } from '../../media'

type Tx = Parameters<Parameters<DbClient['$transaction']>[0]>[0]
type Runtime = { db: DbClient; storage: PrivateStorage }
type FamilyOperation = { id: string; familyId: string; actorUserId?: string; purgeStage: string; purgeCursor: string | null; keysCapturedAt: Date | null; lastAttemptAt?: Date | null }
type UserOperation = { id: string; targetUserId: string; purgeStage: string; purgeCursor: string | null; lastAttemptAt?: Date | null }
type MaintenanceOptions = { budgetMs?: number; objectTimeoutMs?: number }

const IN_FLIGHT_AND_PUT_SAFETY_MS = 16 * 60 * 1000
const MAX_BATCH = 100
const MAX_OPERATIONS_PER_PASS = 4
const DEFAULT_PASS_BUDGET_MS = 45_000
const DEFAULT_OBJECT_TIMEOUT_MS = 10_000
const RETIREMENT_RECHECK_MS = 15 * 60 * 1000

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

function attemptAt(now: Date, previous: Date | null | undefined) {
  return new Date(Math.max(now.getTime(), Date.now(), (previous?.getTime() ?? 0) + 1))
}

async function enqueueStorageDeletes(tx: Tx, operationId: string, rows: Array<{ objectKey: string; familyId?: string; userId?: string; notBefore: Date }>) {
  if (!rows.length) return
  const keys = [...new Set(rows.map(({ objectKey }) => objectKey))]
  const existing = await tx.controlStorageDelete.findMany({ where: { objectKey: { in: keys } }, select: { operationId: true, objectKey: true } })
  if (existing.some((row) => row.operationId !== operationId)) throw new Error('storage_key_scope_conflict')
  await tx.controlStorageDelete.createMany({
    data: rows.map((row) => ({ operationId, ...row })), skipDuplicates: true,
  })
}

async function startExpiredUserOperations(db: DbClient, now: Date, limit: number, deadline: number) {
  const due = await db.controlUserDeletion.findMany({
    where: { restoredAt: null, purgeAfter: { lte: now }, purgeStage: 'waiting' },
    orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { purgeAfter: 'asc' }, { id: 'asc' }], take: limit,
    select: { id: true, targetUserId: true, lastAttemptAt: true },
  })
  for (const deletion of due) {
    if (performance.now() >= deadline) break
    try { await db.$transaction(async (tx) => {
      await lifecycleLock(tx)
      const [user] = await tx.$queryRaw<Array<{ id: string; control_state: string }>>`
        SELECT id, control_state::text FROM users WHERE id = ${deletion.targetUserId}::uuid FOR NO KEY UPDATE
      `
      if (!user || user.control_state === 'active' || user.control_state === 'purged') return
      const cycle = await tx.controlUserDeletion.findFirst({
        where: { id: deletion.id, targetUserId: deletion.targetUserId, restoredAt: null, purgeAfter: { lte: now }, purgeStage: 'waiting' },
      })
      if (!cycle) return
      await tx.controlUserDeletion.update({ where: { id: cycle.id }, data: { lastAttemptAt: attemptAt(now, cycle.lastAttemptAt) } })
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
          familyId, actorUserId: cycle.actorUserId, requestedAt: now,
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
    } catch {
      await db.controlUserDeletion.updateMany({ where: { id: deletion.id, purgeStage: 'waiting', restoredAt: null }, data: { lastAttemptAt: attemptAt(now, deletion.lastAttemptAt), lastErrorCode: 'profile_cleanup_failed' } })
    }
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
        await enqueueStorageDeletes(tx, operation.id, keys.map((objectKey) => ({ familyId: operation.familyId, objectKey, notBefore })))
      }
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeCursor: assets.at(-1)!.id, lastErrorCode: null } })
      return
    }
    await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { keysCapturedAt: now, purgeStage: 'fence_media', purgeCursor: null, lastErrorCode: null } })
  }, { timeout: 15_000 })
}

async function fenceFamilyMedia(db: DbClient, operation: FamilyOperation, now: Date, batchSize: number) {
  await db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    const [family] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status::text FROM families WHERE id = ${operation.familyId}::uuid FOR UPDATE
    `
    if (!family || family.status === 'active') return
    const current = await tx.controlFamilyDeletion.findUnique({ where: { id: operation.id } })
    if (!current || current.purgedAt || !current.keysCapturedAt || current.purgeStage !== 'fence_media') return
    await tx.$queryRaw`SELECT set_config('app.control_family_purge_operation', ${operation.id}, true)`
    const assets = await tx.mediaAsset.findMany({
      where: { familyId: operation.familyId, ...(current.purgeCursor ? { id: { gt: current.purgeCursor } } : {}) },
      orderBy: { id: 'asc' }, take: batchSize,
      include: { variants: { select: { objectKey: true } }, reservation: { select: { expiresAt: true } } },
    })
    if (!assets.length) {
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'objects', purgeCursor: null, lastErrorCode: null } })
      return
    }
    for (const asset of assets) {
      await tx.mediaAsset.updateMany({ where: { id: asset.id, familyId: operation.familyId, deletedAt: null }, data: { deletedAt: now } })
      const keys = mediaPurgeObjectKeys({ originalKey: asset.originalKey, mediaKind: asset.mediaKind, variants: asset.variants })
      const queued = await tx.controlStorageDelete.findMany({ where: { operationId: operation.id, objectKey: { in: keys } }, select: { id: true, objectKey: true, notBefore: true } })
      if (queued.length !== keys.length || new Set(queued.map(({ objectKey }) => objectKey)).size !== keys.length) {
        throw new Error('family_media_fence_missing_captured_storage_key')
      }
      const safeAt = new Date(now.getTime() + IN_FLIGHT_AND_PUT_SAFETY_MS)
      const notBefore = asset.reservation?.expiresAt && asset.reservation.expiresAt > safeAt ? asset.reservation.expiresAt : safeAt
      for (const row of queued) {
        await tx.controlStorageDelete.update({ where: { id: row.id }, data: {
          completedAt: null,
          notBefore: row.notBefore > notBefore ? row.notBefore : notBefore,
          lastErrorCode: null,
        } })
      }
    }
    await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: {
      purgeCursor: assets.at(-1)!.id,
      lastErrorCode: null,
    } })
  }, { timeout: 15_000 })
}

async function deleteOperationObjects(runtime: Runtime, operationId: string, now: Date, batchSize: number, deadline: number, objectTimeoutMs: number) {
  const rows = await runtime.db.controlStorageDelete.findMany({
    where: { operationId, completedAt: null, notBefore: { lte: now }, nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: batchSize,
  })
  for (const row of rows) {
    if (performance.now() >= deadline) break
    const claimed = await runtime.db.controlStorageDelete.updateMany({
      where: { id: row.id, completedAt: null, nextAttemptAt: { lte: now } },
      data: { attempts: { increment: 1 }, nextAttemptAt: retryAt(row.attempts + 1, now) },
    })
    if (claimed.count !== 1) continue
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const requestBudget = Math.max(1, Math.min(objectTimeoutMs, deadline - performance.now()))
      await Promise.race([
        runtime.storage.retireObject!(row.objectKey),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('storage_timeout'), { code: 'timeout' })), requestBudget) }),
      ])
      await runtime.db.controlStorageDelete.updateMany({ where: { id: row.id, completedAt: null }, data: { completedAt: now, lastErrorCode: null } })
    } catch (error) {
      const safeCode = typeof error === 'object' && error !== null && 'code' in error && error.code === 'timeout'
        ? 'storage_timeout' : errorCode(error)
      await runtime.db.controlStorageDelete.updateMany({ where: { id: row.id, completedAt: null }, data: { lastErrorCode: safeCode } })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

async function recheckCompletedRetirements(runtime: Runtime, now: Date, batchSize: number, deadline: number, objectTimeoutMs: number) {
  const cutoff = new Date(now.getTime() - RETIREMENT_RECHECK_MS)
  const rows = await runtime.db.controlStorageDelete.findMany({
    where: { completedAt: { lte: cutoff }, nextAttemptAt: { lte: now } },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }], take: batchSize,
  })
  for (const row of rows) {
    if (performance.now() >= deadline) break
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const requestBudget = Math.max(1, Math.min(objectTimeoutMs, deadline - performance.now()))
      await Promise.race([
        runtime.storage.retireObject!(row.objectKey),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('storage_timeout'), { code: 'timeout' })), requestBudget) }),
      ])
      await runtime.db.controlStorageDelete.updateMany({ where: { id: row.id, completedAt: row.completedAt }, data: { completedAt: now, nextAttemptAt: new Date(now.getTime() + RETIREMENT_RECHECK_MS), attempts: { increment: 1 }, lastErrorCode: null } })
    } catch (error) {
      const safeCode = typeof error === 'object' && error !== null && 'code' in error && error.code === 'timeout'
        ? 'storage_timeout' : errorCode(error)
      await runtime.db.controlStorageDelete.updateMany({ where: { id: row.id, completedAt: row.completedAt }, data: { nextAttemptAt: retryAt(row.attempts + 1, now), attempts: { increment: 1 }, lastErrorCode: safeCode } })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

async function eraseFamilyArchive(db: DbClient, operation: FamilyOperation, now: Date, batchSize: number) {
  await db.$transaction(async (tx) => {
    await lifecycleLock(tx)
    const [family] = await tx.$queryRaw<Array<{ owner_user_id: string; status: string }>>`
      SELECT owner_user_id, status::text FROM families WHERE id = ${operation.familyId}::uuid FOR UPDATE
    `
    if (!family || family.status === 'active') return
    const current = await tx.controlFamilyDeletion.findUnique({ where: { id: operation.id } })
    const pending = await tx.controlStorageDelete.count({ where: { operationId: operation.id, completedAt: null } })
    if (!current || current.purgedAt || !current.keysCapturedAt || pending || current.notBefore > now) return
    await tx.$queryRaw`SELECT set_config('app.control_family_purge_operation', ${operation.id}, true)`
    if (current.purgeStage === 'capture_media') {
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'fence_media', purgeCursor: null } })
      return
    }
    if (current.purgeStage === 'fence_media') {
      return
    }
    if (current.purgeStage === 'objects') {
      await tx.$queryRaw`SELECT set_config('app.control_content_purge_operation', ${operation.id}, true)`
      await tx.$executeRaw`DELETE FROM max_video_legacy_retention WHERE family_id = ${operation.familyId}::uuid`
      const maxVideoReferences = await tx.$queryRaw<Array<{ id: string; memory_id: string }>>`
        SELECT id::text, memory_id::text FROM max_video_references WHERE family_id = ${operation.familyId}::uuid
      `
      const backupMemories = await tx.$queryRaw<Array<{ memory_id: string }>>`
        SELECT memory_id::text FROM max_memory_backups WHERE family_id = ${operation.familyId}::uuid
      `
      const navigationReplies = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT navigation.id::text FROM telegram_video_navigation_replies navigation
        JOIN telegram_video_deliveries delivery ON delivery.id = navigation.delivery_id
        JOIN telegram_video_references reference ON reference.id = delivery.reference_id
        WHERE reference.family_id = ${operation.familyId}::uuid
      `
      const maxVideoIds = maxVideoReferences.map(({ id }) => id)
      const maxMemoryIds = backupMemories.map(({ memory_id }) => memory_id)
      const telegramReplyIds = navigationReplies.map(({ id }) => id)
      if (maxVideoIds.length) await tx.$executeRaw`UPDATE task_outbox SET payload = '{}'::jsonb, status = 'skipped',
        processing_token = NULL, redacted_at = COALESCE(redacted_at, ${now}), last_error = NULL, updated_at = ${now}
        WHERE type = 'max:video-poster' AND payload->>'referenceId' = ANY(${maxVideoIds}::text[])`
      if (maxMemoryIds.length) await tx.$executeRaw`UPDATE task_outbox SET payload = '{}'::jsonb, status = 'skipped',
        processing_token = NULL, redacted_at = COALESCE(redacted_at, ${now}), last_error = NULL, updated_at = ${now}
        WHERE type = 'max:backup-media' AND payload->>'memoryId' = ANY(${maxMemoryIds}::text[])`
      if (telegramReplyIds.length) await tx.$executeRaw`UPDATE task_outbox SET payload = '{}'::jsonb, status = 'skipped',
        processing_token = NULL, redacted_at = COALESCE(redacted_at, ${now}), last_error = NULL, updated_at = ${now}
        WHERE type = 'telegram:navigation-reply:cleanup' AND payload->>'navigationReplyId' = ANY(${telegramReplyIds}::text[])`
      await tx.$executeRaw`DELETE FROM max_video_references WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`DELETE FROM telegram_video_references WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`DELETE FROM max_memory_backup_attachments WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`DELETE FROM max_memory_backups WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`DELETE FROM max_video_upload_sessions WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`UPDATE children SET avatar_media_id = NULL, avatar_crop = NULL WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`DELETE FROM caption_requests WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`DELETE FROM upload_reservations WHERE family_id = ${operation.familyId}::uuid`
      await tx.$executeRaw`DELETE FROM gifts WHERE family_id = ${operation.familyId}::uuid`
      await tx.albumSourceOperation.deleteMany({ where: { familyId: operation.familyId } })
      await tx.controlAccessSnapshot.deleteMany({ where: { familyId: operation.familyId } })
      await tx.controlFamilyActivity.deleteMany({ where: { familyId: operation.familyId } })

      const bindingRows = await tx.$queryRaw<Array<{ chat_id: bigint }>>`SELECT chat_id FROM max_channel_bindings WHERE family_id = ${operation.familyId}::uuid`
      const chatIds = bindingRows.map(({ chat_id }) => chat_id)
      const decisions = await tx.$queryRaw<Array<{ id: string; origin_inbox_id: string }>>`
        SELECT id::text, origin_inbox_id::text FROM max_channel_decisions
         WHERE selected_family_id = ${operation.familyId}::uuid
            OR candidate_family_ids::jsonb @> jsonb_build_array(${operation.familyId}::text)
            OR chat_id = ANY(${chatIds}::bigint[])
      `
      const decisionIds = decisions.map(({ id }) => id)
      const sources = await tx.$queryRaw<Array<{ id: string; inbox_id: string }>>`
        SELECT id::text, inbox_id::text FROM max_sources WHERE family_id = ${operation.familyId}::uuid
      `
      const maxInboxIds = [...new Set([...decisions.map(({ origin_inbox_id }) => origin_inbox_id), ...sources.map(({ inbox_id }) => inbox_id)])]
      const responses = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text FROM max_outgoing_responses
         WHERE inbox_id = ANY(${maxInboxIds}::uuid[]) OR channel_decision_id = ANY(${decisionIds}::uuid[])
      `
      const responseIds = responses.map(({ id }) => id)
      if (responseIds.length) await tx.$executeRaw`UPDATE task_outbox SET payload = '{}'::jsonb, status = 'skipped',
        processing_token = NULL, redacted_at = COALESCE(redacted_at, ${now}), last_error = NULL, updated_at = ${now}
        WHERE type = 'max:deliver-response' AND payload->>'responseId' = ANY(${responseIds}::text[])`
      if (maxInboxIds.length) {
        await tx.$executeRaw`UPDATE max_inbox SET encrypted_payload = ''::bytea, encryption_iv = ''::bytea,
          encryption_auth_tag = ''::bytea, status = 'processed', processed_at = COALESCE(processed_at, ${now}),
          control_redacted_at = COALESCE(control_redacted_at, ${now})
          WHERE id = ANY(${maxInboxIds}::uuid[])`
        await tx.$executeRaw`UPDATE max_outgoing_responses SET text = '', buttons = NULL WHERE inbox_id = ANY(${maxInboxIds}::uuid[])`
        await tx.$executeRaw`UPDATE task_outbox SET payload = '{}'::jsonb, status = 'skipped', processing_token = NULL,
          redacted_at = COALESCE(redacted_at, ${now}), last_error = NULL, updated_at = ${now}
          WHERE type = 'max:process' AND payload->>'inboxId' = ANY(${maxInboxIds}::text[])`
      }
      if (decisionIds.length) {
        await tx.$executeRaw`UPDATE max_outgoing_responses SET text = '', buttons = NULL WHERE channel_decision_id = ANY(${decisionIds}::uuid[])`
      }
      if (maxInboxIds.length) await tx.maxOutgoingResponse.deleteMany({ where: { inboxId: { in: maxInboxIds } } })
      if (decisionIds.length) await tx.maxOutgoingResponse.deleteMany({ where: { channelDecisionId: { in: decisionIds } } })
      if (decisionIds.length) await tx.maxChannelDecision.deleteMany({ where: { id: { in: decisionIds } } })
      await tx.maxChannelBinding.deleteMany({ where: { familyId: operation.familyId } })
      // The durable redacted inbox row retains the provider-event dedupe key and rejects source
      // replay. Delete the family-owned source itself: its selected target is immutable by design.
      if (sources.length) await tx.$executeRaw`DELETE FROM max_sources WHERE id = ANY(${sources.map(({ id }) => id)}::uuid[])`
      await tx.$executeRaw`DELETE FROM max_outbound_sources WHERE family_id = ${operation.familyId}::uuid`

      const telegram = await tx.$queryRaw<Array<{ id: string; inbox_id: string; bot_id: bigint; chat_id: bigint; media_group_id: string | null }>>`
        SELECT id::text, inbox_id::text, bot_id, chat_id, media_group_id FROM telegram_sources WHERE family_id = ${operation.familyId}::uuid
      `
      const telegramIds = telegram.map(({ id }) => id)
      const telegramInboxIds = telegram.map(({ inbox_id }) => inbox_id)
      const telegramAlbumIds: string[] = []
      for (const row of telegram) {
        if (!row.media_group_id) continue
        const albums = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text FROM telegram_albums WHERE bot_id = ${row.bot_id} AND chat_id = ${row.chat_id} AND media_group_id = ${row.media_group_id}
        `
        telegramAlbumIds.push(...albums.map(({ id }) => id))
      }
      if (telegramInboxIds.length || telegramIds.length || telegramAlbumIds.length) {
        await tx.$executeRaw`UPDATE task_outbox SET payload = '{}'::jsonb, status = 'skipped', processing_token = NULL,
          redacted_at = COALESCE(redacted_at, ${now}), last_error = NULL, updated_at = ${now}
          WHERE type = 'telegram:process' AND (
            payload->>'inboxId' = ANY(${telegramInboxIds}::text[])
            OR payload->>'sourceId' = ANY(${telegramIds}::text[])
            OR payload->>'albumId' = ANY(${telegramAlbumIds}::text[]))`
      }
      if (telegramInboxIds.length) await tx.$executeRaw`UPDATE telegram_inbox SET encrypted_payload = ''::bytea,
        encryption_iv = ''::bytea, encryption_auth_tag = ''::bytea, processed_at = COALESCE(processed_at, ${now}),
        control_redacted_at = COALESCE(control_redacted_at, ${now})
        WHERE id = ANY(${telegramInboxIds}::uuid[])`
      if (telegramAlbumIds.length) await tx.$executeRaw`DELETE FROM telegram_albums WHERE id = ANY(${telegramAlbumIds}::uuid[])`
      // Telegram inbox identity (bot_id, update_id) remains redacted as the replay fence.
      // Its owned source has no independent retention purpose once the family archive is erased.
      if (telegramIds.length) await tx.$executeRaw`DELETE FROM telegram_sources WHERE id = ANY(${telegramIds}::uuid[])`

      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'memories', purgeCursor: null, lastErrorCode: null } })
      return
    }
    const cursor = current.purgeCursor
    if (current.purgeStage === 'memories') {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text FROM memories WHERE family_id = ${operation.familyId}::uuid
          AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid) ORDER BY id LIMIT ${batchSize}
      `
      if (rows.length) await tx.$executeRaw`DELETE FROM memories WHERE id = ANY(${rows.map(({ id }) => id)}::uuid[])`
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: rows.length === batchSize
        ? { purgeCursor: rows.at(-1)!.id } : { purgeStage: 'albums', purgeCursor: null } })
      return
    }
    if (current.purgeStage === 'albums') {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text FROM albums WHERE family_id = ${operation.familyId}::uuid
          AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid) ORDER BY id LIMIT ${batchSize}
      `
      if (rows.length) await tx.$executeRaw`DELETE FROM albums WHERE id = ANY(${rows.map(({ id }) => id)}::uuid[])`
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: rows.length === batchSize
        ? { purgeCursor: rows.at(-1)!.id } : { purgeStage: 'final_rescan', purgeCursor: null } })
      return
    }
    if (current.purgeStage === 'final_rescan') {
      const assets = await tx.mediaAsset.findMany({ where: { familyId: operation.familyId, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' }, take: batchSize, include: { variants: { select: { objectKey: true } }, reservation: { select: { expiresAt: true } } } })
      if (assets.length) {
        const floor = new Date(now.getTime() + IN_FLIGHT_AND_PUT_SAFETY_MS)
        const missing: Array<{ objectKey: string; familyId: string; notBefore: Date }> = []
        for (const asset of assets) {
          const safeAt = asset.reservation?.expiresAt && asset.reservation.expiresAt > floor ? asset.reservation.expiresAt : floor
          const keys = mediaPurgeObjectKeys({ originalKey: asset.originalKey, mediaKind: asset.mediaKind, variants: asset.variants })
          const queued = await tx.controlStorageDelete.findMany({ where: { objectKey: { in: keys } }, select: { operationId: true, objectKey: true } })
          for (const objectKey of keys) {
            const owner = queued.find((row) => row.objectKey === objectKey)
            if (owner && owner.operationId !== operation.id) throw new Error('storage_key_scope_conflict')
            if (!owner) missing.push({ familyId: operation.familyId, objectKey, notBefore: safeAt })
          }
        }
        await enqueueStorageDeletes(tx, operation.id, missing)
        await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeCursor: assets.at(-1)!.id } })
        return
      }
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'media', purgeCursor: null } })
      return
    }
    if (current.purgeStage === 'media') {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text FROM media_assets WHERE family_id = ${operation.familyId}::uuid
          AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid) ORDER BY id LIMIT ${batchSize}
      `
      const ids = rows.map(({ id }) => id)
      if (ids.length) {
        // A stale or partially completed earlier stage must not leave a child FK
        // pointing at a media row when this bounded batch is deleted.
        await tx.$executeRaw`UPDATE children SET avatar_media_id = NULL, avatar_crop = NULL
          WHERE avatar_media_id = ANY(${ids}::uuid[])`
        await tx.$executeRaw`DELETE FROM max_video_legacy_retention WHERE family_id = ${operation.familyId}::uuid AND media_id = ANY(${ids}::uuid[])`
        await tx.$executeRaw`DELETE FROM media_assets WHERE id = ANY(${ids}::uuid[])`
      }
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: rows.length === batchSize
        ? { purgeCursor: rows.at(-1)!.id } : { purgeStage: 'children', purgeCursor: null } })
      return
    }
    if (current.purgeStage === 'children') {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text FROM children WHERE family_id = ${operation.familyId}::uuid
          AND (${cursor}::uuid IS NULL OR id > ${cursor}::uuid) ORDER BY id LIMIT ${batchSize}
      `
      if (rows.length) await tx.$executeRaw`DELETE FROM children WHERE id = ANY(${rows.map(({ id }) => id)}::uuid[])`
      await tx.controlFamilyDeletion.update({ where: { id: operation.id }, data: rows.length === batchSize
        ? { purgeCursor: rows.at(-1)!.id } : { purgeStage: 'finalize', purgeCursor: null } })
      return
    }
    if (current.purgeStage !== 'finalize') return
    await tx.$executeRaw`DELETE FROM family_invites WHERE family_id = ${operation.familyId}::uuid`
    await tx.$executeRaw`DELETE FROM family_members WHERE family_id = ${operation.familyId}::uuid AND user_id <> ${family.owner_user_id}::uuid`
    await tx.$executeRaw`UPDATE family_members SET family_display_name = NULL, revoked_at = COALESCE(revoked_at, ${now})
      WHERE family_id = ${operation.familyId}::uuid AND user_id = ${family.owner_user_id}::uuid`
    await tx.family.update({ where: { id: operation.familyId }, data: {
      name: 'Удалённый архив', status: 'deleted', maxBackupChatId: null, maxBackupNextSendAt: null,
      storageUsedBytes: 0n, storageReservedBytes: 0n,
    } })
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
      await enqueueStorageDeletes(tx, operation.id, avatars.map((avatar) => ({ userId: operation.targetUserId, objectKey: avatar.objectKey,
        notBefore: avatar.expiresAt > notBeforeFloor ? avatar.expiresAt : notBeforeFloor })))
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
    const incomplete = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
        FROM control_user_deletion_families link
        LEFT JOIN control_family_deletions deletion ON deletion.family_id = link.family_id
        LEFT JOIN families family ON family.id = link.family_id
       WHERE link.deletion_id = ${operation.id}::uuid
         AND (deletion.purged_at IS NULL OR family.status::text IS DISTINCT FROM 'deleted'
           OR EXISTS (SELECT 1 FROM memories WHERE family_id = link.family_id)
           OR EXISTS (SELECT 1 FROM children WHERE family_id = link.family_id)
           OR EXISTS (SELECT 1 FROM media_assets WHERE family_id = link.family_id)
           OR EXISTS (SELECT 1 FROM gifts WHERE family_id = link.family_id)
           OR EXISTS (SELECT 1 FROM albums WHERE family_id = link.family_id)
           OR EXISTS (SELECT 1 FROM max_channel_bindings WHERE family_id = link.family_id)
           OR EXISTS (SELECT 1 FROM max_sources WHERE family_id = link.family_id)
           OR EXISTS (SELECT 1 FROM telegram_sources WHERE family_id = link.family_id))
    `
    if (Number(incomplete[0]?.count ?? 0n) > 0) {
      await tx.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'families' } })
      return
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
    await tx.controlUserActivity.deleteMany({ where: { userId: operation.targetUserId } })
    await tx.familyMember.updateMany({ where: { userId: operation.targetUserId }, data: { familyDisplayName: null } })
    await tx.user.update({ where: { id: operation.targetUserId }, data: {
      displayName: null, email: null, passwordHash: null, welcomeShownAt: null, role: 'user', controlState: 'purged',
    } })
    await tx.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'purged', purgedAt: now, lastErrorCode: null } })
  }, { timeout: 30_000 })
}

async function processUserOperations(runtime: Runtime, now: Date, batchSize: number, deadline: number, objectTimeoutMs: number) {
  const operations = await runtime.db.controlUserDeletion.findMany({
    where: { restoredAt: null, purgeAfter: { lte: now }, purgeStage: { not: 'purged' } },
    orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { purgeAfter: 'asc' }, { id: 'asc' }], take: MAX_OPERATIONS_PER_PASS,
    select: { id: true, targetUserId: true, purgeStage: true, purgeCursor: true, lastAttemptAt: true },
  })
  for (const operation of operations) {
    if (performance.now() >= deadline) break
    await runtime.db.controlUserDeletion.update({ where: { id: operation.id }, data: { lastAttemptAt: attemptAt(now, operation.lastAttemptAt) } })
    try {
      const linked = await runtime.db.controlUserDeletionFamily.findMany({ where: { deletionId: operation.id }, select: { familyId: true } })
      const latest = await runtime.db.controlUserDeletion.findUniqueOrThrow({ where: { id: operation.id }, select: { purgeStage: true, purgeCursor: true } })
      if (latest.purgeStage === 'families') {
        const familyIds = linked.map(({ familyId }) => familyId)
        const familyOps = familyIds.length ? await runtime.db.controlFamilyDeletion.count({ where: { familyId: { in: familyIds }, purgedAt: null } }) : 0
        if (familyOps) continue
        await runtime.db.controlUserDeletion.update({ where: { id: operation.id }, data: { purgeStage: 'profile_keys', purgeCursor: null, lastErrorCode: null } })
      } else if (latest.purgeStage === 'profile_keys') {
        await captureUserAvatarKeys(runtime.db, { ...operation, ...latest }, now, batchSize)
      } else if (latest.purgeStage === 'profile_objects') {
        await deleteOperationObjects(runtime, operation.id, now, batchSize, deadline, objectTimeoutMs)
        await finalizeUser(runtime.db, operation, now)
      }
    } catch {
      await runtime.db.controlUserDeletion.updateMany({ where: { id: operation.id, purgeStage: { not: 'purged' } }, data: { lastAttemptAt: attemptAt(now, operation.lastAttemptAt), lastErrorCode: 'profile_cleanup_failed' } })
    }
  }
}

export async function runControlDeletionMaintenance(runtime: Runtime, now = new Date(), requestedBatchSize = 20, options: MaintenanceOptions = {}) {
  const batchSize = Math.max(1, Math.min(MAX_BATCH, Math.trunc(requestedBatchSize)))
  const budgetMs = Math.max(1, Math.min(DEFAULT_PASS_BUDGET_MS, Math.trunc(options.budgetMs ?? DEFAULT_PASS_BUDGET_MS)))
  const objectTimeoutMs = Math.max(1, Math.min(DEFAULT_OBJECT_TIMEOUT_MS, Math.trunc(options.objectTimeoutMs ?? DEFAULT_OBJECT_TIMEOUT_MS)))
  const deadline = performance.now() + budgetMs
  if (typeof runtime.storage.retireObject !== 'function') {
    const [families, users] = await Promise.all([
      runtime.db.controlFamilyDeletion.count({ where: { purgedAt: null } }),
      runtime.db.controlUserDeletion.count({ where: { restoredAt: null, purgeAfter: { lte: now }, purgeStage: { not: 'purged' } } }),
    ])
    if (families || users) throw new Error('control_irreversible_storage_retirement_unsupported')
    return
  }
  const recheckDeadline = Math.min(deadline, performance.now() + Math.min(5_000, Math.floor(budgetMs / 4)))
  await recheckCompletedRetirements(runtime, now, batchSize, recheckDeadline, objectTimeoutMs)
  await startExpiredUserOperations(runtime.db, now, Math.min(MAX_OPERATIONS_PER_PASS, batchSize), deadline)
  const familyOperations = await runtime.db.controlFamilyDeletion.findMany({
    where: { purgedAt: null }, orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { requestedAt: 'asc' }, { id: 'asc' }], take: MAX_OPERATIONS_PER_PASS,
    select: { id: true, familyId: true, purgeStage: true, purgeCursor: true, keysCapturedAt: true, lastAttemptAt: true },
  })
  for (const operation of familyOperations) {
    if (performance.now() >= deadline) break
    try {
      const latest = await runtime.db.controlFamilyDeletion.findUniqueOrThrow({ where: { id: operation.id }, select: { purgeStage: true, purgeCursor: true, keysCapturedAt: true, lastAttemptAt: true } })
      await runtime.db.controlFamilyDeletion.update({ where: { id: operation.id }, data: { lastAttemptAt: attemptAt(now, latest.lastAttemptAt) } })
      if (latest.purgeStage === 'capture_media') await captureFamilyKeys(runtime.db, { ...operation, ...latest }, now, batchSize)
      const afterCapture = await runtime.db.controlFamilyDeletion.findUniqueOrThrow({ where: { id: operation.id }, select: { purgeStage: true, purgeCursor: true, keysCapturedAt: true } })
      if (afterCapture.purgeStage === 'fence_media') {
        await fenceFamilyMedia(runtime.db, { ...operation, ...afterCapture }, now, batchSize)
      }
      const afterFence = await runtime.db.controlFamilyDeletion.findUniqueOrThrow({ where: { id: operation.id }, select: { purgeStage: true, purgeCursor: true, keysCapturedAt: true } })
      if (afterFence.purgeStage !== 'fence_media' && afterFence.purgeStage !== 'capture_media') {
        await deleteOperationObjects(runtime, operation.id, now, batchSize, deadline, objectTimeoutMs)
      }
      const remaining = await runtime.db.controlStorageDelete.count({ where: { operationId: operation.id, completedAt: null } })
      const refreshed = await runtime.db.controlFamilyDeletion.findUnique({ where: { id: operation.id }, select: { keysCapturedAt: true } })
      if (refreshed?.keysCapturedAt && remaining === 0 && performance.now() < deadline) await eraseFamilyArchive(runtime.db, operation, now, batchSize)
    } catch {
      await runtime.db.controlFamilyDeletion.updateMany({ where: { id: operation.id, purgedAt: null }, data: { lastAttemptAt: attemptAt(now, operation.lastAttemptAt), lastErrorCode: 'archive_cleanup_failed' } })
    }
  }
  if (performance.now() < deadline) await processUserOperations(runtime, now, batchSize, deadline, objectTimeoutMs)
}
