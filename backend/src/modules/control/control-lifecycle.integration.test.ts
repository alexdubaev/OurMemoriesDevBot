import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { createPrisma } from '../../db'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { createPrismaAuthRepository, createPrismaBrowserLinkRepository, createPrismaMaxAuthRepository } from '../auth/infrastructure/auth-repository'
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
const ownedFamilyId = '71000000-0000-4000-8000-000000000001'
const sharedFamilyId = '71000000-0000-4000-8000-000000000002'
const legacyFamilyId = '71000000-0000-4000-8000-000000000003'
const protectedIds = [actorId]

async function seed() {
  await prisma.user.createMany({ data: [
    { id: actorId, displayName: 'Control operator' },
    { id: targetId, displayName: 'Synthetic target' },
    { id: formerMemberId, displayName: 'Synthetic former member' },
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
      ] },
    },
  })
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
    await expect(createPrismaMaxAuthRepository(prisma).exchangeMaxIdentity({
      identity: { provider: 'max', subject: '987654321', displayName: 'Synthetic target' },
      fingerprintHash: 'e'.repeat(64),
      replayExpiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
      session: {
        refreshTokenHash: 'late-max-session-token',
        refreshTokenFamilyHash: 'late-max-session-family-token',
        expiresAt: new Date(Date.now() + 60_000),
        metadata: { userAgent: null, ipAddress: null },
      },
    })).resolves.toEqual({ state: 'invalid_session' })
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
    expect(await prisma.family.findUniqueOrThrow({ where: { id: sharedFamilyId } })).toMatchObject({ status: 'deleting' })

    await restoreControlUser(prisma, {
      actorId, targetId, protectedIds,
      key: '70000000-0000-4000-8000-000000000105',
      deletionId: trashed.deletionId,
    })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ controlState: 'active' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: ownedFamilyId } })).toMatchObject({ status: 'active' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: legacyFamilyId } })).toMatchObject({ status: 'deleted' })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: actorId } } })).toMatchObject({ role: 'viewer', revokedAt: null })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: ownedFamilyId, userId: formerMemberId } } })).toMatchObject({ revokedAt: expect.any(Date) })
    expect(await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: sharedFamilyId, userId: targetId } } })).toMatchObject({ revokedAt: expect.any(Date) })
    expect(await prisma.authSession.count({ where: { userId: targetId, revokedAt: null } })).toBe(0)
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
    const purgeAfter = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', 'Europe/Berlin', true)`
      const deletion = await tx.controlUserDeletion.create({
        data: { targetUserId: targetId, actorUserId: actorId, deletedAt, purgeAfter },
      })
      expect(deletion.purgeAfter.getTime() - deletion.deletedAt.getTime()).toBe(720 * 60 * 60 * 1000)
      await tx.controlUserDeletion.delete({ where: { id: deletion.id } })
    })
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
      metadata: { userAgent: null, ipAddress: null },
    })).resolves.toBeNull()
  })
})
