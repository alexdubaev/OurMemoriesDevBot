import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { MaxApiPort } from '../application/ports'
import type { PrivateStorage } from '../../../storage'
import { fetchCdnVideo, selectRendition } from './video-playback'
import { MAX_DIRECT_VIDEO_MAX_BYTES } from '@web-app-demo/contracts'
import { enqueueMaxVideoPoster } from './video-poster'
import { MaxProviderError } from './max-api'

const MAX_BATCH_SIZE = 10
const MAX_RECOVERY_BASELINE_CATALOG_SHA256 = 'f5f2033cdb89806b6741dc1037c92f2134ba96587a8b50df2c12334337a12eb8'
const MAX_RECOVERY_LIFECYCLE_MIGRATIONS = [
  ['20261025160000_control_user_lifecycle', '910ee6aeda44457ae611a69994cd7f11eb6c1e0936ac33874cdcb8bd59f5df57'],
  ['20261025170000_control_durable_purge', 'f9ff69a061afefeceaeda618c4aeaf424563b2fed850d6e17808e23554b2fa8d'],
  ['20261025180000_control_purge_fences', 'eee2bddedbd167b1de111b16e8c0a75e054c9cf9c555752d73b8f02e3f2c3655'],
] as const
const MAX_RECOVERY_NOTIFICATION_MIGRATION = ['20261027210000_max_bot_stopped', 'f394dc4d1a981756729478576352efdbae1e955357d97be65fe95802782274b5'] as const

export type MaxVideoLegacyCandidate = {
  mediaId: string
  familyId: string
  memoryId: string
  position: number
  sourceId: string
  providerMessageId: string
  providerAttachmentId: string
  providerRecipientId: string
  providerChannelId: string | null
  width: number | null
  height: number | null
  durationMs: number | null
  thumbnailMediaId: string | null
  snapshot: unknown
}

export type MaxVideoLegacyPlan = { version: 1; offset: number; scanned: number; totalRows: number; hasMore: boolean; candidates: MaxVideoLegacyCandidate[]; skipped: Array<{ mediaId: string; reason: string }> }

