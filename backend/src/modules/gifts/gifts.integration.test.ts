import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { runBackgroundJob } from '../../jobs'
import { createPrivateStorage } from '../../storage'
import { pngFixture } from '../../storage/storage-contract'
import { signAccessToken } from '../auth'

const databaseUrl = requireIntegrationDatabaseUrl()

type User = { userId: string; token: string }
let subjectCounter = 0
const subject = () => String(47_000 + ++subjectCounter)

describe('Gift wishlist API', () => {
  const storageRoot = resolve('.test-gift-storage')
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '100000',
    PRIVATE_STORAGE_DRIVER: 'filesystem',
    PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
    PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '100000000',
    MEDIA_FAMILY_QUOTA_BYTES: '1000000000',
  })
  const app = createApp({ env, prisma, privateStorage: createPrivateStorage(env) })

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

  test('full creates, every member reads, viewer cannot edit, outsiders get 404', async () => {
    const { owner, viewer, family } = await familyWithMembers()
    const outsider = await admittedUser('Чужой', subject())
    const otherFamily = await createFamily(outsider, 'Чужая семья')

    const photoMediaId = await giftPhoto(owner, family.id)
    const created = await api(owner, 'POST', gifts(family.id), {
      title: '  Конструктор  ', url: 'https://shop.example/item/1', price: '2 500 ₽', photoMediaId,
    }, randomUUID())
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('private, no-store')
    expect(created.body.gift).toMatchObject({
      childId: family.childId, title: 'Конструктор', url: 'https://shop.example/item/1', price: '2 500 ₽',
      photoMediaId, createdBy: { userId: owner.userId, name: 'Мама' }, reservation: null, version: 1,
    })
    const giftId = created.body.gift.id

    const listed = await api(viewer, 'GET', gifts(family.id))
    expect(listed.status).toBe(200)
    expect(listed.headers.get('cache-control')).toBe('private, no-store')
    expect(listed.body.gifts.map((gift: { id: string }) => gift.id)).toEqual([giftId])

    for (const variant of ['original', 'preview', 'display'] as const) {
      const contentPath = `/api/v1/families/${family.id}/media/${photoMediaId}/content?variant=${variant}`
      const headers = { Authorization: `Bearer ${viewer.token}` }
      const content = await app.request(contentPath, { headers })
      expect(content.status).toBe(200)
      expect(content.headers.get('cache-control')).toBe('private, no-store')
      const etag = content.headers.get('etag')
      expect(etag).toBeTruthy()

      const head = await app.request(contentPath, { method: 'HEAD', headers })
      expect(head.status).toBe(200)
      expect(head.headers.get('cache-control')).toBe('private, no-store')

      const conditional = await app.request(contentPath, { headers: { ...headers, 'If-None-Match': etag! } })
      expect(conditional.status).toBe(200)
      expect(conditional.headers.get('cache-control')).toBe('private, no-store')
    }
    expect((await api(outsider, 'GET', `/api/v1/families/${family.id}/media/${photoMediaId}/content?variant=preview`)).status).toBe(404)

    const viewerUpload = await api(viewer, 'POST', `/api/v1/families/${family.id}/uploads`, {
      purpose: 'gift', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
    })
    expect(viewerUpload.status).toBe(403)

    for (const attempt of [
      await api(viewer, 'POST', gifts(family.id), { title: 'x', url: 'https://shop.example/', photoMediaId: randomUUID() }, randomUUID()),
      await api(viewer, 'PATCH', gift(family.id, giftId), { expectedVersion: 1, title: 'Другое' }),
      await api(viewer, 'DELETE', gift(family.id, giftId), undefined, undefined, { 'If-Match': '1' }),
    ]) {
      expect(attempt.status).toBe(403)
      expect(attempt.body.error.code).toBe('ROLE_FORBIDDEN')
    }

    const denied = await api(outsider, 'GET', gifts(family.id))
    expect(denied.status).toBe(404)
    expect(denied.headers.get('cache-control')).toBe('private, no-store')
    expect((await api(outsider, 'POST', reservation(family.id, giftId), { expectedVersion: 1 })).status).toBe(404)
    expect((await api(outsider, 'GET', gifts(otherFamily.id))).body.gifts).toEqual([])
    const crossFamily = await api(outsider, 'PATCH', gift(otherFamily.id, giftId), { expectedVersion: 1, title: 'Взлом' })
    expect(crossFamily.status).toBe(404)
    expect((await api(outsider, 'POST', reservation(otherFamily.id, giftId), { expectedVersion: 1 })).status).toBe(404)
  })

  test('creation validates the photo, the input and the idempotency key', async () => {
    const { owner, family } = await familyWithMembers()
    const stranger = await admittedUser('Другая мама', subject())
    const strangerFamily = await createFamily(stranger, 'Другая семья')
    const foreignPhoto = await giftPhoto(stranger, strangerFamily.id)
    const memoryPhoto = await uploadPhoto(owner, family.id, 'memory')
    const photoMediaId = await giftPhoto(owner, family.id)
    const base = { title: 'Мяч', url: 'https://shop.example/ball' }

    for (const body of [
      base,
      { ...base, photoMediaId: foreignPhoto },
      { ...base, photoMediaId: memoryPhoto },
      { ...base, photoMediaId: randomUUID() },
      { ...base, photoMediaId, url: 'javascript:alert(1)' },
      { ...base, photoMediaId, url: 'https://user:pass@shop.example/' },
      { ...base, photoMediaId, title: 'я'.repeat(121) },
      { ...base, photoMediaId, price: '1'.repeat(31) },
    ]) {
      const rejected = await api(owner, 'POST', gifts(family.id), body, randomUUID())
      expect(rejected.status).toBe(422)
      expect(rejected.body.error.code).toBe('INVALID_INPUT')
    }

    const key = randomUUID()
    const first = await api(owner, 'POST', gifts(family.id), { ...base, photoMediaId }, key)
    expect(first.status).toBe(201)
    const replay = await api(owner, 'POST', gifts(family.id), { ...base, photoMediaId }, key)
    expect(replay.status).toBe(200)
    expect(replay.body.gift.id).toBe(first.body.gift.id)
    const changed = await api(owner, 'POST', gifts(family.id), { ...base, title: 'Другой мяч', photoMediaId }, key)
    expect(changed.status).toBe(409)
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
    expect(await prisma.gift.count()).toBe(1)

    const reused = await api(owner, 'POST', gifts(family.id), { ...base, title: 'Второй', photoMediaId }, randomUUID())
    expect(reused.status).toBe(422)
  })

  test('the 201st unbought gift is rejected and bought gifts do not count', async () => {
    const { owner, family } = await familyWithMembers()
    const assets = Array.from({ length: 200 }, () => randomUUID())
    await prisma.mediaAsset.createMany({ data: assets.map((id) => storedGiftAsset(id, family.id, owner.userId)) })
    await prisma.gift.createMany({ data: assets.map((photoMediaId, index) => ({
      familyId: family.id, childId: family.childId, title: `Подарок ${index}`, url: 'https://shop.example/',
      photoMediaId, createdByUserId: owner.userId,
    })) })
    const photoMediaId = await giftPhoto(owner, family.id)
    const body = { title: 'Лишний', url: 'https://shop.example/x', photoMediaId }
    const rejected = await api(owner, 'POST', gifts(family.id), body, randomUUID())
    expect(rejected.status).toBe(422)
    expect(rejected.body.error.message).toBe('В списке уже 200 подарков — удалите ненужные')

    const now = new Date()
    await prisma.gift.updateMany({
      where: { photoMediaId: assets[0] },
      data: { reservedByUserId: owner.userId, reservedAt: now, boughtAt: now },
    })
    expect((await api(owner, 'POST', gifts(family.id), body, randomUUID())).status).toBe(201)
  })

  test('reservation rules: anyone reserves, one holder, holder or owner releases, holder buys', async () => {
    const { owner, viewer, full, family } = await familyWithMembers()
    const created = await createGift(owner, family.id, 'Самокат')
    const id = created.id

    const alreadyOpen = await api(full, 'DELETE', purchase(family.id, id), { expectedVersion: 1 })
    expect(alreadyOpen.status).toBe(200)
    expect(alreadyOpen.body.gift.version).toBe(1)

    const reserved = await api(viewer, 'POST', reservation(family.id, id), { expectedVersion: 1 })
    expect(reserved.status).toBe(200)
    expect(reserved.body.gift.reservation).toMatchObject({ userId: viewer.userId, name: 'Бабушка', boughtAt: null })
    expect(reserved.body.gift.version).toBe(2)

    const again = await api(viewer, 'POST', reservation(family.id, id), { expectedVersion: 1 })
    expect(again.status).toBe(200)
    expect(again.body.gift.version).toBe(2)

    const taken = await api(full, 'POST', reservation(family.id, id), { expectedVersion: 2 })
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('CONFLICT')

    expect((await api(full, 'DELETE', reservation(family.id, id), { expectedVersion: 2 })).status).toBe(403)
    expect((await api(full, 'POST', purchase(family.id, id), { expectedVersion: 2 })).status).toBe(403)
    expect((await api(full, 'DELETE', purchase(family.id, id), { expectedVersion: 2 })).status).toBe(403)

    const released = await api(owner, 'DELETE', reservation(family.id, id), { expectedVersion: 2 })
    expect(released.status).toBe(200)
    expect(released.body.gift.reservation).toBeNull()

    expect((await api(full, 'POST', purchase(family.id, id), { expectedVersion: 3 })).status).toBe(409)
    const stale = await api(viewer, 'POST', reservation(family.id, id), { expectedVersion: 2 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')

    expect((await api(viewer, 'POST', reservation(family.id, id), { expectedVersion: 3 })).status).toBe(200)
    const bought = await api(viewer, 'POST', purchase(family.id, id), { expectedVersion: 4 })
    expect(bought.status).toBe(200)
    expect(bought.body.gift.reservation.boughtAt).not.toBeNull()

    const locked = await api(viewer, 'DELETE', reservation(family.id, id), { expectedVersion: 5 })
    expect(locked.status).toBe(409)
    expect(locked.body.error.code).toBe('CONFLICT')
    expect((await api(owner, 'DELETE', reservation(family.id, id), { expectedVersion: 5 })).status).toBe(409)
    expect((await api(full, 'DELETE', purchase(family.id, id), { expectedVersion: 5 })).status).toBe(403)

    const unbought = await api(viewer, 'DELETE', purchase(family.id, id), { expectedVersion: 5 })
    expect(unbought.status).toBe(200)
    expect(unbought.body.gift.reservation).toMatchObject({ userId: viewer.userId, boughtAt: null })
    expect((await api(viewer, 'DELETE', reservation(family.id, id), { expectedVersion: 6 })).status).toBe(200)
    const repeatedUnbought = await api(full, 'DELETE', purchase(family.id, id), { expectedVersion: 7 })
    expect(repeatedUnbought.status).toBe(200)
    expect(repeatedUnbought.body.gift.version).toBe(7)
    expect((await prisma.gift.findUniqueOrThrow({ where: { id } })).version).toBe(7)
  })

  test('two members reserving the same gift at once produce one holder', async () => {
    const { owner, viewer, full, family } = await familyWithMembers()
    const created = await createGift(owner, family.id, 'Кукла')
    const results = await Promise.all([viewer, full].map((user) =>
      api(user, 'POST', reservation(family.id, created.id), { expectedVersion: 1 })))
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    expect(results.find((result) => result.status === 409)!.body.error.code).toBe('CONFLICT')
    const row = await prisma.gift.findUniqueOrThrow({ where: { id: created.id } })
    expect([viewer.userId, full.userId]).toContain(row.reservedByUserId!)
    expect(row.version).toBe(2)
  })

  test('list puts unbought gifts first by creation, then bought ones by purchase time, with names', async () => {
    const { owner, viewer, family } = await familyWithMembers()
    const a = await createGift(owner, family.id, 'A')
    const b = await createGift(owner, family.id, 'B')
    const c = await createGift(owner, family.id, 'C')
    const d = await createGift(owner, family.id, 'D')
    await prisma.gift.update({ where: { id: a.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } })
    await prisma.gift.update({ where: { id: b.id }, data: { createdAt: new Date('2026-01-03T00:00:00Z') } })
    await prisma.gift.update({ where: { id: c.id }, data: { createdAt: new Date('2026-01-02T00:00:00Z') } })
    await prisma.gift.update({ where: { id: d.id }, data: { createdAt: new Date('2026-01-04T00:00:00Z') } })
    const reservedAt = new Date('2026-02-01T00:00:00Z')
    await prisma.gift.update({ where: { id: a.id }, data: { reservedByUserId: viewer.userId, reservedAt, boughtAt: new Date('2026-02-03T00:00:00Z') } })
    await prisma.gift.update({ where: { id: d.id }, data: { reservedByUserId: viewer.userId, reservedAt, boughtAt: new Date('2026-02-02T00:00:00Z') } })
    await prisma.gift.update({ where: { id: c.id }, data: { reservedByUserId: viewer.userId, reservedAt } })

    const listed = await api(owner, 'GET', gifts(family.id))
    expect(listed.body.gifts.map((item: { title: string }) => item.title)).toEqual(['B', 'C', 'A', 'D'])
    expect(listed.body.gifts[1].reservation).toEqual({ userId: viewer.userId, name: 'Бабушка', reservedAt: reservedAt.toISOString(), boughtAt: null })
    expect(listed.body.gifts[2].createdBy).toEqual({ userId: owner.userId, name: 'Мама' })
  })

  test('edits use optimistic versions and retire replaced or deleted photos in the same transaction', async () => {
    const { owner, full, family } = await familyWithMembers()
    const created = await createGift(owner, family.id, 'Пазл')
    const oldPhoto = created.photoMediaId
    const occupied = await createGift(owner, family.id, 'Другая игрушка')
    const { owner: foreignOwner, family: foreignFamily } = await familyWithMembers()
    const foreignPhoto = await giftPhoto(foreignOwner, foreignFamily.id)
    const memoryPhoto = await uploadPhoto(owner, family.id, 'memory')
    const rejectedPhotos = [foreignPhoto, memoryPhoto, occupied.photoMediaId]
    for (const rejectedPhoto of rejectedPhotos) {
      const rejected = await api(full, 'PATCH', gift(family.id, created.id), { expectedVersion: 1, photoMediaId: rejectedPhoto })
      expect(rejected.status).toBe(422)
      expect(await prisma.gift.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ photoMediaId: oldPhoto, version: 1 })
    }
    for (const photoMediaId of rejectedPhotos) expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: photoMediaId } })).deletedAt).toBeNull()

    const newPhoto = await giftPhoto(full, family.id)
    const updated = await api(full, 'PATCH', gift(family.id, created.id), {
      expectedVersion: 1, title: 'Пазл 1000', url: 'http://shop.example/puzzle', price: null, photoMediaId: newPhoto,
    })
    expect(updated.status).toBe(200)
    expect(updated.body.gift).toMatchObject({ title: 'Пазл 1000', url: 'http://shop.example/puzzle', price: null, photoMediaId: newPhoto, version: 2 })
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: oldPhoto } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete', dedupeKey: `media-delete:${oldPhoto}` } })).toBe(1)
    expect((await api(owner, 'GET', `/api/v1/families/${family.id}/media/${oldPhoto}/content?variant=preview`)).status).toBe(404)

    const stale = await api(owner, 'PATCH', gift(family.id, created.id), { expectedVersion: 1, title: 'Старое' })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
    const staleDelete = await api(owner, 'DELETE', gift(family.id, created.id), undefined, undefined, { 'If-Match': '1' })
    expect(staleDelete.status).toBe(409)
    expect(staleDelete.body.error.code).toBe('VERSION_CONFLICT')

    await api(owner, 'POST', reservation(family.id, created.id), { expectedVersion: 2 })
    const removed = await api(full, 'DELETE', gift(family.id, created.id), undefined, undefined, { 'If-Match': '3' })
    expect(removed.status).toBe(204)
    expect(await prisma.gift.count({ where: { id: created.id } })).toBe(0)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: newPhoto } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete', dedupeKey: `media-delete:${newPhoto}` } })).toBe(1)
    expect((await api(full, 'DELETE', gift(family.id, created.id), undefined, undefined, { 'If-Match': '3' })).status).toBe(404)
  })

  test('removing or leaving a member releases their unbought reservations only', async () => {
    const { owner, viewer, full, family } = await familyWithMembers()
    const open = await createGift(owner, family.id, 'Открытый')
    const done = await createGift(owner, family.id, 'Купленный')
    const fullGift = await createGift(owner, family.id, 'Полный')
    await api(viewer, 'POST', reservation(family.id, open.id), { expectedVersion: 1 })
    await api(viewer, 'POST', reservation(family.id, done.id), { expectedVersion: 1 })
    await api(viewer, 'POST', purchase(family.id, done.id), { expectedVersion: 2 })
    await api(full, 'POST', reservation(family.id, fullGift.id), { expectedVersion: 1 })

    const membership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: viewer.userId } },
    })
    const removed = await api(owner, 'DELETE', `/api/v1/families/${family.id}/members/${viewer.userId}`, { expectedVersion: membership.version })
    expect(removed.status).toBe(204)
    const repeated = await api(owner, 'DELETE', `/api/v1/families/${family.id}/members/${viewer.userId}`, { expectedVersion: membership.version })
    expect(repeated.status).toBe(204)

    const released = await prisma.gift.findUniqueOrThrow({ where: { id: open.id } })
    expect(released).toMatchObject({ reservedByUserId: null, reservedAt: null, version: 3 })
    expect(await prisma.gift.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ reservedByUserId: viewer.userId })
    const listed = await api(owner, 'GET', gifts(family.id))
    expect(listed.body.gifts.find((item: { id: string }) => item.id === done.id).reservation.name).toBe('Бабушка')
    expect((await api(viewer, 'GET', gifts(family.id))).status).toBe(404)

    const fullMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: full.userId } },
    })
    const left = await api(full, 'DELETE', `/api/v1/families/${family.id}/members/${full.userId}`, { expectedVersion: fullMembership.version })
    expect(left.status).toBe(204)
    expect(await prisma.gift.findUniqueOrThrow({ where: { id: fullGift.id } })).toMatchObject({ reservedByUserId: null })
  })

  test('daily media cleanup keeps photos attached to gifts', async () => {
    const { owner, family } = await familyWithMembers()
    const created = await createGift(owner, family.id, 'Книга')
    const loose = await giftPhoto(owner, family.id)
    const old = new Date('2026-09-01T00:00:00Z')
    await prisma.mediaAsset.updateMany({ where: { id: { in: [created.photoMediaId, loose] } }, data: { createdAt: old } })
    await runBackgroundJob('media:pending:cleanup', { prisma } as never, new Date('2026-09-10T00:00:00Z'))
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: created.photoMediaId } })).deletedAt).toBeNull()
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: loose } })).deletedAt).not.toBeNull()
  })

  const gifts = (familyId: string) => `/api/v1/families/${familyId}/gifts`
  const gift = (familyId: string, giftId: string) => `${gifts(familyId)}/${giftId}`
  const reservation = (familyId: string, giftId: string) => `${gift(familyId, giftId)}/reservation`
  const purchase = (familyId: string, giftId: string) => `${gift(familyId, giftId)}/purchase`

  async function createGift(user: User, familyId: string, title: string) {
    const photoMediaId = await giftPhoto(user, familyId)
    const created = await api(user, 'POST', gifts(familyId), { title, url: 'https://shop.example/item', photoMediaId }, randomUUID())
    expect(created.status).toBe(201)
    return created.body.gift as { id: string; photoMediaId: string }
  }

  async function familyWithMembers() {
    const owner = await admittedUser('Мама', subject())
    const viewer = await admittedUser('Бабушка', subject())
    const full = await admittedUser('Папа', subject())
    const family = await createFamily(owner, 'Семья')
    await inviteMember(owner, viewer, family.id, 'viewer')
    await inviteMember(owner, full, family.id, 'full')
    return { owner, viewer, full, family }
  }

  function storedGiftAsset(id: string, familyId: string, uploaderId: string) {
    return {
      id, familyId, uploaderId, sourceKind: 'upload' as const, purpose: 'gift' as const, mediaKind: 'photo' as const,
      originalKey: `media-originals/${id}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: id.replaceAll('-', '').repeat(2), byteSize: 1n, width: 1, height: 1,
      originalStatus: 'stored' as const, renditionStatus: 'ready' as const,
    }
  }

  async function giftPhoto(user: User, familyId: string) {
    return uploadPhoto(user, familyId, 'gift')
  }

  async function uploadPhoto(user: User, familyId: string, purpose: 'gift' | 'memory') {
    const reserved = await api(user, 'POST', `/api/v1/families/${familyId}/uploads`, {
      purpose, kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
    }, randomUUID())
    if (reserved.status !== 201) throw new Error(JSON.stringify(reserved.body))
    const stored = await app.request(reserved.body.upload.url, {
      method: 'PUT', headers: reserved.body.upload.headers, body: pngFixture as unknown as BodyInit,
    })
    expect(stored.status).toBe(200)
    const finalized = await api(user, 'POST', `/api/v1/families/${familyId}/uploads/${reserved.body.upload.uploadId}/finalize`, {})
    expect(finalized.status).toBe(200)
    return reserved.body.assetId as string
  }

  async function clearFixtures() {
    await prisma.gift.deleteMany()
    await prisma.idempotencyRecord.deleteMany()
    await prisma.memoryComment.deleteMany()
    await prisma.memoryLike.deleteMany()
    await prisma.memorySeen.deleteMany()
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

  async function admittedUser(displayName: string, subject: string): Promise<User> {
    const user = await prisma.user.create({ data: { email: null, displayName } })
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'max', subject } })
    const session = await prisma.authSession.create({
      data: {
        userId: user.id, externalIdentityId: identity.id, refreshTokenHash: `hash-${subject}`,
        refreshTokenFamilyHash: `family-${subject}`, expiresAt: new Date(Date.now() + 600_000),
      },
    })
    return { userId: user.id, token: await signAccessToken({ sub: user.id, sessionId: session.id }, env) }
  }

  async function createFamily(owner: User, name: string) {
    const created = await api(owner, 'POST', '/api/v1/families', { name, timezone: 'Europe/Moscow' }, randomUUID())
    expect(created.status).toBe(201)
    const avatarId = randomUUID()
    await prisma.mediaAsset.create({
      data: { ...storedGiftAsset(avatarId, created.body.family.id, owner.userId), purpose: 'child_avatar' },
    })
    const child = await prisma.child.create({
      data: {
        familyId: created.body.family.id, displayName: 'Ребёнок', birthDate: new Date('2024-01-01T00:00:00.000Z'), sex: 'girl',
        avatarMediaId: avatarId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
      },
    })
    return { id: created.body.family.id as string, childId: child.id }
  }

  async function inviteMember(owner: User, member: User, familyId: string, role: 'full' | 'viewer') {
    const invite = await api(owner, 'POST', `/api/v1/families/${familyId}/invites`, { role }, randomUUID())
    expect(invite.status).toBe(201)
    const accepted = await api(member, 'POST', '/api/v1/invites/accept', { token: invite.body.rawToken })
    if (accepted.status !== 200) throw new Error(JSON.stringify(accepted.body))
  }

  async function api(
    user: User, method: string, path: string, body?: unknown, idempotencyKey?: string,
    extraHeaders: Record<string, string> = {},
  ) {
    const response = await app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${user.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) as any : undefined }
  }
})
