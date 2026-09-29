import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')
const lastLegacyMigration = '20260927150000_welcome_first_run_claim'
const expectedUpgradeMigrations = [
  '20260928100000_mm0_domain_temporal_foundation',
  '20260928130000_mm2_max_mixed_video_attachment',
  '20260929120000_mixed_max_direct_attachments',
  '20260929180000_max_memory_backup_reservation',
  '20260929200000_allow_signed_max_backup_channel_ids',
  '20260929210000_pace_max_backup_channel_sends',
]

test('upgrades populated pre-MM memories without changing legacy publication history', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const migrationNames = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name).sort()
  const boundary = migrationNames.indexOf(lastLegacyMigration)
  expect(boundary).toBeGreaterThan(-1)
  expect(migrationNames.slice(boundary + 1)).toEqual(expectedUpgradeMigrations)

  const databaseName = `mm4_upgrade_${process.pid}_${Date.now()}_${randomUUID().slice(0, 8)}`
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
    for (const migrationName of migrationNames.slice(0, boundary + 1)) {
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
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    await database.query(
      `INSERT INTO users (id, display_name, role, created_at, updated_at)
       VALUES ($1, 'MM-4 synthetic owner', 'user', now(), now())`, [ownerId],
    )
    await database.query(
      `INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at)
       VALUES ($1, $2, 'Synthetic family', 'Europe/Moscow', 'active', now(), now())`,
      [familyId, ownerId],
    )
    await database.query(
      `INSERT INTO family_members (family_id, user_id, role, joined_at)
       VALUES ($1, $2, 'full', now())`, [familyId, ownerId],
    )
    await database.query(
      `INSERT INTO children (id, family_id, display_name, created_at, updated_at)
       VALUES ($1, $2, 'Synthetic child', now(), now())`, [childId, familyId],
    )
    await database.query('COMMIT')

    const legacy = [
      { kind: 'note', media: [] as string[], ordinal: 1 },
      { kind: 'photo', media: ['photo'], ordinal: 2 },
      { kind: 'photo', media: ['photo', 'photo'], ordinal: null },
      { kind: 'video', media: ['video'], ordinal: null },
      { kind: 'voice', media: ['voice'], ordinal: null },
    ]
    const expected: Array<{ id: string, kind: string, ordinal: number | null, media: Array<{ id: string, kind: string, position: number }> }> = []
    for (const [index, item] of legacy.entries()) {
      const memoryId = randomUUID()
      await database.query(
        `INSERT INTO memories
          (id, family_id, child_id, author_id, kind, body, occurred_at, status,
           first_published_ordinal, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8, now())`,
        [memoryId, familyId, childId, ownerId, item.kind, `Legacy ${index}`, '2025-01-02T03:04:05.000Z', item.ordinal],
      )
      const media: Array<{ id: string, kind: string, position: number }> = []
      for (const [position, kind] of item.media.entries()) {
        const mediaId = randomUUID()
        const mime = kind === 'photo' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/ogg'
        await database.query(
          `INSERT INTO media_assets
            (id, family_id, uploader_id, source_kind, purpose, media_kind, original_key,
             declared_mime, verified_mime, sha256, byte_size, original_status, rendition_status, updated_at)
           VALUES ($1, $2, $3, 'upload', 'memory', $4, $5, $6, $6, repeat('a', 64), 100,
                   'stored', 'ready', now())`,
          [mediaId, familyId, ownerId, kind, `mm4-upgrade/${mediaId}`, mime],
        )
        await database.query(
          `INSERT INTO memory_media (family_id, memory_id, media_id, position)
           VALUES ($1, $2, $3, $4)`, [familyId, memoryId, mediaId, position],
        )
        media.push({ id: mediaId, kind, position })
      }
      expected.push({ id: memoryId, kind: item.kind, ordinal: item.ordinal, media })
    }

    await database.end()
    database = undefined
    const deploy = spawnSync('bun', ['run', 'prisma:deploy'], {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: upgradedUrl.toString() },
      encoding: 'utf8',
    })
    if (deploy.status !== 0) throw new Error(`Prisma migration deploy failed: ${deploy.stderr || deploy.stdout}`)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()

    const applied = await database.query<{ migration_name: string }>(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE migration_name > $1 ORDER BY migration_name`, [lastLegacyMigration],
    )
    expect(applied.rows.map((row) => row.migration_name)).toEqual(expectedUpgradeMigrations)
    const rows = await database.query<{
      id: string, kind: string, first_published_ordinal: string | null,
      first_published_at: Date | null, source_published_at: Date | null,
      media: Array<{ id: string, kind: string, position: number }>
    }>(
      `SELECT m.id, m.kind::text, m.first_published_ordinal, m.first_published_at,
              m.source_published_at,
              COALESCE(json_agg(json_build_object('id', a.id, 'kind', a.media_kind,
                'position', mm.position) ORDER BY mm.position)
                FILTER (WHERE a.id IS NOT NULL), '[]'::json) AS media
       FROM memories m
       LEFT JOIN memory_media mm ON mm.memory_id = m.id
       LEFT JOIN media_assets a ON a.id = mm.media_id
       WHERE m.family_id = $1
       GROUP BY m.id ORDER BY m.body`, [familyId],
    )
    expect(rows.rows).toHaveLength(5)
    for (const row of rows.rows) {
      const before = expected.find((item) => item.id === row.id)
      expect(before).toBeDefined()
      expect(row.kind).toBe(before!.kind)
      expect(row.first_published_ordinal).toBe(before!.ordinal === null ? null : String(before!.ordinal))
      expect(row.first_published_at).toBeNull()
      expect(row.source_published_at).toBeNull()
      expect(row.media).toEqual(before!.media)
    }

    // The enum values must be usable by real rows, not merely present in pg_enum.
    const newMemoryId = randomUUID()
    const publishedAt = '2026-09-28T10:15:30.123Z'
    await database.query(
      `INSERT INTO memories
        (id, family_id, child_id, author_id, kind, body, occurred_at, status, updated_at)
       VALUES ($1, $2, $3, $4, 'media', 'New mixed', now(), 'processing', now())`,
      [newMemoryId, familyId, childId, ownerId],
    )
    await database.query(
      `UPDATE families SET publication_ordinal = 3, unread_tracking_activated_at = now(),
         updated_at = now() WHERE id = $1`, [familyId],
    )
    await expect(database.query(
      `UPDATE memories SET status = 'published', first_published_at = $2, updated_at = now()
       WHERE id = $1`, [newMemoryId, publishedAt],
    )).rejects.toMatchObject({ code: '23514' })
    await database.query(
      `UPDATE memories SET status = 'published', first_published_ordinal = 3,
         first_published_at = $2, updated_at = now() WHERE id = $1`,
      [newMemoryId, publishedAt],
    )
    const published = await database.query<{
      kind: string, first_published_ordinal: string, first_published_at: Date
    }>(`SELECT kind::text, first_published_ordinal, first_published_at
         FROM memories WHERE id = $1`, [newMemoryId])
    expect(published.rows[0]).toEqual({
      kind: 'media', first_published_ordinal: '3', first_published_at: new Date(publishedAt),
    })
    await expect(database.query(
      `UPDATE memories SET first_published_ordinal = 4 WHERE id = $1`, [newMemoryId],
    )).rejects.toMatchObject({ code: '23514' })
    await expect(database.query(
      `UPDATE memories SET first_published_at = now() WHERE id = $1`, [newMemoryId],
    )).rejects.toMatchObject({ code: '23514' })
    const inboxId = randomUUID()
    const sourceId = randomUUID()
    await database.query(
      `INSERT INTO max_inbox
        (id, event_key, bot_id, event_kind, encrypted_payload, encryption_iv,
         encryption_auth_tag)
       VALUES ($1, $2, 1, 'message_created', decode('00', 'hex'),
               decode('00', 'hex'), decode('00', 'hex'))`,
      [inboxId, `mm4-upgrade-${inboxId}`],
    )
    await database.query(
      `INSERT INTO max_sources
        (id, inbox_id, bot_id, sender_subject, recipient_id, message_id,
         planned_memory_id, updated_at)
       VALUES ($1, $2, 1, 'synthetic-sender', 1, $3, $4, now())`,
      [sourceId, inboxId, `mm4-upgrade-${sourceId}`, randomUUID()],
    )
    await database.query(
      `INSERT INTO max_source_attachments
        (source_id, position, provider_kind, provider_attachment_id,
         planned_media_id, updated_at)
       VALUES ($1, 0, 'video', 'synthetic-video', $2, now())`,
      [sourceId, randomUUID()],
    )
    const videoAttachment = await database.query<{ kind: string }>(
      `SELECT provider_kind::text AS kind FROM max_source_attachments WHERE source_id = $1`,
      [sourceId],
    )
    expect(videoAttachment.rows).toEqual([{ kind: 'video' }])
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