export function createMaxVideoLegacyMigration(options: { prisma: DbClient; api?: MaxApiPort; storage: Pick<PrivateStorage, 'headObject'> }) {
  return {
    async inventory(input: { batchSize?: number; offset?: number } = {}): Promise<MaxVideoLegacyPlan> {
      const batchSize = boundedBatch(input.batchSize ?? 5)
      const offset = boundedOffset(input.offset ?? 0)
      if (!options.api) throw new Error('MAX API is required for inventory')
      const where = { asset: { mediaKind: 'video' as const, purpose: 'memory' as const, originalStatus: 'stored' as const, deletedAt: null, storageDeletedAt: null }, memory: { status: 'published' as const, deletedAt: null } }
      const totalRows = await options.prisma.memoryMedia.count({ where })
      const rows = await options.prisma.memoryMedia.findMany({
        where, include: { memory: true, asset: { include: { variants: true } } },
        orderBy: [{ familyId: 'asc' }, { memoryId: 'asc' }, { position: 'asc' }], skip: offset, take: batchSize,
      })
      const candidates: MaxVideoLegacyCandidate[] = []
      const skipped: Array<{ mediaId: string; reason: string }> = []
      for (const row of rows) {
        const mediaId = row.mediaId
        try {
          const existingRetention = await options.prisma.maxVideoLegacyRetention.findUnique({ where: { mediaId }, select: { mediaId: true, recoveredAt: true } })
          if (existingRetention) { skipped.push({ mediaId, reason: existingRetention.recoveredAt ? 'recovered' : 'already_migrated' }); continue }
          const attachments = await options.prisma.maxSourceAttachment.findMany({ where: { mediaId }, include: { source: true } })
          if (attachments.length !== 1) { skipped.push({ mediaId, reason: 'source_attachment_ambiguous' }); continue }
          const attachment = attachments[0]!
          const source = attachment.source
          if (attachment.providerKind !== 'video' || attachment.status !== 'stored' || attachment.position !== row.position || source.status !== 'published' ||
              source.memoryId !== row.memoryId || source.familyId !== row.familyId) { skipped.push({ mediaId, reason: 'source_mapping_mismatch' }); continue }
          const checked = await verifyProviderVideo(options.api, source, attachment.position, attachment.providerAttachmentId)
          if (checked.reason) { skipped.push({ mediaId, reason: checked.reason }); continue }
          const snapshot = await readRecoverySnapshot(options.prisma, row.memoryId, row.familyId, mediaId, source.id, row.position)
          candidates.push({
            mediaId, familyId: row.familyId, memoryId: row.memoryId, position: row.position, sourceId: source.id,
            providerMessageId: checked.providerMessageId!, providerAttachmentId: attachment.providerAttachmentId,
            providerRecipientId: checked.providerRecipientId!, providerChannelId: checked.providerChannelId ?? null,
            width: checked.width ?? row.asset.width, height: checked.height ?? row.asset.height,
            durationMs: checked.durationMs ?? row.asset.durationMs, thumbnailMediaId: mediaId, snapshot,
          })
        } catch {
          skipped.push({ mediaId, reason: 'verification_unavailable' })
        }
      }
      return { version: 1, offset, scanned: rows.length, totalRows, hasMore: offset + rows.length < totalRows, candidates, skipped }
    },

    async apply(plan: MaxVideoLegacyPlan, input: { offset?: number; batchSize?: number } = {}) {
      assertPlan(plan)
      if (!options.api) throw new Error('MAX API is required for apply')
      const offset = boundedOffset(input.offset ?? 0)
      const batchSize = boundedBatch(input.batchSize ?? 5)
      const batch = plan.candidates.slice(offset, offset + batchSize)
      const reasons: Record<string, number> = {}
      const outcomes: Array<{ mediaId: string; status: 'migrated' | 'already_migrated' | 'skipped'; reason?: string }> = []
      const result = { migrated: 0, alreadyMigrated: 0, skipped: 0, reasons, outcomes }
      const skip = (mediaId: string, reason: string) => { result.skipped++; reasons[reason] = (reasons[reason] ?? 0) + 1; outcomes.push({ mediaId, status: 'skipped', reason }) }
      for (const candidate of batch) {
        try {
          const retention = await options.prisma.maxVideoLegacyRetention.findUnique({ where: { mediaId: candidate.mediaId } })
          if (retention) {
            if (retention.recoveredAt) { skip(candidate.mediaId, 'recovered'); continue }
            if (await registeredLedgerMatches(options.prisma, retention)) { result.alreadyMigrated++; outcomes.push({ mediaId: candidate.mediaId, status: 'already_migrated' }); continue }
            skip(candidate.mediaId, 'retention_mapping_mismatch')
            continue
          }
          const mapping = await exactMapping(options.prisma, candidate)
          if (!mapping) { skip(candidate.mediaId, 'source_mapping_changed'); continue }
          if (mapping.providerAttachmentId !== candidate.providerAttachmentId || mapping.source.id !== candidate.sourceId ||
              mapping.position !== candidate.position) {
            skip(candidate.mediaId, 'source_mapping_changed')
            continue
          }
          const checked = await verifyProviderVideo(options.api, mapping.source, mapping.position, mapping.providerAttachmentId)
          if (checked.reason) { skip(candidate.mediaId, checked.reason); continue }
          if (checked.providerMessageId !== candidate.providerMessageId || checked.providerRecipientId !== candidate.providerRecipientId ||
              (checked.providerChannelId ?? null) !== candidate.providerChannelId || mapping.providerAttachmentId !== candidate.providerAttachmentId) {
            skip(candidate.mediaId, 'provider_mapping_changed')
            continue
          }
          const poster = await findReusablePoster(options.storage, candidate.mediaId, mapping.asset.variants)
          let inserted = false
          await options.prisma.$transaction(async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM families WHERE id=${candidate.familyId}::uuid FOR UPDATE`)
          await tx.$queryRaw(Prisma.sql`SELECT id FROM memories WHERE id=${candidate.memoryId}::uuid AND family_id=${candidate.familyId}::uuid FOR UPDATE`)
          await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id=${candidate.mediaId}::uuid AND family_id=${candidate.familyId}::uuid FOR UPDATE`)
          const current = await exactMapping(tx as DbClient, candidate)
          if (!current || await tx.maxVideoLegacyRetention.findUnique({ where: { mediaId: candidate.mediaId }, select: { mediaId: true } })) return
          const currentSnapshot = await readRecoverySnapshot(tx as DbClient, candidate.memoryId, candidate.familyId, candidate.mediaId, candidate.sourceId, candidate.position)
          if (stableJson(currentSnapshot) !== stableJson(candidate.snapshot)) return
          if (current.asset.originalKey !== mapping.asset.originalKey || current.position !== mapping.position || current.source.id !== mapping.source.id ||
              current.providerAttachmentId !== mapping.providerAttachmentId || current.source.messageId !== mapping.source.messageId) return
          const existingReference = await tx.maxVideoReference.findUnique({ where: { id: candidate.mediaId }, select: { id: true } })
          if (existingReference) return
          await tx.maxVideoReference.create({ data: {
            id: candidate.mediaId, sourceId: candidate.sourceId, memoryId: candidate.memoryId, familyId: candidate.familyId,
            attachmentPosition: candidate.position, providerAttachmentId: candidate.providerAttachmentId,
            width: candidate.width, height: candidate.height, durationMs: candidate.durationMs, thumbnailMediaId: poster,
          } })
          await tx.maxVideoLegacyRetention.create({ data: {
            mediaId: candidate.mediaId, familyId: candidate.familyId, memoryId: candidate.memoryId, referenceId: candidate.mediaId,
            sourceId: candidate.sourceId, position: candidate.position, providerMessageId: candidate.providerMessageId,
            providerAttachmentId: candidate.providerAttachmentId, providerRecipientId: BigInt(candidate.providerRecipientId),
            providerChannelId: candidate.providerChannelId === null ? null : BigInt(candidate.providerChannelId), snapshot: candidate.snapshot as never,
          } })
          if (!poster) await enqueueMaxVideoPoster(tx, candidate.mediaId)
          inserted = true
          }, { timeout: 15_000 })
          if (inserted) { result.migrated++; outcomes.push({ mediaId: candidate.mediaId, status: 'migrated' }) }
          else {
            const after = await options.prisma.maxVideoLegacyRetention.findUnique({ where: { mediaId: candidate.mediaId } })
            if (after?.recoveredAt) skip(candidate.mediaId, 'recovered')
            else if (after && await registeredLedgerMatches(options.prisma, after)) { result.alreadyMigrated++; outcomes.push({ mediaId: candidate.mediaId, status: 'already_migrated' }) }
            else skip(candidate.mediaId, 'candidate_changed_during_apply')
          }
        } catch {
          skip(candidate.mediaId, 'candidate_unavailable')
        }
      }
      return result
    },

    async recoveryReadiness() {
      const totalAll = await options.prisma.maxVideoLegacyRetention.count({ where: { recoveredAt: null } })
      const familyDeletionTablePresent = await hasFamilyDeletionTable(options.prisma)
      const total = await countRecoverableRetention(options.prisma, familyDeletionTablePresent)
      let ready = 0
      let missingObjects = 0
      const invalid: string[] = []
      let cursor: string | undefined
      while (true) {
        const rows = await findRecoverableRetention(options.prisma, familyDeletionTablePresent, cursor, MAX_BATCH_SIZE, true)
        if (!rows.length) break
        for (const row of rows) {
          if (!await registeredLedgerMatches(options.prisma, row)) invalid.push(row.mediaId)
          else if (!await retainedObjectsReady(options.prisma, options.storage, row.mediaId)) missingObjects++
          else ready++
        }
        cursor = rows.at(-1)!.mediaId
      }
      return { total, excluded: totalAll - total, inspected: total, ready, missingObjects, invalid, hasMore: false }
    },

    async recoverAll(input: { apply: boolean; batchSize?: number }) {
      const batchSize = boundedBatch(input.batchSize ?? 5)
      const totalAll = await options.prisma.maxVideoLegacyRetention.count({ where: { recoveredAt: null } })
      const familyDeletionTablePresent = await hasFamilyDeletionTable(options.prisma)
      const totalBefore = await countRecoverableRetention(options.prisma, familyDeletionTablePresent)
      let recovered = 0
      let refused = 0
      let inspected = 0
      let cursor: string | undefined
      while (true) {
        const rows = await findRecoverableRetention(options.prisma, familyDeletionTablePresent, cursor, batchSize, false)
        if (!rows.length) break
        cursor = rows.at(-1)!.mediaId
        for (const row of rows) {
        inspected++
        const removed = await options.prisma.$transaction(async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM families WHERE id=${row.familyId}::uuid FOR UPDATE`)
          await tx.$queryRaw(Prisma.sql`SELECT id FROM memories WHERE id=${row.memoryId}::uuid AND family_id=${row.familyId}::uuid FOR UPDATE`)
          await tx.$queryRaw(Prisma.sql`SELECT id FROM media_assets WHERE id=${row.mediaId}::uuid AND family_id=${row.familyId}::uuid FOR UPDATE`)
          if (await isFamilyEligibleForRecovery(tx as DbClient, row.familyId, familyDeletionTablePresent) === false) return false
          const currentLedger = await tx.maxVideoLegacyRetention.findUnique({ where: { mediaId: row.mediaId } })
          if (!currentLedger || currentLedger.recoveredAt) return false
          if (!await registeredLedgerMatches(tx as DbClient, currentLedger) || !await retainedObjectsReady(tx as DbClient, options.storage, row.mediaId)) return false
          if (!input.apply) return true
          await tx.maxVideoReference.delete({ where: { id: row.referenceId } })
          await tx.maxVideoLegacyRetention.update({ where: { mediaId: row.mediaId }, data: { recoveredAt: new Date() } })
          return true
        }, { timeout: 15_000 })
        if (!removed) refused++
        else if (input.apply) recovered++
        }
      }
      const remaining = await countRecoverableRetention(options.prisma, familyDeletionTablePresent)
      return { inspected: input.apply ? inspected : totalBefore, excluded: totalAll - totalBefore, recovered, refused, remaining, hasMore: false }
    },
  }
}

async function hasFamilyDeletionTable(prisma: DbClient) {
  const schemaRows = await prisma.$queryRaw<Array<{ migrationLedger: boolean; familyDeletions: boolean; storageDeletes: boolean; purgeFences: boolean; botStopped: boolean }>>(Prisma.sql`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "migrationLedger",
           to_regclass('public.control_family_deletions') IS NOT NULL AS "familyDeletions",
           to_regclass('public.control_storage_deletes') IS NOT NULL AS "storageDeletes",
           EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='max_sources_control_no_redacted_replay' AND NOT tgisinternal) AS "purgeFences",
           EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='max_inbox_event_kind' AND e.enumlabel='bot_stopped') AS "botStopped"
  `)
  const schema = schemaRows[0]
  if (!schema || Object.values(schema).some((value) => typeof value !== 'boolean') || !schema.migrationLedger) {
    throw new Error('Cannot validate MAX recovery migration history')
  }

  const catalog = await reviewedMigrationCatalog()
  const baselineCatalogHash = createHash('sha256').update(catalog.slice(0, 59).map(({ name, checksum }) => `${name}:${checksum}`).join('\n') + '\n').digest('hex')
  if (catalog.length !== 63 || baselineCatalogHash !== MAX_RECOVERY_BASELINE_CATALOG_SHA256 ||
      MAX_RECOVERY_LIFECYCLE_MIGRATIONS.some(([name, checksum], index) => catalog[59 + index]?.name !== name || catalog[59 + index]?.checksum !== checksum) ||
      catalog[62]?.name !== MAX_RECOVERY_NOTIFICATION_MIGRATION[0] || catalog[62]?.checksum !== MAX_RECOVERY_NOTIFICATION_MIGRATION[1]) {
    throw new Error('MAX recovery migration catalog is not the exact reviewed lifecycle extension')
  }
  const ledger = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>(Prisma.sql`
    SELECT migration_name, checksum, finished_at, rolled_back_at
      FROM _prisma_migrations
     ORDER BY migration_name, started_at, id
  `)
  if (ledger.length < 59 || ledger.length > 63 || ledger.some((row, index) => {
    const expected = catalog[index]
    return !row.finished_at || row.rolled_back_at !== null || row.migration_name !== expected?.name ||
      (row.checksum !== expected?.checksum && row.checksum !== expected?.crlfChecksum)
  })) throw new Error('MAX recovery migration ledger is not an exact completed reviewed prefix')

  const expectedFamilyDeletionTable = ledger.length >= 60
  const expectedStorageDeleteTable = ledger.length >= 61
  const expectedPurgeFences = ledger.length >= 62
  if (schema.familyDeletions !== expectedFamilyDeletionTable || schema.storageDeletes !== expectedStorageDeleteTable || schema.purgeFences !== expectedPurgeFences || schema.botStopped !== (ledger.length === 63)) {
    throw new Error('Control lifecycle schema does not match the exact MAX recovery migration prefix')
  }
  return schema.familyDeletions
}

let migrationCatalogPromise: Promise<Array<{ name: string; checksum: string; crlfChecksum: string }>> | undefined

function reviewedMigrationCatalog() {
  migrationCatalogPromise ??= (async () => {
    const root = resolve(import.meta.dir, '../../../../prisma/migrations')
    const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    const catalog: Array<{ name: string; checksum: string; crlfChecksum: string }> = []
    for (const name of entries) {
      const source = await readFile(resolve(root, name, 'migration.sql'))
      const lfSource = Buffer.from(source.toString('utf8').replace(/\r\n/g, '\n'))
      const crlfSource = Buffer.from(lfSource.toString('utf8').replace(/\n/g, '\r\n'))
      catalog.push({
        name,
        checksum: createHash('sha256').update(lfSource).digest('hex'),
        crlfChecksum: createHash('sha256').update(crlfSource).digest('hex'),
      })
    }
    return catalog
  })()
  return migrationCatalogPromise
}

async function isFamilyEligibleForRecovery(prisma: DbClient, familyId: string, familyDeletionTablePresent: boolean) {
  if (!familyDeletionTablePresent) return true
  const rows = await prisma.$queryRaw<Array<{ eligible: boolean; familyExists: boolean }>>(Prisma.sql`
    SELECT (deletion.family_id IS NULL) AS eligible,
           (family.id IS NOT NULL AND family.status <> 'active'::family_status) AS "familyExists"
      FROM (SELECT ${familyId}::uuid AS family_id) target
      LEFT JOIN control_family_deletions deletion ON deletion.family_id=target.family_id
      LEFT JOIN families family ON family.id=target.family_id
  `)
  if (typeof rows[0]?.eligible !== 'boolean' || typeof rows[0]?.familyExists !== 'boolean') throw new Error('Cannot determine durable family deletion intent')
  if (!rows[0].eligible && !rows[0].familyExists) throw new Error('Invalid active or orphaned durable family deletion intent')
  return rows[0].eligible
}

async function assertFamilyDeletionIntentsAreValid(prisma: DbClient, familyDeletionTablePresent: boolean) {
  if (!familyDeletionTablePresent) return
  const rows = await prisma.$queryRaw<Array<{ invalidIntents: number; unfencedFamilies: number }>>(Prisma.sql`
    SELECT count(*) FILTER (WHERE family.id IS NULL OR family.status='active'::family_status)::integer AS "invalidIntents",
           count(*) FILTER (WHERE family.id IS NOT NULL AND family.status <> 'active'::family_status AND deletion.purged_at IS NULL
             AND (deletion.keys_captured_at IS NULL OR EXISTS (
               SELECT 1 FROM media_assets asset WHERE asset.family_id=deletion.family_id AND asset.deleted_at IS NULL
             )))::integer AS "unfencedFamilies"
      FROM control_family_deletions deletion
      LEFT JOIN families family ON family.id=deletion.family_id
  `)
  if (!Number.isSafeInteger(rows[0]?.invalidIntents) || rows[0]!.invalidIntents !== 0) throw new Error('Invalid active or orphaned durable family deletion intent')
  if (!Number.isSafeInteger(rows[0]?.unfencedFamilies) || rows[0]!.unfencedFamilies !== 0) {
    throw new Error('Irreversible family media keys are not durably captured and fenced')
  }
}

async function countRecoverableRetention(prisma: DbClient, familyDeletionTablePresent: boolean) {
  if (!familyDeletionTablePresent) return prisma.maxVideoLegacyRetention.count({ where: { recoveredAt: null } })
  await assertFamilyDeletionIntentsAreValid(prisma, familyDeletionTablePresent)
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT count(*)::integer AS count
      FROM max_video_legacy_retention retention
     WHERE recovered_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM control_family_deletions deletion
          JOIN families family ON family.id=deletion.family_id
          WHERE deletion.family_id=retention.family_id AND family.status <> 'active'::family_status
       )
  `)
  if (!Number.isSafeInteger(rows[0]?.count) || rows[0]!.count < 0) throw new Error('Cannot count eligible MAX video recovery records')
  return rows[0]!.count
}

