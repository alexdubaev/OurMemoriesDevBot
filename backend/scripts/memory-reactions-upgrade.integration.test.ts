import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')
const reactionMigration = '20261001090000_memory_reactions'

test('backfills every existing like to heart without changing identity or timestamp', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name).sort()
  const boundary = migrations.indexOf(reactionMigration)
  expect(boundary).toBeGreaterThan(-1)
  const databaseName = `reaction_upgrade_${process.pid}_${Date.now()}_${randomUUID().slice(0, 8)}`
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
    for (const migrationName of migrations.slice(0, -1)) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(`INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
        VALUES ($1, $2, now(), $3, now(), 1)`,
      [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName])
    }
    const userId = randomUUID(), familyId = randomUUID(), childId = randomUUID(), memoryId = randomUUID()
    const createdAt = new Date('2025-02-03T04:05:06.789Z')
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    await database.query(`INSERT INTO users (id, display_name, role, created_at, updated_at)
      VALUES ($1, 'Synthetic owner', 'user', now(), now())`, [userId])
    await database.query(`INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at)
      VALUES ($1, $2, 'Synthetic family', 'Europe/Moscow', 'active', now(), now())`, [familyId, userId])
    await database.query(`INSERT INTO family_members (family_id, user_id, role, joined_at)
      VALUES ($1, $2, 'full', now())`, [familyId, userId])
    await database.query(`INSERT INTO children (id, family_id, display_name, created_at, updated_at)
      VALUES ($1, $2, 'Synthetic child', now(), now())`, [childId, familyId])
    await database.query(`INSERT INTO memories (id, family_id, child_id, author_id, kind, body, occurred_at, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'note', 'Existing like', now(), 'processing', $5, now())`, [memoryId, familyId, childId, userId, createdAt])
    await database.query(`UPDATE memories SET status = 'published', first_published_at = $2 WHERE id = $1`,
      [memoryId, createdAt])
    await database.query(`INSERT INTO memory_likes (family_id, memory_id, user_id, created_at)
      VALUES ($1, $2, $3, $4)`, [familyId, memoryId, userId, createdAt])
    await database.query('COMMIT')
    await database.end()
    database = undefined
    const deploy = spawnSync('bun', ['run', 'prisma:deploy'], {
      cwd: backendRoot, env: { ...process.env, DATABASE_URL: upgradedUrl.toString() }, encoding: 'utf8',
    })
    if (deploy.status !== 0) throw new Error(`Prisma migration deploy failed: ${deploy.stderr || deploy.stdout}`)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    const rows = await database.query<{ family_id: string; memory_id: string; user_id: string; created_at: Date; reaction: string }>(
      `SELECT family_id, memory_id, user_id, created_at, reaction::text FROM memory_likes WHERE memory_id = $1`, [memoryId])
    expect(rows.rows).toEqual([{ family_id: familyId, memory_id: memoryId, user_id: userId, created_at: createdAt, reaction: 'heart' }])
    expect((await database.query('SELECT COUNT(*)::int AS count FROM memory_likes WHERE memory_id = $1', [memoryId])).rows)
      .toEqual([{ count: 1 }])
  } finally {
    await database?.end().catch(() => undefined)
    if (database) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`).catch(() => undefined)
    else await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined)
    await admin.end()
  }
})
