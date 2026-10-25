import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrisma } from '../../db'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { FilesystemPrivateStorage } from '../../storage/filesystem-storage'
import { runControlDeletionMaintenance } from './infrastructure/control-purge'

const prisma = createPrisma(requireIntegrationDatabaseUrl())
const actorId = '79000000-0000-4000-8000-000000000001'
const targetId = '79000000-0000-4000-8000-000000000002'
const familyId = '79100000-0000-4000-8000-000000000001'
const mediaId = '79200000-0000-4000-8000-000000000001'
const epoch = new Date('2030-01-01T00:00:00.000Z')
let root = ''
const storage = () => new FilesystemPrivateStorage({
  driver: 'filesystem', root, publicBaseUrl: 'http://localhost', signingKey: Buffer.alloc(32, 7),
  uploadMaxBytes: 10_000_000, uploadUrlTtlSeconds: 600, downloadUrlTtlSeconds: 60,
})

async function clean() {
  await prisma.controlStorageDelete.deleteMany()
  await prisma.controlLifecycleCommand.deleteMany()
  await prisma.controlAccessSnapshot.deleteMany()
  await prisma.controlUserDeletionFamily.deleteMany()
  await prisma.controlUserDeletion.deleteMany()
  await prisma.controlFamilyDeletion.deleteMany()
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
    verifiedMime: 'image/jpeg', byteSize: 7n, originalStatus: 'stored', renditionStatus: 'ready',
  } })
  await prisma.family.update({ where: { id: familyId }, data: { storageUsedBytes: 7n } })
  const localStorage = storage()
  for (const key of [
    'media-originals/control-purge-test/original.jpg',
    'media-display/control-purge-test/original.jpg',
    'media-preview/control-purge-test/original.jpg',
  ]) {
    await localStorage.writeObject({ key, body: new Blob(['payload']).stream(), contentLength: 7, contentType: 'image/jpeg' })
  }
}

describe('Control bounded deletion maintenance', () => {
  beforeEach(async () => {
    await clean()
    root = await mkdtemp(join(tmpdir(), 'control-purge-'))
  })

  afterAll(async () => {
    await clean()
    await prisma.$disconnect()
  })

  test('keeps ready archive bytes through the account grace period', async () => {
    await seed()
    const localStorage = storage()
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, new Date(epoch.getTime() + 29 * 24 * 60 * 60 * 1000), 10)
    expect(await localStorage.headObject('media-originals/control-purge-test/original.jpg')).not.toBeNull()
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'trashed' })
  })

  test('durably captures and removes originals and deterministic image derivatives after expiry', async () => {
    await seed({ purgeAfter: new Date(epoch.getTime() + 30 * 24 * 60 * 60 * 1000) })
    const localStorage = storage()
    await runControlDeletionMaintenance({ db: prisma, storage: localStorage }, new Date(epoch.getTime() + 31 * 24 * 60 * 60 * 1000), 10)
    for (const key of [
      'media-originals/control-purge-test/original.jpg',
      'media-display/control-purge-test/original.jpg',
      'media-preview/control-purge-test/original.jpg',
    ]) expect(await localStorage.headObject(key)).toBeNull()
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'purged', displayName: null, email: null, passwordHash: null })
    expect(await prisma.mediaAsset.findUnique({ where: { id: mediaId } })).toBeNull()
  })
})