async function findRecoverableRetention(prisma: DbClient, familyDeletionTablePresent: boolean, cursor: string | undefined, take: number, selectDetails: boolean) {
  const where = { recoveredAt: null, ...(cursor ? { mediaId: { gt: cursor } } : {}) }
  if (!familyDeletionTablePresent) return prisma.maxVideoLegacyRetention.findMany({ where, orderBy: { mediaId: 'asc' }, take,
    ...(selectDetails ? { select: { mediaId: true, familyId: true, memoryId: true, referenceId: true, sourceId: true, position: true,
      providerMessageId: true, providerAttachmentId: true, providerRecipientId: true, providerChannelId: true, snapshot: true } } : {}) })

  const ids = await prisma.$queryRaw<Array<{ mediaId: string }>>(Prisma.sql`
    SELECT media_id AS "mediaId"
      FROM max_video_legacy_retention retention
     WHERE recovered_at IS NULL
       AND (${cursor ?? null}::uuid IS NULL OR media_id > ${cursor ?? null}::uuid)
       AND NOT EXISTS (
         SELECT 1 FROM control_family_deletions deletion
          JOIN families family ON family.id=deletion.family_id
          WHERE deletion.family_id=retention.family_id AND family.status <> 'active'::family_status
       )
     ORDER BY media_id ASC
     LIMIT ${take}
  `)
  if (ids.some((row) => typeof row.mediaId !== 'string')) throw new Error('Cannot list eligible MAX video recovery records')
  if (!ids.length) return []
  const rows = await prisma.maxVideoLegacyRetention.findMany({ where: { mediaId: { in: ids.map(({ mediaId }) => mediaId) } },
    ...(selectDetails ? { select: { mediaId: true, familyId: true, memoryId: true, referenceId: true, sourceId: true, position: true,
      providerMessageId: true, providerAttachmentId: true, providerRecipientId: true, providerChannelId: true, snapshot: true } } : {}) })
  const byId = new Map(rows.map((row) => [row.mediaId, row]))
  return ids.map(({ mediaId }) => {
    const row = byId.get(mediaId)
    if (!row) throw new Error('Eligible MAX video recovery record disappeared while scanning')
    return row
  })
}

