import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { childrenFixtures } from '../src/test-support/children-fixtures'
import { createMaxVideoLegacyMigration } from '../src/modules/max/infrastructure/legacy-video-migration'
import { PrismaMemoryRepository } from '../src/modules/memories'
import { createPrismaIdempotencyExecutor } from '../src/idempotency'
import { FilesystemPrivateStorage } from '../src/storage/filesystem-storage'
import type { MaxApiPort } from '../src/modules/max/application/ports'
// @ts-expect-error JS runtime safety guard has no declaration surface.
import { assertTestDatabaseUrl } from '../../scripts/repo-env.mjs'
import { requireIntegrationDatabaseUrl } from '../src/test-support/integration-database'
import { runFrozenMax63Positive } from './test-support/frozen-max63-recovery'

const root = resolve(import.meta.dir, '../..')
const preRetentionBaseline = '92a4fb7d732339927fb3ac0c38c8bbe18f655ad4'
const multiVideoMigrationName = '20261025110000_max_multivideo_references'

test('reviewed MAX63 retention backfill preserves historical inverse and frozen d299 worker compatibility', async () => {
  const output = await runFrozenMax63Positive(root, 'scripts/max-video-retention-backfill.integration.test.ts',
    'retention migration holds preexisting legacy videos without changing timestamps or quota', { archiveGitContext: true })
  expect(output).toContain('1 pass')
  console.log(output)
}, process.platform === 'win32' ? 600_000 : 420_000)

