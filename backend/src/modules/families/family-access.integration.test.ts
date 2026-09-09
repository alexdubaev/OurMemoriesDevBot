import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { signAccessToken } from '../auth'
import { createPrismaFamilyAccess } from './infrastructure/family-access'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Family access and invitations', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
  })
  const app = createApp({ env, prisma })

  async function clearFixtures() {
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
  }

  beforeEach(clearFixtures)

  afterAll(async () => {
    await clearFixtures()
    await prisma.$disconnect()
  })

  test('isolates two families, ignores global admin, and applies revocation to a live session', async () => {
    const ownerA = await admittedUser('Owner A', '11001')
    const ownerB = await admittedUser('Owner B', '11002', 'admin')
    const viewer = await admittedUser('Viewer', '11003')
    const familyA = await createFamily(ownerA.token, 'Семья A')
    const familyB = await createFamily(ownerB.token, 'Семья B')

    expect(familyA.response.status).toBe(201)
    expect(familyB.response.status).toBe(201)
    expect((await getFamily(familyA.body.family.id, ownerB.token)).status).toBe(404)

    const invite = await jsonRequest(
      `/api/v1/families/${familyA.body.family.id}/invites`,
      ownerA.token,
      'POST',
      { role: 'viewer' },
    )
    expect(invite.response.status).toBe(201)
    expect(invite.body.rawToken).toHaveLength(32)

    const accepted = await jsonRequest('/api/v1/invites/accept', viewer.token, 'POST', {
      token: invite.body.rawToken,
    })
    expect(accepted.response.status).toBe(200)
    expect(accepted.body.membership.role).toBe('viewer')
    const me = await app.request('/api/v1/me', { headers: authHeaders(viewer.token) })
    expect(me.status).toBe(200)
    expect((await me.json()).activeFamily).toMatchObject({
      id: familyA.body.family.id,
      role: 'viewer',
      isOwner: false,
    })

    const access = createPrismaFamilyAccess(prisma)
    await expect(access.requireFull({
      principal: { userId: viewer.userId, sessionId: viewer.sessionId },
      familyId: familyA.body.family.id,
    })).rejects.toMatchObject({ kind: 'forbidden' })

    const ownerRemoval = await app.request(
      `/api/v1/families/${familyA.body.family.id}/members/${ownerA.userId}`,
      { method: 'DELETE', headers: authHeaders(ownerA.token) },
    )
    expect(ownerRemoval.status).toBe(409)
    const ownerDemotion = await jsonRequest(
      `/api/v1/families/${familyA.body.family.id}/members/${ownerA.userId}`,
      ownerA.token,
      'PATCH',
      { role: 'viewer' },
    )
    expect(ownerDemotion.response.status).toBe(409)

    const revokeViewer = await app.request(
      `/api/v1/families/${familyA.body.family.id}/members/${viewer.userId}`,
      { method: 'DELETE', headers: authHeaders(ownerA.token) },
    )
    expect(revokeViewer.status).toBe(204)
    expect((await app.request(
      `/api/v1/families/${familyA.body.family.id}/members/${viewer.userId}`,
      { method: 'DELETE', headers: authHeaders(ownerA.token) },
    )).status).toBe(204)
    expect((await getFamily(familyA.body.family.id, viewer.token)).status).toBe(404)
  })

  test('consumes an invite atomically and keeps same-user retry idempotent', async () => {
    const owner = await admittedUser('Owner', '12001')
    const first = await admittedUser('First', '12002')
    const second = await admittedUser('Second', '12003')
    const family = await createFamily(owner.token, 'Семья')
    const invite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`,
      owner.token,
      'POST',
      {},
    )

    const attempts = await Promise.all([
      jsonRequest('/api/v1/invites/accept', first.token, 'POST', { token: invite.body.rawToken }),
      jsonRequest('/api/v1/invites/accept', second.token, 'POST', { token: invite.body.rawToken }),
    ])
    expect(attempts.map(({ response }) => response.status).sort()).toEqual([200, 409])

    const winner = attempts.find(({ response }) => response.status === 200)!
    const winnerToken = winner === attempts[0] ? first.token : second.token
    const repeated = await jsonRequest('/api/v1/invites/accept', winnerToken, 'POST', {
      token: invite.body.rawToken,
    })
    expect(repeated.response.status).toBe(200)
    expect(await prisma.familyMember.count({ where: { familyId: family.body.family.id } })).toBe(2)
  })

  test('keeps one active family when one user accepts two invitations concurrently', async () => {
    const ownerA = await admittedUser('Owner A', '12501')
    const ownerB = await admittedUser('Owner B', '12502')
    const joiningUser = await admittedUser('Joining user', '12503')
    const familyA = await createFamily(ownerA.token, 'Семья A')
    const familyB = await createFamily(ownerB.token, 'Семья B')
    const inviteA = await jsonRequest(
      `/api/v1/families/${familyA.body.family.id}/invites`, ownerA.token, 'POST', {},
    )
    const inviteB = await jsonRequest(
      `/api/v1/families/${familyB.body.family.id}/invites`, ownerB.token, 'POST', {},
    )

    const attempts = await Promise.all([
      jsonRequest('/api/v1/invites/accept', joiningUser.token, 'POST', {
        token: inviteA.body.rawToken,
      }),
      jsonRequest('/api/v1/invites/accept', joiningUser.token, 'POST', {
        token: inviteB.body.rawToken,
      }),
    ])

    expect(attempts.map(({ response }) => response.status).sort()).toEqual([200, 409])
    expect(attempts.find(({ response }) => response.status === 409)?.body.error.code)
      .toBe('ALREADY_IN_FAMILY')
    expect(await prisma.familyMember.count({
      where: { userId: joiningUser.userId, revokedAt: null },
    })).toBe(1)
  })

  test('enforces pilot admission and distinguishes revoked from expired invitations', async () => {
    const outsider = await admittedUser('Not admitted', '13001', 'user', false)
    const denied = await createFamily(outsider.token, 'Недоступная семья')
    expect(denied.response.status).toBe(403)
    expect(denied.body.error.code).toBe('ROLE_FORBIDDEN')

    const owner = await admittedUser('Owner', '13002')
    const family = await createFamily(owner.token, 'Семья')
    const revoked = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', {},
    )
    const stored = await prisma.familyInvite.findUniqueOrThrow({ where: { id: revoked.body.id } })
    expect(stored.tokenHash).not.toBe(revoked.body.rawToken)
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(72 * 60 * 60 * 1000)

    expect((await app.request(
      `/api/v1/families/${family.body.family.id}/invites/${revoked.body.id}`,
      { method: 'DELETE', headers: authHeaders(owner.token) },
    )).status).toBe(204)
    expect((await app.request(
      `/api/v1/families/${family.body.family.id}/invites/${revoked.body.id}`,
      { method: 'DELETE', headers: authHeaders(owner.token) },
    )).status).toBe(204)
    const revokedPreview = await jsonRequest('/api/v1/invites/preview', outsider.token, 'POST', {
      token: revoked.body.rawToken,
    })
    expect(revokedPreview.response.status).toBe(410)
    expect(revokedPreview.body.error.code).toBe('INVITE_REVOKED')

    const expired = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', {},
    )
    await prisma.familyInvite.update({
      where: { id: expired.body.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const expiredPreview = await jsonRequest('/api/v1/invites/preview', outsider.token, 'POST', {
      token: expired.body.rawToken,
    })
    expect(expiredPreview.response.status).toBe(410)
    expect(expiredPreview.body.error.code).toBe('INVITE_EXPIRED')
  })

  async function admittedUser(
    displayName: string,
    subject: string,
    role: 'user' | 'admin' = 'user',
    admitted = true,
  ) {
    const user = await prisma.user.create({ data: { email: null, displayName, role } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
    if (admitted) await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: `hash-${subject}`,
        refreshTokenFamilyHash: `family-${subject}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    return {
      userId: user.id,
      sessionId: session.id,
      token: await signAccessToken({ sub: user.id, sessionId: session.id }, env),
    }
  }

  async function createFamily(token: string, name: string) {
    return jsonRequest('/api/v1/families', token, 'POST', {
      name,
      timezone: 'Europe/Moscow',
      child: { displayName: 'Ребёнок' },
    })
  }

  function getFamily(familyId: string, token: string) {
    return app.request(`/api/v1/families/${familyId}`, { headers: authHeaders(token) })
  }

  async function jsonRequest(path: string, token: string, method: string, body: unknown) {
    const response = await app.request(path, {
      method,
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { response, body: await response.json() as any }
  }

  function authHeaders(token: string) {
    return { Authorization: `Bearer ${token}` }
  }
})