async function registeredLedgerMatches(prisma: DbClient, row: {
  mediaId: string; familyId: string; memoryId: string; referenceId: string; sourceId: string; position: number;
  providerMessageId: string; providerAttachmentId: string; providerRecipientId: bigint; providerChannelId: bigint | null; snapshot: unknown
}) {
  const reference = await prisma.maxVideoReference.findUnique({ where: { id: row.referenceId }, select: { id: true, memoryId: true, familyId: true, sourceId: true, attachmentPosition: true, providerAttachmentId: true } })
  if (!reference || reference.id !== row.mediaId || reference.memoryId !== row.memoryId || reference.familyId !== row.familyId || reference.sourceId !== row.sourceId ||
      reference.attachmentPosition !== row.position || reference.providerAttachmentId !== row.providerAttachmentId) return false
  const [legacy, attachments] = await Promise.all([
    prisma.memoryMedia.findUnique({ where: { memoryId_position: { memoryId: row.memoryId, position: row.position } }, include: { asset: { include: { variants: true } } } }),
    prisma.maxSourceAttachment.findMany({ where: { mediaId: row.mediaId }, include: { source: true } }),
  ])
  if (!legacy || legacy.mediaId !== row.mediaId || legacy.familyId !== row.familyId || attachments.length !== 1 || legacy.asset.familyId !== row.familyId ||
      legacy.asset.originalStatus !== 'stored' || legacy.asset.deletedAt !== null || legacy.asset.storageDeletedAt !== null) return false
  const snapshot = row.snapshot as { mediaAsset?: { original_key?: string; original_status?: string; deleted_at?: unknown; storage_deleted_at?: unknown; sha256?: string | null; byte_size?: number | string }; mediaVariants?: Array<Record<string, unknown>> }
  const savedAsset = snapshot?.mediaAsset
  if (!savedAsset || savedAsset.original_key !== legacy.asset.originalKey || savedAsset.original_status !== 'stored' || savedAsset.deleted_at !== null ||
      savedAsset.storage_deleted_at !== null || savedAsset.sha256 !== legacy.asset.sha256 || String(savedAsset.byte_size) !== String(legacy.asset.byteSize)) return false
  const savedVariants = snapshot.mediaVariants ?? []
  const currentVariants = legacy.asset.variants.map(({ variant, objectKey, sha256, byteSize }) => ({ variant, object_key: objectKey, sha256, byte_size: byteSize.toString() }))
  const expectedVariants = (savedVariants as Array<Record<string, unknown>>).map(({ variant, object_key, sha256, byte_size }) => ({ variant: String(variant), object_key, sha256, byte_size: String(byte_size) }))
    .sort((a, b) => a.variant.localeCompare(b.variant))
  currentVariants.sort((a, b) => a.variant.localeCompare(b.variant))
  if (stableJson(expectedVariants) !== stableJson(currentVariants)) return false
  const attachment = attachments[0]!
  const source = attachment.source
  const expectedMessageId = source.originalChannelId !== null ? source.originalMessageId : source.messageId
  const expectedRecipientId = source.originalChannelId ?? source.recipientId
  return attachment.providerKind === 'video' && attachment.status === 'stored' && attachment.position === row.position &&
    attachment.providerAttachmentId === row.providerAttachmentId && source.id === row.sourceId && source.familyId === row.familyId &&
    source.memoryId === row.memoryId && source.status === 'published' && expectedMessageId === row.providerMessageId &&
    expectedRecipientId === row.providerRecipientId && source.originalChannelId === row.providerChannelId
}

