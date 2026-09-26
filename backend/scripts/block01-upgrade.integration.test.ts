import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'

import { createPrisma } from '../src/db'

const block00Migrations = [
  '20260808125145_init',
  '20260809113326_user_avatars',
  '20260809171936_task_outbox',
] as const

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')

test('upgrades Block 00 legacy users and sessions to Block 01 without data loss', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

  const databaseName = `block01_upgrade_${process.pid}_${Date.now()}`
  if (!/^block01_upgrade_[0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe temporary database name: ${databaseName}`)
  }
  const admin = new Client({ connectionString: databaseUrl })
  const upgradedUrl = new URL(databaseUrl)
  upgradedUrl.pathname = `/${databaseName}`
  let legacy: Client | undefined
  let upgraded: ReturnType<typeof createPrisma> | undefined

  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    legacy = new Client({ connectionString: upgradedUrl.toString() })
    await legacy.connect()
    await legacy.query(`
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
    for (const migrationName of block00Migrations) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await legacy.query(sql)
      await legacy.query(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName],
      )
    }

    const legacyUserId = '01993b24-7e7d-7000-8000-000000000101'
    const legacySessionId = '01993b24-7e7d-7000-8000-000000000102'
    await legacy.query(
      `INSERT INTO users
        (id, email, password_hash, display_name, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'user', now(), now())`,
      [legacyUserId, 'legacy@example.com', 'legacy-password-hash', 'Legacy User'],
    )
    await legacy.query(
      `INSERT INTO auth_sessions
        (id, user_id, refresh_token_hash, refresh_token_family_hash, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day', now(), now())`,
      [legacySessionId, legacyUserId, 'legacy-refresh-hash', 'legacy-family-hash'],
    )
    await legacy.end()
    legacy = undefined

    const firstDeploy = deployMigrations(upgradedUrl.toString())
    expect(firstDeploy.status).toBe(0)

    upgraded = createPrisma(upgradedUrl.toString())
    const legacyUser = await upgraded.user.findUniqueOrThrow({ where: { id: legacyUserId } })
    const legacySession = await upgraded.authSession.findUniqueOrThrow({
      where: { id: legacySessionId },
    })
    expect(legacyUser).toMatchObject({
      id: legacyUserId,
      email: 'legacy@example.com',
      displayName: 'Legacy User',
    })
    expect(legacySession).toMatchObject({
      id: legacySessionId,
      userId: legacyUserId,
      externalIdentityId: null,
      refreshTokenHash: 'legacy-refresh-hash',
      refreshTokenFamilyHash: 'legacy-family-hash',
      revokedAt: null,
    })
    const telegramUser = await upgraded.user.create({
      data: { email: null, displayName: 'Telegram User' },
    })
    expect(telegramUser.email).toBeNull()

    const catalog = await upgraded.$queryRaw<Array<{ object_name: string | null }>>`
      SELECT to_regclass('public.idempotency_records')::text AS object_name
      UNION ALL SELECT to_regclass('public.family_members_one_active_family_per_user_key')::text
      UNION ALL SELECT to_regclass('public.families_one_undeleted_owned_family_per_user_key')::text
      UNION ALL SELECT (
        SELECT conname FROM pg_constraint WHERE conname = 'families_owner_membership_fkey'
      )
      UNION ALL SELECT (
        SELECT conname FROM pg_constraint WHERE conname = 'idempotency_records_actor_user_id_fkey'
      )
    `
    expect(catalog.map(({ object_name }) => object_name)).toEqual([
      'idempotency_records',
      null,
      'families_one_undeleted_owned_family_per_user_key',
      'families_owner_membership_fkey',
      'idempotency_records_actor_user_id_fkey',
    ])

    await upgraded.$disconnect()
    upgraded = undefined
    const secondDeploy = deployMigrations(upgradedUrl.toString())
    expect(secondDeploy.status).toBe(0)
    expect(`${secondDeploy.stdout}${secondDeploy.stderr}`).toContain('No pending migrations')
  } finally {
    await upgraded?.$disconnect()
    await legacy?.end()
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
