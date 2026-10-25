import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrisma } from '../../db'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { FilesystemPrivateStorage } from '../../storage/filesystem-storage'
import type { PrivateStorage } from '../../storage/port'
import { schedules } from '../../scheduler'
import { backgroundJobs } from '../../jobs'
import type { BackendRuntime } from '../../runtime'
import { runControlDeletionMaintenance } from './infrastructure/control-purge'
import { previewUserDeletion, restoreControlUser, trashControlUser } from './infrastructure/control-lifecycle'

const prisma = createPrisma(requireIntegrationDatabaseUrl())
const actorId = '79000000-0000-4000-8000-000000000001'
const targetId = '79000000-0000-4000-8000-000000000002'
const familyId = '79100000-0000-4000-8000-000000000001'
const mediaId = '79200000-0000-4000-8000-000000000001'
const retainedMediaId = '79200000-0000-4000-8000-000000000002'
const epoch = new Date('2030-01-01T00:00:00.000Z')
let root = ''
const storage = () => new FilesystemPrivateStorage({
  driver: 'filesystem', root, publicBaseUrl: 'http://localhost', signingKey: Buffer.alloc(32, 7),
  uploadMaxBytes: 10_000_000, uploadUrlTtlSeconds: 600, downloadUrlTtlSeconds: 60,
})

async function clean() {
  const cleanupOperationId = '79900000-0000-4000-8000-000000000001'
  const cleanupOperation = await prisma.controlFamilyDeletion.upsert({
    where: { familyId },
    create: { id: cleanupOperationId, familyId, actorUserId: actorId, requestedAt: new Date(), keysCapturedAt: new Date() },
    update: { keysCapturedAt: new Date() },
  })
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.control_family_purge_operation', ${cleanupOperation.id}, true)`
    await tx.$executeRaw`DELETE FROM "media_assets" WHERE "family_id" = ${familyId}::uuid`
  })
  await prisma.controlStorageDelete.deleteMany()
  await prisma.controlLifecycleCommand.deleteMany()
  await prisma.controlAccessSnapshot.deleteMany()
  await prisma.controlUserDeletionFamily.deleteMany()
  await prisma.controlUserDeletion.deleteMany()
  await prisma.controlFamilyDeletion.deleteMany()
  await prisma.userAvatar.deleteMany()
  await prisma.mediaAsset.deleteMany()
  await prisma.family.deleteMany()
  await prisma.user.deleteMany()
}

async function seed({ purgeAfter = new Date(epoch.getTime() + 30 * 24 * 60 * 60 * 1000) } = {}) {
  await prisma.user.createMany({ data: [
    { id: actorId, displayName: 'Synthetic operator' },
    { id: targetId, displayName: 'Synthetic account to purge', email: 'purge@example.test', passwordHash: 'synthetic-hash' },
  ] })
  await prisma.family.create({ data: {
    id: familyId, ownerUserId: targetId, name: 'Synthetic private archive', timezone: 'UTC',
    members: { create: [{ userId: targetId, role: 'full' }] },
  } })
  await prisma.controlUserDeletion.create({ data: {
    id: '79300000-0000-4000-8000-000000000001', targetUserId: targetId, actorUserId: actorId,
    deletedAt: epoch, purgeAfter,
    families: { create: [{ familyId, originalStatus: 'active', restoreEligible: true }] },
  } })
  await prisma.user.update({ where: { id: targetId }, data: { controlState: 'trashed' } })
  await prisma.family.update({ where: { id: familyId }, data: { status: 'deleting' } })
  await prisma.mediaAsset.create({ data: {
    id: mediaId, familyId, uploaderId: targetId, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
    originalKey: 'media-originals/control-purge-test/original.jpg', declaredMime: 'image/jpeg',
    verifiedMime: 'image/jpeg', sha256: 'a'.repeat(64), byteSize: 7n, originalStatus: 'stored', renditionStatus: 'ready',
  } })
  await prisma.mediaAsset.create({ data: {
    id: retainedMediaId, familyId, uploaderId: targetId, sourceKind: 'max', purpose: 'memory', mediaKind: 'video',
    originalKey: 'media-originals/control-purge-test/retained.mp4', declaredMime: 'video/mp4',
    verifiedMime: 'video/mp4', sha256: 'b'.repeat(64), byteSize: 7n, originalStatus: 'stored', renditionStatus: 'ready',
  } })
  await prisma.family.update({ where: { id: familyId }, data: { storageUsedBytes: 14n } })
  const localStorage = storage()
  for (const key of [
    'media-originals/control-purge-test/original.jpg',
    'media-display/control-purge-test/original.jpg',
    'media-preview/control-purge-test/original.jpg',
    'media-originals/control-purge-test/retained.mp4',
    'media-playback/control-purge-test/retained.mp4',
    'media-preview/control-purge-test/retained.mp4.poster-v1.jpg',
  ]) {
    await localStorage.writeObject({ key, body: new Blob(['payload']).stream(), contentLength: 7, contentType: 'image/jpeg' })
  }
  await prisma.userAvatar.create({ data: {
    userId: targetId, state: 'ready', objectKey: 'avatars/control-purge-test/avatar.jpg', contentType: 'image/jpeg',
    byteSize: 7, expiresAt: new Date(epoch.getTime() + 40 * 24 * 60 * 60 * 1000), readyAt: epoch,
  } })
  await localStorage.writeObject({ key: 'avatars/control-purge-test/avatar.jpg', body: new Blob(['payload']).stream(), contentLength: 7, contentType: 'image/jpeg' })
}

