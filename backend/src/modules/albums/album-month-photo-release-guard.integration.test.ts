import { expect, test } from 'bun:test'
import { Client } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'

const root = resolve(import.meta.dir, '../../../..')
const baseline = 'a18469ab8a54464d491659d849fcf286973fa9e4'
const migrationName = '20261105110000_album_month_photos'

test('S3 month-photo guard accepts only the exact 65/66 ledger and matching schema', async () => {
  const base = new URL(requireIntegrationDatabaseUrl()!)
  if (base.hostname !== '127.0.0.1' || !base.pathname.endsWith('_test')) throw Error('Isolated loopback test database required')
  const name = `s3_month_guard_${randomUUID().replaceAll('-', '')}_test`, url = new URL(base); url.pathname = `/${name}`
  const admin = new Client({ connectionString: base.toString() }); await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`)
  const db = new Client({ connectionString: url.toString() }); await db.connect()
  const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); if (r.status !== 0) throw Error(r.stderr); return r.stdout }
  const paths = (rev: string) => git('ls-tree', '-r', '--name-only', rev, '--', 'backend/prisma/migrations/').trim().split('\n').filter(p => p.endsWith('/migration.sql')).sort()
  const catalog = (rev: string) => paths(rev).map(path => { const sql = git('show', `${rev}:${path}`).replaceAll('\r\n', '\n'); return `${path.split('/').at(-2)}:${createHash('sha256').update(sql).digest('hex')}:${createHash('sha256').update(sql.replaceAll('\n', '\r\n')).digest('hex')}` }).join('\n')
  const current = git('rev-parse', 'HEAD').trim(), oldCatalog = catalog(baseline), newCatalog = catalog(current)
  const program = readFileSync(resolve(root, 'deploy/selectel/redeploy.sh'), 'utf8').replaceAll('\r\n', '\n').match(/MEMOLY_S3_MONTH_HISTORY_JS'\n([\s\S]*?)\nMEMOLY_S3_MONTH_HISTORY_JS/)?.[1]
  if (!program) throw Error('Actual month-photo release validator is missing')
  let cases = 0
  const check = (phase: string, candidate: string, accepted: boolean) => {
    const r = spawnSync('bun', ['-e', program], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString(), MEMOLY_S3_MONTH_BASELINE: oldCatalog, MEMOLY_S3_MONTH_CANDIDATE: candidate, MEMOLY_S3_MONTH_PHASE: phase }, encoding: 'utf8', timeout: 20_000 })
    expect(r.error).toBeUndefined()
    if (accepted && r.status !== 0) throw Error(`guard rejected ${phase}: ${r.stdout}\n${r.stderr}`)
    accepted ? expect(r.status).toBe(0) : expect(r.status).not.toBe(0); cases++
  }
  const apply = async (rev: string, index: number) => {
    const path = paths(rev)[index]!, sql = git('show', `${rev}:${path}`).replaceAll('\r\n', '\n')
    await db.query(sql)
    await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)', [randomUUID(), createHash('sha256').update(index % 2 ? sql.replaceAll('\n', '\r\n') : sql).digest('hex'), path.split('/').at(-2)])
  }
  try {
    expect(paths(baseline)).toHaveLength(65); expect(paths(current)).toHaveLength(66)
    expect(paths(current)[65]!.split('/').at(-2)).toBe(migrationName)
    await db.query('CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)')
    for (let i = 0; i < 65; i++) await apply(baseline, i)
    check('pre-sql', newCatalog, true); check('complete', newCatalog, false)
    await db.query('ALTER TABLE album_entries ADD COLUMN month_cover_source_id text')
    check('pre-sql', newCatalog, false)
    await db.query('ALTER TABLE album_entries DROP COLUMN month_cover_source_id')
    const migrationPath = paths(current)[65]!, sql = git('show', `${current}:${migrationPath}`).replaceAll('\r\n', '\n')
    await db.query(sql)
    await db.query('INSERT INTO _prisma_migrations (id,checksum,migration_name,finished_at,applied_steps_count) VALUES ($1,$2,$3,now(),1)', [randomUUID(), createHash('sha256').update(sql).digest('hex'), migrationName])
    check('pre-sql', newCatalog, true); check('complete', newCatalog, true)
    check('complete', newCatalog.replace(migrationName, '20990101000000_foreign'), false)
    check('unknown', newCatalog, false)
    await db.query('ALTER TABLE album_entries DROP CONSTRAINT album_entries_month_cover_source_id_fkey')
    await db.query('ALTER TABLE album_entries ADD CONSTRAINT album_entries_month_cover_source_id_fkey FOREIGN KEY (month_cover_source_id) REFERENCES album_entry_sources(id) ON DELETE CASCADE NOT VALID')
    check('complete', newCatalog, false)
    await db.query('ALTER TABLE album_entries DROP CONSTRAINT album_entries_month_cover_source_id_fkey')
    await db.query('ALTER TABLE album_entries ADD CONSTRAINT album_entries_month_cover_source_id_fkey FOREIGN KEY (month_cover_source_id) REFERENCES album_entry_sources(id) ON DELETE SET NULL')
    await db.query('ALTER TABLE album_source_operations DISABLE TRIGGER album_source_operations_legacy_month_replace_fence')
    check('complete', newCatalog, false)
    await db.query('ALTER TABLE album_source_operations ENABLE TRIGGER album_source_operations_legacy_month_replace_fence')
    await db.query('DROP INDEX album_entry_sources_month_page_idx')
    check('complete', newCatalog, false)
    await db.query('CREATE INDEX album_entry_sources_month_page_idx ON album_entry_sources(entry_id, kind, position, id)')
    check('complete', oldCatalog, false)
    console.log(`S3 month-photo release guard: ${cases} real PostgreSQL assertions across exact 65/66 states`)
  } finally { await db.end(); await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); await admin.end() }
}, 300_000)
