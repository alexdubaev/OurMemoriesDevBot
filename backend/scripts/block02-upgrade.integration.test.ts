import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

const block01Migrations = [
  '20260808125145_init',
  '20260809113326_user_avatars',
  '20260809171936_task_outbox',
  '20260909150000_block01_auth_family',
  '20260909190000_block01_review_fixes',
  '20260909220000_idempotency_response_snapshot',
] as const

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')

test('upgrades a populated Block 01 database with Block 02 data constraints intact', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = `block02_upgrade_${process.pid}_${Date.now()}`
  if (!/^block02_upgrade_[0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe temporary database name: ${databaseName}`)
  }
  const admin = new Client({ connectionString: databaseUrl })
  const upgradedUrl = new URL(databaseUrl)
  upgradedUrl.pathname = `/${databaseName}`
  let database: Client | undefined

  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    await database.query(`
      CREATE TABLE "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )
    `)
    for (const migrationName of block01Migrations) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName],
      )
    }

    const ownerId = '01993b24-7e7d-7000-8000-000000000201'
    const outsiderId = '01993b24-7e7d-7000-8000-000000000202'
    const familyId = '01993b24-7e7d-7000-8000-000000000203'
    const childId = '01993b24-7e7d-7000-8000-000000000204'
    const idempotencyId = '01993b24-7e7d-7000-8000-000000000205'
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    await database.query(
      `INSERT INTO users (id, display_name, role, created_at, updated_at)
       VALUES ($1, 'Legacy owner', 'user', now(), now()),
              ($2, 'Legacy outsider', 'user', now(), now())`,
      [ownerId, outsiderId],
    )
    await database.query(
      `INSERT INTO families
        (id, owner_user_id, name, timezone, status, storage_used_bytes,
         storage_reserved_bytes, created_at, updated_at)
       VALUES ($1, $2, 'Legacy family', 'Europe/Moscow', 'active', 0, 0, now(), now())`,
      [familyId, ownerId],
    )
    await database.query(
      `INSERT INTO family_members (family_id, user_id, role, joined_at)
       VALUES ($1, $2, 'full', now())`,
      [familyId, ownerId],
    )
    await database.query(
      `INSERT INTO children (id, family_id, display_name, created_at, updated_at)
       VALUES ($1, $2, 'Legacy child', now(), now())`,
      [childId, familyId],
    )
    await database.query(
      `INSERT INTO idempotency_records
        (id, actor_user_id, operation, key, payload_hash, resource_id,
         response_snapshot, expires_at, created_at)
       VALUES ($1, $2, 'family.create', $3,
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', $4,
               '{"legacy":true}'::jsonb, now() + interval '1 day', now())`,
      [idempotencyId, ownerId, randomUUID(), familyId],
    )
    await database.query('COMMIT')
    await database.end()
    database = undefined

    const deploy = deployMigrations(upgradedUrl.toString())
    expect(deploy.status).toBe(0)

    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    const preserved = await database.query<{ families: number; children: number; records: number }>(`
      SELECT (SELECT count(*)::int FROM families) AS families,
             (SELECT count(*)::int FROM children) AS children,
             (SELECT count(*)::int FROM idempotency_records) AS records
    `)
    expect(preserved.rows[0]).toEqual({ families: 1, children: 1, records: 1 })

    const inserted = await database.query<{ created_sequence: string }>(
      `INSERT INTO memories
        (family_id, child_id, author_id, kind, body, occurred_at, updated_at)
       VALUES ($1, $2, $3, 'note', 'Legacy-compatible memory', now(), now())
       RETURNING created_sequence::text`,
      [familyId, childId, ownerId],
    )
    expect(BigInt(inserted.rows[0]!.created_sequence)).toBeGreaterThan(0n)

    await expect(database.query(
      `INSERT INTO memories
        (family_id, child_id, author_id, kind, body, occurred_at, updated_at)
       VALUES ($1, $2, $3, 'note', 'Wrong-family author', now(), now())`,
      [familyId, childId, outsiderId],
    )).rejects.toMatchObject({ constraint: 'memories_author_membership_fkey' })
  } finally {
    await database?.end()
    await admin.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
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