async function retainedObjectsReady(prisma: DbClient, storage: Pick<PrivateStorage, 'headObject'>, mediaId: string) {
  try {
    const relation = await prisma.memoryMedia.findFirst({ where: { mediaId }, include: { asset: { include: { variants: true } } } })
    if (!relation) return false
    const original = await storage.headObject(relation.asset.originalKey)
    if (!original || original.contentLength !== Number(relation.asset.byteSize) || original.contentType !== relation.asset.verifiedMime) return false
    for (const variant of relation.asset.variants) {
      const object = await storage.headObject(variant.objectKey)
      if (!object || object.contentLength !== Number(variant.byteSize) || object.contentType !== variant.mime) return false
    }
    return true
  } catch {
    return false
  }
}

async function exactMapping(prisma: DbClient, candidate: MaxVideoLegacyCandidate) {
  const relation = await prisma.memoryMedia.findUnique({ where: { memoryId_position: { memoryId: candidate.memoryId, position: candidate.position } }, include: { asset: { include: { variants: true } } } })
  if (!relation || relation.mediaId !== candidate.mediaId || relation.familyId !== candidate.familyId || relation.asset.mediaKind !== 'video' || relation.asset.purpose !== 'memory' || relation.asset.deletedAt || relation.asset.storageDeletedAt || relation.asset.originalStatus !== 'stored') return null
  const attachments = await prisma.maxSourceAttachment.findMany({ where: { mediaId: candidate.mediaId }, include: { source: true } })
  if (attachments.length !== 1) return null
  const attachment = attachments[0]!
  const source = attachment.source
  if (attachment.providerKind !== 'video' || attachment.status !== 'stored' || attachment.position !== candidate.position || source.id !== candidate.sourceId ||
      source.familyId !== candidate.familyId || source.memoryId !== candidate.memoryId || source.status !== 'published') return null
  return { position: relation.position, asset: relation.asset, source, providerAttachmentId: attachment.providerAttachmentId }
}

