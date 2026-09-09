import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { signAccessToken } from '../auth'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Memories API', () => {
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

  test('full creates a plain-text note, while viewer may read it but cannot create', async () => {
    const owner = await admittedUser('Владелец', '31001')
    const viewer = await admittedUser('Зритель', '31002')
    const family = await createFamily(owner.token, 'Семья воспоминаний')
    const invite = await request(
      `/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST', { role: 'viewer' }, randomUUID(),
    )
    await request('/api/v1/invites/accept', viewer.token, 'POST', { token: invite.body.rawToken })

    const created = await request(
      `/api/v1/families/${family.body.family.id}/memories`,
      owner.token,
      'POST',
      {
        kind: 'note',
        childId: family.body.child.id,
        body: `<b>Первый день</b>`,
        occurredAt: '2026-09-08T10:00:00.000Z',
      },
      randomUUID(),
    )

    expect(created.response.status).toBe(201)
    expect(created.body).toMatchObject({
      kind: 'note', body: '<b>Первый день</b>', familyId: family.body.family.id,
      attachments: [], likes: { count: 0, likedByMe: false },
    })
    const listed = await request(
      `/api/v1/families/${family.body.family.id}/memories`, viewer.token, 'GET', undefined,
    )
    expect(listed.response.status).toBe(200)
    expect(listed.body.items).toHaveLength(1)
    expect(listed.body.items[0].id).toBe(created.body.id)

    const denied = await request(
      `/api/v1/families/${family.body.family.id}/memories`, viewer.token, 'POST', {
        kind: 'note', childId: family.body.child.id, body: 'Нельзя', occurredAt: '2026-09-08T11:00:00.000Z',
      }, randomUUID(),
    )
    expect(denied.response.status).toBe(403)
  })

  test('an invited full member has the same memory mutations as the owner', async () => {
    const owner = await admittedUser('Владелец', '31501')
    const full = await admittedUser('Полный доступ', '31502')
    const family = await createFamily(owner.token, 'Семья')
    const invite = await request(`/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST',
      { role: 'full' }, randomUUID())
    await request('/api/v1/invites/accept', full.token, 'POST', { token: invite.body.rawToken })

    const created = await createNote(full.token, family.body.family.id, family.body.child.id, 'Создал full')
    expect(created.response.status).toBe(201)
    const edited = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      full.token, 'PATCH', { body: 'Изменил full', occurredAt: created.body.occurredAt, expectedVersion: 1 })
    expect(edited.response.status).toBe(200)
    const removed = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      full.token, 'DELETE', undefined, undefined, { 'If-Match': '2' })
    expect(removed.response.status).toBe(204)
  })

  test('replays one idempotent creation, preserves its original snapshot, and rejects changed payloads', async () => {
    const owner = await admittedUser('Владелец', '32001')
    const family = await createFamily(owner.token, 'Семья')
    const key = randomUUID()
    const input = noteInput(family.body.child.id, 'Первоначальный текст')
    const attempts = await Promise.all([
      request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', input, key),
      request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', input, key),
    ])

    expect(attempts.map(({ response }) => response.status).sort()).toEqual([200, 201])
    expect(attempts[0].body).toEqual(attempts[1].body)
    expect(await prisma.memory.count()).toBe(1)
    const original = attempts[0].body
    const changed = await request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
      ...input, body: 'Другой текст',
    }, key)
    expect(changed.response.status).toBe(409)
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT')

    const edited = await request(`/api/v1/families/${family.body.family.id}/memories/${original.id}`,
      owner.token, 'PATCH', { body: 'После правки', occurredAt: input.occurredAt, expectedVersion: 1 })
    expect(edited.response.status).toBe(200)
    const replay = await request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', input, key)
    expect(replay.response.status).toBe(200)
    expect(replay.body).toEqual(original)
  })

  test('enforces family isolation, child ownership, and the full/viewer mutation boundary', async () => {
    const ownerA = await admittedUser('Владелец A', '33001')
    const ownerB = await admittedUser('Владелец B', '33002', 'admin')
    const viewer = await admittedUser('Зритель', '33003')
    const familyA = await createFamily(ownerA.token, 'Семья A')
    const familyB = await createFamily(ownerB.token, 'Семья B')
    const invite = await request(`/api/v1/families/${familyA.body.family.id}/invites`, ownerA.token, 'POST',
      { role: 'viewer' }, randomUUID())
    await request('/api/v1/invites/accept', viewer.token, 'POST', { token: invite.body.rawToken })
    const created = await createNote(ownerA.token, familyA.body.family.id, familyA.body.child.id, 'Только семьи A')

    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories/${created.body.id}`,
      ownerB.token, 'GET', undefined)).response.status).toBe(404)
    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories/${created.body.id}`,
      ownerB.token, 'PATCH', { body: 'Чужая правка', occurredAt: created.body.occurredAt, expectedVersion: 1 })).response.status).toBe(404)
    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories/${created.body.id}`,
      viewer.token, 'PATCH', { body: 'Нельзя', occurredAt: created.body.occurredAt, expectedVersion: 1 })).response.status).toBe(403)
    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories`, ownerA.token, 'POST',
      noteInput(familyB.body.child.id, 'Чужой ребёнок'), randomUUID())).response.status).toBe(404)
  })

  test('rejects stale versions rather than overwriting a newer edit', async () => {
    const owner = await admittedUser('Владелец', '34001')
    const family = await createFamily(owner.token, 'Семья')
    const created = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Версия один')
    const first = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'PATCH', { body: 'Версия два', occurredAt: created.body.occurredAt, expectedVersion: 1 })
    expect(first.response.status).toBe(200)
    expect(first.body.version).toBe(2)
    const stale = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'PATCH', { body: 'Потерянная правка', occurredAt: created.body.occurredAt, expectedVersion: 1 })
    expect(stale.response.status).toBe(409)
    const current = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'GET', undefined)
    expect(current.body.body).toBe('Версия два')
  })

  test('keeps a keyset page stable when newer memories arrive and rejects cursor context changes', async () => {
    const owner = await admittedUser('Владелец', '35001')
    const outsider = await admittedUser('Другая семья', '35002')
    const family = await createFamily(owner.token, 'Семья')
    const otherFamily = await createFamily(outsider.token, 'Другая семья')
    const base = Date.now() - 60_000
    const oldest = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Старое', base)
    const middle = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Среднее', base + 10_000)
    const newest = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Новое', base + 20_000)
    const first = await request(`/api/v1/families/${family.body.family.id}/memories?limit=2`, owner.token, 'GET', undefined)
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([newest.body.id, middle.body.id])
    await createNote(owner.token, family.body.family.id, family.body.child.id, 'Позже', base + 30_000)
    const second = await request(
      `/api/v1/families/${family.body.family.id}/memories?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      owner.token, 'GET', undefined,
    )
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([oldest.body.id])
    expect(new Set([...first.body.items, ...second.body.items].map((item: { id: string }) => item.id)).size).toBe(3)
    expect((await request(`/api/v1/families/${otherFamily.body.family.id}/memories?cursor=${encodeURIComponent(first.body.nextCursor)}`,
      outsider.token, 'GET', undefined)).response.status).toBe(422)
    expect((await request(`/api/v1/families/${family.body.family.id}/memories?kind=note&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      owner.token, 'GET', undefined)).response.status).toBe(422)
    expect((await request(`/api/v1/families/${family.body.family.id}/memories?cursor=${encodeURIComponent(`${first.body.nextCursor}x`)}`,
      owner.token, 'GET', undefined)).response.status).toBe(422)
  })

  test('soft-deletes a memory without returning it again', async () => {
    const owner = await admittedUser('Владелец', '36001')
    const family = await createFamily(owner.token, 'Семья')
    const created = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Удалить')
    const deleted = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'DELETE', undefined, undefined, { 'If-Match': '1' })
    expect(deleted.response.status).toBe(204)
    const repeated = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'DELETE', undefined, undefined, { 'If-Match': '1' })
    expect(repeated.response.status).toBe(204)
    expect((await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'GET', undefined)).response.status).toBe(404)
    expect((await request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'GET', undefined)).body.items)
      .toEqual([])
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: created.body.id } })).toMatchObject({ status: 'deleted' })
  })

  test('serializes idempotent likes and excludes revoked members from the public count', async () => {
    const owner = await admittedUser('Владелец', '37001')
    const viewer = await admittedUser('Зритель', '37002')
    const family = await createFamily(owner.token, 'Семья')
    const invite = await request(`/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST',
      { role: 'viewer' }, randomUUID())
    await request('/api/v1/invites/accept', viewer.token, 'POST', { token: invite.body.rawToken })
    const created = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Нравится')
    const likes = await Promise.all([
      request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}/like`, viewer.token, 'PUT', { liked: true }),
      request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}/like`, viewer.token, 'PUT', { liked: true }),
    ])
    expect(likes.map(({ body }) => body)).toEqual([
      { count: 1, likedByMe: true }, { count: 1, likedByMe: true },
    ])
    const unlikes = await Promise.all([
      request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}/like`, viewer.token, 'PUT', { liked: false }),
      request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}/like`, viewer.token, 'PUT', { liked: false }),
    ])
    expect(unlikes.map(({ body }) => body)).toEqual([
      { count: 0, likedByMe: false }, { count: 0, likedByMe: false },
    ])
    await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}/like`, viewer.token, 'PUT', { liked: true })
    await app.request(`/api/v1/families/${family.body.family.id}/members/${viewer.userId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}` },
    })
    const ownerView = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'GET', undefined)
    expect(ownerView.body.likes).toEqual({ count: 0, likedByMe: false })
  })

  test('keeps media publication closed and rejects a cross-family typed media reference at the database boundary', async () => {
    const ownerA = await admittedUser('Владелец A', '38001')
    const ownerB = await admittedUser('Владелец B', '38002')
    const familyA = await createFamily(ownerA.token, 'Семья A')
    const familyB = await createFamily(ownerB.token, 'Семья B')
    const created = await createNote(ownerA.token, familyA.body.family.id, familyA.body.child.id, 'Запись A')
    const mediaAttempt = await request(`/api/v1/families/${familyA.body.family.id}/memories`, ownerA.token, 'POST', {
      kind: 'photo', childId: familyA.body.child.id, body: '', occurredAt: new Date(Date.now() - 30_000).toISOString(),
      mediaIds: [randomUUID()],
    }, randomUUID())
    expect(mediaAttempt.response.status).toBe(409)
    await expect(Promise.resolve(prisma.memoryMedia.create({
      data: { familyId: familyB.body.family.id, memoryId: created.body.id, mediaId: randomUUID(), position: 0 },
    }))).rejects.toThrow()
  })

  async function clearFixtures() {
    await prisma.idempotencyRecord.deleteMany()
    await prisma.memoryLike.deleteMany()
    await prisma.memoryMedia.deleteMany()
    await prisma.memory.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
  }

  async function admittedUser(displayName: string, subject: string, role: 'user' | 'admin' = 'user') {
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
    return { userId: user.id, token: await signAccessToken({ sub: user.id, sessionId: session.id }, env) }
  }

  function createFamily(token: string, name: string) {
    return request('/api/v1/families', token, 'POST', {
      name, timezone: 'Europe/Moscow', child: { displayName: 'Ребёнок' },
    }, randomUUID())
  }

  function createNote(token: string, familyId: string, childId: string, body: string, occurredAt = Date.now() - 30_000) {
    return request(`/api/v1/families/${familyId}/memories`, token, 'POST',
      noteInput(childId, body, occurredAt), randomUUID())
  }

  function noteInput(childId: string, body: string, occurredAt = Date.now() - 30_000) {
    return { kind: 'note', childId, body, occurredAt: new Date(occurredAt).toISOString() }
  }

  async function request(
    path: string,
    token: string,
    method: string,
    body: unknown,
    idempotencyKey?: string,
    extraHeaders: Record<string, string> = {},
  ) {
    const response = await app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        ...extraHeaders,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const responseText = await response.text()
    return { response, body: responseText === '' ? undefined : JSON.parse(responseText) as any }
  }
})
