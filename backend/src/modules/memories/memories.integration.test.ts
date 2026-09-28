import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { memoryDtoSchema, memoryPageSchema } from '@web-app-demo/contracts'
import { Client } from 'pg'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { Prisma } from '../../generated/prisma/client'
import { signAccessToken } from '../auth'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Memories API', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '10000',
  })
  const app = createApp({ env, prisma })
  // A separate pool makes lifecycle writes observable at PostgreSQL rather than queueing behind
  // the memory request inside the same adapter connection.
  const lifecyclePrisma = createPrisma(databaseUrl!)
  const lifecycleApp = createApp({ env, prisma: lifecyclePrisma })

  beforeEach(clearFixtures)
  afterAll(async () => {
    await clearFixtures()
    await prisma.$disconnect()
    await lifecyclePrisma.$disconnect()
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

  test('replays a pre-MM-0 idempotency snapshot with absent temporal fields as null', async () => {
    const owner = await admittedUser('Владелец', '32002')
    const family = await createFamily(owner.token, 'Семья')
    const key = randomUUID()
    const input = noteInput(family.body.child.id, 'Старый снимок')
    const created = await request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', input, key)
    expect(created.response.status).toBe(201)

    const idempotencyRecord = await prisma.idempotencyRecord.findFirstOrThrow({ where: { key } })
    const legacySnapshot = { ...(idempotencyRecord.responseSnapshot as Record<string, unknown>) }
    delete legacySnapshot.firstPublishedAt
    delete legacySnapshot.sourcePublishedAt
    await prisma.idempotencyRecord.update({ where: { id: idempotencyRecord.id }, data: { responseSnapshot: legacySnapshot as Prisma.InputJsonValue } })

    const replay = await request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', input, key)
    expect(replay.response.status).toBe(200)
    expect(replay.body).toMatchObject({ firstPublishedAt: null, sourcePublishedAt: null })
    expect(replay.body.id).toBe(created.body.id)
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
    const createdA = await createNote(ownerA.token, familyA.body.family.id, familyA.body.child.id, 'Только семьи A')
    const createdB = await createNote(ownerB.token, familyB.body.family.id, familyB.body.child.id, 'Только семьи B')

    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories/${createdA.body.id}`,
      ownerB.token, 'GET', undefined)).response.status).toBe(404)
    for (const [method, body, headers] of [
      ['GET', undefined, undefined],
      ['PATCH', { body: 'Чужая правка', occurredAt: createdB.body.occurredAt, expectedVersion: 1 }, undefined],
      ['DELETE', undefined, { 'If-Match': '1' }],
      ['PUT', { liked: true }, undefined],
    ] as const) {
      const suffix = method === 'PUT' ? '/like' : ''
      const attempt = await request(
        `/api/v1/families/${familyA.body.family.id}/memories/${createdB.body.id}${suffix}`,
        ownerA.token,
        method,
        body,
        undefined,
        headers,
      )
      expect(attempt.response.status).toBe(404)
    }
    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories/${createdA.body.id}`,
      viewer.token, 'PATCH', { body: 'Нельзя', occurredAt: createdA.body.occurredAt, expectedVersion: 1 })).response.status).toBe(403)
    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories/${createdA.body.id}`,
      viewer.token, 'DELETE', undefined, undefined, { 'If-Match': '1' })).response.status).toBe(403)
    expect((await request(`/api/v1/families/${familyA.body.family.id}/memories`, ownerA.token, 'POST',
      noteInput(familyB.body.child.id, 'Чужой ребёнок'), randomUUID())).response.status).toBe(404)
  })

  test('allows only one concurrent update and reports VERSION_CONFLICT for stale update and delete', async () => {
    const owner = await admittedUser('Владелец', '34001')
    const family = await createFamily(owner.token, 'Семья')
    const created = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Версия один')
    const updates = await Promise.all([
      request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
        owner.token, 'PATCH', { body: 'Конкурент A', occurredAt: created.body.occurredAt, expectedVersion: 1 }),
      request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
        owner.token, 'PATCH', { body: 'Конкурент B', occurredAt: created.body.occurredAt, expectedVersion: 1 }),
    ])
    expect(updates.map(({ response }) => response.status).sort()).toEqual([200, 409])
    expect(updates.find(({ response }) => response.status === 409)?.body.error.code).toBe('VERSION_CONFLICT')
    const stale = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'PATCH', { body: 'Потерянная правка', occurredAt: created.body.occurredAt, expectedVersion: 1 })
    expect(stale.response.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
    const staleDelete = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'DELETE', undefined, undefined, { 'If-Match': '1' })
    expect(staleDelete.response.status).toBe(409)
    expect(staleDelete.body.error.code).toBe('VERSION_CONFLICT')
    const current = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'GET', undefined)
    expect(['Конкурент A', 'Конкурент B']).toContain(current.body.body)
    expect(current.body.version).toBe(2)
  })

  test('keeps a sequence-bound keyset snapshot across backdated inserts and deletes', async () => {
    const owner = await admittedUser('Владелец', '35001')
    const outsider = await admittedUser('Другая семья', '35002')
    const family = await createFamily(owner.token, 'Семья')
    const otherFamily = await createFamily(outsider.token, 'Другая семья')
    const base = Date.now() - 60_000
    const oldest = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Старое', base)
    const lowerMiddle = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Среднее 1', base + 10_000)
    const upperMiddle = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Среднее 2', base + 20_000)
    const newest = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Новое', base + 30_000)
    const first = await request(`/api/v1/families/${family.body.family.id}/memories?limit=2`, owner.token, 'GET', undefined)
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([newest.body.id, upperMiddle.body.id])
    const insertedAfterSnapshot = await createNote(
      owner.token,
      family.body.family.id,
      family.body.child.id,
      'Новая, но задним числом',
      base + 15_000,
    )
    await request(`/api/v1/families/${family.body.family.id}/memories/${oldest.body.id}`,
      owner.token, 'DELETE', undefined, undefined, { 'If-Match': '1' })
    const second = await request(
      `/api/v1/families/${family.body.family.id}/memories?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      owner.token, 'GET', undefined,
    )
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([lowerMiddle.body.id])
    expect(second.body.items.map((item: { id: string }) => item.id)).not.toContain(insertedAfterSnapshot.body.id)
    expect(second.body.items.map((item: { id: string }) => item.id)).not.toContain(oldest.body.id)
    expect((await request(`/api/v1/families/${otherFamily.body.family.id}/memories?cursor=${encodeURIComponent(first.body.nextCursor)}`,
      outsider.token, 'GET', undefined)).response.status).toBe(422)
    expect((await request(`/api/v1/families/${family.body.family.id}/memories?kind=note&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      owner.token, 'GET', undefined)).response.status).toBe(422)
    expect((await request(`/api/v1/families/${family.body.family.id}/memories?cursor=${encodeURIComponent(`${first.body.nextCursor}x`)}`,
      owner.token, 'GET', undefined)).response.status).toBe(422)
    expect((await request(`/api/v1/families/${family.body.family.id}/memories?cursor=${encodeURIComponent('%%%not-a-cursor')}`,
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
    const likeDeleted = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}/like`,
      owner.token, 'PUT', { liked: true })
    expect(likeDeleted.response.status).toBe(404)
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
    const viewerMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: viewer.userId } },
    })
    await request(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: viewerMembership.version },
    )
    const ownerView = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'GET', undefined)
    expect(ownerView.body.likes).toEqual({ count: 0, likedByMe: false })
    const reinvite = await request(`/api/v1/families/${family.body.family.id}/invites`, owner.token, 'POST',
      { role: 'viewer' }, randomUUID())
    await request('/api/v1/invites/accept', viewer.token, 'POST', { token: reinvite.body.rawToken })
    const reactivatedView = await request(`/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
      owner.token, 'GET', undefined)
    expect(reactivatedView.body.likes).toEqual({ count: 1, likedByMe: false })
  })

  test('serializes revoke against an in-flight create authorization', async () => {
    const owner = await admittedUser('Владелец', '37501')
    const full = await admittedUser('Полный доступ', '37502')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, full.token, family.body.family.id, 'full')
    const fullMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: full.userId } },
    })
    const blocker = await beginDatabaseBlock('LOCK TABLE memories IN ACCESS EXCLUSIVE MODE')

    try {
      const creation = createNote(full.token, family.body.family.id, family.body.child.id, 'Гонка создания')
      await waitForLockedQuery(blocker)
      const revocation = requestThrough(
        lifecycleApp,
        `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
        owner.token,
        'DELETE',
        { expectedVersion: fullMembership.version },
      )
      await waitForLockedQuery(blocker, 'family_members')
      await blocker.query('COMMIT')

      expect((await creation).response.status).toBe(201)
      expect((await revocation).response.status).toBe(204)
    } finally {
      await rollbackAndClose(blocker)
    }
  })

  test('serializes downgrade against an in-flight update authorization', async () => {
    const owner = await admittedUser('Владелец', '37601')
    const full = await admittedUser('Полный доступ', '37602')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, full.token, family.body.family.id, 'full')
    const fullMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: full.userId } },
    })
    const created = await createNote(full.token, family.body.family.id, family.body.child.id, 'До правки')
    const blocker = await beginDatabaseBlock(
      'SELECT id FROM memories WHERE id = $1 FOR UPDATE',
      [created.body.id],
    )

    try {
      const update = request(
        `/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
        full.token,
        'PATCH',
        { body: 'После правки', occurredAt: created.body.occurredAt, expectedVersion: 1 },
      )
      await waitForLockedQuery(blocker)
      const downgrade = requestThrough(
        lifecycleApp,
        `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
        owner.token,
        'PATCH',
        { role: 'viewer', expectedVersion: fullMembership.version },
      )
      await waitForLockedQuery(blocker, 'family_members')
      await blocker.query('COMMIT')

      expect((await update).response.status).toBe(200)
      expect((await downgrade).response.status).toBe(200)
    } finally {
      await rollbackAndClose(blocker)
    }
  })

  test('serializes revoke against an in-flight delete authorization', async () => {
    const owner = await admittedUser('Владелец', '37701')
    const full = await admittedUser('Полный доступ', '37702')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, full.token, family.body.family.id, 'full')
    const fullMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: full.userId } },
    })
    const created = await createNote(full.token, family.body.family.id, family.body.child.id, 'Удалить')
    const blocker = await beginDatabaseBlock(
      'SELECT id FROM memories WHERE id = $1 FOR UPDATE',
      [created.body.id],
    )

    try {
      const deletion = request(
        `/api/v1/families/${family.body.family.id}/memories/${created.body.id}`,
        full.token,
        'DELETE',
        undefined,
        undefined,
        { 'If-Match': '1' },
      )
      await waitForLockedQuery(blocker)
      const revocation = requestThrough(
        lifecycleApp,
        `/api/v1/families/${family.body.family.id}/members/${full.userId}`,
        owner.token,
        'DELETE',
        { expectedVersion: fullMembership.version },
      )
      await waitForLockedQuery(blocker, 'family_members')
      await blocker.query('COMMIT')

      expect((await deletion).response.status).toBe(204)
      expect((await revocation).response.status).toBe(204)
    } finally {
      await rollbackAndClose(blocker)
    }
  })

  test('serializes revoke against an in-flight like authorization', async () => {
    const owner = await admittedUser('Владелец', '37801')
    const viewer = await admittedUser('Зритель', '37802')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    const viewerMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: viewer.userId } },
    })
    const created = await createNote(owner.token, family.body.family.id, family.body.child.id, 'Лайк')
    const lockName = `memory-like:${created.body.id}:${viewer.userId}`
    const blocker = await beginDatabaseBlock(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [lockName],
    )

    try {
      const like = request(
        `/api/v1/families/${family.body.family.id}/memories/${created.body.id}/like`,
        viewer.token,
        'PUT',
        { liked: true },
      )
      await waitForLockedQuery(blocker)
      const revocation = requestThrough(
        lifecycleApp,
        `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
        owner.token,
        'DELETE',
        { expectedVersion: viewerMembership.version },
      )
      await waitForLockedQuery(blocker, 'family_members')
      await blocker.query('COMMIT')

      expect((await like).response.status).toBe(200)
      expect((await revocation).response.status).toBe(204)
    } finally {
      await rollbackAndClose(blocker)
    }
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
    await expect(Promise.resolve(prisma.memory.create({
      data: {
        familyId: familyA.body.family.id,
        childId: familyA.body.child.id,
        authorId: ownerB.userId,
        kind: 'note',
        body: 'Неверный автор',
        occurredAt: new Date(Date.now() - 30_000),
      },
    }))).rejects.toThrow()
  })

  test('publishes ordered photo/video as one media Memory and rejects voice, foreign, and unready assets', async () => {
    const owner = await admittedUser('Владелец', '38011')
    const otherOwner = await admittedUser('Другой владелец', '38012')
    const family = await createFamily(owner.token, 'Семья медиа')
    const foreignFamily = await createFamily(otherOwner.token, 'Другая семья')
    const photo = await createMemoryAsset(family.body.family.id, owner.userId, 'photo')
    const video = await createMemoryAsset(family.body.family.id, owner.userId, 'video')
    const voice = await createMemoryAsset(family.body.family.id, owner.userId, 'voice')
    const unready = await createMemoryAsset(family.body.family.id, owner.userId, 'photo', 'pending')
    const foreign = await createMemoryAsset(foreignFamily.body.family.id, otherOwner.userId, 'photo')
    const created = await request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
      kind: 'media', childId: family.body.child.id, body: 'Фото и видео',
      occurredAt: '2023-07-14T18:43:00.000Z', mediaIds: [photo.id, video.id],
    }, randomUUID())
    expect(created.response.status).toBe(201)
    expect(created.body).toMatchObject({ kind: 'media', firstPublishedAt: expect.any(String), sourcePublishedAt: null })
    expect(created.body.attachments.map((attachment: { id: string }) => attachment.id)).toEqual([photo.id, video.id])
    const persisted = await prisma.memory.findUniqueOrThrow({ where: { id: created.body.id }, include: { media: { orderBy: { position: 'asc' } } } })
    expect(persisted.media.map(({ position, mediaId }) => ({ position, mediaId }))).toEqual([
      { position: 0, mediaId: photo.id }, { position: 1, mediaId: video.id },
    ])

    for (const mediaIds of [[voice.id], [foreign.id], [unready.id]]) {
      const rejected = await request(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
        kind: 'media', childId: family.body.child.id, body: '',
        occurredAt: '2023-07-14T18:43:00.000Z', mediaIds,
      }, randomUUID())
      expect(rejected.response.status).toBeGreaterThanOrEqual(400)
    }
  })

  test('serves historical published note, photo, album, video, and voice through the Feed DTO', async () => {
    const owner = await admittedUser('Владелец', '38013')
    const family = await createFamily(owner.token, 'Историческая семья')
    const familyId = family.body.family.id as string
    const childId = family.body.child.id as string
    const legacy = [
      { kind: 'note', mediaKinds: [] },
      { kind: 'photo', mediaKinds: ['photo'] },
      { kind: 'photo', mediaKinds: ['photo', 'photo'] },
      { kind: 'video', mediaKinds: ['video'] },
      { kind: 'voice', mediaKinds: ['voice'] },
    ] as const
    const expected: Array<{
      id: string, kind: string, attachmentIds: string[], attachmentKinds: Array<'photo' | 'video' | 'voice'>
    }> = []

    for (const [index, item] of legacy.entries()) {
      const assets = await Promise.all(item.mediaKinds.map((kind) => createMemoryAsset(familyId, owner.userId, kind)))
      const memory = await prisma.memory.create({ data: {
        familyId, childId, authorId: owner.userId,
        kind: item.kind, body: `Старая запись ${index + 1}`,
        occurredAt: new Date(`2025-01-02T03:04:0${index}.000Z`),
        status: 'published', firstPublishedAt: new Date(), sourcePublishedAt: null,
        media: { create: assets.map((asset, position) => ({ mediaId: asset.id, position })) },
      } })
      expected.push({
        id: memory.id, kind: item.kind,
        attachmentIds: assets.map((asset) => asset.id),
        attachmentKinds: [...item.mediaKinds],
      })
    }

    // Recreate the post-MM-0 shape of rows published before the timestamp column existed.
    // The publication guard rightly forbids creating a fresh published row with NULL here.
    const legacyFixture = new Client({ connectionString: databaseUrl! })
    await legacyFixture.connect()
    try {
      await legacyFixture.query('BEGIN')
      await legacyFixture.query('ALTER TABLE memories DISABLE TRIGGER memories_first_publication_guard')
      await legacyFixture.query('UPDATE memories SET first_published_at = NULL WHERE id = ANY($1::uuid[])',
        [expected.map(({ id }) => id)])
      await legacyFixture.query('ALTER TABLE memories ENABLE TRIGGER memories_first_publication_guard')
      await legacyFixture.query('COMMIT')
    } catch (error) {
      await legacyFixture.query('ROLLBACK')
      throw error
    } finally {
      await legacyFixture.end()
    }

    const listed = await request(`/api/v1/families/${familyId}/memories`, owner.token, 'GET', undefined)
    expect(listed.response.status).toBe(200)
    const page = memoryPageSchema.parse(listed.body)
    expect(page.items).toHaveLength(legacy.length)
    expect(page.items.map(({ id }) => id)).toEqual(expected.map(({ id }) => id).reverse())

    for (const item of expected) {
      const fromFeed = page.items.find(({ id }) => id === item.id)
      expect(fromFeed).toBeDefined()
      expect(fromFeed).toMatchObject({
        kind: item.kind, status: 'published', firstPublishedAt: null, sourcePublishedAt: null,
      })
      expect(fromFeed!.attachments.map(({ id, kind }) => ({ id, kind }))).toEqual(
        item.attachmentIds.map((id, index) => ({ id, kind: item.attachmentKinds[index] })),
      )
      const detail = await request(`/api/v1/families/${familyId}/memories/${item.id}`, owner.token, 'GET', undefined)
      expect(detail.response.status).toBe(200)
      expect(memoryDtoSchema.parse(detail.body)).toEqual(fromFeed!)
    }
  })

  test('returns the measured 48-peak voice waveform through the Memory contract', async () => {
    const owner = await admittedUser('Владелец', '38101')
    const family = await createFamily(owner.token, 'Семья')
    const waveform = Array.from({ length: 48 }, (_, index) => (index + 1) / 48)
    const asset = await prisma.mediaAsset.create({
      data: {
        familyId: family.body.family.id,
        uploaderId: owner.userId,
        sourceKind: 'upload',
        purpose: 'memory',
        mediaKind: 'voice',
        originalKey: `media-originals/${randomUUID()}`,
        declaredMime: 'audio/ogg',
        verifiedMime: 'audio/ogg',
        sha256: randomUUID().replaceAll('-', '').repeat(2),
        byteSize: 1_024n,
        durationMs: 12_000,
        waveform,
        originalStatus: 'stored',
        renditionStatus: 'ready',
        variants: {
          create: {
            variant: 'playback',
            objectKey: `media-playback/${randomUUID()}.m4a`,
            sha256: randomUUID().replaceAll('-', '').repeat(2),
            byteSize: 512n,
            mime: 'audio/mp4',
            durationMs: 12_000,
          },
        },
      },
    })

    const memory = await prisma.memory.create({
      data: {
        familyId: family.body.family.id,
        childId: family.body.child.id,
        authorId: owner.userId,
        kind: 'voice',
        body: 'Первое слово',
        occurredAt: new Date('2026-09-11T10:00:00.000Z'),
        firstPublishedAt: new Date(),
        media: { create: { mediaId: asset.id, position: 0 } },
      },
    })
    const listed = await request(
      `/api/v1/families/${family.body.family.id}/memories/${memory.id}`,
      owner.token,
      'GET',
      undefined,
    )

    expect(listed.response.status).toBe(200)
    expect(listed.body.attachments[0].waveform).toEqual(waveform)
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
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        externalIdentityId: identity.id,
        refreshTokenHash: `hash-${subject}`,
        refreshTokenFamilyHash: `family-${subject}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    return { userId: user.id, token: await signAccessToken({ sub: user.id, sessionId: session.id }, env) }
  }

  async function createFamily(token: string, name: string) {
    const created = await request('/api/v1/families', token, 'POST', {
      name, timezone: 'Europe/Moscow',
    }, randomUUID())
    if (created.response.status === 201) {
      const avatar = await prisma.mediaAsset.create({
        data: {
          familyId: created.body.family.id,
          uploaderId: created.body.family.ownerUserId,
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
      const child = await prisma.child.create({
        data: {
          familyId: created.body.family.id,
          displayName: 'Test child',
          birthDate: new Date('2024-01-01T00:00:00.000Z'),
          sex: 'girl',
          avatarMediaId: avatar.id,
          avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
        },
      })
      created.body.child = { id: child.id }
    }
    return created
  }

  async function inviteMember(
    ownerToken: string,
    memberToken: string,
    familyId: string,
    role: 'full' | 'viewer',
  ) {
    const invite = await request(
      `/api/v1/families/${familyId}/invites`,
      ownerToken,
      'POST',
      { role },
      randomUUID(),
    )
    expect(invite.response.status).toBe(201)
    const accepted = await request('/api/v1/invites/accept', memberToken, 'POST', {
      token: invite.body.rawToken,
    })
    expect(accepted.response.status).toBe(200)
  }

  async function beginDatabaseBlock(sql: string, parameters: unknown[] = []) {
    const client = new Client({ connectionString: databaseUrl! })
    await client.connect()
    await client.query('BEGIN')
    await client.query(sql, parameters)
    return client
  }

  async function waitForLockedQuery(client: Client, queryFragment?: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      // PostgreSQL caches cumulative-statistics snapshots for the duration of a transaction.
      // The blocker deliberately stays in one transaction, so refresh before observing a second
      // connection that may have begun waiting after the previous poll.
      await client.query('SELECT pg_stat_clear_snapshot()')
      const result = await client.query<{ waiting: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND ($1::text IS NULL OR query ILIKE $1)
         ) AS waiting`,
        [queryFragment ? `%${queryFragment}%` : null],
      )
      if (result.rows[0]?.waiting) return
      await Bun.sleep(50)
    }
    await client.query('SELECT pg_stat_clear_snapshot()')
    const activity = await client.query<{
      state: string
      wait_event_type: string | null
      wait_event: string | null
      query: string
    }>(`
      SELECT state, wait_event_type, wait_event, query
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
       ORDER BY pid
    `)
    throw new Error(
      `Timed out waiting for a blocked PostgreSQL query${queryFragment ? ` containing ${queryFragment}` : ''}: ${JSON.stringify(activity.rows)}`,
    )
  }

  async function rollbackAndClose(client: Client) {
    try {
      await client.query('ROLLBACK')
    } finally {
      await client.end()
    }
  }

  function createNote(token: string, familyId: string, childId: string, body: string, occurredAt = Date.now() - 30_000) {
    return request(`/api/v1/families/${familyId}/memories`, token, 'POST',
      noteInput(childId, body, occurredAt), randomUUID())
  }

  function createMemoryAsset(familyId: string, uploaderId: string, mediaKind: 'photo' | 'video' | 'voice', originalStatus: 'stored' | 'pending' = 'stored') {
    const mime = mediaKind === 'photo' ? 'image/png' : mediaKind === 'video' ? 'video/mp4' : 'audio/ogg'
    return prisma.mediaAsset.create({ data: {
      familyId, uploaderId, sourceKind: 'upload', purpose: 'memory', mediaKind,
      originalKey: `media-originals/${randomUUID()}`, declaredMime: mime, verifiedMime: mime,
      sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: 1n,
      originalStatus, renditionStatus: 'ready',
    } })
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
    return requestThrough(app, path, token, method, body, idempotencyKey, extraHeaders)
  }

  async function requestThrough(
    targetApp: ReturnType<typeof createApp>,
    path: string,
    token: string,
    method: string,
    body: unknown,
    idempotencyKey?: string,
    extraHeaders: Record<string, string> = {},
  ) {
    const response = await targetApp.request(path, {
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