describe('Control bounded deletion maintenance', () => {
  beforeEach(async () => {
    await clean()
    root = await mkdtemp(join(tmpdir(), 'control-purge-'))
  })

  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

  afterAll(async () => {
    await clean()
    await prisma.$disconnect()
  })

  test('keeps ready archive bytes through the account grace period', async () => {
    await seed()
    const localStorage = storage()
    await backgroundJobs['control:deletion']({ prisma, privateStorage: { storage: localStorage } } as unknown as BackendRuntime,
      new Date(epoch.getTime() + 29 * 24 * 60 * 60 * 1000))
    expect(await localStorage.headObject('media-originals/control-purge-test/original.jpg')).not.toBeNull()
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'trashed' })
  })

  test('durably captures and removes originals and deterministic image derivatives after expiry', async () => {
    await seed({ purgeAfter: new Date(epoch.getTime() + 30 * 24 * 60 * 60 * 1000) })
    const localStorage = storage()
    expect(await prisma.mediaAsset.deleteMany({ where: { id: retainedMediaId } })).toMatchObject({ count: 0 })
    const expiredAt = new Date(epoch.getTime() + 31 * 24 * 60 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, expiredAt, 10)
    const safePurgeAt = new Date(expiredAt.getTime() + 17 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, safePurgeAt, 10)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, safePurgeAt, 10)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, safePurgeAt, 10)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, new Date(safePurgeAt.getTime() + 17 * 60 * 1000), 10)
    for (const key of [
      'media-originals/control-purge-test/original.jpg',
      'media-display/control-purge-test/original.jpg',
      'media-preview/control-purge-test/original.jpg',
      'media-originals/control-purge-test/retained.mp4',
      'media-playback/control-purge-test/retained.mp4',
      'media-preview/control-purge-test/retained.mp4.poster-v1.jpg',
      'avatars/control-purge-test/avatar.jpg',
    ]) expect(await localStorage.headObject(key)).toBeNull()
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'purged', displayName: null, email: null, passwordHash: null })
    expect(await prisma.mediaAsset.findUnique({ where: { id: mediaId } })).toBeNull()
    expect(await prisma.mediaAsset.findUnique({ where: { id: retainedMediaId } })).toBeNull()
  })

  test('resumes a failed object delete after restart and leaves no false purged state', async () => {
    await seed()
    const localStorage = storage()
    const purgeAfter = new Date(epoch.getTime() + 30 * 24 * 60 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, purgeAfter, 10)
    const failedStorage = new Proxy(localStorage, {
      get(target, property) {
        if (property === 'deleteObject') return async () => { throw new Error('synthetic object-store outage') }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PrivateStorage
    const retryAt = new Date(purgeAfter.getTime() + 17 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: failedStorage }, retryAt, 10)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'purging' })
    expect(await prisma.controlStorageDelete.count({ where: { completedAt: null } })).toBeGreaterThan(0)
    const profileSafeAt = new Date(retryAt.getTime() + 17 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, profileSafeAt, 10)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, profileSafeAt, 10)
    let completionNow = new Date(profileSafeAt.getTime() + 17 * 60 * 1000)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if ((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).controlState === 'purged') break
      await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, completionNow, 10)
      completionNow = new Date(completionNow.getTime() + 17 * 60 * 1000)
    }
    expect(await localStorage.headObject('media-originals/control-purge-test/original.jpg')).toBeNull()
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'purged' })
  })

  test('registers lifecycle cleanup in the recurring scheduler', () => {
    expect(schedules.some(({ job }) => job === 'control:deletion')).toBe(true)
  })

  test('blocks a stale runtime from approving a browser login challenge during trash', async () => {
    await seed()
    await prisma.controlUserDeletion.deleteMany({ where: { targetUserId: targetId } })
    await prisma.user.update({ where: { id: targetId }, data: { controlState: 'active' } })
    await prisma.browserLoginChallenge.create({ data: {
      id: 'control-purge-pending-challenge', verifierHash: 'a'.repeat(64), displayCodeHash: 'b'.repeat(64),
      expiresAt: new Date(epoch.getTime() + 60_000),
    } })
    const preview = await previewUserDeletion(prisma, targetId, [actorId])
    const trashed = await trashControlUser(prisma, {
      actorId, targetId, protectedIds: [actorId], key: '79400000-0000-4000-8000-000000000001',
      fingerprint: preview.fingerprint, confirmation: targetId,
    })
    await expect(Promise.resolve(prisma.browserLoginChallenge.update({
      where: { id: 'control-purge-pending-challenge' }, data: { state: 'approved', approvedUserId: targetId },
    }))).rejects.toBeDefined()
    await restoreControlUser(prisma, {
      actorId, targetId, protectedIds: [actorId], key: '79400000-0000-4000-8000-000000000002', deletionId: trashed.deletionId,
    })
    expect(await prisma.browserLoginChallenge.findUniqueOrThrow({ where: { id: 'control-purge-pending-challenge' } })).toMatchObject({ state: 'pending', approvedUserId: null })
  })
})