async function verifyProviderVideo(api: MaxApiPort, source: { senderSubject: string; recipientId: bigint; messageId: string; originalMessageId: string | null; originalChannelId: bigint | null }, position: number, providerAttachmentId: string) {
  try {
    const forwarded = Boolean(source.originalMessageId && source.originalChannelId !== null)
    const envelope = Boolean(source.originalMessageId && source.originalChannelId === null)
    const messageId = forwarded ? source.originalMessageId! : source.messageId
    const signal = AbortSignal.timeout(10_000)
    const message = await api.getMessage(messageId, signal)
    const expectedRecipient = forwarded ? String(source.originalChannelId) : String(source.recipientId)
    const attachments = envelope ? message.forwardedAttachments : message.attachments
    const actualId = forwarded || envelope ? source.originalMessageId! : source.messageId
    const senderOk = forwarded ? message.recipientType === 'channel' : message.senderId === source.senderSubject
    if (message.messageId !== (envelope ? source.messageId : actualId) || message.recipientId !== expectedRecipient || !senderOk ||
        (envelope && message.forwardedFrom?.messageId !== source.originalMessageId)) return { reason: 'provider_message_mismatch' }
    const current = attachments?.[position]
    if (!current || current.kind !== 'video' || current.providerAttachmentId !== providerAttachmentId || !api.getVideo) return { reason: 'provider_attachment_mismatch' }
    const video = await api.getVideo(current.currentToken, signal)
    const rendition = selectRendition(video.renditions)
    if (!rendition) return { reason: 'rendition_unavailable' }
    const head = await fetchCdnVideo(rendition.url, undefined, 'HEAD', MAX_DIRECT_VIDEO_MAX_BYTES, signal)
    if (head.contentLength <= 0) return { reason: 'head_invalid' }
    const range = await fetchCdnVideo(rendition.url, 'bytes=0-1', 'GET', MAX_DIRECT_VIDEO_MAX_BYTES, signal)
    if (!range.range || range.range.start !== 0 || range.range.end !== 1 || !range.body || await readExactlyTwoBytes(range.body) !== 2) return { reason: 'range_invalid' }
    return { providerMessageId: message.messageId, providerRecipientId: message.recipientId, providerChannelId: forwarded ? message.recipientId : null,
      width: video.width, height: video.height, durationMs: video.durationMs }
  } catch (error) {
    if (error instanceof MaxProviderError) {
      if (error.code === 'message_identity_mismatch') return { reason: 'provider_identity_mismatch' }
      if (error.code === 'message_not_found' || error.status === 404) return { reason: 'provider_message_not_found' }
      if (error.status === 401 || error.status === 403) return { reason: 'provider_unauthorized' }
      if (error.retryable || error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500)) return { reason: 'provider_retryable' }
      return { reason: 'provider_unavailable' }
    }
    if (error instanceof Error && error.name === 'TimeoutError' || error instanceof Error && error.name === 'AbortError') return { reason: 'provider_timeout' }
    return { reason: 'verification_unavailable' }
  }
}

