import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { createInviteStartResolver } from './application/invite-start'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('families invite-start resolver', () => {
  const prisma = createPrisma(databaseUrl!)
  const fixedNow = new Date('2026-09-15T10:00:00.000Z')

  beforeEach(async () => {
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('classifies only active unused invites in active families without changing Core rows', async () => {
    const activeToken = token('active')
    const expiredToken = token('expired')
    const revokedToken = token('revoked')
    const usedToken = token('used')
    const inactiveFamilyToken = token('inactive')
    const owner = await prisma.user.create({ data: { displayName: 'Resolver owner' } })
    const inactiveOwner = await prisma.user.create({ data: { displayName: 'Inactive owner' } })
    const activeFamily = await createFamily(owner.id, 'Active family')
    const inactiveFamily = await createFamily(inactiveOwner.id, 'Inactive family')
    await prisma.familyInvite.createMany({ data: [
      invite(activeFamily.id, owner.id, activeToken, { expiresAt: new Date('2026-09-16T10:00:00.000Z') }),
      invite(activeFamily.id, owner.id, expiredToken, { expiresAt: new Date('2026-09-14T10:00:00.000Z') }),
      invite(activeFamily.id, owner.id, revokedToken, { revokedAt: fixedNow }),
      invite(activeFamily.id, owner.id, usedToken, { acceptedAt: fixedNow, acceptedBy: owner.id }),
      invite(inactiveFamily.id, inactiveOwner.id, inactiveFamilyToken),
    ] })
    await prisma.family.update({ where: { id: inactiveFamily.id }, data: { status: 'deleting' } })

    const before = await Promise.all([
      prisma.familyInvite.count(), prisma.familyMember.count(), prisma.user.count(),
      prisma.externalIdentity.count(), prisma.child.count(),
    ])
    const resolveInviteStart = createInviteStartResolver(prisma, () => fixedNow)

    expect(await resolveInviteStart(activeToken)).toBe('active')
    expect(await resolveInviteStart(token('missing'))).toBe('invalid')
    expect(await resolveInviteStart(expiredToken)).toBe('invalid')
    expect(await resolveInviteStart(revokedToken)).toBe('invalid')
    expect(await resolveInviteStart(usedToken)).toBe('invalid')
    expect(await resolveInviteStart(inactiveFamilyToken)).toBe('invalid')
    expect(await Promise.all([
      prisma.familyInvite.count(), prisma.familyMember.count(), prisma.user.count(),
      prisma.externalIdentity.count(), prisma.child.count(),
    ])).toEqual(before)
    expect((await prisma.familyInvite.findUniqueOrThrow({ where: { tokenHash: hash(activeToken) } })).acceptedAt).toBeNull()
  })

  async function createFamily(ownerUserId: string, name: string) {
    return prisma.$transaction(async (tx) => {
      const family = await tx.family.create({ data: { ownerUserId, name, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: family.id, userId: ownerUserId, role: 'full' } })
      return family
    })
  }

  function invite(familyId: string, createdBy: string, rawToken: string, overrides: Record<string, unknown> = {}) {
    return {
      familyId, role: 'viewer' as const, tokenHash: hash(rawToken), createdBy,
      expiresAt: new Date('2026-09-16T10:00:00.000Z'), ...overrides,
    }
  }
})

function token(label: string) {
  return `${label}_${randomUUID().replaceAll('-', '')}`.padEnd(32, 'x')
}

function hash(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex')
}
