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

  test('lists only current memberships and keeps legacy /me stable with gate off', async () => {
    const owner = await admittedUser('Owner', '190001')
    const viewer = await admittedUser('Viewer', '190002')
    const stranger = await admittedUser('Stranger', '190003')
    const family = await createFamily(owner.token, 'Семья дома')
    expect(family.response.status).toBe(201)
    await prisma.familyMember.create({ data: { familyId: family.body.family.id, userId: viewer.userId, role: 'viewer' } })

    const empty = await app.request('/api/v1/me/families', { headers: authHeaders(stranger.token) })
    expect(empty.status).toBe(200)
    expect(await empty.json()).toMatchObject({ version: 1, ownFamilyId: null, canCreateOwnFamily: true, items: [], nextCursor: null })

    const owned = await app.request('/api/v1/me/families', { headers: authHeaders(owner.token) })
    expect(owned.status).toBe(200)
    expect(await owned.json()).toMatchObject({
      version: 1, ownFamilyId: family.body.family.id, ownFamilyStatus: 'active', canCreateOwnFamily: false,
      items: [{ familyId: family.body.family.id, isOwner: true, role: 'full', setupStatus: 'ready',
        unreadCount: null, unreadState: 'not_enabled', membershipEpoch: 1 }],
    })
    const visible = await app.request('/api/v1/me/families', { headers: authHeaders(viewer.token) })
    expect((await visible.json()).items[0]).toMatchObject({
      familyId: family.body.family.id, isOwner: false, role: 'viewer',
      capabilities: { canManageMembers: false, canPublishNote: false },
    })
    const unauthenticated = await app.request('/api/v1/me/families')
    expect(unauthenticated.status).toBe(401)
    expect((await unauthenticated.json()).error.code).toBe('SESSION_REQUIRED')
    const invalidLimit = await app.request('/api/v1/me/families?limit=51', { headers: authHeaders(owner.token) })
    expect(invalidLimit.status).toBe(422)
    const invalidCursor = await app.request('/api/v1/me/families?cursor=bogus', { headers: authHeaders(owner.token) })
    expect(invalidCursor.status).toBe(422)
    const legacy = await app.request('/api/v1/me', { headers: authHeaders(viewer.token) })
    expect((await legacy.json()).activeFamily.id).toBe(family.body.family.id)
  })

  test('enforces one undeleted owned family at the database boundary', async () => {
    const owner = await admittedUser('Owner', '190004')
    const created = await createFamily(owner.token, 'First')
    expect(created.response.status).toBe(201)
    await expect(Promise.resolve(prisma.family.create({
      data: { ownerUserId: owner.userId, name: 'Second', timezone: 'Europe/Moscow' },
    }))).rejects.toThrow()
    expect(await prisma.family.count({ where: { ownerUserId: owner.userId, status: { not: 'deleted' } } })).toBe(1)
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
    const meBody = await me.json()
    expect(meBody.user).not.toHaveProperty('externalIdentity')
    expect(meBody.activeFamily).toMatchObject({
      id: familyA.body.family.id,
      role: 'viewer',
      isOwner: false,
    })

    const access = createPrismaFamilyAccess(prisma)
    await expect(access.requireFull({
      principal: { userId: viewer.userId, sessionId: viewer.sessionId },
      familyId: familyA.body.family.id,
    })).rejects.toMatchObject({ kind: 'forbidden' })

    const ownerRemoval = await jsonRequest(
      `/api/v1/families/${familyA.body.family.id}/members/${ownerA.userId}`,
      ownerA.token,
      'DELETE',
      { expectedVersion: 1 },
    )
    expect(ownerRemoval.response.status).toBe(409)
    const ownerDemotion = await jsonRequest(
      `/api/v1/families/${familyA.body.family.id}/members/${ownerA.userId}`,
      ownerA.token,
      'PATCH',
      { role: 'viewer', expectedVersion: 1 },
    )
    expect(ownerDemotion.response.status).toBe(403)

    const revokeViewer = await jsonRequest(
      `/api/v1/families/${familyA.body.family.id}/members/${viewer.userId}`,
      ownerA.token,
      'DELETE',
      { expectedVersion: accepted.body.membership.version },
    )
    expect(revokeViewer.response.status).toBe(204)
    expect((await jsonRequest(
      `/api/v1/families/${familyA.body.family.id}/members/${viewer.userId}`,
      ownerA.token,
      'DELETE',
      { expectedVersion: accepted.body.membership.version },
    )).response.status).toBe(204)
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
    const loserToken = winner === attempts[0] ? second.token : first.token
    const repeated = await jsonRequest('/api/v1/invites/accept', winnerToken, 'POST', {
      token: invite.body.rawToken,
    })
    expect(repeated.response.status).toBe(200)
    expect((await jsonRequest('/api/v1/invites/preview', winnerToken, 'POST', {
      token: invite.body.rawToken,
    })).response.status).toBe(200)
    const usedByAnotherUser = await jsonRequest('/api/v1/invites/preview', loserToken, 'POST', {
      token: invite.body.rawToken,
    })
    expect(usedByAnotherUser.response.status).toBe(409)
    expect(usedByAnotherUser.body.error.code).toBe('INVITE_USED')
    expect(await prisma.familyMember.count({ where: { familyId: family.body.family.id } })).toBe(2)
  })

  test('does not consume an unused invite when an active member opens the same family', async () => {
    const owner = await admittedUser('Owner', '12011')
    const member = await admittedUser('Member', '12012')
    const family = await createFamily(owner.token, 'Семья')
    const membershipInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', {
        role: 'viewer', inviteeDisplayName: 'Первое имя',
      },
    )
    const accepted = await jsonRequest('/api/v1/invites/accept', member.token, 'POST', {
      token: membershipInvite.body.rawToken,
    })
    expect(accepted.response.status).toBe(200)

    const unused = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', {
        role: 'full', inviteeDisplayName: 'Новое имя',
      },
    )
    const alreadyMember = await jsonRequest('/api/v1/invites/accept', member.token, 'POST', {
      token: unused.body.rawToken,
    })
    expect(alreadyMember.response.status).toBe(200)
    expect(alreadyMember.body.membership).toMatchObject({
      role: 'viewer',
      familyDisplayName: 'Первое имя',
    })
    expect(await prisma.familyInvite.findUniqueOrThrow({ where: { id: unused.body.id } }))
      .toMatchObject({ acceptedAt: null, acceptedBy: null })
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
        ...profile, avatarMediaId: memoryAsset.id, expectedVersion: completed.body.child.version,
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
        ...profile, avatarMediaId: replacement.id, expectedVersion: completed.body.child.version,
      },
    )
    expect(replaced.response.status).toBe(200)
    expect(replaced.body.child.avatarMediaId).toBe(replacement.id)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: avatar.id } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(1)
  })

  test('changes an avatar without requiring optional metadata and rejects media outside its family', async () => {
    const ownerA = await admittedUser('Avatar owner A', '10091')
    const ownerB = await admittedUser('Avatar owner B', '10092')
    const familyA = await jsonRequest('/api/v1/families', ownerA.token, 'POST', {
      name: 'Аватар семьи A', timezone: 'Europe/Moscow',
    })
    const familyB = await jsonRequest('/api/v1/families', ownerB.token, 'POST', {
      name: 'Аватар семьи B', timezone: 'Europe/Moscow',
    })

    async function createAsset(familyId: string, uploaderId: string, purpose: 'child_avatar' | 'memory') {
      return prisma.mediaAsset.create({ data: {
        familyId, uploaderId, sourceKind: 'upload', purpose, mediaKind: 'photo',
        originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
        sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: 1n, width: 1, height: 1,
        originalStatus: 'stored', renditionStatus: 'ready',
      } })
    }

    const currentAvatar = await createAsset(familyA.body.family.id, ownerA.userId, 'child_avatar')
    const replacement = await createAsset(familyA.body.family.id, ownerA.userId, 'child_avatar')
    const wrongPurpose = await createAsset(familyA.body.family.id, ownerA.userId, 'memory')
    const otherFamilyAvatar = await createAsset(familyB.body.family.id, ownerB.userId, 'child_avatar')
    const child = await prisma.child.create({ data: {
      familyId: familyA.body.family.id, displayName: 'Имя сохранено', birthDate: null, sex: null,
      avatarMediaId: currentAvatar.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    } })
    const patchPath = `/api/v1/families/${familyA.body.family.id}`
    const patchChild = (avatarMediaId: string) => jsonRequest(patchPath, ownerA.token, 'PATCH', {
      child: {
        avatarMediaId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: child.version,
      },
    })

    const crossFamily = await patchChild(otherFamilyAvatar.id)
    expect(crossFamily.response.status).toBe(409)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: currentAvatar.id } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(0)

    const wrongPurposeResult = await patchChild(wrongPurpose.id)
    expect(wrongPurposeResult.response.status).toBe(409)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: currentAvatar.id } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(0)

    const invalidCrop = await jsonRequest(patchPath, ownerA.token, 'PATCH', {
      child: {
        avatarMediaId: replacement.id, avatarCrop: { x: 0, y: 0, width: 0.5, height: 1 },
        expectedVersion: child.version,
      },
    })
    expect(invalidCrop.response.status).toBe(409)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: currentAvatar.id } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(0)

    const changed = await patchChild(replacement.id)
    expect(changed.response.status).toBe(200)
    expect(changed.body.child).toMatchObject({
      name: 'Имя сохранено', birthDate: null, sex: null, avatarMediaId: replacement.id, version: child.version + 1,
    })
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: currentAvatar.id } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(1)
  })

  test('retires only an unreferenced avatar from a stale photo-only update after a two-session conflict', async () => {
    const owner = await admittedUser('Photo conflict owner', '10093')
    const secondSessionRecord = await prisma.authSession.create({ data: {
      userId: owner.userId,
      refreshTokenHash: 'hash-photo-conflict-second-session',
      refreshTokenFamilyHash: 'family-photo-conflict-second-session',
      expiresAt: new Date(Date.now() + 60_000),
    } })
    await prisma.$executeRaw`
      UPDATE auth_sessions
         SET external_identity_id = ${owner.identityId}::uuid
       WHERE id = ${secondSessionRecord.id}::uuid
    `
    const secondSession = {
      userId: owner.userId,
      token: await signAccessToken({ sub: owner.userId, sessionId: secondSessionRecord.id }, env),
    }
    const otherMember = await admittedUser('Photo conflict other member', '10094')
    const family = await jsonRequest('/api/v1/families', owner.token, 'POST', {
      name: 'Семья конфликта фото', timezone: 'Europe/Moscow',
    })
    await prisma.familyMember.create({
      data: { familyId: family.body.family.id, userId: otherMember.userId, role: 'full' },
    })
    async function createAvatar(uploaderId: string) {
      return prisma.mediaAsset.create({ data: {
        familyId: family.body.family.id, uploaderId, sourceKind: 'upload', purpose: 'child_avatar',
        mediaKind: 'photo', originalKey: `media-originals/${randomUUID()}`,
        declaredMime: 'image/png', verifiedMime: 'image/png',
        sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: 13n, width: 1, height: 1,
        originalStatus: 'stored', renditionStatus: 'ready',
      } })
    }

    const initialAvatar = await createAvatar(owner.userId)
    const unreferencedUpload = await createAvatar(owner.userId)
    const otherUsersUpload = await createAvatar(otherMember.userId)
    const referencedUpload = await createAvatar(owner.userId)
    const child = await prisma.child.create({ data: {
      familyId: family.body.family.id, displayName: 'До конфликта', birthDate: null, sex: null,
      avatarMediaId: initialAvatar.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    } })
    const patchPath = `/api/v1/families/${family.body.family.id}`
    const replaceAvatar = (token: string, avatarMediaId: string, expectedVersion: number) =>
      jsonRequest(patchPath, token, 'PATCH', {
        child: { avatarMediaId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion },
      })

    const updatedBySecondSession = await jsonRequest(patchPath, secondSession.token, 'PATCH', {
      child: { displayName: 'Обновлено во второй сессии', expectedVersion: child.version },
    })
    expect(updatedBySecondSession.response.status).toBe(200)

    const failedCombinedUpdate = await jsonRequest(patchPath, owner.token, 'PATCH', {
      name: 'Название не должно сохраниться',
      child: {
        avatarMediaId: unreferencedUpload.id,
        avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
        expectedVersion: child.version,
      },
    })
    expect(failedCombinedUpdate.response.status).toBe(409)
    expect((await prisma.family.findUniqueOrThrow({ where: { id: family.body.family.id } })).name)
      .toBe('Семья конфликта фото')
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: unreferencedUpload.id } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(0)

    const stalePhoto = await replaceAvatar(owner.token, unreferencedUpload.id, child.version)
    expect(stalePhoto.response.status).toBe(409)
    expect(stalePhoto.body.error.code).toBe('VERSION_CONFLICT')
    expect(await prisma.child.findUniqueOrThrow({ where: { id: child.id } })).toMatchObject({
      displayName: 'Обновлено во второй сессии', avatarMediaId: initialAvatar.id, version: child.version + 1,
    })
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: unreferencedUpload.id } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({
      where: { type: 'media:delete', dedupeKey: `media-delete:${unreferencedUpload.id}` },
    })).toBe(1)

    const otherUsersStalePhoto = await replaceAvatar(owner.token, otherUsersUpload.id, child.version)
    expect(otherUsersStalePhoto.response.status).toBe(409)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: otherUsersUpload.id } })).deletedAt).toBeNull()

    const attachedBySecondSession = await replaceAvatar(secondSession.token, referencedUpload.id, child.version + 1)
    expect(attachedBySecondSession.response.status).toBe(200)
    const staleReferencedPhoto = await replaceAvatar(owner.token, referencedUpload.id, child.version)
    expect(staleReferencedPhoto.response.status).toBe(409)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: referencedUpload.id } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({
      where: { type: 'media:delete', dedupeKey: `media-delete:${referencedUpload.id}` },
    })).toBe(0)

    const racingUpload = await createAvatar(owner.userId)
    const racingExpectedVersion = child.version + 2
    const concurrentUpdates = await Promise.all([
      jsonRequest(patchPath, secondSession.token, 'PATCH', {
        child: { displayName: 'Конкурирующее изменение', expectedVersion: racingExpectedVersion },
      }),
      replaceAvatar(owner.token, racingUpload.id, racingExpectedVersion),
    ])
    expect(concurrentUpdates.map(({ response }) => response.status).sort()).toEqual([200, 409])
    const finalChild = await prisma.child.findUniqueOrThrow({ where: { id: child.id } })
    const finalRacingUpload = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: racingUpload.id } })
    if (finalChild.avatarMediaId === racingUpload.id) {
      expect(finalRacingUpload.deletedAt).toBeNull()
      expect(await prisma.taskOutbox.count({
        where: { type: 'media:delete', dedupeKey: `media-delete:${racingUpload.id}` },
      })).toBe(0)
    } else {
      expect(finalRacingUpload.deletedAt).not.toBeNull()
      expect(await prisma.taskOutbox.count({
        where: { type: 'media:delete', dedupeKey: `media-delete:${racingUpload.id}` },
      })).toBe(1)
    }
  })

  test('rejects a future child birth date using the family calendar day', async () => {
    const owner = await admittedUser('Timezone owner', '12101')
    const timezone = 'Pacific/Kiritimati'
    const created = await jsonRequest('/api/v1/families', owner.token, 'POST', {
      name: 'Timezone family', timezone,
    })
    expect(created.response.status).toBe(201)
    const avatar = await prisma.mediaAsset.create({
      data: {
        familyId: created.body.family.id,
        uploaderId: owner.userId,
        sourceKind: 'upload',
        purpose: 'child_avatar',
        mediaKind: 'photo',
        originalKey: `media-originals/${randomUUID()}`,
        declaredMime: 'image/png',
        verifiedMime: 'image/png',
        sha256: randomUUID().replaceAll('-', '').repeat(2),
        byteSize: 1n,
        width: 1,
        height: 1,
        originalStatus: 'stored',
        renditionStatus: 'ready',
      },
    })

    const response = await jsonRequest(
      `/api/v1/families/${created.body.family.id}/child`,
      owner.token,
      'PUT',
      {
        name: 'Завтра',
        birthDate: calendarDateOffset(timezone, 1),
        sex: 'girl',
        avatarMediaId: avatar.id,
        avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
        expectedVersion: null,
      },
    )
    expect(response.response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFLICT')
  })

  test('rejects a timezone change that would make the existing child birth date future', async () => {
    const owner = await admittedUser('Timezone change owner', '12102')
    const sourceTimezone = 'Pacific/Kiritimati'
    const created = await jsonRequest('/api/v1/families', owner.token, 'POST', {
      name: 'Timezone change family', timezone: sourceTimezone,
    })
    const avatar = await prisma.mediaAsset.create({
      data: {
        familyId: created.body.family.id,
        uploaderId: owner.userId,
        sourceKind: 'upload',
        purpose: 'child_avatar',
        mediaKind: 'photo',
        originalKey: `media-originals/${randomUUID()}`,
        declaredMime: 'image/png',
        verifiedMime: 'image/png',
        sha256: randomUUID().replaceAll('-', '').repeat(2),
        byteSize: 1n,
        width: 1,
        height: 1,
        originalStatus: 'stored',
        renditionStatus: 'ready',
      },
    })
    const completed = await jsonRequest(
      `/api/v1/families/${created.body.family.id}/child`,
      owner.token,
      'PUT',
      {
        name: 'Сегодня',
        birthDate: calendarDateOffset(sourceTimezone, 0),
        sex: 'girl',
        avatarMediaId: avatar.id,
        avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
        expectedVersion: null,
      },
    )
    expect(completed.response.status).toBe(200)

    const changed = await jsonRequest(
      `/api/v1/families/${created.body.family.id}`,
      owner.token,
      'PATCH',
      { timezone: 'Pacific/Honolulu' },
    )
    expect(changed.response.status).toBe(409)
    expect(changed.body.error.code).toBe('CONFLICT')
    expect((await getFamilyJson(created.body.family.id, owner.token)).body.family.timezone)
      .toBe(sourceTimezone)
  })

  test('rejects stale child writes through both child mutation paths', async () => {
    const owner = await admittedUser('Owner', '10011')
    const family = await createFamily(owner.token, 'Семья')
    const current = await getFamilyJson(family.body.family.id, owner.token)
    const child = current.body.child
    expect(child).not.toBeNull()

    const avatar = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: child.avatarMediaId } })
    const profile = {
      name: 'Лиза',
      birthDate: '2024-02-29',
      sex: 'girl',
      avatarMediaId: avatar.id,
      avatarCrop: child.avatarCrop,
      expectedVersion: child.version,
    }
    const first = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/child`, owner.token, 'PUT', profile,
    )
    expect(first.response.status).toBe(200)

    const stale = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/child`, owner.token, 'PUT', {
        ...profile,
        name: 'Старое имя',
      },
    )
    expect(stale.response.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')

    const missingVersion = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/child`, owner.token, 'PUT', {
        ...profile,
        name: 'Без версии',
        expectedVersion: null,
      },
    )
    expect(missingVersion.response.status).toBe(409)
    expect(missingVersion.body.error.code).toBe('VERSION_CONFLICT')

    const legacyFirst = await jsonRequest(
      `/api/v1/families/${family.body.family.id}`, owner.token, 'PATCH', {
        child: { displayName: 'Лиза legacy', expectedVersion: first.body.child.version },
      },
    )
    expect(legacyFirst.response.status).toBe(200)
    const legacyStale = await jsonRequest(
      `/api/v1/families/${family.body.family.id}`, owner.token, 'PATCH', {
        child: { displayName: 'Старый legacy', expectedVersion: first.body.child.version },
      },
    )
    expect(legacyStale.response.status).toBe(409)
    expect(legacyStale.body.error.code).toBe('VERSION_CONFLICT')
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
      { role: 'full', expectedVersion: accepted.body.membership.version },
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
    const viewerAccepted = await jsonRequest(
      '/api/v1/invites/accept', viewer.token, 'POST', { token: viewerInvite.body.rawToken },
    )

    const renamed = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      full.token,
      'PATCH',
      { familyDisplayName: 'Бабушка Оля', expectedVersion: viewerAccepted.body.membership.version },
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
      { role: 'full', expectedVersion: renamed.body.membership.version },
    )).response.status).toBe(403)
    expect((await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${owner.userId}`,
      full.token,
      'PATCH',
      { familyDisplayName: 'Нельзя', expectedVersion: 1 },
    )).response.status).toBe(403)
  })

  test('rejects stale member alias, role, removal, and pre-reactivation versions', async () => {
    const owner = await admittedUser('Owner', '12211')
    const member = await admittedUser('Member', '12212')
    const family = await createFamily(owner.token, 'Семья')
    const membershipInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'viewer' },
    )
    const accepted = await jsonRequest('/api/v1/invites/accept', member.token, 'POST', {
      token: membershipInvite.body.rawToken,
    })
    const originalVersion = accepted.body.membership.version

    const missingVersion = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'PATCH',
      { familyDisplayName: 'Без версии' },
    )
    expect(missingVersion.response.status).toBe(422)

    const aliased = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'PATCH',
      { familyDisplayName: 'Бабушка Оля', expectedVersion: originalVersion },
    )
    expect(aliased.response.status).toBe(200)
    const staleAlias = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'PATCH',
      { familyDisplayName: 'Старое имя', expectedVersion: originalVersion },
    )
    expect(staleAlias.response.status).toBe(409)
    expect(staleAlias.body.error.code).toBe('VERSION_CONFLICT')

    const aliasVersion = aliased.body.membership.version
    const promoted = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'PATCH',
      { role: 'full', expectedVersion: aliasVersion },
    )
    expect(promoted.response.status).toBe(200)
    const staleRole = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'PATCH',
      { role: 'viewer', expectedVersion: aliasVersion },
    )
    expect(staleRole.response.status).toBe(409)
    expect(staleRole.body.error.code).toBe('VERSION_CONFLICT')

    const removalVersion = promoted.body.membership.version
    const removed = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: removalVersion },
    )
    expect(removed.response.status).toBe(204)

    const reactivationInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'viewer' },
    )
    const reactivated = await jsonRequest('/api/v1/invites/accept', member.token, 'POST', {
      token: reactivationInvite.body.rawToken,
    })
    expect(reactivated.response.status).toBe(200)
    expect(reactivated.body.membership.version).toBeGreaterThan(removalVersion)

    const staleRemoval = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: removalVersion },
    )
    expect(staleRemoval.response.status).toBe(409)
    expect(staleRemoval.body.error.code).toBe('VERSION_CONFLICT')

    const preRemovalStale = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'PATCH',
      { familyDisplayName: 'До удаления', expectedVersion: removalVersion },
    )
    expect(preRemovalStale.response.status).toBe(409)
    expect(preRemovalStale.body.error.code).toBe('VERSION_CONFLICT')
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
    const accepted = await jsonRequest(
      '/api/v1/invites/accept', full.token, 'POST', { token: membershipInvite.body.rawToken },
    )

    const downgradedInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, full.token, 'POST', {},
    )
    const downgraded = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
      owner.token, 'PATCH', { role: 'viewer', expectedVersion: accepted.body.membership.version },
    )
    expect(downgraded.response.status).toBe(200)
    expect((await jsonRequest('/api/v1/invites/preview', owner.token, 'POST', {
      token: downgradedInvite.body.rawToken,
    })).response.status).toBe(410)

    const promoted = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
      owner.token, 'PATCH', { role: 'full', expectedVersion: downgraded.body.membership.version },
    )
    const removedInvite = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/invites`, full.token, 'POST', {},
    )
    expect((await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: promoted.body.membership.version },
    )).response.status).toBe(204)
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
    const missingPreview = await jsonRequest('/api/v1/invites/preview', outsider.token, 'POST', {
      token: 'missing-invitation-token'.padEnd(32, 'x'),
    })
    expect(missingPreview.response.status).toBe(404)
    expect(missingPreview.body.error.code).toBe('NOT_FOUND')
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

  test('admits only the provider and subject bound to the current session', async () => {
    const maxOwner = await admittedUser('MAX owner', '14001', 'user', true, 'max')
    const telegramOwner = await admittedUser('Telegram owner', '14002')
    expect((await createFamily(maxOwner.token, 'MAX family')).response.status).toBe(201)
    expect((await createFamily(telegramOwner.token, 'Telegram family')).response.status).toBe(201)

    const telegramOnly = await userWithProviderIdentities('Telegram admission only', '14003', 'max', ['telegram'])
    const telegramOnlyDenied = await createFamily(telegramOnly.token, 'MAX denied by Telegram-only admission')
    expect(telegramOnlyDenied.response.status).toBe(403)
    expect(telegramOnlyDenied.body.error.code).toBe('ROLE_FORBIDDEN')

    const maxOnly = await userWithProviderIdentities('MAX admission only', '14004', 'telegram', ['max'])
    const maxOnlyDenied = await createFamily(maxOnly.token, 'Telegram denied by MAX-only admission')
    expect(maxOnlyDenied.response.status).toBe(403)
    expect(maxOnlyDenied.body.error.code).toBe('ROLE_FORBIDDEN')

    const maxBound = await userWithProviderIdentities('MAX bound', '14005', 'max', ['telegram', 'max'])
    const telegramBound = await userWithProviderIdentities('Telegram bound', '14006', 'telegram', ['telegram', 'max'])
    expect((await createFamily(maxBound.token, 'MAX exact family')).response.status).toBe(201)
    expect((await createFamily(telegramBound.token, 'Telegram exact family')).response.status).toBe(201)
  })

  test('denies null-provenance and revoked-admission sessions without inventing a provider', async () => {
    const legacy = await admittedUser('Legacy session', '14007', 'user', true, 'telegram', false)
    const legacyDenied = await createFamily(legacy.token, 'Legacy denied')
    expect(legacyDenied.response.status).toBe(403)
    expect(legacyDenied.body.error.code).toBe('ROLE_FORBIDDEN')

    const revoked = await admittedUser('Revoked admission', '14008')
    await prisma.pilotAdmission.updateMany({
      where: { provider: 'telegram', subject: '14008' },
      data: { revokedAt: new Date() },
    })
    const revokedDenied = await createFamily(revoked.token, 'Revoked denied')
    expect(revokedDenied.response.status).toBe(403)
    expect(revokedDenied.body.error.code).toBe('ROLE_FORBIDDEN')

    const active = await admittedUser('Active admission', '14009')
    expect((await createFamily(active.token, 'Active admitted')).response.status).toBe(201)
  })

  test('rejects a session bound to an identity owned by another user', async () => {
    const foreign = await admittedUser('Foreign identity owner', '14010')
    const victim = await prisma.user.create({ data: { email: null, displayName: 'Mismatched session' } })
    const session = await prisma.authSession.create({
      data: {
        userId: victim.id,
        externalIdentityId: foreign.identityId,
        refreshTokenHash: 'hash-mismatched-14010',
        refreshTokenFamilyHash: 'family-mismatched-14010',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const token = await signAccessToken({ sub: victim.id, sessionId: session.id }, env)

    const denied = await createFamily(token, 'Mismatched identity denied')
    expect(denied.response.status).toBe(401)
    expect(denied.body.error.code).toBe('UNAUTHORIZED')
  })

  async function admittedUser(
    displayName: string,
    subject: string,
    role: 'user' | 'admin' = 'user',
    admitted = true,
    provider: 'telegram' | 'max' = 'telegram',
    bindSession = true,
  ) {
    const user = await prisma.user.create({ data: { email: null, displayName, role } })
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider, subject } })
    if (admitted) await prisma.pilotAdmission.create({ data: { provider, subject } })
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: `hash-${subject}`,
        refreshTokenFamilyHash: `family-${subject}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    if (bindSession) {
      await prisma.$executeRaw`
        UPDATE auth_sessions
           SET external_identity_id = ${identity.id}::uuid
         WHERE id = ${session.id}::uuid
      `
    }
    return {
      userId: user.id,
      sessionId: session.id,
      identityId: identity.id,
      token: await signAccessToken({ sub: user.id, sessionId: session.id }, env),
    }
  }

  async function userWithProviderIdentities(
    displayName: string,
    subject: string,
    boundProvider: 'telegram' | 'max',
    admittedProviders: Array<'telegram' | 'max'>,
  ) {
    const user = await prisma.user.create({ data: { email: null, displayName, role: 'user' } })
    const identities = await Promise.all([
      prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } }),
      prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } }),
    ])
    for (const provider of admittedProviders) {
      await prisma.pilotAdmission.create({ data: { provider, subject } })
    }
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: `hash-${boundProvider}-${subject}`,
        refreshTokenFamilyHash: `family-${boundProvider}-${subject}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    const identity = identities.find((candidate) => candidate.provider === boundProvider)!
    await prisma.$executeRaw`
      UPDATE auth_sessions
         SET external_identity_id = ${identity.id}::uuid
       WHERE id = ${session.id}::uuid
    `
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

  async function getFamilyJson(familyId: string, token: string) {
    const response = await getFamily(familyId, token)
    return { response, body: await response.json() as any }
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
    return { response, body: response.status === 204 ? null : await response.json() as any }
  }

  function authHeaders(token: string) {
    return { Authorization: `Bearer ${token}` }
  }
})

function calendarDateOffset(timezone: string, days: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  const shifted = new Date(Date.UTC(value('year'), value('month') - 1, value('day') + days))
  return shifted.toISOString().slice(0, 10)
}
