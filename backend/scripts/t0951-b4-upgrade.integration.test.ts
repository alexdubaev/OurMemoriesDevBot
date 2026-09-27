import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')
const b4Migration = '20260927140000_t0951_unread_publication_guard'

test('B4 guard upgrades a populated B3 database without changing archive ordinals', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
  const databaseName = `t0951_b4_upgrade_${process.pid}_${Date.now()}`
  if (!/^t0951_b4_upgrade_[0-9_]+$/.test(databaseName)) throw new Error('Unsafe database name')
  const upgradedUrl = new URL(databaseUrl)
  upgradedUrl.pathname = `/${databaseName}`
  const admin = new Client({ connectionString: databaseUrl })
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
    const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name < b4Migration)
      .map((entry) => entry.name).sort()
    for (const migrationName of migrations) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(`INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
        VALUES ($1, $2, now(), $3, now(), 1)`,
      [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName])
    }

    const [ownerId, familyId, childId, memoryId] = Array.from({ length: 4 }, () => randomUUID())
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    await database.query(`INSERT INTO users (id, display_name, role, created_at, updated_at)
      VALUES ($1, 'Historical owner', 'user', now(), now())`, [ownerId])
    await database.query(`INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at)
      VALUES ($1, $2, 'Historical family', 'Europe/Moscow', 'active', now(), now())`, [familyId, ownerId])
    await database.query(`INSERT INTO family_members (family_id, user_id, role, joined_at)
      VALUES ($1, $2, 'full', now())`, [familyId, ownerId])
    await database.query(`INSERT INTO children (id, family_id, display_name, created_at, updated_at)
      VALUES ($1, $2, 'Historical child', now(), now())`, [childId, familyId])
    await database.query(`INSERT INTO memories (id, family_id, child_id, author_id, kind, body, occurred_at, updated_at)
      VALUES ($1, $2, $3, $4, 'note', 'Historical note', now(), now())`,
    [memoryId, familyId, childId, ownerId])
    await database.query('COMMIT')
    await database.end()
    database = undefined

    const deploy = spawnSync('bun', ['run', 'prisma:deploy'], { cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: upgradedUrl.toString() }, encoding: 'utf8' })
    expect(deploy.status).toBe(0)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    await database.query('UPDATE families SET unread_tracking_activated_at = now() WHERE id = $1', [familyId])
    await database.query('UPDATE memories SET body = $1 WHERE id = $2', ['Edited historical note', memoryId])
    const old = await database.query<{ first_published_ordinal: string | null }>(
      'SELECT first_published_ordinal FROM memories WHERE id = $1', [memoryId])
    expect(old.rows[0]?.first_published_ordinal).toBeNull()
    await expect(database.query(`INSERT INTO memories (id, family_id, child_id, author_id, kind, body, occurred_at, updated_at)
      VALUES ($1, $2, $3, $4, 'note', 'Untracked', now(), now())`,
    [randomUUID(), familyId, childId, ownerId])).rejects.toMatchObject({ code: '23514' })
    await database.query('UPDATE families SET publication_ordinal = 1 WHERE id = $1', [familyId])
    await database.query(`INSERT INTO memories
      (id, family_id, child_id, author_id, kind, body, occurred_at, updated_at, first_published_ordinal)
      VALUES ($1, $2, $3, $4, 'note', 'Tracked', now(), now(), 1)`,
    [randomUUID(), familyId, childId, ownerId])
    const count = await database.query<{ count: number }>('SELECT count(*)::int AS count FROM memories')
    expect(count.rows[0]?.count).toBe(2)
  } finally {
    await database?.end()
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`, [databaseName])
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.end()
  }
})
