import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { childrenFixtures } from '../../test-support/children-fixtures'
import { runFrozenMax63Positive } from '../../../scripts/test-support/frozen-max63-recovery'
import { FilesystemPrivateStorage } from '../../storage/filesystem-storage'
import { runBackgroundJob } from '../../jobs'
import { createMediaTasks } from '../media'

describe('MAX legacy video retention and recovery', () => {
  const fx = childrenFixtures()
  const created: Array<{ mediaId: string; memoryId: string; inboxId: string }> = []
  const storageRoots: string[] = []

  afterEach(async () => {
    const items = created.splice(0)
    for (const item of items) {
      await fx.db.maxVideoLegacyRetention.deleteMany({ where: { mediaId: item.mediaId } })
      await fx.db.maxVideoReference.deleteMany({ where: { id: item.mediaId } })
      await fx.db.memory.deleteMany({ where: { id: item.memoryId } })
      await fx.db.maxInbox.deleteMany({ where: { id: item.inboxId } })
    }
    const ownedMediaIds = [...new Set(items.map(({ mediaId }) => mediaId))]
    if (ownedMediaIds.length) {
      await fx.db.$executeRawUnsafe('ALTER TABLE media_assets DISABLE TRIGGER media_assets_protect_retained_max_video')
      try {
        await fx.db.mediaAsset.updateMany({ where: { id: { in: ownedMediaIds } }, data: { legacyVideoRetainedAt: null } })
      } finally {
        await fx.db.$executeRawUnsafe('ALTER TABLE media_assets ENABLE TRIGGER media_assets_protect_retained_max_video')
      }
      await fx.db.mediaAsset.deleteMany({ where: { id: { in: ownedMediaIds } } })
    }
    for (const root of storageRoots.splice(0)) await rm(root, { recursive: true, force: true })
    await fx.cleanup()
  })
  afterAll(async () => { await fx.disconnect() })

  test('reviewed MAX63 retains legacy bytes through tombstone, cleanup and explicit DB-only reference recovery', async () => {
    const output = await runFrozenMax63Positive(resolve(import.meta.dir, '../../../..'),
      'src/modules/max/legacy-video-migration.integration.test.ts',
      'retains legacy bytes through tombstone, cleanup and explicit DB-only reference recovery')
    expect(output).toContain('1 pass')
    console.log(output)
  }, 300_000)

  test('holds an unlinked MAX video inserted after the retention DDL through cleanup and delete work', async () => {
    const family = await fx.family()
    const storageRoot = await mkdtemp(join(tmpdir(), 'max-video-unlinked-hold-'))
    storageRoots.push(storageRoot)
    const storage = new FilesystemPrivateStorage({ driver: 'filesystem', root: storageRoot, publicBaseUrl: 'http://127.0.0.1',
      signingKey: randomBytes(32), uploadMaxBytes: 10_000, uploadUrlTtlSeconds: 60, downloadUrlTtlSeconds: 60 })
    const mediaId = randomUUID()
    const originalKey = `media-originals/${randomUUID()}`
    const quotaBefore = await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })
    const rollback = new Error('rollback synthetic retained-video transaction')
    await expect(fx.db.$transaction(async (tx) => {
      const prisma = new Proxy(tx as object, { get(target, property, receiver) {
        if (property === '$transaction') return (callback: (client: typeof tx) => unknown) => callback(tx)
        return Reflect.get(target, property, receiver)
      } }) as typeof tx
      await tx.mediaAsset.create({ data: {
        id: mediaId, familyId: family.id, uploaderId: family.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'video', originalKey,
        declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: '9'.repeat(64), byteSize: 3n, originalStatus: 'stored',
        renditionStatus: 'ready', deletedAt: new Date('2020-01-01T00:00:00.000Z'), createdAt: new Date('2020-01-01T00:00:00.000Z'),
      } })
      await storage.writeObject({ key: originalKey, body: new Response(new Uint8Array([7, 8, 9])).body!, contentLength: 3, contentType: 'video/mp4' })
      const held = await tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })
      expect(held.legacyVideoRetainedAt).toBeInstanceOf(Date)
      expect(await tx.maxVideoReference.findUnique({ where: { id: mediaId } })).toBeNull()
      await runBackgroundJob('media:pending:cleanup', { prisma } as never, new Date('2026-10-25T00:00:00.000Z'))
      await runBackgroundJob('media:orphans:reconcile', { prisma, privateStorage: { storage } } as never, new Date('2026-10-25T00:00:00.000Z'))
      await createMediaTasks({ prisma: prisma as never, privateStorage: { storage }, env: {} }).deleteAsset({ mediaId })
      expect(await tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({ storageDeletedAt: null, legacyVideoRetainedAt: expect.any(Date) })
      expect(await tx.taskOutbox.count({ where: { payload: { path: ['mediaId'], equals: mediaId } } })).toBe(0)
      expect(await tx.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })).toEqual(quotaBefore)
      expect(await storage.headObject(originalKey)).not.toBeNull()
      throw rollback
    })).rejects.toThrow(rollback.message)
    expect(await fx.db.mediaAsset.findUnique({ where: { id: mediaId } })).toBeNull()
    expect(await storage.headObject(originalKey)).not.toBeNull()
  })
})
