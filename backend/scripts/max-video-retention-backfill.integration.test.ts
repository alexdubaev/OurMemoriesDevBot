import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const root = resolve(import.meta.dir, '../..')
const preRetentionBaseline = '92a4fb7d732339927fb3ac0c38c8bbe18f655ad4'
const multiVideoMigrationName = '20261025110000_max_multivideo_references'

test('retention migration holds preexisting legacy videos without changing timestamps or quota', async () => {
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
      const ledger = await verify.query(`SELECT count(*)::text AS count FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)
      expect(ledger.rows).toEqual([{ count: '59' }])
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
      const ready = await migration.recoveryReadiness()
      expect(ready).toMatchObject({ total: 1, inspected: 1, ready: 1, missingObjects: 0, invalid: [] })
      expect(await privateStorage.headObject(originalKey)).toMatchObject({ contentLength: videoBytes.length, contentType: 'video/mp4' })
      const readonly = await migration.recoverAll({ apply: false })
      expect(readonly).toMatchObject({ inspected: 1, recovered: 0, refused: 0, remaining: 1 })
      expect(await fx.db.maxVideoReference.count({ where: { id: videoId } })).toBe(1)
      const recovered = await migration.recoverAll({ apply: true })
      expect(recovered).toMatchObject({ inspected: 1, recovered: 1, refused: 0, remaining: 0 })
      expect(await fx.db.maxVideoReference.findUnique({ where: { id: videoId } })).toBeNull()
      expect(await fx.db.maxVideoReference.count({ where: { providerAttachmentId: 'non-ledger-video' } })).toBe(1)
      expect(await fx.db.maxVideoReference.count({ where: { providerAttachmentId: 'second-non-ledger-video' } })).toBe(1)
      expect((await privateStorage.headObject(originalKey))?.contentLength).toBe(videoBytes.length)

      const archived = resolve(fixture, 'runtime-d299')
      mkdirSync(archived, { recursive: true })
      const frozenArchive = spawnSync('git', ['archive', 'd2999cca6e4e5980cc2277de7453440353f5b392', 'backend', 'packages', 'webapp/package.json', 'website/package.json', 'package.json', 'bun.lock', 'bunfig.toml'],
        { cwd: root, env, encoding: null, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
      if (frozenArchive.status !== 0 || !frozenArchive.stdout) throw new Error(`Cannot archive frozen d299 runtime: ${frozenArchive.stderr}`)
      const frozenExtract = spawnSync('tar', ['-x', '-C', archived], { cwd: root, input: frozenArchive.stdout, encoding: 'utf8', timeout: 60_000 })
      if (frozenExtract.status !== 0) throw new Error(`Cannot extract frozen d299 runtime: ${frozenExtract.stderr}`)
      checked('frozen d299 runtime dependency install', 'bun', ['install', '--frozen-lockfile', '--filter', '@web-app-demo/backend'], archived)
      checked('frozen d299 Prisma generation', 'bun', ['run', '--cwd', 'backend', 'prisma:generate'], archived)
      const frozenProbe = resolve(archived, 'backend/scripts/test-support/max-video-release-probe.mjs')
      writeFileSync(frozenProbe, `
import { createPrisma } from '../../src/db.ts'
import { loadEnv } from '../../src/env.ts'
import { createPrismaIdempotencyExecutor } from '../../src/idempotency/index.ts'
import { PrismaMemoryRepository } from '../../src/modules/memories/index.ts'
import { createMediaTasks } from '../../src/modules/media/index.ts'
import { createPrivateStorage } from '../../src/storage/index.ts'
import { randomUUID } from 'node:crypto'
const [databaseUrl, familyId, memoryId, userId, sourceId, videoId, storageRoot] = process.argv.slice(2)
const env = loadEnv({ DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4),
  CORS_ORIGINS: 'http://localhost:5173', PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot })
const prisma = createPrisma(databaseUrl)
const scope = { familyId, principal: { userId, sessionId: 'frozen-d299-probe' } }
try {
  const upsert = async (attachmentPosition, providerAttachmentId) => prisma.maxVideoReference.upsert({
    where: { sourceId_attachmentPosition: { sourceId, attachmentPosition } },
    create: { id: randomUUID(), sourceId, memoryId, familyId, attachmentPosition, providerAttachmentId },
    update: { memoryId, familyId, providerAttachmentId },
    select: { id: true, attachmentPosition: true, providerAttachmentId: true },
  })
  const createdPositionThree = await upsert(3, 'frozen-d299-video-three')
  const replayedPositionThree = await upsert(3, 'frozen-d299-video-three-replayed')
  const createdPositionFour = await upsert(4, 'frozen-d299-video-four')
  const referenceCount = await prisma.maxVideoReference.count({ where: { sourceId } })
  const repository = new PrismaMemoryRepository(prisma, createPrismaIdempotencyExecutor(prisma))
  const before = await repository.get(scope, memoryId)
  const updated = await repository.update(scope, memoryId, { expectedVersion: before.version, body: 'edited by frozen d299', occurredAt: before.occurredAt })
  await repository.delete(scope, memoryId, updated.version, new Date())
  const storage = createPrivateStorage(env)
  await createMediaTasks({ prisma, privateStorage: storage, env }).deleteAsset({ mediaId: videoId })
  console.log(JSON.stringify({ attachments: before.attachments.map(({ id, source }) => [id, source]),
    stableReplayId: createdPositionThree.id === replayedPositionThree.id, replayedProviderId: replayedPositionThree.providerAttachmentId,
    createdPositionFour: createdPositionFour.attachmentPosition, referenceCount, editedBody: updated.body, deleted: true }))
} finally { await prisma.$disconnect() }
`)
      const frozenOutput = checked('frozen d299 performs native composite create/replay and reads, edits, deletes, and runs its media delete task', 'bun', [frozenProbe,
        ownUrl.toString(), family.id, memory.id, family.owner.id, source.id, videoId, storageRoot], archived)
      const oldBehavior = JSON.parse(frozenOutput.trim().split('\n').at(-1)!)
      expect(oldBehavior).toMatchObject({ attachments: [
        [videoId, 'private_storage'], [expect.any(String), 'max'], [expect.any(String), 'max'],
        [expect.any(String), 'max'], [expect.any(String), 'max'],
      ], stableReplayId: true, replayedProviderId: 'frozen-d299-video-three-replayed', createdPositionFour: 4,
      referenceCount: 4, editedBody: 'edited by frozen d299', deleted: true })
      expect((await privateStorage.headObject(originalKey))?.contentLength).toBe(videoBytes.length)
      const afterOldWorker = await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: videoId } })
      expect(afterOldWorker).toMatchObject({ deletedAt: null, storageDeletedAt: null, legacyVideoRetainedAt: expect.any(Date) })
      expect(await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })).toEqual({ storageUsedBytes: asset.byteSize })
      expect(await fx.db.maxVideoReference.count({ where: { providerAttachmentId: 'non-ledger-video' } })).toBe(1)
      expect(await fx.db.maxVideoReference.count({ where: { providerAttachmentId: 'second-non-ledger-video' } })).toBe(1)
      const callsBeforeCurrentReturn = { messageReads, videoReads }
      const currentReturn = await migration.recoverAll({ apply: true })
      expect(currentReturn).toMatchObject({ inspected: 0, recovered: 0, refused: 0, remaining: 0 })
      expect({ messageReads, videoReads }).toEqual(callsBeforeCurrentReturn)
      expect(await fx.db.maxVideoReference.count({ where: { memoryId: memory.id } })).toBe(4)
      expect((await privateStorage.headObject(originalKey))?.contentLength).toBe(videoBytes.length)
      expect(await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })).toEqual({ storageUsedBytes: asset.byteSize })
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
