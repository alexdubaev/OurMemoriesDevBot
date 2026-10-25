import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrisma } from '../../db'
import { Prisma } from '../../generated/prisma/client'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { FilesystemPrivateStorage } from '../../storage/filesystem-storage'
import type { PrivateStorage } from '../../storage/port'
import { schedules } from '../../scheduler'
import { backgroundJobs } from '../../jobs'
import type { BackendRuntime } from '../../runtime'
import { runControlDeletionMaintenance } from './infrastructure/control-purge'
import { previewFamilyDeletion, previewUserDeletion, purgeControlFamily, restoreControlUser, trashControlUser } from './infrastructure/control-lifecycle'

const prisma = createPrisma(requireIntegrationDatabaseUrl())
const actorId = '79000000-0000-4000-8000-000000000001'
const targetId = '79000000-0000-4000-8000-000000000002'
const familyId = '79100000-0000-4000-8000-000000000001'
const otherFamilyId = '79100000-0000-4000-8000-000000000002'
const mediaId = '79200000-0000-4000-8000-000000000001'
const retainedMediaId = '79200000-0000-4000-8000-000000000002'
const channelInboxId = '79500000-0000-4000-8000-000000000001'
const channelDecisionId = '79500000-0000-4000-8000-000000000002'
const maxSourceInboxId = '79500000-0000-4000-8000-000000000003'
const telegramInboxId = '79500000-0000-4000-8000-000000000004'
const maxSourceEventKey = 'control-purge-owned-max-source-event'
const channelChatId = 7950000001n
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
    await tx.$executeRaw`UPDATE children SET avatar_media_id = NULL, avatar_crop = NULL WHERE family_id = ${familyId}::uuid`
    await tx.$executeRaw`DELETE FROM "media_assets" WHERE "family_id" = ${familyId}::uuid`
  })
  await prisma.maxSource.deleteMany({ where: { inboxId: maxSourceInboxId } })
  await prisma.maxInbox.deleteMany({ where: { id: maxSourceInboxId } })
  await prisma.telegramSource.deleteMany({ where: { inboxId: telegramInboxId } })
  await prisma.telegramInbox.deleteMany({ where: { id: telegramInboxId } })
  await prisma.controlStorageDelete.deleteMany()
  await prisma.controlLifecycleCommand.deleteMany()
  await prisma.controlAccessSnapshot.deleteMany()
  await prisma.controlUserDeletionFamily.deleteMany()
  await prisma.controlUserDeletion.deleteMany()
  await prisma.controlFamilyDeletion.deleteMany()
  await prisma.maxOutgoingResponse.deleteMany({ where: { inboxId: channelInboxId } })
  await prisma.maxChannelDecision.deleteMany({ where: { id: channelDecisionId } })
  await prisma.maxInbox.deleteMany({ where: { id: channelInboxId } })
  await prisma.userAvatar.deleteMany()
  await prisma.mediaAsset.deleteMany()
  await prisma.family.deleteMany()
  await prisma.user.deleteMany()
}

