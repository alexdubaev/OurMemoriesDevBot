import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'
import { Client } from 'pg'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'

const backendRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const migrationsRoot = resolve(backendRoot, 'prisma', 'migrations')
const childTagsMigration = '20261024100000_memory_child_tags'

test('child tags migration keeps every existing memory on its previous child and only adds schema', async () => {
  const databaseUrl = requireIntegrationDatabaseUrl()
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name).sort()
  const boundary = migrations.indexOf(childTagsMigration)
  expect(boundary).toBeGreaterThan(-1)
  const migrationSql = await readFile(resolve(migrationsRoot, childTagsMigration, 'migration.sql'), 'utf8')
  // Expand only: nothing is dropped, renamed, retyped or made mandatory.
  expect(migrationSql).not.toMatch(/\bDROP\b|\bRENAME\b|SET NOT NULL|ALTER COLUMN|\bTRUNCATE\b|DELETE FROM|^\s*UPDATE\s/im)

  const databaseName = `child_tags_upgrade_${process.pid}_${Date.now()}_${randomUUID().slice(0, 8)}_test`
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
    for (const migrationName of migrations.slice(0, boundary)) {
      const sql = await readFile(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8')
      await database.query(sql)
      await database.query(`INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
        VALUES ($1, $2, now(), $3, now(), 1)`,
      [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName])
    }

    const owner = randomUUID(), relative = randomUUID(), familyId = randomUUID(), otherFamilyId = randomUUID()
    const elder = randomUUID(), younger = randomUUID(), otherChild = randomUUID()
    const memories = [
      { id: randomUUID(), familyId, childId: elder, authorId: owner, status: 'published' },
      { id: randomUUID(), familyId, childId: younger, authorId: relative, status: 'published' },
      { id: randomUUID(), familyId, childId: elder, authorId: relative, status: 'deleted' },
      { id: randomUUID(), familyId: otherFamilyId, childId: otherChild, authorId: relative, status: 'published' },
    ]
    await database.query('BEGIN')
    await database.query('SET CONSTRAINTS ALL DEFERRED')
    for (const [id, name] of [[owner, 'Synthetic owner'], [relative, 'Synthetic relative']]) {
      await database.query(`INSERT INTO users (id, display_name, role, created_at, updated_at) VALUES ($1, $2, 'user', now(), now())`, [id, name])
    }
    for (const [id, familyOwner] of [[familyId, owner], [otherFamilyId, relative]]) {
      await database.query(`INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at)
        VALUES ($1, $2, 'Synthetic family', 'Europe/Moscow', 'active', now(), now())`, [id, familyOwner])
      await database.query(`INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES ($1, $2, 'full', now())`, [id, familyOwner])
    }
    await database.query(`INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES ($1, $2, 'full', now())`, [familyId, relative])
    for (const [id, family] of [[elder, familyId], [younger, familyId], [otherChild, otherFamilyId]]) {
      await database.query(`INSERT INTO children (id, family_id, display_name, created_at, updated_at)
        VALUES ($1, $2, 'Synthetic child', now(), now())`, [id, family])
    }
    for (const memory of memories) {
      await database.query(`INSERT INTO memories (id, family_id, child_id, author_id, kind, body, occurred_at, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'note', 'Existing memory', now(), 'processing', now(), now())`,
      [memory.id, memory.familyId, memory.childId, memory.authorId])
      await database.query(`UPDATE memories SET status = 'published', first_published_at = now() WHERE id = $1`, [memory.id])
      if (memory.status === 'deleted') {
        await database.query(`UPDATE memories SET status = 'deleted', deleted_at = now(), version = version + 1 WHERE id = $1`, [memory.id])
      }
    }
    await database.query('COMMIT')
    const before = await database.query('SELECT id, family_id, child_id, author_id, version, status::text FROM memories ORDER BY id')
    await database.end()
    database = undefined

    const deploy = spawnSync('bun', ['run', 'prisma:deploy'], {
      cwd: backendRoot, env: { ...process.env, DATABASE_URL: upgradedUrl.toString() }, encoding: 'utf8',
    })
    if (deploy.status !== 0) throw new Error(`Prisma migration deploy failed: ${deploy.stderr || deploy.stdout}`)
    database = new Client({ connectionString: upgradedUrl.toString() })
    await database.connect()

    const tags = await database.query<{ family_id: string; memory_id: string; child_id: string; attachment_id: string | null; created_by: string }>(
      'SELECT family_id, memory_id, child_id, attachment_id, created_by FROM memory_child_tags ORDER BY memory_id')
    expect(tags.rows).toEqual(memories
      .map((memory) => ({ family_id: memory.familyId, memory_id: memory.id, child_id: memory.childId, attachment_id: null, created_by: memory.authorId }))
      .sort((a, b) => a.memory_id.localeCompare(b.memory_id)))
    expect((await database.query('SELECT id, family_id, child_id, author_id, version, status::text FROM memories ORDER BY id')).rows).toEqual(before.rows)
    expect((await database.query('SELECT DISTINCT child_tags_version FROM memories')).rows).toEqual([{ child_tags_version: 1 }])
    expect((await database.query('SELECT COUNT(*)::int AS count FROM children WHERE deleted_at IS NOT NULL')).rows).toEqual([{ count: 0 }])

    // Publication-level tag is unique per memory and child; attachment tags are unique per attachment.
    await expect(database.query(`INSERT INTO memory_child_tags (family_id, memory_id, child_id, created_by) VALUES ($1, $2, $3, $4)`,
      [familyId, memories[0]!.id, elder, owner])).rejects.toThrow(/memory_child_tags_publication_key/)
    const attachmentId = randomUUID()
    await database.query(`INSERT INTO memory_child_tags (family_id, memory_id, child_id, attachment_id, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [familyId, memories[0]!.id, younger, attachmentId, owner])
    await expect(database.query(`INSERT INTO memory_child_tags (family_id, memory_id, child_id, attachment_id, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [familyId, memories[0]!.id, younger, attachmentId, owner])).rejects.toThrow(/memory_child_tags_attachment_key/)
    // A child of another family can never be attached, and a tagged child cannot be hard-deleted.
    await expect(database.query(`INSERT INTO memory_child_tags (family_id, memory_id, child_id, created_by) VALUES ($1, $2, $3, $4)`,
      [familyId, memories[0]!.id, otherChild, owner])).rejects.toThrow(/memory_child_tags_child_id_family_id_fkey/)
    await expect(database.query('DELETE FROM children WHERE id = $1', [younger])).rejects.toThrow(/fkey/)
    // Removing a memory removes its tags.
    await database.query('DELETE FROM memories WHERE id = $1', [memories[3]!.id])
    expect((await database.query('SELECT COUNT(*)::int AS count FROM memory_child_tags WHERE memory_id = $1', [memories[3]!.id])).rows).toEqual([{ count: 0 }])
  } finally {
    await database?.end().catch(() => undefined)
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined)
    await admin.end()
  }
}, 180_000)
