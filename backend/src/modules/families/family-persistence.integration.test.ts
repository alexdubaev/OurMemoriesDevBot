import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { createPrisma } from '../../db'

const databaseUrl = requireIntegrationDatabaseUrl()

describe('Block 01 family persistence', () => {
  const prisma = createPrisma(databaseUrl!)
  const ownedUserIds = new Set<string>()

  beforeEach(clearFixtures)

  afterAll(async () => {
    await clearFixtures()
    await prisma.$disconnect()
  })

  test('creates a MAX user without inventing an email address', async () => {
    const user = await prisma.user.create({
      data: { email: null, displayName: 'MAX User', role: 'user' },
    })
    ownedUserIds.add(user.id)
    const subject = `1${randomUUID().replaceAll(/\D/g, '')}`
    const identity = await prisma.externalIdentity.create({
      data: { provider: 'max', subject, userId: user.id },
    })

    expect(user.email).toBeNull()
    expect(identity).toMatchObject({ provider: 'max', subject, userId: user.id })
  })

  test('does not let two users claim the same MAX identity', async () => {
    const first = await prisma.user.create({ data: { email: null, role: 'user' } })
    ownedUserIds.add(first.id)
    const second = await prisma.user.create({ data: { email: null, role: 'user' } })
    ownedUserIds.add(second.id)
    const subject = `1${randomUUID().replaceAll(/\D/g, '')}`
    await prisma.externalIdentity.create({
      data: { provider: 'max', subject, userId: first.id },
    })

    await expect(
      Promise.resolve(prisma.externalIdentity.create({
        data: { provider: 'max', subject, userId: second.id },
      })),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  async function clearFixtures() {
    const userIds = [...ownedUserIds]
    if (userIds.length > 0) {
      await prisma.externalIdentity.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
      ownedUserIds.clear()
    }
  }
})
