import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')
const welcomeMigration = '20260927150000_welcome_first_run_claim'

test('Welcome migration backfills existing accounts while post-migration accounts start unclaimed', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')
  const databaseName = `welcome_upgrade_${process.pid}_${Date.now()}`
  if (!/^welcome_upgrade_[0-9_]+$/.test(databaseName)) throw new Error('Unsafe database name')
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
      .filter((entry) => entry.isDirectory() && entry.name < welcomeMigration)
      .map((entry) => entry.name).sort()
    for (const migrationName of migrations) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(`INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
        VALUES ($1, $2, now(), $3, now(), 1)`,
      [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName])
    }

    const existingUserId = randomUUID()
    const familyId = randomUUID()
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    await database.query(`INSERT INTO users (id, display_name, role, created_at, updated_at)
      VALUES ($1, 'Existing owner', 'user', now(), now())`, [existingUserId])
    await database.query(`INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at)
      VALUES ($1, $2, 'Existing family', 'Europe/Moscow', 'active', now(), now())`, [familyId, existingUserId])
    await database.query(`INSERT INTO family_members (family_id, user_id, role, joined_at)
      VALUES ($1, $2, 'full', now())`, [familyId, existingUserId])
    await database.query('COMMIT')
    await database.end()
    database = undefined

    const deploy = spawnSync('bun', ['run', 'prisma:deploy'], { cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: upgradedUrl.toString() }, encoding: 'utf8' })
    expect(deploy.status).toBe(0)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()
    const existing = await database.query<{ welcome_shown_at: Date | null }>(
      'SELECT welcome_shown_at FROM users WHERE id = $1', [existingUserId])
    expect(existing.rows[0]?.welcome_shown_at).toBeInstanceOf(Date)

    const newUserId = randomUUID()
    await database.query(`INSERT INTO users (id, display_name, role, created_at, updated_at)
      VALUES ($1, 'New owner', 'user', now(), now())`, [newUserId])
    const newUser = await database.query<{ welcome_shown_at: Date | null }>(
      'SELECT welcome_shown_at FROM users WHERE id = $1', [newUserId])
    expect(newUser.rows[0]?.welcome_shown_at).toBeNull()
    const family = await database.query<{ owner_user_id: string; role: string }>(
      `SELECT f.owner_user_id, fm.role FROM families f
        JOIN family_members fm ON fm.family_id = f.id WHERE f.id = $1 AND fm.user_id = $2`,
      [familyId, existingUserId])
    expect(family.rows).toEqual([{ owner_user_id: existingUserId, role: 'full' }])
  } finally {
    await database?.end()
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`, [databaseName])
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.end()
  }
})
