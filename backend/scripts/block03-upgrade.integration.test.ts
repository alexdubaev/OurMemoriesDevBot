import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

const block02Migrations = [
  '20260808125145_init',
  '20260809113326_user_avatars',
  '20260809171936_task_outbox',
  '20260909150000_block01_auth_family',
  '20260909190000_block01_review_fixes',
  '20260909220000_idempotency_response_snapshot',
  '20260909230000_block02_memories',
] as const

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')

test('upgrades populated Block 02 data and adds family-scoped media including child avatars', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = `block03_upgrade_${process.pid}_${Date.now()}`
  if (!/^block03_upgrade_[0-9_]+$/.test(databaseName)) throw new Error('Unsafe database name')
  const admin = new Client({ connectionString: databaseUrl })
  const upgradedUrl = new URL(databaseUrl)
  upgradedUrl.pathname = `/${databaseName}`
  let database: Client | undefined

  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    await database.query(`CREATE TABLE "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`)
    for (const migrationName of block02Migrations) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName],
      )
    }

    const ownerId = '01991fe1-4bc9-7a4a-a8b6-3bb8ce1ab601'
    const outsiderId = '01991fe1-4bc9-7a4a-a8b6-3bb8ce1ab602'
    const familyId = '01991fe1-4bc9-7a4a-a8b6-3bb8ce1ab603'
    const otherFamilyId = '01991fe1-4bc9-7a4a-a8b6-3bb8ce1ab604'
    const childId = '01991fe1-4bc9-7a4a-a8b6-3bb8ce1ab605'
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    await database.query(
      `INSERT INTO users (id, display_name, role, created_at, updated_at)
       VALUES ($1, 'Owner', 'user', now(), now()), ($2, 'Other', 'user', now(), now())`,
      [ownerId, outsiderId],
    )
    await database.query(
      `INSERT INTO families
        (id, owner_user_id, name, timezone, status, storage_used_bytes,
         storage_reserved_bytes, created_at, updated_at)
       VALUES ($1, $2, 'Family', 'Europe/Moscow', 'active', 0, 0, now(), now()),
              ($3, $4, 'Other', 'Europe/Moscow', 'active', 0, 0, now(), now())`,
      [familyId, ownerId, otherFamilyId, outsiderId],
    )
    await database.query(
      `INSERT INTO family_members (family_id, user_id, role, joined_at)
       VALUES ($1, $2, 'full', now()), ($3, $4, 'full', now())`,
      [familyId, ownerId, otherFamilyId, outsiderId],
    )
    await database.query(
      `INSERT INTO children (id, family_id, display_name, created_at, updated_at)
       VALUES ($1, $2, 'Legacy child', now(), now())`,
      [childId, familyId],
    )
    await database.query('COMMIT')
    await database.end()
    database = undefined

    expect(deployMigrations(upgradedUrl.toString()).status).toBe(0)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()

    const preserved = await database.query<{ avatar_media_id: string | null }>(
      'SELECT avatar_media_id FROM children WHERE id = $1', [childId],
    )
    expect(preserved.rows[0]).toEqual({ avatar_media_id: null })

    const assetId = randomUUID()
    await database.query(
      `INSERT INTO media_assets
        (id, family_id, uploader_id, source_kind, purpose, media_kind, original_key,
         declared_mime, verified_mime, sha256, byte_size, original_status, rendition_status, updated_at)
       VALUES ($1, $2, $3, 'upload', 'child_avatar', 'photo', 'media/2026/09/test',
               'image/png', 'image/png', repeat('a', 64), 100, 'stored', 'ready', now())`,
      [assetId, familyId, ownerId],
    )
    await database.query('UPDATE children SET avatar_media_id = $1 WHERE id = $2', [assetId, childId])

    const memoryId = randomUUID()
    await database.query(
      `INSERT INTO memories
        (id, family_id, child_id, author_id, kind, body, occurred_at, updated_at)
       VALUES ($1, $2, $3, $4, 'note', 'Legacy-compatible note', now(), now())`,
      [memoryId, familyId, childId, ownerId],
    )

    await expect(database.query(
      `INSERT INTO memory_media (family_id, memory_id, media_id, position)
       VALUES ($1, $2, $3, 0)`,
      [otherFamilyId, memoryId, assetId],
    )).rejects.toMatchObject({ constraint: 'memory_media_memory_id_family_id_fkey' })
  } finally {
    await database?.end()
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`, [databaseName],
    )
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.end()
  }
})

function deployMigrations(databaseUrl: string) {
  return spawnSync('bun', ['run', 'prisma:deploy'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  })
}
