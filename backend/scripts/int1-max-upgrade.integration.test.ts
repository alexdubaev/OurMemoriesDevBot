import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')
const lastPreBackupMigration = '20260929120000_mixed_max_direct_attachments'
const backupMigrations = [
  '20260929180000_max_memory_backup_reservation',
  '20260929200000_allow_signed_max_backup_channel_ids',
  '20260929210000_pace_max_backup_channel_sends',
]
const lifecycleMigration = '20260929220000_max_channel_lifecycle_events'
const channelOnboardingMigration = '20261001130000_max_channel_onboarding'

test('upgrades populated migration 39 through MAX backup and lifecycle migrations without backfilling legacy memories', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const migrationNames = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name).sort()
  expect(migrationNames.length).toBeGreaterThanOrEqual(45)
  expect(migrationNames[38]).toBe(lastPreBackupMigration)
  expect(migrationNames.slice(39, 42)).toEqual(backupMigrations)
  expect(migrationNames[42]).toBe(lifecycleMigration)
  expect(migrationNames[44]).toBe(channelOnboardingMigration)

  const databaseName = `memoly_max_onboarding_resume_20261001_${process.pid.toString(36)}_${Date.now().toString(36)}_${randomUUID().slice(0, 4)}_test`
  const upgradedUrl = new URL(databaseUrl)
  upgradedUrl.pathname = `/${databaseName}`
  const admin = new Client({ connectionString: databaseUrl })
  let database: Client | undefined
  let created = false
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    created = true
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    await database.query(`CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`)
    for (const migrationName of migrationNames.slice(0, 39)) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName],
      )
    }

    const ownerId = randomUUID()
    const familyId = randomUUID()
    const childId = randomUUID()
    const legacyMemoryId = randomUUID()
    const legacyMediaId = randomUUID()
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    await database.query(
      `INSERT INTO users (id, display_name, role, created_at, updated_at)
       VALUES ($1, 'INT-1 synthetic owner', 'user', now(), now())`, [ownerId],
    )
    await database.query(
      `INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at)
       VALUES ($1, $2, 'INT-1 synthetic family', 'Europe/Moscow', 'active', now(), now())`,
      [familyId, ownerId],
    )
    await database.query(
      `INSERT INTO family_members (family_id, user_id, role, joined_at)
       VALUES ($1, $2, 'full', now())`, [familyId, ownerId],
    )
    await database.query(
      `INSERT INTO children (id, family_id, display_name, created_at, updated_at)
       VALUES ($1, $2, 'INT-1 synthetic child', now(), now())`, [childId, familyId],
    )
    const legacyChannelId = '9223372036854775807'
    await database.query('COMMIT')
    await database.query(
      `INSERT INTO memories
        (id, family_id, child_id, author_id, kind, body, occurred_at, status,
         first_published_ordinal, first_published_at, updated_at)
       VALUES ($1, $2, $3, $4, 'photo', 'Legacy published photo',
               '2025-01-02T03:04:05.000Z', 'published', 1,
               '2025-01-02T03:04:05.000Z', now())`,
      [legacyMemoryId, familyId, childId, ownerId],
    )
    await database.query(
      `INSERT INTO media_assets
        (id, family_id, uploader_id, source_kind, purpose, media_kind, original_key,
         declared_mime, verified_mime, sha256, byte_size, original_status,
         rendition_status, updated_at)
       VALUES ($1, $2, $3, 'upload', 'memory', 'photo', $4, 'image/jpeg',
               'image/jpeg', repeat('a', 64), 100, 'stored', 'ready', now())`,
      [legacyMediaId, familyId, ownerId, `int1-upgrade/${legacyMediaId}`],
    )
    await database.query(
      `INSERT INTO memory_media (family_id, memory_id, media_id, position)
       VALUES ($1, $2, $3, 0)`, [familyId, legacyMemoryId, legacyMediaId],
    )
    const legacySql = `SELECT m.id, m.body, m.kind::text AS kind, m.status::text AS status,
      m.first_published_ordinal, m.first_published_at, m.source_published_at,
      mm.media_id, mm.position, a.original_key
      FROM memories m JOIN memory_media mm ON mm.memory_id = m.id
      JOIN media_assets a ON a.id = mm.media_id WHERE m.id = $1`
    const before = await database.query(legacySql, [legacyMemoryId])
    expect(before.rows).toHaveLength(1)
    expect(before.rows[0].media_id).toBe(legacyMediaId)
    expect((await database.query(`SELECT to_regclass('public.max_memory_backups') AS backup_table`))
      .rows[0].backup_table).toBeNull()
    expect((await database.query(`SELECT COUNT(*)::int AS count FROM "_prisma_migrations"`))
      .rows[0].count).toBe(39)

    // Stage through the previous head so the final migration sees a routable signed
    // pointer already present, while this fixture still starts from populated v39.
    for (const migrationName of migrationNames.slice(39, 44)) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName],
      )
    }
    await database.query('UPDATE families SET max_backup_chat_id = $2 WHERE id = $1', [familyId, legacyChannelId])

    await database.end()
    database = undefined
    assertTaskDatabaseTarget(upgradedUrl)
    const deploy = spawnSync('bun', ['run', 'prisma:deploy'], {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: upgradedUrl.toString(), TEST_DATABASE_URL: upgradedUrl.toString(), TEST_SKIP_DOCKER: '1' },
      encoding: 'utf8',
    })
    if (deploy.status !== 0) throw new Error(`Prisma migration deploy failed: ${deploy.stderr || deploy.stdout}`)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    const applied = await database.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE migration_name > $1 ORDER BY migration_name`, [lastPreBackupMigration],
    )
    expect(applied.rows.map((row) => row.migration_name)).toEqual(migrationNames.slice(39))
    expect((await database.query(`SELECT COUNT(*)::int AS count FROM "_prisma_migrations"`))
      .rows[0].count).toBe(migrationNames.length)
    expect((await database.query(legacySql, [legacyMemoryId])).rows).toEqual(before.rows)
    expect((await database.query(`SELECT COUNT(*)::int AS count FROM max_memory_backups`))
      .rows[0].count).toBe(0)
    expect((await database.query(`SELECT COUNT(*)::int AS count FROM max_memory_backup_attachments`))
      .rows[0].count).toBe(0)
    expect((await database.query(
      `SELECT chat_id::text, family_id, state FROM max_channel_bindings WHERE chat_id = $1`, [legacyChannelId],
    )).rows).toEqual([{ chat_id: legacyChannelId, family_id: familyId, state: 'connected' }])

    const channelChatId = '-1001234567890'
    const nextSendAt = '2026-10-01T12:34:56.789Z'
    await database.query(
      `UPDATE families SET max_backup_chat_id = $2, max_backup_next_send_at = $3,
       updated_at = now() WHERE id = $1`, [familyId, channelChatId, nextSendAt],
    )
    const newMemoryId = randomUUID()
    const newMediaId = randomUUID()
    const backupId = randomUUID()
    await database.query(
      `INSERT INTO memories
        (id, family_id, child_id, author_id, kind, body, occurred_at, status,
         first_published_at, updated_at)
       VALUES ($1, $2, $3, $4, 'media', 'New backup Memory', now(), 'published', now(), now())`,
      [newMemoryId, familyId, childId, ownerId],
    )
    await database.query(
      `INSERT INTO media_assets
        (id, family_id, uploader_id, source_kind, purpose, media_kind, original_key,
         declared_mime, verified_mime, sha256, byte_size, original_status,
         rendition_status, updated_at)
       VALUES ($1, $2, $3, 'upload', 'memory', 'photo', $4, 'image/jpeg',
               'image/jpeg', repeat('b', 64), 200, 'stored', 'ready', now())`,
      [newMediaId, familyId, ownerId, `int1-upgrade/${newMediaId}`],
    )
    await database.query(
      `INSERT INTO max_memory_backups
        (id, family_id, memory_id, body, state, channel_chat_id,
         provider_message_id, updated_at)
       VALUES ($1, $2, $3, 'New backup Memory', 'sent', $4, 'synthetic-provider-message', now())`,
      [backupId, familyId, newMemoryId, channelChatId],
    )
    await database.query(
      `INSERT INTO max_memory_backup_attachments
        (backup_id, family_id, position, kind, media_id)
       VALUES ($1, $2, 0, 'image', $3)`, [backupId, familyId, newMediaId],
    )
    const upgraded = await database.query<{
      max_backup_chat_id: string, max_backup_next_send_at: Date,
      provider_message_id: string, media_id: string, position: number,
    }>(
      `SELECT f.max_backup_chat_id, f.max_backup_next_send_at,
              b.provider_message_id, a.media_id, a.position
       FROM max_memory_backups b
       JOIN families f ON f.id = b.family_id
       JOIN max_memory_backup_attachments a ON a.backup_id = b.id
       WHERE b.id = $1`, [backupId],
    )
    expect(upgraded.rows).toEqual([{
      max_backup_chat_id: channelChatId,
      max_backup_next_send_at: new Date(nextSendAt),
      provider_message_id: 'synthetic-provider-message',
      media_id: newMediaId,
      position: 0,
    }])
    expect((await database.query(legacySql, [legacyMemoryId])).rows).toEqual(before.rows)
    expect((await database.query(`SELECT COUNT(*)::int AS count FROM max_memory_backups WHERE memory_id = $1`,
      [legacyMemoryId])).rows[0].count).toBe(0)

    const freshName = `memoly_max_onboarding_resume_20261001_${process.pid.toString(36)}_${Date.now().toString(36)}_${randomUUID().slice(0, 4)}_test`
    const freshUrl = new URL(databaseUrl)
    freshUrl.pathname = `/${freshName}`
    await admin.query(`CREATE DATABASE "${freshName}"`)
    try {
      assertTaskDatabaseTarget(freshUrl)
      const freshDeploy = spawnSync('bun', ['run', 'prisma:deploy'], {
        cwd: backendRoot,
        env: { ...process.env, DATABASE_URL: freshUrl.toString(), TEST_DATABASE_URL: freshUrl.toString(), TEST_SKIP_DOCKER: '1' },
        encoding: 'utf8',
      })
      if (freshDeploy.status !== 0) throw new Error(`Fresh Prisma migration deploy failed: ${freshDeploy.stderr || freshDeploy.stdout}`)
      const fresh = new Client({ connectionString: freshUrl.toString() })
      await fresh.connect()
      try {
        expect((await fresh.query(`SELECT COUNT(*)::int AS count FROM "_prisma_migrations"`)).rows[0].count)
          .toBe(migrationNames.length)
        expect((await fresh.query(`SELECT to_regclass('public.max_channel_bindings') AS table_name`)).rows[0].table_name)
          .toBe('max_channel_bindings')
      } finally { await fresh.end() }
    } finally {
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [freshName])
      await admin.query(`DROP DATABASE IF EXISTS "${freshName}"`)
    }
  } finally {
    await database?.end()
    if (created) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`, [databaseName],
      )
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    }
    await admin.end()
  }
})

function assertTaskDatabaseTarget(url: URL) {
  const name = url.pathname.slice(1)
  if (url.hostname !== '127.0.0.1' || url.port !== '55481' ||
      !name.startsWith('memoly_max_onboarding_resume_20261001_') || !name.endsWith('_test')) {
    throw new Error('MAX migration test database is outside the verified task target')
  }
  process.stdout.write(`Verified migration DB host=${url.hostname} port=${url.port} db=${name}\n`)
}
