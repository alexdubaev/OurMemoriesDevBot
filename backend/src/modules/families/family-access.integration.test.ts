import { randomUUID } from 'node:crypto'

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
    // This suite intentionally exercises many state transitions through one in-memory app.
    // Its fixture reset cannot reset that app's process-local rate-limit counter.
    AUTH_RATE_LIMIT_MAX: '10000',
  })
  const app = createApp({ env, prisma })

  async function clearFixtures() {
    await prisma.taskOutbox.deleteMany()
    await prisma.idempotencyRecord.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.mediaVariant.deleteMany()
    await prisma.uploadReservation.deleteMany()
    await prisma.mediaAsset.deleteMany()
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
    expect(ownerDemotion.response.status).toBe(403)

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

  test('creates one bootstrap family and lets only its owner complete a child with a ready private avatar', async () => {
    const owner = await admittedUser('Owner', '10001')
    const full = await admittedUser('Full', '10002')
    const created = await jsonRequest('/api/v1/families', owner.token, 'POST', {
      name: 'Наша семья', timezone: 'Europe/Moscow',
    })
    expect(created.response.status).toBe(201)
    expect(created.body.child).toBeNull()
    expect((await jsonRequest(
      `/api/v1/families/${created.body.family.id}/invites`, owner.token, 'POST', {},
    )).response.status).toBe(409)

    await prisma.familyMember.create({
      data: { familyId: created.body.family.id, userId: full.userId, role: 'full' },
    })
    const avatar = await prisma.mediaAsset.create({
      data: {
        familyId: created.body.family.id,
        uploaderId: owner.userId,
        sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
        originalKey: `media-originals/${randomUUID()}`,
        declaredMime: 'image/png', verifiedMime: 'image/png', sha256: 'a'.repeat(64),
        byteSize: 12n, width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready',
      },
    })
    const profile = {
      name: ' Маша ', birthDate: '2024-02-29', sex: 'girl', avatarMediaId: avatar.id,
      avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    }
    const completed = await jsonRequest(
      `/api/v1/families/${created.body.family.id}/child`, owner.token, 'PUT', profile,
    )
    expect(completed.response.status).toBe(200)
    expect(completed.body.child).toMatchObject({
      name: 'Маша', birthDate: '2024-02-29', sex: 'girl', avatarMediaId: avatar.id, isComplete: true,
    })
    expect(await prisma.child.count({ where: { familyId: created.body.family.id } })).toBe(1)
    expect((await jsonRequest(
      `/api/v1/families/${created.body.family.id}/child`, full.token, 'PUT', profile,
    )).response.status).toBe(403)

    const memoryAsset = await prisma.mediaAsset.create({
      data: {
        familyId: created.body.family.id, uploaderId: owner.userId,
        sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
        originalKey: `media-originals/${randomUUID()}`,
        declaredMime: 'image/png', verifiedMime: 'image/png', sha256: 'b'.repeat(64),
        byteSize: 12n, width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready',
      },
    })
    const rejectedReplacement = await jsonRequest(
      `/api/v1/families/${created.body.family.id}/child`, owner.token, 'PUT', {
        ...profile, avatarMediaId: memoryAsset.id,
      },
    )
    expect(rejectedReplacement.response.status).toBe(409)
    expect((await getFamily(created.body.family.id, owner.token)).status).toBe(200)

    const replacement = await prisma.mediaAsset.create({
      data: {
        familyId: created.body.family.id, uploaderId: owner.userId,
        sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
        originalKey: `media-originals/${randomUUID()}`,
        declaredMime: 'image/png', verifiedMime: 'image/png', sha256: 'c'.repeat(64),
        byteSize: 12n, width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready',
      },
    })
    const replaced = await jsonRequest(
      `/api/v1/families/${created.body.family.id}/child`, owner.token, 'PUT', {
        ...profile, avatarMediaId: replacement.id,
      },
    )
    expect(replaced.response.status).toBe(200)
    expect(replaced.body.child.avatarMediaId).toBe(replacement.id)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: avatar.id } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(1)
  })

  test('lets full issue an aliased invite without granting owner-only member management', async () => {
    const owner = await admittedUser('Owner', '12101')
    const full = await admittedUser('Full', '12102')
    const viewer = await admittedUser('Viewer', '12103')
    const family = await createFamily(owner.token, 'Семья')
    const fullInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`,
      owner.token,
      'POST',
      { role: 'full' },
    )
    await jsonRequest('/api/v1/invites/accept', full.token, 'POST', { token: fullInvite.body.rawToken })

    const invite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`,
      full.token,
      'POST',
      { role: 'viewer', inviteeDisplayName: 'Бабушка Оля' },
    )
    expect(invite.response.status).toBe(201)

    const accepted = await jsonRequest('/api/v1/invites/accept', viewer.token, 'POST', {
      token: invite.body.rawToken,
    })
    expect(accepted.response.status).toBe(200)
    expect(accepted.body.membership).toMatchObject({
      role: 'viewer',
      familyDisplayName: 'Бабушка Оля',
    })

    const roleChange = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      full.token,
      'PATCH',
      { role: 'full' },
    )
    expect(roleChange.response.status).toBe(403)
  })

  test('lets full change only a non-owner family alias', async () => {
    const owner = await admittedUser('Owner', '12201')
    const full = await admittedUser('Full', '12202')
    const viewer = await admittedUser('Viewer', '12203')
    const family = await createFamily(owner.token, 'Семья')
    const fullInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'full' },
    )
    const viewerInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'viewer' },
    )
    await jsonRequest('/api/v1/invites/accept', full.token, 'POST', { token: fullInvite.body.rawToken })
    await jsonRequest('/api/v1/invites/accept', viewer.token, 'POST', { token: viewerInvite.body.rawToken })

    const renamed = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      full.token,
      'PATCH',
      { familyDisplayName: 'Бабушка Оля' },
    )
    expect(renamed.response.status).toBe(200)
    expect(renamed.body.membership).toMatchObject({
      userId: viewer.userId,
      familyDisplayName: 'Бабушка Оля',
      role: 'viewer',
    })
    expect((await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      full.token,
      'PATCH',
      { role: 'full' },
    )).response.status).toBe(403)
    expect((await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${owner.userId}`,
      full.token,
      'PATCH',
      { familyDisplayName: 'Нельзя' },
    )).response.status).toBe(403)
  })

  test('lets full revoke only its own pending invitation', async () => {
    const owner = await admittedUser('Owner', '12301')
    const full = await admittedUser('Full', '12302')
    const family = await createFamily(owner.token, 'Семья')
    const fullInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'full' },
    )
    await jsonRequest('/api/v1/invites/accept', full.token, 'POST', { token: fullInvite.body.rawToken })
    const fullPending = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, full.token, 'POST', { role: 'viewer' },
    )
    const ownerPending = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'viewer' },
    )

    const fullVisible = await app.request(
      `/api/v1/families/${family.body.family.id}/invites`, { headers: authHeaders(full.token) },
    )
    expect(fullVisible.status).toBe(200)
    expect((await fullVisible.json() as any).items.map((invite: { id: string }) => invite.id))
      .toEqual([fullPending.body.id])
    const ownerVisible = await app.request(
      `/api/v1/families/${family.body.family.id}/invites`, { headers: authHeaders(owner.token) },
    )
    expect((await ownerVisible.json() as any).items.map((invite: { id: string }) => invite.id).sort())
      .toEqual([fullPending.body.id, ownerPending.body.id].sort())

    expect((await app.request(
      `/api/v1/families/${family.body.family.id}/invites/${fullPending.body.id}`,
      { method: 'DELETE', headers: authHeaders(full.token) },
    )).status).toBe(204)
    expect((await app.request(
      `/api/v1/families/${family.body.family.id}/invites/${ownerPending.body.id}`,
      { method: 'DELETE', headers: authHeaders(full.token) },
    )).status).toBe(404)
  })

  test('invalidates a full member’s pending invitations on downgrade and removal', async () => {
    const owner = await admittedUser('Owner', '12401')
    const full = await admittedUser('Full', '12402')
    const family = await createFamily(owner.token, 'Семья')
    const membershipInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'full' },
    )
    await jsonRequest('/api/v1/invites/accept', full.token, 'POST', { token: membershipInvite.body.rawToken })

    const downgradedInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, full.token, 'POST', {},
    )
    expect((await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
      owner.token, 'PATCH', { role: 'viewer' },
    )).response.status).toBe(200)
    expect((await jsonRequest('/api/v1/invites/preview', owner.token, 'POST', {
      token: downgradedInvite.body.rawToken,
    })).response.status).toBe(410)

    await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
      owner.token, 'PATCH', { role: 'full' },
    )
    const removedInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, full.token, 'POST', {},
    )
    expect((await app.request(
      `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
      { method: 'DELETE', headers: authHeaders(owner.token) },
    )).status).toBe(204)
    expect((await jsonRequest('/api/v1/invites/preview', owner.token, 'POST', {
      token: removedInvite.body.rawToken,
    })).response.status).toBe(410)
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
    const created = await jsonRequest('/api/v1/families', token, 'POST', {
      name,
      timezone: 'Europe/Moscow',
    })
    if (created.response.status === 201) {
      const avatar = await prisma.mediaAsset.create({
        data: {
          familyId: created.body.family.id, uploaderId: created.body.family.ownerUserId,
          sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
          originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
          sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: 1n, width: 1, height: 1,
          originalStatus: 'stored', renditionStatus: 'ready',
        },
      })
      await prisma.child.create({
        data: { familyId: created.body.family.id, displayName: 'Test child', birthDate: new Date('2024-01-01T00:00:00.000Z'), sex: 'girl', avatarMediaId: avatar.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 } },
      })
    }
    return created
  }

  function getFamily(familyId: string, token: string) {
    return app.request(`/api/v1/families/${familyId}`, { headers: authHeaders(token) })
  }

  async function jsonRequest(path: string, token: string, method: string, body: unknown) {
    const needsIdempotencyKey = method === 'POST' && (
      path === '/api/v1/families' || path.endsWith('/invites')
    )
    const response = await app.request(path, {
      method,
      headers: {
        ...authHeaders(token),
        'Content-Type': 'application/json',
        ...(needsIdempotencyKey ? { 'Idempotency-Key': randomUUID() } : {}),
      },
      body: JSON.stringify(body),
    })
    return { response, body: await response.json() as any }
  }

  function authHeaders(token: string) {
    return { Authorization: `Bearer ${token}` }
  }
})