async function readExactlyTwoBytes(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  let count = 0
  try {
    while (count < 2) {
      const chunk = await reader.read()
      if (chunk.done || count + chunk.value.byteLength > 2) return -1
      count += chunk.value.byteLength
    }
    const extra = await reader.read()
    return extra.done && count === 2 ? 2 : -1
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

async function findReusablePoster(storage: Pick<PrivateStorage, 'headObject'>, mediaId: string, variants: Array<{ variant: string; objectKey: string; mime: string; byteSize: bigint }>) {
  for (const variant of ['display', 'preview']) {
    const object = variants.find((item) => item.variant === variant)
    if (!object || !object.mime.startsWith('image/')) continue
    const physical = await storage.headObject(object.objectKey)
    if (physical && physical.contentLength === Number(object.byteSize) && physical.contentType === object.mime) return mediaId
  }
  return null
}

async function readRecoverySnapshot(prisma: DbClient, memoryId: string, familyId: string, mediaId: string, sourceId: string, position: number) {
  const rows = await prisma.$queryRaw<Array<{ snapshot: unknown }>>(Prisma.sql`
    SELECT jsonb_build_object(
      'memory', (SELECT to_jsonb(m) FROM memories m WHERE m.id=${memoryId}::uuid AND m.family_id=${familyId}::uuid),
      'memoryMedia', (SELECT to_jsonb(mm) FROM memory_media mm WHERE mm.memory_id=${memoryId}::uuid AND mm.family_id=${familyId}::uuid AND mm.media_id=${mediaId}::uuid AND mm.position=${position}),
      'mediaAsset', (SELECT to_jsonb(a) FROM media_assets a WHERE a.id=${mediaId}::uuid AND a.family_id=${familyId}::uuid),
      'mediaVariants', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.variant) FROM media_variants v WHERE v.media_id=${mediaId}::uuid), '[]'::jsonb),
      'source', (SELECT to_jsonb(s) FROM max_sources s WHERE s.id=${sourceId}::uuid),
      'sourceAttachments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.position) FROM max_source_attachments a WHERE a.source_id=${sourceId}::uuid), '[]'::jsonb)
    ) AS snapshot
  `)
  return rows[0]?.snapshot ?? null
}

function boundedBatch(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BATCH_SIZE) throw new Error(`batch-size must be between 1 and ${MAX_BATCH_SIZE}`)
  return value
}

function boundedOffset(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('offset must be a non-negative safe integer')
  return value
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function assertPlan(plan: MaxVideoLegacyPlan): asserts plan is MaxVideoLegacyPlan {
  if (plan.version !== 1 || !Array.isArray(plan.candidates) || !Array.isArray(plan.skipped) || !Number.isSafeInteger(plan.totalRows) || plan.totalRows < 0) throw new Error('invalid migration plan')
  for (const candidate of plan.candidates) {
    if (!candidate.mediaId || !candidate.memoryId || !candidate.familyId || !candidate.sourceId || !candidate.providerMessageId || !candidate.providerAttachmentId || !candidate.snapshot) throw new Error('incomplete migration plan')
  }
}
