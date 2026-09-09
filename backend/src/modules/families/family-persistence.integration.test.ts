import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Block 01 family persistence', () => {
  const prisma = createPrisma(databaseUrl!)

  beforeEach(async () => {
    await prisma.externalIdentity.deleteMany()
    await prisma.user.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  test('creates a Telegram user without inventing an email address', async () => {
    const user = await prisma.user.create({
      data: { email: null, displayName: 'Telegram User', role: 'user' },
    })
    const identity = await prisma.externalIdentity.create({
      data: { provider: 'telegram', subject: '99281912', userId: user.id },
    })

    expect(user.email).toBeNull()
    expect(identity).toMatchObject({ provider: 'telegram', subject: '99281912', userId: user.id })
  })

  test('does not let two users claim the same Telegram identity', async () => {
    const first = await prisma.user.create({ data: { email: null, role: 'user' } })
    const second = await prisma.user.create({ data: { email: null, role: 'user' } })
    await prisma.externalIdentity.create({
      data: { provider: 'telegram', subject: '10001', userId: first.id },
    })

    await expect(
      Promise.resolve(prisma.externalIdentity.create({
        data: { provider: 'telegram', subject: '10001', userId: second.id },
      })),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})
