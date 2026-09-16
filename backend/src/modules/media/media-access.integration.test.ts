import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { createPrivateStorage } from '../../storage'
import { runBackgroundJob } from '../../jobs'
import { pngFixture } from '../../storage/storage-contract'
import { signAccessToken } from '../auth'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Private media API', () => {
  const storageRoot = resolve('.test-media-storage')
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '10000',
    PRIVATE_STORAGE_DRIVER: 'filesystem',
    PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
    PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '100000000',
    MEDIA_FAMILY_QUOTA_BYTES: '150',
  })
  const privateStorage = createPrivateStorage(env)
  const app = createApp({ env, prisma, privateStorage })

  beforeEach(async () => {
    await clearFixtures()
    await rm(storageRoot, { recursive: true, force: true })
    await mkdir(storageRoot, { recursive: true })
  })

  afterAll(async () => {
    await clearFixtures()
    await prisma.$disconnect()
    await rm(storageRoot, { recursive: true, force: true })
  })

  test('full uploads a photo and published members receive private HEAD and single-range bytes', async () => {
    const owner = await admittedUser('Владелец', '43001')
    const viewer = await admittedUser('Зритель', '43002')
    const outsider = await admittedUser('Чужой', '43003')
    const family = await createFamily(owner.token, 'Семья')
    const foreignFamily = await createFamily(outsider.token, 'Другая семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    const viewerMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: viewer.userId } },
    })

    const uploaded = await uploadPhoto(owner.token, family.body.family.id, 'memory', pngFixture)
    expect(uploaded.finalized.response.status).toBe(200)
    expect(uploaded.finalized.body.asset).toMatchObject({
      id: uploaded.reserved.body.assetId,
      purpose: 'memory',
      kind: 'photo',
      originalStatus: 'stored',
      renditionStatus: 'ready',
    })

    const memory = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
        kind: 'photo', childId: family.body.child.id, body: '',
        occurredAt: new Date(Date.now() - 30_000).toISOString(),
        mediaIds: [uploaded.reserved.body.assetId],
      }, randomUUID(),
    )
    expect(memory.response.status).toBe(201)
    expect(memory.body.attachments).toHaveLength(1)

    const contentPath = `/api/v1/families/${family.body.family.id}/media/${uploaded.reserved.body.assetId}/content?variant=original`
    const head = await app.request(contentPath, {
      method: 'HEAD', headers: { Authorization: `Bearer ${viewer.token}` },
    })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(pngFixture.byteLength))
    expect(head.headers.get('cache-control')).toBe('private, no-store')
    expect(head.headers.get('referrer-policy')).toBe('no-referrer')

    const partial = await app.request(contentPath, {
      headers: { Authorization: `Bearer ${viewer.token}`, Range: 'bytes=8-19' },
    })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 8-19/${pngFixture.byteLength}`)
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(pngFixture.subarray(8, 20))

    const mediaSession = await app.request(`/api/v1/families/${family.body.family.id}/media/playback-session`, {
      method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` },
    })
    expect(mediaSession.status).toBe(204)
    const mediaCookie = mediaSession.headers.get('set-cookie')?.split(';')[0]
    expect(mediaCookie).toMatch(/^our_memories_media_access=/)

    const playbackBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32])
    const playbackKey = `media-playback/${uploaded.reserved.body.assetId}`
    await privateStorage.storage.writeObject({
      key: playbackKey,
      body: new Blob([playbackBytes]).stream(),
      contentLength: playbackBytes.byteLength,
      contentType: 'audio/mp4',
    })
    await prisma.mediaVariant.create({ data: {
      familyId: family.body.family.id,
      mediaId: uploaded.reserved.body.assetId,
      variant: 'playback',
      objectKey: playbackKey,
      sha256: 'a'.repeat(64),
      byteSize: BigInt(playbackBytes.byteLength),
      mime: 'audio/mp4',
      width: null,
      height: null,
      durationMs: 1_000,
      codec: 'mp4a.40.2',
    } })
    const playbackPath = contentPath.replace('variant=original', 'variant=playback')
    const cookieHead = await app.request(playbackPath, { method: 'HEAD', headers: { Cookie: mediaCookie! } })
    expect(cookieHead.status).toBe(200)
    expect(cookieHead.headers.get('content-type')).toBe('audio/mp4')
    const playbackRange = await app.request(playbackPath, {
      headers: { Cookie: mediaCookie!, Range: 'bytes=0-1023' },
    })
    expect(playbackRange.status).toBe(206)
    expect(playbackRange.headers.get('accept-ranges')).toBe('bytes')
    expect(playbackRange.headers.get('content-range')).toBe(`bytes 0-${playbackBytes.byteLength - 1}/${playbackBytes.byteLength}`)
    expect(playbackRange.headers.get('content-type')).toBe('audio/mp4')

    const cookieRange = await app.request(contentPath, {
      headers: { Cookie: mediaCookie!, Range: 'bytes=8-19' },
    })
    expect(cookieRange.status).toBe(206)
    expect(cookieRange.headers.get('accept-ranges')).toBe('bytes')
    expect(cookieRange.headers.get('content-range')).toBe(`bytes 8-19/${pngFixture.byteLength}`)
    expect(cookieRange.headers.get('content-length')).toBe('12')
    expect(cookieRange.headers.get('content-type')).toBe('image/png')
    expect((await app.request(contentPath, { headers: { Range: 'bytes=0-3' } })).status).toBe(401)
    expect((await app.request(`/api/v1/families/${family.body.family.id}`)).status).toBe(401)
    expect((await app.request(playbackPath, {
      headers: { Cookie: await expiredCookie(viewer.userId, viewer.sessionId) },
    })).status).toBe(401)

    expect((await app.request(contentPath, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    })).status).toBe(404)
    expect((await app.request(contentPath.replace(family.body.family.id, foreignFamily.body.family.id), {
      headers: { Cookie: mediaCookie! },
    })).status).toBe(404)
    for (const request of [
      app.request(contentPath.replace('variant=original', 'variant=preview'), { method: 'HEAD', headers: { Authorization: `Bearer ${outsider.token}` } }),
      app.request(contentPath, { headers: { Authorization: `Bearer ${outsider.token}`, Range: 'bytes=0-3' } }),
    ]) expect((await request).status).toBe(404)
    const unsatisfiable = await app.request(contentPath, {
      headers: { Authorization: `Bearer ${viewer.token}`, Range: 'bytes=999-' },
    })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe(`bytes */${pngFixture.byteLength}`)

    const revoked = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: viewerMembership.version },
    )
    expect(revoked.response.status).toBe(204)
    expect((await app.request(contentPath, { headers: { Cookie: mediaCookie! } })).status).toBe(404)

    const deleted = await app.request(`/api/v1/families/${family.body.family.id}/memories/${memory.body.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}`, 'If-Match': String(memory.body.version) },
    })
    expect(deleted.status).toBe(204)
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: `media-delete:${uploaded.reserved.body.assetId}` } })).toBe(1)
    expect((await app.request(contentPath, { headers: { Cookie: mediaCookie! } })).status).toBe(404)
  })

  test('serializes quota reservations and viewers cannot reserve uploads', async () => {
    const owner = await admittedUser('Владелец', '43101')
    const viewer = await admittedUser('Зритель', '43102')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    const input = { purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: 100 }

    const attempts = await Promise.all([
      jsonRequest(`/api/v1/families/${family.body.family.id}/uploads`, owner.token, 'POST', input),
      jsonRequest(`/api/v1/families/${family.body.family.id}/uploads`, owner.token, 'POST', input),
    ])
    expect(attempts.map(({ response }) => response.status).sort()).toEqual([201, 413])
    expect((await prisma.family.findUniqueOrThrow({ where: { id: family.body.family.id } })).storageReservedBytes)
      .toBe(100n)

    const denied = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads`, viewer.token, 'POST', input,
    )
    expect(denied.response.status).toBe(403)
  })

  test('revocation after ticket issuance blocks finalize and durably schedules cleanup', async () => {
    const owner = await admittedUser('Владелец', '43201')
    const member = await admittedUser('Участник', '43202')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, member.token, family.body.family.id, 'full')
    const membership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: member.userId } },
    })
    const upload = await reserveAndPut(member.token, family.body.family.id, 'memory', pngFixture)

    const revoked = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: membership.version },
    )
    expect(revoked.response.status).toBe(204)
    const finalized = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads/${upload.reserved.body.upload.uploadId}/finalize`,
      member.token, 'POST', {},
    )
    expect(finalized.response.status).toBe(403)
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(1)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: upload.reserved.body.assetId } })).deletedAt)
      .not.toBeNull()
  })

  test('revocation cannot turn an already finalized asset into a deletion', async () => {
    const owner = await admittedUser('Владелец', '43211')
    const member = await admittedUser('Участник', '43212')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, member.token, family.body.family.id, 'full')
    const membership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: member.userId } },
    })
    const uploaded = await uploadPhoto(member.token, family.body.family.id, 'memory', pngFixture)
    await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: membership.version },
    )
    const repeated = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads/${uploaded.reserved.body.upload.uploadId}/finalize`, member.token, 'POST', {},
    )
    expect(repeated.response.status).toBe(403)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: uploaded.reserved.body.assetId } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: `media-delete:${uploaded.reserved.body.assetId}` } })).toBe(0)
  })

  test('retires finalized media that was never attached after the grace period', async () => {
    const owner = await admittedUser('Владелец', '43221')
    const family = await createFamily(owner.token, 'Семья')
    const uploaded = await uploadPhoto(owner.token, family.body.family.id, 'memory', pngFixture)
    await prisma.mediaAsset.update({ where: { id: uploaded.reserved.body.assetId }, data: { createdAt: new Date('2026-09-01T00:00:00Z') } })
    await runBackgroundJob('media:pending:cleanup', { prisma } as any, new Date('2026-09-10T00:00:00Z'))
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: uploaded.reserved.body.assetId } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: `media-delete:${uploaded.reserved.body.assetId}` } })).toBe(1)
  })

  test('rejects spoofed image bytes and keeps the cleanup key durable', async () => {
    const owner = await admittedUser('Владелец', '43301')
    const family = await createFamily(owner.token, 'Семья')
    const fake = Buffer.alloc(80, 0x20)
    fake.write('<!doctype html><script>')
    const upload = await reserveAndPut(owner.token, family.body.family.id, 'memory', fake)

    const finalized = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads/${upload.reserved.body.upload.uploadId}/finalize`,
      owner.token, 'POST', {},
    )
    expect(finalized.response.status).toBe(415)
    expect(await prisma.taskOutbox.count({
      where: { type: 'media:delete', dedupeKey: `media-delete:${upload.reserved.body.assetId}` },
    })).toBe(1)
  })

  test('child avatar assets share the lifecycle but cannot be published as MemoryMedia', async () => {
    const owner = await admittedUser('Владелец', '43401')
    const viewer = await admittedUser('Зритель', '43402')
    const full = await admittedUser('Полный доступ', '43403')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    await inviteMember(owner.token, full.token, family.body.family.id, 'full')
    expect((await jsonRequest(`/api/v1/families/${family.body.family.id}/uploads`, full.token, 'POST', {
      purpose: 'child_avatar', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
    })).response.status).toBe(403)
    const uploaded = await uploadPhoto(owner.token, family.body.family.id, 'child_avatar', pngFixture)
    expect(uploaded.finalized.response.status).toBe(200)

    const memory = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
        kind: 'photo', childId: family.body.child.id, body: '',
        occurredAt: new Date(Date.now() - 30_000).toISOString(),
        mediaIds: [uploaded.reserved.body.assetId],
      }, randomUUID(),
    )
    expect(memory.response.status).toBe(409)

    const completed = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/child`, owner.token, 'PUT', {
        name: 'Ребёнок', birthDate: '2024-02-29', sex: 'girl',
        avatarMediaId: uploaded.reserved.body.assetId,
        avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
        expectedVersion: (await prisma.child.findUniqueOrThrow({
          where: { id: family.body.child.id },
        })).version,
      },
    )
    expect(completed.response.status).toBe(200)
    const avatar = await app.request(
      `/api/v1/families/${family.body.family.id}/media/${uploaded.reserved.body.assetId}/content?variant=display`,
      { headers: { Authorization: `Bearer ${viewer.token}` } },
    )
    expect(avatar.status).toBe(200)
    expect(avatar.headers.get('content-type')).toBe('image/webp')
  })

  async function uploadPhoto(token: string, familyId: string, purpose: 'memory' | 'child_avatar', bytes: Uint8Array) {
    const upload = await reserveAndPut(token, familyId, purpose, bytes)
    const finalized = await jsonRequest(
      `/api/v1/families/${familyId}/uploads/${upload.reserved.body.upload.uploadId}/finalize`,
      token, 'POST', {},
    )
    return { ...upload, finalized }
  }

  async function reserveAndPut(token: string, familyId: string, purpose: 'memory' | 'child_avatar', bytes: Uint8Array) {
    const reserved = await jsonRequest(`/api/v1/families/${familyId}/uploads`, token, 'POST', {
      purpose, kind: 'photo', contentType: 'image/png', byteSize: bytes.byteLength,
    })
    expect(reserved.response.status).toBe(201)
    const stored = await app.request(reserved.body.upload.url, {
      method: 'PUT', headers: reserved.body.upload.headers, body: bytes as unknown as BodyInit,
    })
    expect(stored.status).toBe(200)
    return { reserved, stored }
  }

  async function clearFixtures() {
    await prisma.idempotencyRecord.deleteMany()
    await prisma.memoryLike.deleteMany()
    await prisma.memoryMedia.deleteMany()
    await prisma.memory.deleteMany()
    await prisma.child.updateMany({ data: { avatarMediaId: null } })
    await prisma.mediaVariant.deleteMany()
    await prisma.uploadReservation.deleteMany()
    await prisma.mediaAsset.deleteMany()
    await prisma.taskOutbox.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
  }

  async function admittedUser(displayName: string, subject: string) {
    const user = await prisma.user.create({ data: { email: null, displayName } })
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
    const session = await prisma.authSession.create({
      data: {
        userId: user.id, externalIdentityId: identity.id, refreshTokenHash: `hash-${subject}`,
        refreshTokenFamilyHash: `family-${subject}`, expiresAt: new Date(Date.now() + 60_000),
      },
    })
    return { userId: user.id, sessionId: session.id, token: await signAccessToken({ sub: user.id, sessionId: session.id }, env) }
  }

  async function expiredCookie(userId: string, sessionId: string) {
    const token = await new SignJWT({ sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(0)
      .sign(new TextEncoder().encode(env.JWT_SECRET))
    return `${'our_memories_media_access'}=${token}`
  }

  async function createFamily(token: string, name: string) {
    const created = await jsonRequest('/api/v1/families', token, 'POST', {
      name, timezone: 'Europe/Moscow',
    }, randomUUID())
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
      const child = await prisma.child.create({
        data: { familyId: created.body.family.id, displayName: 'Test child', birthDate: new Date('2024-01-01T00:00:00.000Z'), sex: 'girl', avatarMediaId: avatar.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 } },
      })
      created.body.child = { id: child.id }
    }
    return created
  }

  async function inviteMember(ownerToken: string, memberToken: string, familyId: string, role: 'full' | 'viewer') {
    const invite = await jsonRequest(
      `/api/v1/families/${familyId}/invites`, ownerToken, 'POST', { role }, randomUUID(),
    )
    await jsonRequest('/api/v1/invites/accept', memberToken, 'POST', { token: invite.body.rawToken })
  }

  async function jsonRequest(
    path: string, token: string, method: string, body?: unknown, idempotencyKey?: string,
  ) {
    const response = await app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) as any : undefined }
  }
})
