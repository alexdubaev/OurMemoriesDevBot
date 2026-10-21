import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
// @ts-expect-error The repository's runtime safety guard is JavaScript with no declaration surface.
import { assertTestDatabaseUrl } from '../../../../scripts/repo-env.mjs'
import { signAccessToken } from '../auth'

const databaseUrl = requireIntegrationDatabaseUrl()
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for MAX family invite expiry tests')
assertTestDatabaseUrl(databaseUrl)
const databaseAddress = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost', '::1'].includes(databaseAddress.hostname)
  || !/^\/(?:web_app_demo_test|memoly_family_audit(?:_e2e)?_test|memoly_family_audit_verify_20261016_test)$/.test(databaseAddress.pathname)) {
  throw new Error('MAX family invite expiry tests refuse non-loopback or non-test databases')
}

describe('MAX family invite expiry', () => {
  const prisma = createPrisma(databaseUrl)
  const env = loadEnv({ DATABASE_URL: databaseUrl, JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173' })
  const app = createApp({ env, prisma })

  beforeEach(async () => {
    await prisma.taskOutbox.deleteMany()
    await prisma.idempotencyRecord.deleteMany()
    await prisma.maxVideoReference.deleteMany()
    await prisma.maxOutboundSource.deleteMany()
    await prisma.maxVideoUploadSession.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
  })
  afterAll(async () => { await prisma.$disconnect() })

  test('MAX owner list excludes expired link while preserving its database record', async () => {
    const subject = String(BigInt(`0x${randomUUID().replaceAll('-', '')}`))
    const user = await prisma.user.create({ data: { email: null, displayName: 'MAX owner', role: 'user' } })
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'max', subject } })
    const session = await prisma.authSession.create({ data: {
      userId: user.id, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    } })
    await prisma.$executeRaw`UPDATE auth_sessions SET external_identity_id = ${identity.id}::uuid WHERE id = ${session.id}::uuid`
    const token = await signAccessToken({ sub: user.id, sessionId: session.id }, env)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const created = await app.request('/api/v1/families', {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ name: 'MAX synthetic family', timezone: 'Europe/Moscow' }),
    })
    expect(created.status).toBe(201)
    const { family } = await created.json() as { family: { id: string } }
    const avatar = await prisma.mediaAsset.create({ data: {
      familyId: family.id, uploaderId: user.id, sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
      originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: 1n, width: 1, height: 1,
      originalStatus: 'stored', renditionStatus: 'ready',
    } })
    await prisma.child.create({ data: {
      familyId: family.id, displayName: 'Synthetic MAX child', birthDate: new Date('2024-01-01T00:00:00.000Z'), sex: 'girl',
      avatarMediaId: avatar.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    } })
    const invitation = await app.request(`/api/v1/families/${family.id}/invites`, {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ role: 'viewer' }),
    })
    expect(invitation.status).toBe(201)
    const { id } = await invitation.json() as { id: string }
    await prisma.familyInvite.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1_000) } })

    const listed = await app.request(`/api/v1/families/${family.id}/invites`, { headers })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ items: [] })
    expect((await prisma.familyInvite.findUniqueOrThrow({ where: { id } })).revokedAt).toBeNull()
  })
})
