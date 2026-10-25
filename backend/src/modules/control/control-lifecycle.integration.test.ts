import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createPrisma } from '../../db'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { createPrismaAuthRepository, createPrismaBrowserLinkRepository, createPrismaMaxAuthRepository } from '../auth/infrastructure/auth-repository'
import { FamilyService } from '../families/application/family-service'
import {
  previewFamilyDeletion,
  previewUserDeletion,
  purgeControlFamily,
  restoreControlUser,
  trashControlUser,
} from './infrastructure/control-lifecycle'

const databaseUrl = requireIntegrationDatabaseUrl()
const prisma = createPrisma(databaseUrl)
const actorId = '70000000-0000-4000-8000-000000000001'
const targetId = '70000000-0000-4000-8000-000000000002'
const formerMemberId = '70000000-0000-4000-8000-000000000003'
const overlappingUserId = '70000000-0000-4000-8000-000000000004'
const protectedHexOwnerId = '70000000-0000-4000-8abc-000000000005'
const ownedFamilyId = '71000000-0000-4000-8000-000000000001'
const sharedFamilyId = '71000000-0000-4000-8000-000000000002'
const legacyFamilyId = '71000000-0000-4000-8000-000000000003'
const sharedChildId = '72000000-0000-4000-8000-000000000002'
const protectedIds = [actorId]

async function seed() {
  await prisma.user.createMany({ data: [
    { id: actorId, displayName: 'Control operator' },
    { id: targetId, displayName: 'Synthetic target' },
    { id: formerMemberId, displayName: 'Synthetic former member' },
    { id: overlappingUserId, displayName: 'Synthetic overlapping deletion target' },
    { id: protectedHexOwnerId, displayName: 'Synthetic protected hex owner' },
  ] })
  const identity = await prisma.externalIdentity.create({
    data: { userId: targetId, provider: 'max', subject: '987654321' },
  })
  await prisma.authSession.create({
    data: {
      userId: targetId,
      externalIdentityId: identity.id,
      refreshTokenHash: 'control-lifecycle-session-before-trash',
      refreshTokenFamilyHash: 'control-lifecycle-session-family-before-trash',
      expiresAt: new Date(Date.now() + 60_000),
    },
  })
  await prisma.family.create({
    data: {
      id: legacyFamilyId,
      ownerUserId: targetId,
      name: 'Synthetic inactive legacy archive',
      timezone: 'UTC',
      members: { create: [{ userId: targetId, role: 'full' }] },
    },
  })
  const legacyChild = await prisma.child.create({ data: { familyId: legacyFamilyId, displayName: 'Synthetic legacy child' } })
  await prisma.memory.create({
    data: {
      familyId: legacyFamilyId,
      childId: legacyChild.id,
      authorId: targetId,
      kind: 'note',
      body: 'Synthetic legacy archive payload',
      occurredAt: new Date('2026-10-22T12:00:00Z'),
      firstPublishedAt: new Date('2026-10-22T12:00:00Z'),
    },
  })
  await prisma.family.update({ where: { id: legacyFamilyId }, data: { status: 'deleted' } })
  await prisma.family.create({
    data: {
      id: ownedFamilyId,
      ownerUserId: targetId,
      name: 'Synthetic lifecycle archive',
      timezone: 'UTC',
      members: { create: [
        { userId: targetId, role: 'full' },
        { userId: actorId, role: 'viewer' },
        { userId: formerMemberId, role: 'viewer', revokedAt: new Date('2026-01-01T00:00:00Z') },
        { userId: overlappingUserId, role: 'viewer' },
      ] },
    },
  })
  await prisma.family.create({
    data: {
      id: sharedFamilyId,
      ownerUserId: actorId,
      name: 'Synthetic shared family',
      timezone: 'UTC',
      members: { create: [
        { userId: actorId, role: 'full' },
        { userId: targetId, role: 'viewer' },
        { userId: overlappingUserId, role: 'viewer' },
      ] },
    },
  })
  await prisma.child.create({ data: { id: sharedChildId, familyId: sharedFamilyId, displayName: 'Synthetic shared child' } })
  const child = await prisma.child.create({ data: { familyId: ownedFamilyId, displayName: 'Synthetic child' } })
  await prisma.memory.create({
    data: {
      familyId: ownedFamilyId,
      childId: child.id,
      authorId: targetId,
      kind: 'note',
      body: 'Synthetic ready archive payload',
      occurredAt: new Date('2026-10-24T12:00:00Z'),
      firstPublishedAt: new Date('2026-10-24T12:00:00Z'),
    },
  })
}

