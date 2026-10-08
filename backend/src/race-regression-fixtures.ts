import { Client } from 'pg'

import { createPrisma, type DbClient } from './db'

function localTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL
  if (!value) throw new Error('Set TEST_DATABASE_URL to an isolated local *_test database')
  const parsed = new URL(value)
  if (!parsed.pathname.endsWith('_test') ||
    !new Set(['localhost', '127.0.0.1', '[::1]', '::1']).has(parsed.hostname)) {
    throw new Error('Set TEST_DATABASE_URL to an isolated local *_test database')
  }
  return value
}

const databaseUrl = localTestDatabaseUrl()

export function createRaceTestClients() {
  return {
    prisma: createPrisma(databaseUrl),
    pg: new Client({ connectionString: databaseUrl }),
  }
}

export function withTransactionClientHook(db: DbClient, wrap: (tx: any) => any): DbClient {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver)
      return (callback: (tx: any) => Promise<unknown>, options?: unknown) =>
        target.$transaction((tx) => callback(wrap(tx)), options as never)
    },
  }) as DbClient
}

export function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

export async function waitForDatabaseLockWait(pg: Client) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    await pg.query('SELECT pg_stat_clear_snapshot()')
    const result = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'`,
    )
    if ((result.rows[0]?.count ?? 0) > 0) return
    await Bun.sleep(10)
  }
  throw new Error('No PostgreSQL lock wait appeared during the controlled race')
}

export async function reservationIsLockableNow(pg: Client, reservationId: string) {
  await pg.query('BEGIN')
  try {
    await pg.query('SELECT id FROM upload_reservations WHERE id = $1::uuid FOR UPDATE NOWAIT', [reservationId])
    await pg.query('COMMIT')
    return true
  } catch (error) {
    await pg.query('ROLLBACK')
    if ((error as { code?: string }).code === '55P03') return false
    throw error
  }
}

export async function seedRaceOwner(prisma: DbClient) {
  const user = await prisma.user.create({ data: { displayName: `race-${crypto.randomUUID()}` } })
  const family = await prisma.$transaction(async (tx) => {
    const created = await tx.family.create({ data: {
      ownerUserId: user.id,
      name: 'Synthetic race regression',
      timezone: 'UTC',
    } })
    await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
    return created
  })
  const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Synthetic child' } })
  return { familyId: family.id, userId: user.id, childId: child.id }
}

export async function cleanupRaceOwner(prisma: DbClient, owner: { familyId: string; userId: string }) {
  await prisma.$transaction(async (tx) => {
    const assets = await tx.mediaAsset.findMany({ where: { familyId: owner.familyId }, select: { id: true } })
    await tx.captionRequest.deleteMany({ where: { familyId: owner.familyId } })
    await tx.uploadReservation.deleteMany({ where: { familyId: owner.familyId } })
    await tx.memory.deleteMany({ where: { familyId: owner.familyId } })
    await tx.child.deleteMany({ where: { familyId: owner.familyId } })
    await tx.mediaAsset.deleteMany({ where: { familyId: owner.familyId } })
    await tx.taskOutbox.deleteMany({ where: { dedupeKey: { in: assets.map(({ id }) => `media-delete:${id}`) } } })
    await tx.$executeRaw`DELETE FROM families WHERE id = ${owner.familyId}::uuid`
    await tx.user.delete({ where: { id: owner.userId } })
  })
}
