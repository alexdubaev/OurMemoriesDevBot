import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { signAccessToken } from '../auth'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Block 01 independent review boundaries', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
  })
  const app = createApp({ env, prisma })

  beforeEach(clearFixtures)
  afterAll(async () => {
    await clearFixtures()
    await prisma.$disconnect()
  })

  test('scopes family, child, member, and invite mutations while enforcing the role matrix', async () => {
    const owner = await admittedUser('Owner', '21001')
    const adminOutsider = await admittedUser('Admin outsider', '21002', 'admin')
    const full = await admittedUser('Full', '21003')
    const viewer = await admittedUser('Viewer', '21004')
    const family = await createFamily(owner, 'Семья A')
    expect(family.response.status).toBe(201)
    await createFamily(adminOutsider, 'Семья B')
    const fullInvite = await createInvite(owner, family.body.family.id, 'full')
    const viewerInvite = await createInvite(owner, family.body.family.id, 'viewer')
    await jsonRequest('/api/v1/invites/accept', full.token, 'POST', { token: fullInvite.body.rawToken })
    await jsonRequest('/api/v1/invites/accept', viewer.token, 'POST', { token: viewerInvite.body.rawToken })

    const ownerUpdate = await patchFamily(owner.token, family.body.family.id, {
      name: 'Обновлённая семья',
      timezone: 'Asia/Yekaterinburg',
      child: { displayName: 'Маша', birthDate: null },
    })
    expect(ownerUpdate.response.status).toBe(200)
    expect(ownerUpdate.body).toMatchObject({
      family: { name: 'Обновлённая семья', timezone: 'Asia/Yekaterinburg' },
      child: { name: 'Маша', birthDate: null },
    })

    expect((await patchFamily(full.token, family.body.family.id, { name: 'Нет' })).response.status)
      .toBe(403)
    expect((await patchFamily(viewer.token, family.body.family.id, { name: 'Нет' })).response.status)
      .toBe(403)
    expect((await patchFamily(adminOutsider.token, family.body.family.id, { name: 'Нет' })).response.status)
      .toBe(404)

    const foreignRead = await app.request(`/api/v1/families/${family.body.family.id}`, {
      headers: authHeaders(adminOutsider.token),
    })
    expect(foreignRead.status).toBe(404)
    expect((await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      adminOutsider.token,
      'PATCH',
      { role: 'full' },
    )).response.status).toBe(404)
    expect((await app.request(
      `/api/v1/families/${family.body.family.id}/invites/${viewerInvite.body.id}`,
      { method: 'DELETE', headers: authHeaders(adminOutsider.token) },
    )).status).toBe(404)

    expect((await createInvite(full, family.body.family.id, 'viewer')).response.status).toBe(201)
    expect((await createInvite(viewer, family.body.family.id, 'viewer')).response.status).toBe(403)
    expect((await createInvite(adminOutsider, family.body.family.id, 'viewer')).response.status)
      .toBe(404)
    expect((await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      owner.token,
      'PATCH',
      { role: 'full' },
    )).response.status).toBe(200)
  })

  test('replays family and invite creation atomically and rejects changed payloads', async () => {
    const owner = await admittedUser('Owner', '22001')
    const missingKey = await jsonRequest('/api/v1/families', owner.token, 'POST', {
      name: 'Без ключа',
      timezone: 'Europe/Moscow',
    })
    expect(missingKey.response.status).toBe(422)
    expect(missingKey.body.error).toMatchObject({
      code: 'INVALID_INPUT',
      fieldErrors: { 'idempotency-key': 'Некорректное значение' },
    })
    const familyKey = randomUUID()
    const familyAttempts = await Promise.all([
      createFamily(owner, 'Идемпотентная семья', familyKey),
      createFamily(owner, 'Идемпотентная семья', familyKey),
    ])
    expect(familyAttempts.map(({ response }) => response.status)).toEqual([201, 201])
    expect(familyAttempts[0]!.body.family.id).toBe(familyAttempts[1]!.body.family.id)
    expect(await prisma.family.count()).toBe(1)
    const familyRecord = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { operation: 'family.create', key: familyKey },
    })
    expect(familyRecord.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(familyRecord.expiresAt.getTime() - familyRecord.createdAt.getTime())
      .toBe(24 * 60 * 60 * 1000)

    const originalFamilyResponse = familyAttempts[0]!.body
    expect(familyRecord.responseSnapshot).toEqual(originalFamilyResponse)
    const patchedFamily = await patchFamily(
      owner.token,
      originalFamilyResponse.family.id,
      { name: 'Имя после создания', child: { displayName: 'Ребёнок после создания' } },
    )
    expect(patchedFamily.response.status).toBe(200)
    expect(patchedFamily.body).not.toEqual(originalFamilyResponse)

    const replayAfterPatch = await createFamily(owner, 'Идемпотентная семья', familyKey)
    expect(replayAfterPatch.response.status).toBe(201)
    expect(replayAfterPatch.body).toEqual(originalFamilyResponse)

    const changedFamily = await createFamily(owner, 'Другое имя', familyKey)
    expect(changedFamily.response.status).toBe(409)
    expect(changedFamily.body.error.code).toBe('IDEMPOTENCY_CONFLICT')

    const inviteKey = randomUUID()
    const inviteAttempts = await Promise.all([
      createInvite(owner, familyAttempts[0]!.body.family.id, 'viewer', inviteKey),
      createInvite(owner, familyAttempts[0]!.body.family.id, 'viewer', inviteKey),
    ])
    expect(inviteAttempts.map(({ response }) => response.status)).toEqual([201, 201])
    expect(inviteAttempts[0]!.body).toEqual(inviteAttempts[1]!.body)
    expect(await prisma.familyInvite.count()).toBe(1)
    const inviteRecord = await prisma.idempotencyRecord.findFirstOrThrow({
      where: {
        operation: `family.invite.create:${familyAttempts[0]!.body.family.id}`,
        key: inviteKey,
      },
    })
    expect(inviteRecord.responseSnapshot).toEqual({
      id: inviteAttempts[0]!.body.id,
      role: inviteAttempts[0]!.body.role,
      inviteeDisplayName: null,
      expiresAt: inviteAttempts[0]!.body.expiresAt,
    })
    expect(JSON.stringify(inviteRecord.responseSnapshot))
      .not.toContain(inviteAttempts[0]!.body.rawToken)
    const storedInvite = await prisma.familyInvite.findUniqueOrThrow({
      where: { id: inviteAttempts[0]!.body.id },
    })
    expect(storedInvite.tokenHash).not.toBe(inviteAttempts[0]!.body.rawToken)

    const changedInvite = await createInvite(
      owner,
      familyAttempts[0]!.body.family.id,
      'full',
      inviteKey,
    )
    expect(changedInvite.response.status).toBe(409)
    expect(changedInvite.body.error.code).toBe('IDEMPOTENCY_CONFLICT')

    await prisma.idempotencyRecord.updateMany({
      where: { operation: `family.invite.create:${familyAttempts[0]!.body.family.id}`, key: inviteKey },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const afterRetention = await createInvite(
      owner,
      familyAttempts[0]!.body.family.id,
      'viewer',
      inviteKey,
    )
    expect(afterRetention.response.status).toBe(201)
    expect(afterRetention.body.rawToken).not.toBe(inviteAttempts[0]!.body.rawToken)
    expect(await prisma.familyInvite.count()).toBe(2)
  })

  test('rejects expired, revoked, and already-used invite acceptance while preserving same-user retry', async () => {
    const owner = await admittedUser('Owner', '23001')
    const first = await admittedUser('First', '23002')
    const second = await admittedUser('Second', '23003')
    const family = await createFamily(owner, 'Семья')

    const expired = await createInvite(owner, family.body.family.id, 'viewer')
    await prisma.familyInvite.update({
      where: { id: expired.body.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const expiredAccept = await acceptInvite(first.token, expired.body.rawToken)
    expect(expiredAccept.response.status).toBe(410)
    expect(expiredAccept.body.error.code).toBe('INVITE_EXPIRED')

    const revoked = await createInvite(owner, family.body.family.id, 'viewer')
    await app.request(`/api/v1/families/${family.body.family.id}/invites/${revoked.body.id}`, {
      method: 'DELETE',
      headers: authHeaders(owner.token),
    })
    const revokedAccept = await acceptInvite(first.token, revoked.body.rawToken)
    expect(revokedAccept.response.status).toBe(410)
    expect(revokedAccept.body.error.code).toBe('INVITE_REVOKED')

    const used = await createInvite(owner, family.body.family.id, 'viewer')
    const accepted = await acceptInvite(first.token, used.body.rawToken)
    expect(accepted.response.status).toBe(200)
    const repeated = await acceptInvite(first.token, used.body.rawToken)
    expect(repeated.response.status).toBe(200)
    expect(repeated.body).toEqual(accepted.body)
    const otherUser = await acceptInvite(second.token, used.body.rawToken)
    expect(otherUser.response.status).toBe(409)
    expect(otherUser.body.error.code).toBe('INVITE_USED')
  })

  test('keeps the owner as an active full member under direct database writes', async () => {
    const owner = await admittedUser('Owner', '24001')
    const family = await createFamily(owner, 'Семья')

    expect(await rejectionMessage(prisma.$transaction(async (tx) => {
      await tx.familyMember.update({
        where: { familyId_userId: { familyId: family.body.family.id, userId: owner.userId } },
        data: { role: 'viewer' },
      })
    }))).toContain('family owner must be an active full member')

    expect(await rejectionMessage(prisma.$transaction(async (tx) => {
      await tx.familyMember.update({
        where: { familyId_userId: { familyId: family.body.family.id, userId: owner.userId } },
        data: { revokedAt: new Date() },
      })
    }))).toContain('family owner must be an active full member')
  })

  test('retires memberships and invites atomically when a family stops being active', async () => {
    const owner = await admittedUser('Owner', '25001')
    const joiningUser = await admittedUser('Joining user', '25002')
    const family = await createFamily(owner, 'Старая семья')
    const invite = await createInvite(owner, family.body.family.id, 'viewer')

    await prisma.family.update({
      where: { id: family.body.family.id },
      data: { status: 'deleting' },
    })

    expect(await prisma.familyMember.count({
      where: { familyId: family.body.family.id, revokedAt: null },
    })).toBe(0)
    expect(await prisma.familyInvite.count({
      where: { familyId: family.body.family.id, revokedAt: null },
    })).toBe(0)
    expect(await rejectionMessage(prisma.familyMember.update({
      where: { familyId_userId: { familyId: family.body.family.id, userId: owner.userId } },
      data: { revokedAt: null },
    }))).toContain('live family access requires an active family')
    expect(await rejectionMessage(prisma.familyInvite.create({
      data: {
        familyId: family.body.family.id,
        role: 'viewer',
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        createdBy: owner.userId,
      },
    }))).toContain('live family access requires an active family')
    expect((await acceptInvite(joiningUser.token, invite.body.rawToken)).response.status).toBe(410)

    const replacement = await createFamily(owner, 'Новая семья')
    expect(replacement.response.status).toBe(201)
  })

  test('serializes concurrent family creation for one admitted user', async () => {
    const owner = await admittedUser('Owner', '26001')
    const attempts = await Promise.all([
      createFamily(owner, 'Семья A'),
      createFamily(owner, 'Семья B'),
    ])

    expect(attempts.map(({ response }) => response.status).sort()).toEqual([201, 409])
    expect(await prisma.familyMember.count({
      where: { userId: owner.userId, revokedAt: null },
    })).toBe(1)
  })

  async function clearFixtures() {
    await prisma.idempotencyRecord.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
  }

  async function admittedUser(
    displayName: string,
    subject: string,
    role: 'user' | 'admin' = 'user',
  ) {
    const user = await prisma.user.create({ data: { email: null, displayName, role } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
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
      token: await signAccessToken({ sub: user.id, sessionId: session.id }, env),
    }
  }

  async function createFamily(
    user: { token: string },
    name: string,
    idempotencyKey = randomUUID(),
  ) {
    const created = await jsonRequest('/api/v1/families', user.token, 'POST', {
      name,
      timezone: 'Europe/Moscow',
    }, idempotencyKey)
    if (created.response.status === 201) {
      const child = await prisma.child.findFirst({ where: { familyId: created.body.family.id } })
      if (!child) await prisma.child.create({
        data: { familyId: created.body.family.id, displayName: 'Legacy child' },
      })
    }
    return created
  }

  function createInvite(
    user: { token: string },
    familyId: string,
    role: 'full' | 'viewer',
    idempotencyKey = randomUUID(),
  ) {
    return jsonRequest(
      `/api/v1/families/${familyId}/invites`,
      user.token,
      'POST',
      { role },
      idempotencyKey,
    )
  }

  function patchFamily(token: string, familyId: string, body: unknown) {
    return jsonRequest(`/api/v1/families/${familyId}`, token, 'PATCH', body)
  }

  function acceptInvite(token: string, rawToken: string) {
    return jsonRequest('/api/v1/invites/accept', token, 'POST', { token: rawToken })
  }

  async function jsonRequest(
    path: string,
    token: string,
    method: string,
    body: unknown,
    idempotencyKey?: string,
  ) {
    const response = await app.request(path, {
      method,
      headers: {
        ...authHeaders(token),
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    })
    return { response, body: await response.json() as any }
  }

  function authHeaders(token: string) {
    return { Authorization: `Bearer ${token}` }
  }

  async function rejectionMessage(operation: PromiseLike<unknown>) {
    try {
      await operation
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    throw new Error('Expected database operation to reject')
  }
})