async function clean() {
  await prisma.controlLifecycleCommand.deleteMany()
  await prisma.controlAccessSnapshot.deleteMany()
  await prisma.controlUserDeletionFamily.deleteMany()
  await prisma.controlUserDeletion.deleteMany()
  await prisma.controlFamilyDeletion.deleteMany()
  await prisma.taskOutbox.deleteMany()
  await prisma.memory.deleteMany()
  await prisma.child.deleteMany()
  await prisma.authSession.deleteMany()
  await prisma.externalIdentity.deleteMany()
  await prisma.family.deleteMany()
  await prisma.user.deleteMany()
}

describe('Control account lifecycle', () => {
  beforeEach(async () => {
    await clean()
    await seed()
  })

  afterAll(async () => {
    await clean()
    await prisma.$disconnect()
  })

  test('protects configured Control owners while keeping the ready archive and revoking access', async () => {
    const protectedPreview = await previewUserDeletion(prisma, actorId, [actorId, targetId])
    await expect(trashControlUser(prisma, {
      actorId,
      targetId: actorId,
      protectedIds: [actorId, targetId],
      key: '70000000-0000-4000-8000-000000000101',
      fingerprint: protectedPreview.fingerprint,
      confirmation: actorId,
    })).rejects.toMatchObject({ code: 'protected_account' })

    const before = await previewUserDeletion(prisma, targetId, protectedIds)
    expect(before.families).toBe(2)
    expect(before.activeFamilies).toBe(1)
    expect(before.memories).toBe(2)
    const trashed = await trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000102',
      fingerprint: before.fingerprint,
      confirmation: targetId,
    })

    expect(trashed.state).toBe('trashed')
    expect(await prisma.memory.count({ where: { familyId: ownedFamilyId, deletedAt: null } })).toBe(1)
    expect(await prisma.family.findUniqueOrThrow({ where: { id: ownedFamilyId } })).toMatchObject({ status: 'deleting' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: legacyFamilyId } })).toMatchObject({ status: 'deleted' })
    expect(await prisma.memory.count({ where: { familyId: legacyFamilyId, deletedAt: null } })).toBe(1)
    expect(await prisma.authSession.count({ where: { userId: targetId, revokedAt: null } })).toBe(0)
    expect(await prisma.familyMember.count({ where: { familyId: ownedFamilyId, revokedAt: null } })).toBe(0)
    expect(await prisma.familyMember.count({ where: { familyId: sharedFamilyId, userId: targetId, revokedAt: null } })).toBe(0)
    expect(await createPrismaAuthRepository(prisma).findActiveRefreshSession({
      refreshTokenHash: 'control-lifecycle-session-before-trash',
      refreshTokenFamilyHash: 'control-lifecycle-session-family-before-trash',
      now: new Date(),
      createdAfter: new Date(0),
      reuseGraceAfter: new Date(0),
    })).toBeNull()
    await expect(createPrismaMaxAuthRepository(prisma, createPrismaAuthRepository(prisma)).exchangeMaxIdentity({
      identity: { provider: 'max', subject: '987654321', displayName: 'Synthetic target' },
      fingerprintHash: 'e'.repeat(64),
      replayExpiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
      session: {
        refreshTokenHash: 'late-max-session-token',
        refreshTokenFamilyHash: 'late-max-session-family-token',
        expiresAt: new Date(Date.now() + 60_000),
        metadata: {},
      },
    })).resolves.toEqual({ state: 'invalid_session' })
  })

  test('protects UUID owners when the submitted path and confirmation use uppercase hex', async () => {
    const upperId = protectedHexOwnerId.toUpperCase()
    const before = await previewUserDeletion(prisma, protectedHexOwnerId, [protectedHexOwnerId])
    await expect(trashControlUser(prisma, {
      actorId,
      targetId: upperId,
      protectedIds: [protectedHexOwnerId],
      key: '70000000-0000-4000-8000-000000000129',
      fingerprint: before.fingerprint,
      confirmation: upperId,
    })).rejects.toMatchObject({ code: 'protected_account' })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: protectedHexOwnerId } })).toMatchObject({ controlState: 'active' })
  })

  test('restores live snapshots but keeps prior revocations and independently purged family access closed', async () => {
    const preview = await previewUserDeletion(prisma, targetId, protectedIds)
    const trashed = await trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000103',
      fingerprint: preview.fingerprint,
      confirmation: targetId,
    })
    const familyPreview = await previewFamilyDeletion(prisma, sharedFamilyId)
    await purgeControlFamily(prisma, {
      actorId,
      targetId: sharedFamilyId,
      protectedIds,
      key: '70000000-0000-4000-8000-000000000104',
      fingerprint: familyPreview.fingerprint,
      confirmation: sharedFamilyId,
    })
    const ownedPreview = await previewFamilyDeletion(prisma, ownedFamilyId)
    await purgeControlFamily(prisma, {
      actorId,
      targetId: ownedFamilyId,
      protectedIds,
      key: '70000000-0000-4000-8000-000000000117',
      fingerprint: ownedPreview.fingerprint,
      confirmation: ownedFamilyId,
    })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: sharedFamilyId } })).toMatchObject({ status: 'deleting' })

    await restoreControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000105',
      deletionId: trashed.deletionId,
    })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'active' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: legacyFamilyId } })).toMatchObject({ status: 'deleted' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: ownedFamilyId } })).toMatchObject({ status: 'deleting' })
    await expect(Promise.resolve(prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.control_user_restore_cycle', ${trashed.deletionId}, true)`
      await tx.family.update({ where: { id: ownedFamilyId }, data: { status: 'active' } })
    }))).rejects.toBeDefined()
    await expect(Promise.resolve(prisma.$transaction(async (tx) => {
      await tx.familyMember.update({
        where: { familyId_userId: { familyId: ownedFamilyId, userId: targetId } },
        data: { revokedAt: null },
      })
    }))).rejects.toBeDefined()
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: actorId } } })).toMatchObject({ role: 'viewer', revokedAt: expect.any(Date) })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: formerMemberId } } })).toMatchObject({ revokedAt: expect.any(Date) })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: sharedFamilyId, userId: targetId } } })).toMatchObject({ revokedAt: expect.any(Date) })
    expect(await prisma.authSession.count({ where: { userId: targetId, revokedAt: null } })).toBe(0)
  })

  test('keeps an overlapping member grant pending when the family owner restores first', async () => {
    const ownerPreview = await previewUserDeletion(prisma, targetId, protectedIds)
    const ownerTrash = await trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000112',
      fingerprint: ownerPreview.fingerprint,
      confirmation: targetId,
    })
    const memberPreview = await previewUserDeletion(prisma, overlappingUserId, protectedIds)
    const memberTrash = await trashControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000113',
      fingerprint: memberPreview.fingerprint,
      confirmation: overlappingUserId,
    })
    await restoreControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000114',
      deletionId: ownerTrash.deletionId,
    })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: overlappingUserId } } })).toMatchObject({ revokedAt: expect.any(Date) })
    await restoreControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000115',
      deletionId: memberTrash.deletionId,
    })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: overlappingUserId } } })).toMatchObject({ role: 'viewer', revokedAt: null })
  })

  test('keeps an overlapping member grant pending when the member restores first', async () => {
    const ownerPreview = await previewUserDeletion(prisma, targetId, protectedIds)
    const ownerTrash = await trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000116',
      fingerprint: ownerPreview.fingerprint,
      confirmation: targetId,
    })
    const memberPreview = await previewUserDeletion(prisma, overlappingUserId, protectedIds)
    const memberTrash = await trashControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000117',
      fingerprint: memberPreview.fingerprint,
      confirmation: overlappingUserId,
    })
    await restoreControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000118',
      deletionId: memberTrash.deletionId,
    })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: overlappingUserId } } })).toMatchObject({ revokedAt: expect.any(Date) })
    await restoreControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000119',
      deletionId: ownerTrash.deletionId,
    })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: overlappingUserId } } })).toMatchObject({ role: 'viewer', revokedAt: null })
  })

  test('rejoin after an explicit revoke replaces the cancelled access snapshot', async () => {
    const ownerPreview = await previewUserDeletion(prisma, targetId, protectedIds)
    await trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000120',
      fingerprint: ownerPreview.fingerprint,
      confirmation: targetId,
    })
    const memberPreview = await previewUserDeletion(prisma, overlappingUserId, protectedIds)
    const memberTrash = await trashControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000121',
      fingerprint: memberPreview.fingerprint,
      confirmation: overlappingUserId,
    })
    const familyService = new FamilyService(
      prisma,
      { requireOwner: async () => undefined } as never,
      {} as never,
      {} as never,
      'synthetic-idempotency-secret',
      1_000_000,
    )
    await familyService.removeMember({ familyId: sharedFamilyId, principal: { userId: actorId, sessionId: 'synthetic-session' } }, overlappingUserId, 1)
    expect(await prisma.controlAccessSnapshot.findUniqueOrThrow({ where: { familyId_userId: { familyId: sharedFamilyId, userId: overlappingUserId } } })).toMatchObject({ cancelledAt: expect.any(Date) })
    await restoreControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000122',
      deletionId: memberTrash.deletionId,
    })
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: sharedFamilyId, userId: overlappingUserId } },
      data: { role: 'full', revokedAt: null, version: { increment: 1 }, membershipEpoch: { increment: 1 } },
    })

    const nextPreview = await previewUserDeletion(prisma, overlappingUserId, protectedIds)
    const nextTrash = await trashControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000123',
      fingerprint: nextPreview.fingerprint,
      confirmation: overlappingUserId,
    })
    await restoreControlUser(prisma, {
      actorId, targetId: overlappingUserId, protectedIds,
      key: '70000000-0000-4000-8000-000000000124',
      deletionId: nextTrash.deletionId,
    })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: sharedFamilyId, userId: overlappingUserId } } })).toMatchObject({ role: 'full', revokedAt: null })
  })

  test('serializes a real memory foreign-key write with account trash without lock inversion', async () => {
    const preview = await previewUserDeletion(prisma, targetId, protectedIds)
    let releaseWriter!: () => void
    let signalFamilyLock!: () => void
    const holdWriter = new Promise<void>((resolve) => { releaseWriter = resolve })
    const familyLocked = new Promise<void>((resolve) => { signalFamilyLock = resolve })
    const child = await prisma.child.findFirstOrThrow({ where: { familyId: ownedFamilyId } })
    const writer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM families WHERE id = ${ownedFamilyId}::uuid FOR KEY SHARE`
      signalFamilyLock()
      await holdWriter
      return tx.memory.create({
        data: {
          familyId: ownedFamilyId,
          childId: child.id,
          authorId: targetId,
          kind: 'note',
          body: 'Memory inserted while deletion waits on the family row',
          occurredAt: new Date(),
          firstPublishedAt: new Date(),
        },
      })
    })
    await familyLocked
    const deletion = trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000125',
      fingerprint: preview.fingerprint,
      confirmation: targetId,
    })

    let blocked = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
      `
      if (row!.count > 0n) { blocked = true; break }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(blocked).toBe(true)
    releaseWriter()
    await writer
    await expect(Promise.resolve(deletion)).rejects.toMatchObject({ code: 'stale_preview' })
    expect(await prisma.memory.count({ where: { familyId: ownedFamilyId, body: 'Memory inserted while deletion waits on the family row' } })).toBe(1)

    const familyPreview = await previewFamilyDeletion(prisma, sharedFamilyId)
    let releaseFamilyWriter!: () => void
    let signalSharedLock!: () => void
    const holdFamilyWriter = new Promise<void>((resolve) => { releaseFamilyWriter = resolve })
    const sharedLocked = new Promise<void>((resolve) => { signalSharedLock = resolve })
    const familyWriter = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM families WHERE id = ${sharedFamilyId}::uuid FOR KEY SHARE`
      signalSharedLock()
      await holdFamilyWriter
      return tx.memory.create({
        data: {
          familyId: sharedFamilyId,
          childId: sharedChildId,
          authorId: actorId,
          kind: 'note',
          body: 'Memory inserted while family purge waits on the family row',
          occurredAt: new Date(),
          firstPublishedAt: new Date(),
        },
      })
    })
    await sharedLocked
    const familyPurge = purgeControlFamily(prisma, {
      actorId,
      targetId: sharedFamilyId,
      protectedIds,
      key: '70000000-0000-4000-8000-000000000128',
      fingerprint: familyPreview.fingerprint,
      confirmation: sharedFamilyId,
    })
    blocked = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
      `
      if (row!.count > 0n) { blocked = true; break }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(blocked).toBe(true)
    releaseFamilyWriter()
    await familyWriter
    await expect(Promise.resolve(familyPurge)).rejects.toMatchObject({ code: 'stale_preview' })
    expect(await prisma.memory.count({ where: { familyId: sharedFamilyId, body: 'Memory inserted while family purge waits on the family row' } })).toBe(1)
  })

  test('samples restore time after waiting on the family lock at the deadline', async () => {
    const preview = await previewUserDeletion(prisma, targetId, protectedIds)
    const requestedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 1_500)
    const trashed = await trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000126',
      fingerprint: preview.fingerprint,
      confirmation: targetId,
    }, requestedAt)
    const purgeAfter = new Date(trashed.purgeAfter)

    let releaseFamily!: () => void
    let signalFamilyLock!: () => void
    const holdFamily = new Promise<void>((resolve) => { releaseFamily = resolve })
    const familyLocked = new Promise<void>((resolve) => { signalFamilyLock = resolve })
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM families WHERE id = ${ownedFamilyId}::uuid FOR UPDATE`
      signalFamilyLock()
      await holdFamily
    })
    await familyLocked
    const restoration = restoreControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000127',
      deletionId: trashed.deletionId,
    })
    let blocked = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
      `
      if (row!.count > 0n) { blocked = true; break }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(blocked).toBe(true)
    while (Date.now() <= purgeAfter.getTime() + 100) await new Promise((resolve) => setTimeout(resolve, 25))
    releaseFamily()
    await blocker
    await expect(Promise.resolve(restoration)).rejects.toMatchObject({ code: 'restore_expired' })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'trashed' })
  })

  test('replays the exact result without extending the deadline and rejects a stale cycle', async () => {
    const preview = await previewUserDeletion(prisma, targetId, protectedIds)
    const command = {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000106',
      fingerprint: preview.fingerprint,
      confirmation: targetId,
    }
    const first = await trashControlUser(prisma, command, new Date('2026-10-25T12:00:00Z'))
    const replay = await trashControlUser(prisma, command, new Date('2026-10-26T12:00:00Z'))
    expect(replay).toEqual(first)
    expect(await prisma.controlUserDeletion.count({ where: { targetUserId: targetId } })).toBe(1)

    await restoreControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000107',
      deletionId: first.deletionId,
    })
    const secondPreview = await previewUserDeletion(prisma, targetId, protectedIds)
    const second = await trashControlUser(prisma, {
      ...command,
      key: '70000000-0000-4000-8000-000000000108',
      fingerprint: secondPreview.fingerprint,
    })
    expect(second.deletionId).not.toBe(first.deletionId)
    await expect(restoreControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000109',
      deletionId: first.deletionId,
    })).rejects.toMatchObject({ code: 'stale_deletion_cycle' })
  })

  test('database fences old-runtime sessions, membership reactivation and owned-family creation', async () => {
    const preview = await previewUserDeletion(prisma, targetId, protectedIds)
    await trashControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000110',
      fingerprint: preview.fingerprint,
      confirmation: targetId,
    })
    await expect(Promise.resolve(prisma.authSession.create({
      data: { userId: targetId, refreshTokenHash: 'raw-old-runtime-session', expiresAt: new Date(Date.now() + 60_000) },
    }))).rejects.toBeDefined()
    await expect(Promise.resolve(prisma.familyMember.update({
      where: { familyId_userId: { familyId: sharedFamilyId, userId: targetId } },
      data: { revokedAt: null },
    }))).rejects.toBeDefined()
    await expect(Promise.resolve(prisma.family.create({
      data: { ownerUserId: targetId, name: 'Old runtime create', timezone: 'UTC' },
    }))).rejects.toBeDefined()
  })

  test('uses an exact 720-hour grace period across a DST boundary', async () => {
    const deletedAt = new Date('2026-03-28T12:00:00Z')
    const berlinDb = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === '$transaction') {
          return (callback: (tx: any) => Promise<unknown>, options?: unknown) => prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT set_config('TimeZone', 'Europe/Berlin', true)`
            return callback(tx)
          }, options as never)
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const preview = await previewUserDeletion(berlinDb, targetId, protectedIds)
    const result = await trashControlUser(berlinDb, {
      actorId,
      targetId,
      protectedIds,
      key: '70000000-0000-4000-8000-000000000112',
      fingerprint: preview.fingerprint,
      confirmation: targetId,
    }, deletedAt)
    const deletion = await prisma.controlUserDeletion.findUniqueOrThrow({ where: { id: result.deletionId } })
    expect(deletion.purgeAfter.getTime() - deletion.deletedAt.getTime()).toBe(720 * 60 * 60 * 1000)
  })

  test('serializes browser approval and redemption against account trash', async () => {
    const now = new Date()
    const challengeId = 'control-lifecycle-browser-challenge'
    const verifierHash = 'c'.repeat(64)
    const browser = createPrismaBrowserLinkRepository(prisma)
    const identity = await prisma.externalIdentity.findFirstOrThrow({ where: { userId: targetId, provider: 'max' } })
    await browser.createBrowserLoginChallenge({
      id: challengeId,
      verifierHash,
      displayCodeHash: 'd'.repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
      now,
    })
    const preview = await previewUserDeletion(prisma, targetId, protectedIds)
    const [approval] = await Promise.all([
      browser.approveBrowserLoginChallenge({ id: challengeId, userId: targetId, externalIdentityId: identity.id, now }),
      trashControlUser(prisma, {
        actorId, targetId, protectedIds,
        key: '70000000-0000-4000-8000-000000000111',
        fingerprint: preview.fingerprint,
        confirmation: targetId,
      }),
    ])
    expect(['approved', 'missing']).toContain(approval)
    const challenge = await prisma.browserLoginChallenge.findUniqueOrThrow({ where: { id: challengeId } })
    expect(challenge.state).not.toBe('approved')
    await expect(browser.redeemBrowserLoginChallenge({
      id: challengeId,
      verifierHash,
      now,
      refreshTokenHash: 'late-browser-session-token',
      refreshTokenFamilyHash: 'late-browser-session-family-token',
      expiresAt: new Date(now.getTime() + 60_000),
      metadata: {},
    })).resolves.toBeNull()
  })
})
