import { afterAll, beforeAll, expect, test } from 'bun:test'

import { cleanupRaceOwner, createRaceTestClients, deferred, reservationIsLockableNow, seedRaceOwner, waitForDatabaseLockWait, withTransactionClientHook } from '../../../race-regression-fixtures'
import { runBackgroundJob } from '../../../jobs'
import { PrismaMediaRepository } from './prisma-media-repository'

const { prisma, pg } = createRaceTestClients()

beforeAll(async () => {
  await pg.connect()
  await prisma.$queryRaw`SELECT 1`
})

afterAll(async () => {
  await prisma.$disconnect()
  await pg.end()
})

test('expired reservation cleanup waits on the family before locking the reservation', async () => {
  const owner = await seedRaceOwner(prisma)
  const assetId = crypto.randomUUID()
  const uploadId = crypto.randomUUID()
  const finalizerAtFamilyLock = deferred()
  const releaseFinalizer = deferred()
  let finalizerPaused = false

  try {
    const expiresAt = new Date(Date.now() + 60_000)
    const bytes = 12n
    await prisma.mediaAsset.create({ data: {
      id: assetId,
      familyId: owner.familyId,
      uploaderId: owner.userId,
      sourceKind: 'upload',
      purpose: 'memory',
      mediaKind: 'photo',
      originalKey: `media-originals/${assetId}`,
      declaredMime: 'image/png',
      byteSize: bytes,
    } })
    await prisma.uploadReservation.create({ data: {
      id: uploadId,
      familyId: owner.familyId,
      userId: owner.userId,
      mediaId: assetId,
      bytes,
      expiresAt,
    } })
    await prisma.family.update({ where: { id: owner.familyId }, data: { storageReservedBytes: bytes } })

    const gatedFinalizerDb = withTransactionClientHook(prisma, (tx) => new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== '$queryRaw') return Reflect.get(target, property, receiver)
        const queryRaw = Reflect.get(target, property, receiver) as (...args: unknown[]) => Promise<unknown>
        return async (...args: unknown[]) => {
          const result = await queryRaw.apply(target, args)
          if (!finalizerPaused) {
            finalizerPaused = true
            finalizerAtFamilyLock.resolve()
            await releaseFinalizer.promise
          }
          return result
        }
      },
    }))

    const finalizing = new PrismaMediaRepository(gatedFinalizerDb).commitFinalization({
      scope: { familyId: owner.familyId, principal: { userId: owner.userId, sessionId: 'race-regression' } },
      uploadId,
      verifiedMime: 'image/png',
      sha256: '0'.repeat(64),
      width: 1,
      height: 1,
      durationMs: null,
      renditionStatus: 'ready',
      variants: [],
      now: new Date(expiresAt.getTime() - 1),
    })
    await finalizerAtFamilyLock.promise

    const cleaning = runBackgroundJob('media:pending:cleanup', { prisma } as any, new Date(expiresAt.getTime() + 1))
    let lockCheckCompleted = false
    let reservationLockable = false
    try {
      await waitForDatabaseLockWait(pg)
      reservationLockable = await reservationIsLockableNow(pg, uploadId)
      lockCheckCompleted = true
    } finally {
      releaseFinalizer.resolve()
    }

    const outcomes = await Promise.allSettled([cleaning, finalizing])
    expect(lockCheckCompleted).toBe(true)
    expect(reservationLockable).toBe(true)
    expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true)
    const [family, reservation, asset] = await Promise.all([
      prisma.family.findUniqueOrThrow({ where: { id: owner.familyId } }),
      prisma.uploadReservation.findUniqueOrThrow({ where: { id: uploadId } }),
      prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }),
    ])
    expect(reservation.finalizedAt).not.toBeNull()
    expect(family.storageReservedBytes).toBe(0n)
    expect(family.storageUsedBytes).toBe(bytes)
    expect(asset.originalStatus).toBe('stored')
    expect(asset.deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: `media-delete:${assetId}` } })).toBe(0)
  } finally {
    releaseFinalizer.resolve()
    await cleanupRaceOwner(prisma, owner)
  }
})
