import { afterAll, beforeAll, expect, test } from 'bun:test'

import { cleanupRaceOwner, createRaceTestClients, deferred, seedRaceOwner, withTransactionClientHook } from '../../../race-regression-fixtures'
import { PrismaCaptionRepository } from './prisma-caption-repository'

const { prisma, pg } = createRaceTestClients()

beforeAll(async () => {
  await pg.connect()
  await prisma.$queryRaw`SELECT 1`
})

afterAll(async () => {
  await prisma.$disconnect()
  await pg.end()
})

test('a reply that resumes after cancel commits leaves the caption unchanged', async () => {
  const owner = await seedRaceOwner(prisma)
  try {
    const memory = await prisma.memory.create({ data: {
      familyId: owner.familyId,
      childId: owner.childId,
      authorId: owner.userId,
      kind: 'voice',
      body: 'Original caption',
      occurredAt: new Date(),
      firstPublishedAt: new Date(),
    } })
    const request = await prisma.captionRequest.create({ data: {
      familyId: owner.familyId,
      userId: owner.userId,
      memoryId: memory.id,
      chatId: 46113001n,
      promptMessageId: 46113002n,
      expectedVersion: memory.version,
      expiresAt: new Date(Date.now() + 60_000),
    } })

    const aclCheckReached = deferred()
    const releaseReply = deferred()
    let paused = false
    const gatedReplyDb = withTransactionClientHook(prisma, (tx) => new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== 'familyMember') return Reflect.get(target, property, receiver)
        return new Proxy(target.familyMember, {
          get(member, memberProperty, memberReceiver) {
            if (memberProperty !== 'count') return Reflect.get(member, memberProperty, memberReceiver)
            const count = Reflect.get(member, memberProperty, memberReceiver) as (...args: unknown[]) => Promise<number>
            return async (...args: unknown[]) => {
              const result = await count.apply(target.familyMember, args)
              if (!paused) {
                paused = true
                aclCheckReached.resolve()
                await releaseReply.promise
              }
              return result
            }
          },
        })
      },
    }))

    const replying = new PrismaCaptionRepository(gatedReplyDb).consumeReply({
      familyId: owner.familyId,
      userId: owner.userId,
      chatId: '46113001',
      replyToMessageId: '46113002',
      text: 'Changed after cancel',
    })
    await aclCheckReached.promise
    expect(await new PrismaCaptionRepository(prisma).cancel({
      familyId: owner.familyId,
      userId: owner.userId,
      chatId: '46113001',
    })).toBe(true)
    releaseReply.resolve()

    await expect(replying).resolves.toMatchObject({ kind: 'expired' })
    const [afterMemory, afterRequest] = await Promise.all([
      prisma.memory.findUniqueOrThrow({ where: { id: memory.id } }),
      prisma.captionRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ])
    expect(afterMemory.body).toBe('Original caption')
    expect(afterMemory.version).toBe(memory.version)
    expect(afterRequest.consumedAt).toBeNull()
    expect(afterRequest.cancelledAt).not.toBeNull()
  } finally {
    await cleanupRaceOwner(prisma, owner)
  }
})

test('simultaneous replies consume one caption request and update one memory version', async () => {
  const owner = await seedRaceOwner(prisma)
  try {
    const memory = await prisma.memory.create({ data: {
      familyId: owner.familyId,
      childId: owner.childId,
      authorId: owner.userId,
      kind: 'voice',
      body: 'Original caption',
      occurredAt: new Date(),
      firstPublishedAt: new Date(),
    } })
    const request = await prisma.captionRequest.create({ data: {
      familyId: owner.familyId,
      userId: owner.userId,
      memoryId: memory.id,
      chatId: 46113003n,
      promptMessageId: 46113004n,
      expectedVersion: memory.version,
      expiresAt: new Date(Date.now() + 60_000),
    } })
    const repository = new PrismaCaptionRepository(prisma)

    const results = await Promise.all([
      repository.consumeReply({ familyId: owner.familyId, userId: owner.userId, chatId: '46113003',
        replyToMessageId: '46113004', text: 'First simultaneous reply' }),
      repository.consumeReply({ familyId: owner.familyId, userId: owner.userId, chatId: '46113003',
        replyToMessageId: '46113004', text: 'Second simultaneous reply' }),
    ])
    expect(results).toEqual([{ kind: 'updated' }, { kind: 'updated' }])

    const [afterMemory, afterRequest] = await Promise.all([
      prisma.memory.findUniqueOrThrow({ where: { id: memory.id } }),
      prisma.captionRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ])
    expect(['First simultaneous reply', 'Second simultaneous reply']).toContain(afterMemory.body)
    expect(afterMemory.version).toBe(memory.version + 1)
    expect(afterRequest.consumedAt).not.toBeNull()
    expect(afterRequest.cancelledAt).toBeNull()
  } finally {
    await cleanupRaceOwner(prisma, owner)
  }
})
