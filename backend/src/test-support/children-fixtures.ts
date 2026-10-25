import { randomUUID } from 'node:crypto'

import { createApp } from '../app'
import { createPrisma } from '../db'
import { loadEnv } from '../env'
import { signAccessToken } from '../modules/auth'
import { requireIntegrationDatabaseUrl } from './integration-database'

type Role = 'full' | 'viewer'
export type FixtureUser = { id: string; token: string; subject: string }
export type FixtureChild = { id: string; name: string; deleted: boolean }
export type FixtureFamily = { id: string; owner: FixtureUser; children: FixtureChild[] }

/**
 * Shared synthetic data for multi-child integration tests: users with a live session, a family
 * with N children (optionally soft-deleted, created in a fixed order), members and memories with
 * child tags. Everything it creates is removed by `cleanup()`.
 */
export function childrenFixtures() {
  const url = requireIntegrationDatabaseUrl()
  const db = createPrisma(url)
  const env = loadEnv({
    DATABASE_URL: url,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '10000',
  })
  const app = createApp({ env, prisma: db })
  const prefix = `9${Date.now()}`
  const users: string[] = []
  const families: string[] = []
  const baseTime = Date.UTC(2026, 0, 1)
  let childSequence = 0

  async function user(name = 'Синтетический участник'): Promise<FixtureUser> {
    const row = await db.user.create({ data: { displayName: name } })
    users.push(row.id)
    const subject = `${prefix}${users.length}`
    const identity = await db.externalIdentity.create({ data: { userId: row.id, provider: 'max', subject } })
    await db.pilotAdmission.create({ data: { provider: 'max', subject } })
    const session = await db.authSession.create({ data: {
      userId: row.id, externalIdentityId: identity.id, refreshTokenHash: randomUUID(),
      refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 3_600_000),
    } })
    return { id: row.id, subject, token: await signAccessToken({ sub: row.id, sessionId: session.id }, env) }
  }

  /** Children are created oldest first; `deleted` marks a soft-deleted profile. */
  async function family(
    owner?: FixtureUser,
    children: Array<string | { name: string; deleted?: boolean; birthDate?: string }> = ['Ребёнок'],
  ): Promise<FixtureFamily> {
    const familyOwner = owner ?? await user('Синтетический владелец')
    const familyId = randomUUID()
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: familyId, ownerUserId: familyOwner.id, name: 'Синтетическая семья', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId: familyOwner.id, role: 'full' } })
    })
    families.push(familyId)
    const created: FixtureChild[] = []
    for (const entry of children) created.push(await child(familyId, typeof entry === 'string' ? { name: entry } : entry))
    return { id: familyId, owner: familyOwner, children: created }
  }

  async function child(familyId: string, input: { name: string; deleted?: boolean; birthDate?: string }): Promise<FixtureChild> {
    childSequence += 1
    const row = await db.child.create({ data: {
      familyId, displayName: input.name,
      birthDate: input.birthDate ? new Date(`${input.birthDate}T00:00:00.000Z`) : null,
      createdAt: new Date(baseTime + childSequence * 1_000),
      deletedAt: input.deleted ? new Date(baseTime + childSequence * 1_000 + 500) : null,
    } })
    return { id: row.id, name: row.displayName, deleted: !!input.deleted }
  }

  async function member(familyId: string, role: Role = 'full', name = 'Синтетический родственник') {
    const row = await user(name)
    await db.familyMember.create({ data: { familyId, userId: row.id, role } })
    return row
  }

  /** A memory written directly; `tags` lists (child, attachment|null) rows to store with it. */
  async function memory(
    target: FixtureFamily,
    input: { author?: FixtureUser; anchorChildId?: string; kind?: 'note' | 'photo' | 'video' | 'voice' | 'media'; body?: string;
      tags?: Array<{ childId: string; attachmentId?: string | null }> } = {},
  ) {
    const author = input.author ?? target.owner
    const anchor = input.anchorChildId ?? target.children.find(({ deleted }) => !deleted)?.id
    if (!anchor) throw new Error('Fixture memory needs a live child anchor')
    const row = await db.memory.create({ data: {
      familyId: target.id, childId: anchor, authorId: author.id, kind: input.kind ?? 'note',
      body: input.body ?? 'Синтетическая публикация', occurredAt: new Date(), firstPublishedAt: new Date(),
    } })
    if (input.tags?.length) await db.memoryChildTag.createMany({ data: input.tags.map((tag) => ({
      familyId: target.id, memoryId: row.id, childId: tag.childId, attachmentId: tag.attachmentId ?? null, createdBy: author.id,
    })) })
    return row
  }

  async function tags(memoryId: string) {
    const rows = await db.memoryChildTag.findMany({ where: { memoryId }, select: { childId: true, attachmentId: true } })
    return rows.sort((a, b) => `${a.childId}:${a.attachmentId ?? ''}`.localeCompare(`${b.childId}:${b.attachmentId ?? ''}`))
  }

  async function request(path: string, token?: string, method = 'GET', body?: unknown, key?: string, headers: Record<string, string> = {}) {
    const response = await app.request(path, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) as any : undefined }
  }

  async function cleanup() {
    await db.idempotencyRecord.deleteMany({ where: { actorUserId: { in: users } } })
    await db.memory.deleteMany({ where: { familyId: { in: families } } })
    await db.child.deleteMany({ where: { familyId: { in: families } } })
    await db.family.deleteMany({ where: { id: { in: families } } })
    await db.user.deleteMany({ where: { id: { in: users } } })
    await db.pilotAdmission.deleteMany({ where: { subject: { startsWith: prefix } } })
  }

  return { db, env, app, user, family, child, member, memory, tags, request, cleanup, disconnect: () => db.$disconnect() }
}