async function seed({ purgeAfter, deletedAt = epoch, putExpiresAt }: { purgeAfter?: Date; deletedAt?: Date; putExpiresAt?: Date } = {}) {
  const purgeTime = purgeAfter ?? new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
  await prisma.user.createMany({ data: [
    { id: actorId, displayName: 'Synthetic operator' },
    { id: targetId, displayName: 'Synthetic account to purge', email: 'purge@example.test', passwordHash: 'synthetic-hash' },
  ] })
  await prisma.family.create({ data: {
    id: familyId, ownerUserId: targetId, name: 'Synthetic private archive', timezone: 'UTC',
    members: { create: [{ userId: targetId, role: 'full' }] },
  } })
  const ownChild = await prisma.child.create({ data: { familyId, displayName: 'Private child name' } })
  const ownMemory = await prisma.memory.create({ data: {
    familyId, childId: ownChild.id, authorId: targetId, kind: 'note', body: 'Private family memory',
    occurredAt: epoch, firstPublishedAt: epoch,
  } })
  const maxInbox = await prisma.maxInbox.create({ data: {
    id: maxSourceInboxId, eventKey: maxSourceEventKey, botId: 795n, eventKind: 'message_created',
    encryptedPayload: Buffer.from('synthetic MAX source payload'), encryptionIv: Buffer.from('iv'),
    encryptionAuthTag: Buffer.from('tag'), status: 'processed',
  } })
  await prisma.maxSource.create({ data: {
    inboxId: maxInbox.id, botId: 795n, senderSubject: 'synthetic-max-subject', recipientId: 795n,
    messageId: 'control-purge-owned-source', status: 'published', plannedMemoryId: ownMemory.id,
    memoryId: ownMemory.id, userId: targetId, familyId, childId: ownChild.id,
  } })
  const telegramInbox = await prisma.telegramInbox.create({ data: {
    id: telegramInboxId, botId: 796n, updateId: 796n, eventKind: 'content',
    encryptedPayload: Buffer.from('synthetic Telegram source payload'), encryptionIv: Buffer.from('iv'),
    encryptionAuthTag: Buffer.from('tag'),
  } })
  await prisma.telegramSource.create({ data: {
    inboxId: telegramInbox.id, botId: 796n, chatId: 796n, messageId: 796n,
    senderSubject: 'synthetic-telegram-subject', userId: targetId, familyId, childId: ownChild.id,
    kind: 'note', status: 'published', plannedMemoryId: ownMemory.id, memoryId: ownMemory.id,
  } })
  await prisma.maxChannelBinding.create({ data: { chatId: channelChatId, familyId, state: 'connected' } })
  await prisma.maxInbox.create({ data: {
    id: channelInboxId, eventKey: 'control-purge-channel-event', botId: 795n, eventKind: 'family_choice',
    encryptedPayload: Buffer.from('synthetic encrypted MAX event'), encryptionIv: Buffer.from('iv'),
    encryptionAuthTag: Buffer.from('tag'),
  } })
  await prisma.maxChannelDecision.create({ data: {
    id: channelDecisionId, originInboxId: channelInboxId, actorSubject: 'synthetic-subject', chatId: channelChatId,
    candidateFamilyIds: [familyId], expectedActiveVersion: 1, expectedChannelVersion: 1,
    expiresAt: new Date(epoch.getTime() + 60_000),
  } })
  await prisma.maxOutgoingResponse.create({ data: {
    inboxId: channelInboxId, channelDecisionId, destinationUserId: 795n, kind: 'family_choice', text: 'Private choice',
  } })
  await prisma.family.create({ data: {
    id: otherFamilyId, ownerUserId: actorId, name: 'Other owner archive', timezone: 'UTC',
    members: { create: [
      { userId: actorId, role: 'full' },
      { userId: targetId, role: 'viewer', revokedAt: epoch, familyDisplayName: 'Former member alias' },
    ] },
  } })
  const otherChild = await prisma.child.create({ data: { familyId: otherFamilyId, displayName: 'Other owner child' } })
  await prisma.memory.create({ data: {
    familyId: otherFamilyId, childId: otherChild.id, authorId: targetId, kind: 'note', body: 'Other owner memory',
    occurredAt: epoch, firstPublishedAt: epoch,
  } })
  await prisma.controlUserDeletion.create({ data: {
    id: '79300000-0000-4000-8000-000000000001', targetUserId: targetId, actorUserId: actorId,
    deletedAt, purgeAfter: purgeTime,
    families: { create: [{ familyId, originalStatus: 'active', restoreEligible: true }] },
  } })
  await prisma.mediaAsset.create({ data: {
    id: mediaId, familyId, uploaderId: targetId, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
    originalKey: 'media-originals/control-purge-test/original.jpg', declaredMime: 'image/jpeg',
    verifiedMime: 'image/jpeg', sha256: 'a'.repeat(64), byteSize: 7n, originalStatus: 'stored', renditionStatus: 'ready',
  } })
  await prisma.child.update({ where: { id: ownChild.id }, data: { avatarMediaId: mediaId, avatarCrop: { x: 1, y: 2 } } })
  await prisma.mediaAsset.create({ data: {
    id: retainedMediaId, familyId, uploaderId: targetId, sourceKind: 'max', purpose: 'memory', mediaKind: 'video',
    originalKey: 'media-originals/control-purge-test/retained.mp4', declaredMime: 'video/mp4',
    verifiedMime: 'video/mp4', sha256: 'b'.repeat(64), byteSize: 7n, originalStatus: 'stored', renditionStatus: 'ready',
  } })
  if (putExpiresAt) await prisma.uploadReservation.create({ data: {
    familyId, userId: targetId, mediaId, bytes: 7n, expiresAt: putExpiresAt, finalizedAt: epoch, releasedAt: epoch,
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
    byteSize: 7, expiresAt: new Date(epoch.getTime() + 30 * 24 * 60 * 60 * 1000), readyAt: epoch,
  } })
  await localStorage.writeObject({ key: 'avatars/control-purge-test/avatar.jpg', body: new Blob(['payload']).stream(), contentLength: 7, contentType: 'image/jpeg' })
  await prisma.user.update({ where: { id: targetId }, data: { controlState: 'trashed' } })
  await prisma.family.update({ where: { id: familyId }, data: { status: 'deleting' } })
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
    let maintenanceAt = expiredAt
    for (let pass = 0; pass < 24 && (await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).controlState !== 'purged'; pass += 1) {
      await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, maintenanceAt, 10)
      maintenanceAt = new Date(maintenanceAt.getTime() + 17 * 60 * 1000)
    }
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
    expect(await prisma.memory.count({ where: { familyId } })).toBe(0)
    expect(await prisma.child.count({ where: { familyId } })).toBe(0)
    expect(await prisma.maxSource.findUnique({ where: { inboxId: maxSourceInboxId } })).toBeNull()
    const maxReceipt = await prisma.maxInbox.findUniqueOrThrow({ where: { id: maxSourceInboxId } })
    expect(maxReceipt).toMatchObject({ eventKey: maxSourceEventKey, controlRedactedAt: expect.any(Date) })
    expect(maxReceipt.encryptedPayload.byteLength).toBe(0)
    expect(await prisma.telegramSource.findUnique({ where: { inboxId: telegramInboxId } })).toBeNull()
    const telegramReceipt = await prisma.telegramInbox.findUniqueOrThrow({ where: { id: telegramInboxId } })
    expect(telegramReceipt).toMatchObject({ botId: 796n, updateId: 796n, controlRedactedAt: expect.any(Date) })
    expect(telegramReceipt.encryptedPayload.byteLength).toBe(0)
    expect(await prisma.memory.count({ where: { familyId: otherFamilyId, body: 'Other owner memory' } })).toBe(1)
    expect(await prisma.family.findUniqueOrThrow({ where: { id: otherFamilyId } })).toMatchObject({ name: 'Other owner archive', status: 'active' })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: otherFamilyId, userId: targetId } } })).toMatchObject({ familyDisplayName: null, revokedAt: epoch })
  })

  test('resumes a failed object delete after restart and leaves no false purged state', async () => {
    await seed()
    const localStorage = storage()
    const purgeAfter = new Date(epoch.getTime() + 30 * 24 * 60 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, purgeAfter, 10)
    const failedStorage = new Proxy(localStorage, {
      get(target, property) {
        if (property === 'retireObject') return async () => { throw new Error('synthetic object-store outage') }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PrivateStorage
    const retryAt = new Date(purgeAfter.getTime() + 17 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: failedStorage }, retryAt, 10)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'purging' })
    expect(await prisma.controlStorageDelete.count({ where: { completedAt: null } })).toBeGreaterThan(0)
    let completionNow = new Date(retryAt.getTime() + 17 * 60 * 1000)
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if ((await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).controlState === 'purged') break
      await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, completionNow, 10)
      completionNow = new Date(completionNow.getTime() + 17 * 60 * 1000)
    }
    expect(await localStorage.headObject('media-originals/control-purge-test/original.jpg')).toBeNull()
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'purged' })
  })

  test('honors a completed upload PUT expiry before deleting its key and zeroes quota once', async () => {
    const putExpiresAt = new Date(epoch.getTime() + 40 * 24 * 60 * 60 * 1000)
    await seed({ putExpiresAt })
    const localStorage = storage()
    const purgeAt = new Date(epoch.getTime() + 31 * 24 * 60 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, purgeAt, 10)
    const queued = await prisma.controlStorageDelete.findFirstOrThrow({ where: { operationId: (await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })).id, objectKey: 'media-originals/control-purge-test/original.jpg' } })
    expect(queued.notBefore).toEqual(putExpiresAt)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, new Date(putExpiresAt.getTime() - 60_000), 10)
    expect(await localStorage.headObject('media-originals/control-purge-test/original.jpg')).not.toBeNull()
    let maintenanceAt = new Date(putExpiresAt.getTime() + 17 * 60 * 1000)
    for (let pass = 0; pass < 24 && (await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).controlState !== 'purged'; pass += 1) {
      await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, maintenanceAt, 10)
      maintenanceAt = new Date(maintenanceAt.getTime() + 17 * 60 * 1000)
    }
    expect(await localStorage.headObject('media-originals/control-purge-test/original.jpg')).toBeNull()
    expect(await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).toMatchObject({ storageUsedBytes: 0n, storageReservedBytes: 0n })
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, maintenanceAt, 10)
    expect(await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).toMatchObject({ storageUsedBytes: 0n, storageReservedBytes: 0n })
  })

  test('fences every media asset before deletes and re-arms keys for a late worker PUT', async () => {
    const purgeAfter = new Date(epoch.getTime() + 30 * 24 * 60 * 60 * 1000)
    await seed({ purgeAfter })
    const localStorage = storage()
    const fenceAt = new Date(purgeAfter.getTime() + 17 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, purgeAfter, 1)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, fenceAt, 1)
    const operation = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })
    expect(operation.purgeStage).toBe('capture_media')
    const originalKey = 'media-originals/control-purge-test/original.jpg'
    const queued = await prisma.controlStorageDelete.findFirstOrThrow({ where: { operationId: operation.id, objectKey: originalKey } })
    await localStorage.deleteObject(originalKey)
    await prisma.controlStorageDelete.update({ where: { id: queued.id }, data: { completedAt: fenceAt } })
    await localStorage.writeObject({ key: originalKey, body: new Blob(['late worker bytes']).stream(), contentLength: 17, contentType: 'image/jpeg' })

    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, fenceAt, 1)
    expect(await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })).toMatchObject({ purgeStage: 'fence_media' })
    expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({ deletedAt: expect.any(Date) })
    const rearmed = await prisma.controlStorageDelete.findUniqueOrThrow({ where: { id: queued.id } })
    expect(rearmed.completedAt).toBeNull()
    expect(rearmed.notBefore.getTime()).toBeGreaterThanOrEqual(fenceAt.getTime() + 16 * 60 * 1000)
    expect(await localStorage.headObject(originalKey)).not.toBeNull()

    for (let pass = 0; pass < 6; pass += 1) {
      await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, fenceAt, 1)
    }
    expect(await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })).toMatchObject({ purgeStage: 'objects' })
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, new Date(fenceAt.getTime() + 15 * 60 * 1000), 10)
    expect(await localStorage.headObject(originalKey)).not.toBeNull()
    for (let pass = 0; pass < 10 && await localStorage.headObject(originalKey); pass += 1) {
      await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, new Date(fenceAt.getTime() + 17 * 60 * 1000), 10)
    }
    expect(await localStorage.headObject(originalKey)).toBeNull()
  })

  test('serializes late private content and object-key writes behind family key capture', async () => {
    await seed()
    const localStorage = storage()
    const expiredAt = new Date(epoch.getTime() + 31 * 24 * 60 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, expiredAt, 10)
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, new Date(expiredAt.getTime() + 17 * 60 * 1000), 10)
    expect(await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })).toMatchObject({ keysCapturedAt: expect.any(Date) })
    await expect(Promise.resolve(prisma.child.create({ data: { familyId, displayName: 'Late private child' } }))).rejects.toBeDefined()
    await expect(Promise.resolve(prisma.mediaAsset.create({ data: {
      familyId, uploaderId: targetId, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey: 'media-originals/control-purge-test/late.jpg', declaredMime: 'image/jpeg',
      verifiedMime: 'image/jpeg', sha256: 'c'.repeat(64), byteSize: 1n, originalStatus: 'stored', renditionStatus: 'ready',
    } }))).rejects.toBeDefined()
    const activeChild = await prisma.child.create({ data: { familyId: otherFamilyId, displayName: 'Active other-family child' } })
    expect(activeChild.familyId).toBe(otherFamilyId)
  })

  test('one failed oldest key does not starve a later family operation', async () => {
    await seed()
    const ownPreview = await previewFamilyDeletion(prisma, familyId)
    await purgeControlFamily(prisma, {
      actorId, targetId: familyId, protectedIds: [actorId], key: '79400000-0000-4000-8000-000000000004',
      fingerprint: ownPreview.fingerprint, confirmation: familyId,
    }, epoch)
    const otherPreview = await previewFamilyDeletion(prisma, otherFamilyId)
    await purgeControlFamily(prisma, {
      actorId, targetId: otherFamilyId, protectedIds: [], key: '79400000-0000-4000-8000-000000000005',
      fingerprint: otherPreview.fingerprint, confirmation: otherFamilyId,
    }, epoch)
    const failingStorage = new Proxy(storage(), {
      get(target, property) {
        if (property === 'retireObject') return async (key: string) => {
          if (key.includes('control-purge-test')) throw new Error('synthetic outage')
          return target.retireObject!(key)
        }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PrivateStorage
    let maintenanceAt = epoch
    for (let pass = 0; pass < 12 && (await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId: otherFamilyId } })).purgedAt === null; pass += 1) {
      await runControlDeletionMaintenance({ db: prisma, storage: failingStorage }, maintenanceAt, 10)
      maintenanceAt = new Date(maintenanceAt.getTime() + 17 * 60 * 1000)
    }
    expect(await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId: otherFamilyId } })).toMatchObject({ purgedAt: expect.any(Date) })
    expect(await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })).toMatchObject({ purgedAt: null })
  })

  test('a fresh fifth family is scheduled ahead of four older pending operations', async () => {
    await seed()
    const oldFamilyIds = [familyId, otherFamilyId,
      '79100000-0000-4000-8000-000000000003', '79100000-0000-4000-8000-000000000004']
    for (const [index, extraFamilyId] of oldFamilyIds.slice(2).entries()) {
      const ownerId = `79000000-0000-4000-8000-00000000000${3 + index}`
      await prisma.user.create({ data: { id: ownerId, displayName: 'Synthetic archive owner' } })
      await prisma.family.create({ data: {
        id: extraFamilyId, ownerUserId: ownerId, name: 'Synthetic blocked archive', timezone: 'UTC',
        members: { create: [{ userId: ownerId, role: 'full' }] },
      } })
    }
    await prisma.family.updateMany({ where: { id: { in: oldFamilyIds }, status: 'active' }, data: { status: 'deleting' } })
    const oldAttempt = new Date(epoch.getTime() - 60 * 60 * 1000)
    for (const [index, oldFamilyId] of oldFamilyIds.entries()) {
      const operation = await prisma.controlFamilyDeletion.create({ data: {
        familyId: oldFamilyId, actorUserId: actorId, requestedAt: oldAttempt, notBefore: epoch,
        keysCapturedAt: epoch, lastAttemptAt: oldAttempt, purgeStage: 'objects',
      } })
      await prisma.controlStorageDelete.create({ data: {
        operationId: operation.id, familyId: oldFamilyId, objectKey: `blocked/${index}.jpg`, notBefore: epoch,
      } })
    }
    const freshFamilyId = '79100000-0000-4000-8000-000000000005'
    const freshOwnerId = '79000000-0000-4000-8000-000000000005'
    await prisma.user.create({ data: { id: freshOwnerId, displayName: 'Synthetic fresh owner' } })
    await prisma.family.create({ data: {
      id: freshFamilyId, ownerUserId: freshOwnerId, name: 'Synthetic fresh archive', timezone: 'UTC',
      members: { create: [{ userId: freshOwnerId, role: 'full' }] },
    } })
    await prisma.family.update({ where: { id: freshFamilyId }, data: { status: 'deleting' } })
    await prisma.controlFamilyDeletion.create({ data: {
      familyId: freshFamilyId, actorUserId: actorId, requestedAt: epoch, notBefore: epoch,
    } })
    const failingStorage = new Proxy(storage(), {
      get(target, property) {
        if (property === 'retireObject') return async () => { throw new Error('synthetic outage') }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PrivateStorage
    await runControlDeletionMaintenance({ db: prisma, storage: failingStorage }, new Date(epoch.getTime() + 17 * 60 * 1000), 10)
    expect(await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId: freshFamilyId } }))
      .toMatchObject({ purgeStage: 'memories', keysCapturedAt: expect.any(Date) })
    expect(await prisma.controlFamilyDeletion.count({ where: { familyId: { in: oldFamilyIds }, purgeStage: 'objects' } })).toBe(4)
  })

  test('a hung object delete times out with durable pending work and no false completion', async () => {
    await seed()
    const operation = await prisma.controlFamilyDeletion.create({ data: {
      familyId, actorUserId: actorId, requestedAt: epoch, notBefore: epoch,
    } })
    const neverStorage = new Proxy(storage(), {
      get(target, property) {
        if (property === 'retireObject') return async () => new Promise<void>(() => {})
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PrivateStorage
    const startedAt = performance.now()
    await runControlDeletionMaintenance({ db: prisma, storage: neverStorage }, new Date(epoch.getTime() + 17 * 60 * 1000), 10,
      { budgetMs: 200, objectTimeoutMs: 50 })
    expect(performance.now() - startedAt).toBeLessThan(1_000)
    expect(await prisma.controlStorageDelete.count({ where: { operationId: operation.id, completedAt: null } })).toBeGreaterThan(0)
    expect(await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { id: operation.id } })).toMatchObject({ purgedAt: null })
  })

  test('completed retired keys remain scheduled across a recheck failure after the operation is already purged', async () => {
    await seed()
    const completedAt = new Date(epoch.getTime() - 60 * 60 * 1000)
    const operation = await prisma.controlFamilyDeletion.create({ data: {
      familyId, actorUserId: actorId, requestedAt: completedAt, notBefore: completedAt,
      keysCapturedAt: completedAt, purgedAt: completedAt, purgeStage: 'purged',
    } })
    const row = await prisma.controlStorageDelete.create({ data: {
      operationId: operation.id, familyId, objectKey: 'media-originals/control-purge-test/retired.jpg',
      notBefore: completedAt, completedAt, nextAttemptAt: completedAt,
    } })
    const failingStorage = new Proxy(storage(), {
      get(target, property) {
        if (property === 'retireObject') return async () => { throw new Error('synthetic retirement recheck failure') }
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PrivateStorage
    const failedAt = new Date(epoch.getTime() + 60 * 60 * 1000)
    await runControlDeletionMaintenance({ db: prisma, storage: failingStorage }, failedAt, 10)
    const pendingRecheck = await prisma.controlStorageDelete.findUniqueOrThrow({ where: { id: row.id } })
    expect(pendingRecheck.completedAt).toEqual(completedAt)
    expect(pendingRecheck.nextAttemptAt.getTime()).toBeGreaterThan(failedAt.getTime())

    const recoveredAt = pendingRecheck.nextAttemptAt
    await runControlDeletionMaintenance({ db: prisma, storage: storage() }, recoveredAt, 10)
    const retried = await prisma.controlStorageDelete.findUniqueOrThrow({ where: { id: row.id } })
    expect(retried.completedAt).toEqual(recoveredAt)
    expect(retried.nextAttemptAt.getTime()).toBeGreaterThan(recoveredAt.getTime())
  })

  test('maintenance refuses S3 before starting newly due irreversible deletion work', async () => {
    await seed({ purgeAfter: epoch, deletedAt: new Date(epoch.getTime() - 30 * 24 * 60 * 60 * 1000) })
    const localStorage = storage()
    const unsupportedStorage = new Proxy(localStorage, {
      get(target, property) {
        if (property === 'driver') return 's3'
        if (property === 'retireObject') return undefined
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as PrivateStorage
    await expect(runControlDeletionMaintenance({ db: prisma, storage: unsupportedStorage }, epoch, 10))
      .rejects.toThrow('control_irreversible_storage_retirement_unsupported')
    expect(await prisma.controlFamilyDeletion.count({ where: { familyId } })).toBe(0)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { controlState: true } }))
      .toEqual({ controlState: 'active' })
  })

  test('a database cleanup error stores only a safe status code', async () => {
    await seed()
    const operation = await prisma.controlFamilyDeletion.create({ data: {
      familyId, actorUserId: actorId, requestedAt: epoch, notBefore: epoch,
    } })
    const failingDb = new Proxy(prisma, {
      get(target, property) {
        if (property === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) =>
          target.$transaction(async (tx) => callback(new Proxy(tx, {
            get(transaction, transactionProperty) {
              if (transactionProperty === 'mediaAsset') return new Proxy(transaction.mediaAsset, {
                get(delegate, method) {
                  if (method === 'findMany') return async () => { throw new Error('private database diagnostic') }
                  const value = Reflect.get(delegate, method, delegate)
                  return typeof value === 'function' ? value.bind(delegate) : value
                },
              })
              const value = Reflect.get(transaction, transactionProperty, transaction)
              return typeof value === 'function' ? value.bind(transaction) : value
            },
          })), options as never)
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as typeof prisma
    await runControlDeletionMaintenance({ db: failingDb, storage: storage() }, new Date(epoch.getTime() + 17 * 60 * 1000), 10)
    const failed = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { id: operation.id } })
    expect(failed.lastErrorCode).toBe('archive_cleanup_failed')
    expect(JSON.stringify(failed)).not.toContain('private database diagnostic')
  })

  test('standalone family purge removes its MAX bindings and preserves another active archive', async () => {
    await seed()
    const localStorage = storage()
    const preview = await previewFamilyDeletion(prisma, familyId)
    await purgeControlFamily(prisma, {
      actorId, targetId: familyId, protectedIds: [actorId], key: '79400000-0000-4000-8000-000000000003',
      fingerprint: preview.fingerprint, confirmation: familyId,
    }, epoch)
    const operation = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })
    let explicitPurgeAt = new Date(epoch.getTime() + 17 * 60 * 1000)
    for (let pass = 0; pass < 24 && !((await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId } })).purgedAt); pass += 1) {
      await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, explicitPurgeAt, 10)
      explicitPurgeAt = new Date(explicitPurgeAt.getTime() + 17 * 60 * 1000)
    }
    expect(operation.actorUserId).toBe(actorId)
    expect(await prisma.family.findUniqueOrThrow({ where: { id: familyId } })).toMatchObject({ status: 'deleted', name: 'Удалённый архив' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: otherFamilyId } })).toMatchObject({ status: 'active', name: 'Other owner archive' })
    expect(await prisma.memory.count({ where: { familyId: otherFamilyId } })).toBe(1)
    expect(await prisma.maxChannelBinding.count({ where: { familyId } })).toBe(0)
    expect(await prisma.maxChannelDecision.findUnique({ where: { id: channelDecisionId } })).toBeNull()
    expect((await prisma.maxInbox.findUniqueOrThrow({ where: { id: channelInboxId } })).encryptedPayload).toHaveLength(0)
    expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: channelInboxId } })).toBe(0)
    await expect(Promise.resolve(prisma.maxOutgoingResponse.create({ data: {
      inboxId: channelInboxId, destinationUserId: 795n, kind: 'family_choice', text: 'stale response',
    } }))).rejects.toBeDefined()
    expect(await localStorage.headObject('media-originals/control-purge-test/original.jpg')).toBeNull()
    expect(await localStorage.headObject('media-originals/control-purge-test/retained.mp4')).toBeNull()
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
