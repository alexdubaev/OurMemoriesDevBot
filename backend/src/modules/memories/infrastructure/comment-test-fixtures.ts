import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { createApp } from '../../../app'
import { createPrisma } from '../../../db'
import { loadEnv } from '../../../env'
import { signAccessToken } from '../../auth'

export function commentFixtures() {
  const url = process.env.TEST_DATABASE_URL!
  const db = createPrisma(url)
  const env = loadEnv({
    DATABASE_URL: url,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '10000',
  })
  const app = createApp({ env, prisma: db })
  const prefix = String(Date.now())
  const users: string[] = [],
    families: string[] = []
  async function user(name = 'Человек') {
    const row = await db.user.create({ data: { displayName: name } })
    users.push(row.id)
    const subject = `${prefix}${users.length}`
    const identity = await db.externalIdentity.create({
      data: { userId: row.id, provider: 'max', subject },
    })
    await db.pilotAdmission.create({ data: { provider: 'max', subject } })
    const session = await db.authSession.create({
      data: {
        userId: row.id,
        externalIdentityId: identity.id,
        refreshTokenHash: randomUUID(),
        refreshTokenFamilyHash: randomUUID(),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    return {
      id: row.id,
      token: await signAccessToken({ sub: row.id, sessionId: session.id }, env),
    }
  }
  async function family(owner: { id: string }) {
    const familyId = randomUUID()
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({
        data: {
          id: familyId,
          ownerUserId: owner.id,
          name: 'Синтетическая семья',
          timezone: 'Europe/Moscow',
        },
      })
      await tx.familyMember.create({
        data: { familyId, userId: owner.id, role: 'full' },
      })
    })
    families.push(familyId)
    const child = await db.child.create({
      data: { familyId, displayName: 'Ребёнок' },
    })
    return { id: familyId, childId: child.id }
  }
  async function memory(
    family: { id: string; childId: string },
    author: { id: string },
    kind: 'note' | 'photo' | 'video' | 'voice' | 'media' = 'note',
  ) {
    return db.memory.create({
      data: {
        familyId: family.id,
        childId: family.childId,
        authorId: author.id,
        kind,
        body: 'Синтетическая публикация',
        occurredAt: new Date(),
        firstPublishedAt: new Date(),
      },
    })
  }
  async function request(
    path: string,
    token?: string,
    method = 'GET',
    body?: unknown,
    key?: string,
    target = app,
  ) {
    const response = await target.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    return { response, body: text ? (JSON.parse(text) as any) : undefined }
  }
  async function cleanup() {
    await db.memory.deleteMany({ where: { familyId: { in: families } } })
    await db.child.deleteMany({ where: { familyId: { in: families } } })
    await db.family.deleteMany({ where: { id: { in: families } } })
    await db.user.deleteMany({ where: { id: { in: users } } })
    await db.pilotAdmission.deleteMany({
      where: { subject: { startsWith: prefix } },
    })
    await db.$disconnect()
  }
  async function blocker(sql: string, params: unknown[]) {
    const client = new Client({ connectionString: url })
    await client.connect()
    await client.query('BEGIN')
    await client.query(sql, params)
    return client
  }
  async function waitLocked(client: Client, fragment: string) {
    for (let i = 0; i < 80; i++) {
      await client.query('SELECT pg_stat_clear_snapshot()')
      const result = await client.query(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query ILIKE $1) AS waiting",
        [`%${fragment}%`],
      )
      if (result.rows[0].waiting) return
      await Bun.sleep(25)
    }
    throw new Error('Expected PostgreSQL lock wait: ' + fragment)
  }
  const path = (familyId: string, memoryId: string) =>
    `/api/v1/families/${familyId}/memories/${memoryId}/comments`
  return {
    db,
    env,
    app,
    user,
    family,
    memory,
    request,
    cleanup,
    blocker,
    waitLocked,
    path,
  }
}