test('current retention backfill preserves timestamps, quota and projection while refusing historical MAX inverse', async () => {
  const baseUrl = requireIntegrationDatabaseUrl()
  if (!baseUrl || process.env.DATABASE_URL !== baseUrl) throw new Error('Explicit matching test database URLs required')
  assertTestDatabaseUrl(baseUrl)
  if (new URL(baseUrl).hostname !== '127.0.0.1' || !new URL(baseUrl).pathname.endsWith('_test')) throw new Error('Loopback *_test PostgreSQL required')
  const name = `max_retention_backfill_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 12)}_test`
  const ownUrl = new URL(baseUrl)
  ownUrl.pathname = `/${name}`
  const admin = new Client({ connectionString: baseUrl })
  const scratch = resolve(root, '.scratch')
  mkdirSync(scratch, { recursive: true })
  const prefix = `${scratch}${sep}`
  const fixture = mkdtempSync(resolve(scratch, 'max-retention-backfill-'))
  if (!resolve(fixture).startsWith(prefix)) throw new Error('Fixture escaped .scratch')
  const frozen = resolve(fixture, 'pre-retention')
  const migrationConfig = resolve(frozen, 'backend/prisma.config.ts')
  const env = { ...process.env, DATABASE_URL: ownUrl.toString(), TEST_DATABASE_URL: ownUrl.toString(), CHECKPOINT_DISABLE: '1' }
  const run = (command: string, args: string[], cwd = root, childEnv = env, timeout = 300_000) =>
    spawnSync(command, args, { cwd, env: childEnv, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 })
  const checked = (label: string, command: string, args: string[], cwd = root, childEnv = env) => {
    const result = run(command, args, cwd, childEnv)
    if (result.status !== 0) throw new Error(`${label} failed exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}\n${result.stdout}\n${result.stderr}`)
    return result.stdout
  }
  let created = false
  let seed: Client | undefined
  let fixtureClient: ReturnType<typeof childrenFixtures> | undefined
  let syntheticVideoId: string | undefined
  let syntheticSourceId: string | undefined
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL
  try {
    await admin.connect()
    await admin.query(`CREATE DATABASE "${name}"`)
    created = true
    mkdirSync(frozen, { recursive: true })
    const archive = spawnSync('git', ['archive', preRetentionBaseline, 'backend/prisma/migrations', 'backend/prisma/schema.prisma', 'backend/prisma.config.ts'],
      { cwd: root, env, encoding: null, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
    if (archive.status !== 0 || !archive.stdout) throw new Error(`Cannot archive exact 92a baseline migration catalog: ${archive.stderr}`)
    const extract = spawnSync('tar', ['-x', '-C', frozen], { cwd: root, input: archive.stdout, encoding: 'utf8', timeout: 60_000 })
    if (extract.status !== 0) throw new Error(`Cannot extract 92a baseline catalog: ${extract.stderr}`)
    const multiVideoMigrationPath = resolve(frozen, 'backend/prisma/migrations', multiVideoMigrationName, 'migration.sql')
    mkdirSync(resolve(multiVideoMigrationPath, '..'), { recursive: true })
    writeFileSync(multiVideoMigrationPath, readFileSync(resolve(root, 'backend/prisma/migrations', multiVideoMigrationName, 'migration.sql')))
    checked('apply 92a baseline plus exact candidate multivideo migration (58 migrations)', 'bunx', ['--bun', 'prisma', 'migrate', 'deploy', '--config', migrationConfig])

    seed = new Client({ connectionString: ownUrl.toString() })
    await seed.connect()
    const userId = randomUUID()
    const familyId = randomUUID()
    const mediaId = randomUUID()
    const insertedAt = new Date('2025-01-02T03:04:05.123Z')
    const quota = 123456n
    try {
      await seed.query('BEGIN')
      await seed.query('SET CONSTRAINTS ALL DEFERRED')
      await seed.query('INSERT INTO users (id, display_name, updated_at) VALUES ($1::uuid, $2, $3)', [userId, 'Synthetic legacy-video owner', insertedAt])
      await seed.query('INSERT INTO families (id, owner_user_id, name, timezone, storage_used_bytes, updated_at) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [familyId, userId, 'Synthetic legacy-video family', 'Europe/Moscow', quota.toString(), insertedAt])
      await seed.query('INSERT INTO family_members (family_id, user_id, role) VALUES ($1::uuid, $2::uuid, $3)', [familyId, userId, 'full'])
      await seed.query(`INSERT INTO media_assets (id, family_id, uploader_id, source_kind, purpose, media_kind, original_key, declared_mime, verified_mime, sha256, byte_size, original_status, rendition_status, created_at, updated_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'max', 'memory', 'video', $4, 'video/mp4', 'video/mp4', $5, 321, 'stored', 'ready', $6, $6)`,
      [mediaId, familyId, userId, `media-originals/${mediaId}`, 'a'.repeat(64), insertedAt])
      await seed.query('COMMIT')
      const before = await seed.query(`SELECT a.updated_at, a.storage_deleted_at, f.storage_used_bytes
        FROM media_assets a JOIN families f ON f.id = a.family_id WHERE a.id = $1::uuid`, [mediaId])
      expect(before.rows).toEqual([{ updated_at: insertedAt, storage_deleted_at: null, storage_used_bytes: quota.toString() }])
    } catch (error) {
      await seed.query('ROLLBACK').catch(() => {})
      throw error
    }
    await seed.end()
    seed = undefined

    checked('apply candidate retention migration after seeding the legacy video', 'bun', ['run', '--cwd', 'backend', 'prisma:deploy'])
    const verify = new Client({ connectionString: ownUrl.toString() })
    await verify.connect()
    try {
      const after = await verify.query(`SELECT a.legacy_video_retained_at, a.updated_at, a.storage_deleted_at, f.storage_used_bytes
        FROM media_assets a JOIN families f ON f.id = a.family_id WHERE a.id = $1::uuid`, [mediaId])
      expect(after.rows).toHaveLength(1)
      expect(after.rows[0].legacy_video_retained_at).toBeInstanceOf(Date)
      expect(after.rows[0].updated_at).toEqual(insertedAt)
      expect(after.rows[0].storage_deleted_at).toBeNull()
      expect(after.rows[0].storage_used_bytes).toBe(quota.toString())
      const ledger = await verify.query(`SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)
      // This test checks today's candidate deploy and retention backfill, so its completed
      // ledger must match the current migration directories, including later approved suffixes.
      const currentMigrationNames = readdirSync(resolve(root, 'backend/prisma/migrations'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
      expect(ledger.rows.map((row) => row.migration_name).sort()).toEqual(currentMigrationNames)
    } finally { await verify.end() }

    process.env.DATABASE_URL = ownUrl.toString()
    process.env.TEST_DATABASE_URL = ownUrl.toString()
    fixtureClient = childrenFixtures()
    const fx = fixtureClient
    const family = await fx.family()
    const memory = await fx.memory(family, { kind: 'video', body: 'synthetic legacy video' })
    const videoId = randomUUID()
    syntheticVideoId = videoId
    const inbox = await fx.db.maxInbox.create({ data: {
      eventKey: `max-video-release-${randomUUID()}`, botId: 1n, eventKind: 'message_created',
      encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]), encryptionAuthTag: new Uint8Array([3]), status: 'processed',
    } })
    const source = await fx.db.maxSource.create({ data: {
      inboxId: inbox.id, botId: 1n, senderSubject: family.owner.subject, recipientId: 1n,
      messageId: `synthetic-release-${randomUUID()}`, status: 'published', plannedMemoryId: memory.id,
      memoryId: memory.id, familyId: family.id, userId: family.owner.id, childId: family.children[0]!.id,
    } })
    syntheticSourceId = source.id
    const storageRoot = resolve(fixture, 'private-media')
    mkdirSync(storageRoot, { recursive: true })
    const privateStorage = new FilesystemPrivateStorage({ driver: 'filesystem', root: storageRoot,
      publicBaseUrl: 'http://127.0.0.1', signingKey: Buffer.alloc(32, 7), uploadMaxBytes: 10_000,
      uploadUrlTtlSeconds: 60, downloadUrlTtlSeconds: 60 })
    const originalKey = `media-originals/${videoId}`
    const videoBytes = Buffer.from([0, 1, 2, 3])
    await privateStorage.writeObject({ key: originalKey, body: new Response(videoBytes).body!,
      contentLength: videoBytes.byteLength, contentType: 'video/mp4' })
    const asset = await fx.db.mediaAsset.create({ data: {
      id: videoId, familyId: family.id, uploaderId: family.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'video',
      originalKey, declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'b'.repeat(64), byteSize: BigInt(videoBytes.byteLength),
      originalStatus: 'stored', renditionStatus: 'ready',
    } })
    await fx.db.family.update({ where: { id: family.id }, data: { storageUsedBytes: asset.byteSize } })
    await fx.db.memoryMedia.create({ data: { familyId: family.id, memoryId: memory.id, mediaId: videoId, position: 0 } })
    const providerAttachmentId = `provider-video-${randomUUID()}`
    await fx.db.maxSourceAttachment.create({ data: { sourceId: source.id, position: 0, providerKind: 'video',
      providerAttachmentId, plannedMediaId: videoId, mediaId: videoId, status: 'stored' } })
    let messageReads = 0
    let videoReads = 0
    const api = {
      getMessage: async (messageId: string) => { messageReads++; return ({ messageId, senderId: family.owner.subject, recipientId: '1', attachments: [
        { kind: 'video' as const, providerAttachmentId, currentToken: 'synthetic-current-token', inboundDurationSeconds: 1, width: 640, height: 360 },
        { kind: 'video' as const, providerAttachmentId: 'non-ledger-video', currentToken: 'synthetic-non-ledger-token', inboundDurationSeconds: 1, width: 640, height: 360 },
      ] }) },
      getVideo: async () => { videoReads++; return { width: 640, height: 360, durationMs: 1_000,
        renditions: [{ url: 'https://maxvd1.okcdn.ru/synthetic-video', width: 640, height: 360, contentLength: videoBytes.length }] } }
    } as unknown as MaxApiPort
    const originalFetch = globalThis.fetch
    globalThis.fetch = Object.assign(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range')
      if (range) return new Response(new Uint8Array([0, 1]), { status: 206, headers: {
        'Content-Type': 'video/mp4', 'Content-Length': '2', 'Content-Range': `bytes 0-1/${videoBytes.length}`,
      } })
      return new Response(null, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(videoBytes.length) } })
    }, { preconnect: originalFetch.preconnect })
    try {
      const migration = createMaxVideoLegacyMigration({ prisma: fx.db, storage: privateStorage, api })
      const plan = await migration.inventory({ batchSize: 10 })
      expect(plan).toMatchObject({ totalRows: 1, candidates: [{ mediaId: videoId, position: 0 }], skipped: [] })
      const applied = await migration.apply(plan)
      expect(applied).toMatchObject({ migrated: 1, alreadyMigrated: 0, skipped: 0 })
      await fx.db.maxVideoReference.create({ data: { id: randomUUID(), sourceId: source.id, memoryId: memory.id,
        familyId: family.id, attachmentPosition: 1, providerAttachmentId: 'non-ledger-video', width: 640, height: 360, durationMs: 1_000 } })
      await fx.db.maxVideoReference.create({ data: { id: randomUUID(), sourceId: source.id, memoryId: memory.id,
        familyId: family.id, attachmentPosition: 2, providerAttachmentId: 'second-non-ledger-video', width: 640, height: 360, durationMs: 1_000 } })
      const scope = { familyId: family.id, principal: { userId: family.owner.id, sessionId: 'release-probe' } }
      const currentRepository = new PrismaMemoryRepository(fx.db, createPrismaIdempotencyExecutor(fx.db))
      const projected = await currentRepository.get(scope, memory.id)
      expect(projected.attachments.map(({ id, source }) => [id, source])).toEqual([
        [videoId, 'max'], [expect.any(String), 'max'], [expect.any(String), 'max'],
      ])
      const snapshot = async () => ({
        ledger: await fx.db.$queryRawUnsafe('SELECT * FROM _prisma_migrations ORDER BY migration_name,started_at,id'),
        media: await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: videoId } }),
        references: await fx.db.maxVideoReference.findMany({ where: { sourceId: source.id }, orderBy: { id: 'asc' } }),
        retention: await fx.db.maxVideoLegacyRetention.findUniqueOrThrow({ where: { mediaId: videoId } }),
        memory: await fx.db.memory.findUniqueOrThrow({ where: { id: memory.id } }),
        family: await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true, updatedAt: true } }),
      })
      const beforeRecovery = await snapshot()
      const callsBeforeRecovery = { messageReads, videoReads }
      for (const operation of [
        () => migration.recoveryReadiness(),
        () => migration.recoverAll({ apply: false }),
        () => migration.recoverAll({ apply: true }),
      ]) {
        await expect(operation()).rejects.toThrow('MAX recovery migration catalog is not the exact reviewed lifecycle extension')
        expect(await snapshot()).toEqual(beforeRecovery)
        expect(Buffer.from((await privateStorage.readRange(originalKey, { start: 0, end: videoBytes.length - 1 }))!)).toEqual(videoBytes)
        expect({ messageReads, videoReads }).toEqual(callsBeforeRecovery)
      }
    } finally { globalThis.fetch = originalFetch }
  } finally {
    if (fixtureClient && syntheticVideoId && syntheticSourceId) {
      await fixtureClient.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('ALTER TABLE "media_assets" DISABLE TRIGGER "media_assets_protect_retained_max_video"')
        try {
          await tx.maxVideoReference.deleteMany({ where: { id: syntheticVideoId } })
          await tx.maxVideoLegacyRetention.deleteMany({ where: { mediaId: syntheticVideoId } })
          await tx.maxSourceAttachment.deleteMany({ where: { sourceId: syntheticSourceId } })
          await tx.memoryMedia.deleteMany({ where: { mediaId: syntheticVideoId } })
          await tx.mediaAsset.deleteMany({ where: { id: syntheticVideoId } })
        } finally {
          await tx.$executeRawUnsafe('ALTER TABLE "media_assets" ENABLE TRIGGER "media_assets_protect_retained_max_video"')
        }
      })
    }
    await fixtureClient?.disconnect()
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
    if (originalTestDatabaseUrl === undefined) delete process.env.TEST_DATABASE_URL
    else process.env.TEST_DATABASE_URL = originalTestDatabaseUrl
    await seed?.end().catch(() => {})
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`)
    await admin.end()
    const resolvedFixture = resolve(fixture)
    if (!resolvedFixture.startsWith(prefix)) throw new Error('Refusing to remove fixture outside .scratch')
    rmSync(resolvedFixture, { recursive: true, force: true })
  }
}, process.platform === 'win32' ? 600_000 : 420_000)
