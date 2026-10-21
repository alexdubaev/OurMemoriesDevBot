import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { commentFixtures } from './infrastructure/comment-test-fixtures'

const databaseUrl = requireIntegrationDatabaseUrl()
const suite = describe
suite('COM-2 comment mutation permissions and lifecycle', () => {
  const f = commentFixtures()
  afterAll(f.cleanup)

  async function mutate(
    path: string,
    token: string,
    method: 'PATCH' | 'DELETE',
    body?: unknown,
    version?: number,
  ) {
    const response = await f.app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(version !== undefined ? { 'If-Match': String(version) } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) : undefined }
  }

  test('edits only the author own comment with atomic version and fresh replay', async () => {
    const owner = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner),
      viewer = await f.user()
    await f.db.familyMember.create({
      data: { familyId: family.id, userId: viewer.id, role: 'viewer' },
    })
    const key = randomUUID(), path = f.path(family.id, memory.id)
    const memoryBefore = await f.db.memory.findUniqueOrThrow({ where: { id: memory.id } })
    const created = await f.request(path, viewer.token, 'POST', { body: 'original' }, key)
    expect(created.response.status).toBe(201)
    expect(created.body.comment.capabilities).toEqual({ edit: true, delete: true })

    const updated = await mutate(`${path}/${created.body.comment.id}`, viewer.token, 'PATCH', {
      body: ' edited\r\n text ', expectedVersion: created.body.comment.version,
    })
    expect(updated.response.status).toBe(200)
    expect(updated.body.comment).toMatchObject({
      body: 'edited\n text', version: created.body.comment.version + 1,
      author: { id: viewer.id }, capabilities: { edit: true, delete: true },
    })
    const stored = await f.db.memoryComment.findUniqueOrThrow({ where: { id: created.body.comment.id } })
    expect(stored).toMatchObject({
      authorId: viewer.id, createdAt: new Date(created.body.comment.createdAt),
      createRequestId: key.toLowerCase(), initialPayloadHash: expect.any(String),
    })
    expect(await f.db.memory.findUniqueOrThrow({ where: { id: memory.id } })).toEqual(memoryBefore)
    expect(Date.parse(updated.body.comment.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(created.body.comment.updatedAt),
    )
    await f.db.idempotencyRecord.deleteMany({ where: { actorUserId: viewer.id } })
    const replay = await f.request(path, viewer.token, 'POST', { body: 'original' }, key)
    expect(replay.response.status).toBe(200)
    expect(replay.body.comment.body).toBe('edited\n text')
    expect((await mutate(`${path}/${created.body.comment.id}`, viewer.token, 'PATCH', {
      body: 'stale', expectedVersion: created.body.comment.version,
    })).response.status).toBe(409)
    expect((await mutate(`${path}/${created.body.comment.id}`, owner.token, 'PATCH', {
      body: 'foreign', expectedVersion: updated.body.comment.version,
    })).response.status).toBe(403)
  })

  test('deletes own comment for members, foreign comment only for actual family owner, and replays tombstone safely', async () => {
    const owner = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner),
      full = await f.user(), viewer = await f.user()
    for (const [actor, role] of [[full, 'full'], [viewer, 'viewer']] as const)
      await f.db.familyMember.create({
        data: { familyId: family.id, userId: actor.id, role },
      })
    const path = f.path(family.id, memory.id)
    const ownKey = randomUUID()
    const authored = await f.request(path, full.token, 'POST', { body: 'own' }, ownKey)
    expect((await mutate(`${path}/${authored.body.comment.id}`, full.token, 'DELETE', undefined, 1)).response.status).toBe(200)
    const replay = await mutate(`${path}/${authored.body.comment.id}`, full.token, 'DELETE', undefined, 1)
    expect(replay.response.status).toBe(200)
    expect(replay.body.summary.count).toBe(0)
    expect(JSON.stringify(replay.body)).not.toContain('own')
    const createReplay = await f.request(path, full.token, 'POST', { body: 'own' }, ownKey)
    // The durable marker rejects resurrection even when the response snapshot is unavailable.
    expect(createReplay.response.status).toBe(409)

    const foreign = await f.request(path, viewer.token, 'POST', { body: 'foreign' }, randomUUID())
    const foreignId = foreign.body.comment.id
    const ownerView = await f.request(path, owner.token)
    expect(ownerView.body.items.find((item: { id: string }) => item.id === foreignId).capabilities).toEqual({ edit: false, delete: true })
    const fullView = await f.request(path, full.token)
    expect(fullView.body.items.find((item: { id: string }) => item.id === foreignId).capabilities).toEqual({ edit: false, delete: false })
    expect((await mutate(`${path}/${foreignId}`, full.token, 'DELETE', undefined, 1)).response.status).toBe(403)
    expect((await mutate(`${path}/${foreignId}`, owner.token, 'PATCH', { body: 'owner cannot edit', expectedVersion: 1 })).response.status).toBe(403)
    const deleted = await mutate(`${path}/${foreignId}`, owner.token, 'DELETE', undefined, 1)
    expect(deleted.response.status).toBe(200)
    expect(deleted.body.summary.count).toBe(0)
    expect(await f.db.memoryComment.findUniqueOrThrow({ where: { id: foreignId } })).toMatchObject({ body: '', version: 2, deletedAt: expect.any(Date) })
    await f.db.idempotencyRecord.deleteMany({ where: { actorUserId: viewer.id } })
    expect((await f.request(path, viewer.token, 'POST', { body: 'foreign' }, (await f.db.memoryComment.findUniqueOrThrow({ where: { id: foreignId } })).createRequestId)).response.status).toBe(409)
    expect(deleted.response.headers.get('cache-control')).toBe('private, no-store')
    expect((await mutate(`${path}/${foreignId}`, owner.token, 'DELETE', undefined, 1)).response.status).toBe(200)
  })

  test('rejects malformed and stale mutation requests and scopes errors privately', async () => {
    const owner = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    const path = f.path(family.id, memory.id)
    const created = await f.request(path, owner.token, 'POST', { body: 'x' }, randomUUID())
    const id = created.body.comment.id
    const unauthenticated = await f.app.request(`${path}/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x', expectedVersion: 1 }),
    })
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('cache-control')).toBe('private, no-store')
    expect((await mutate(`${path}/${id}`, owner.token, 'PATCH', { body: 'x', expectedVersion: 1, authorId: owner.id })).response.status).toBe(400)
    expect((await mutate(`${path}/${id}`, owner.token, 'DELETE')).response.status).toBe(400)
    const stale = await mutate(`${path}/${id}`, owner.token, 'DELETE', undefined, 9)
    expect(stale.response.status).toBe(409)
    expect(stale.response.headers.get('cache-control')).toBe('private, no-store')
    const oversized = await f.app.request(`${path}/${id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x'.repeat(17000), expectedVersion: 1 }),
    })
    expect(oversized.status).toBe(413)
    expect(oversized.headers.get('cache-control')).toBe('private, no-store')
  })

  test('Owner, Full and Viewer can each edit and delete their own comments, with family isolation', async () => {
    const owner = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    const full = await f.user(), viewer = await f.user()
    await f.db.familyMember.createMany({ data: [
      { familyId: family.id, userId: full.id, role: 'full' },
      { familyId: family.id, userId: viewer.id, role: 'viewer' },
    ] })
    const path = f.path(family.id, memory.id)
    for (const actor of [owner, full, viewer]) {
      const created = await f.request(path, actor.token, 'POST', { body: 'own' }, randomUUID())
      const edited = await mutate(`${path}/${created.body.comment.id}`, actor.token, 'PATCH', { body: 'edited', expectedVersion: 1 })
      expect(edited.response.status).toBe(200)
      expect(edited.body.comment.capabilities).toEqual({ edit: true, delete: true })
      expect((await mutate(`${path}/${created.body.comment.id}`, actor.token, 'DELETE', undefined, 2)).response.status).toBe(200)
    }
    const otherOwner = await f.user(), otherFamily = await f.family(otherOwner), otherMemory = await f.memory(otherFamily, otherOwner)
    const foreign = await f.request(f.path(otherFamily.id, otherMemory.id), otherOwner.token, 'POST', { body: 'foreign family' }, randomUUID())
    expect((await mutate(`${path}/${foreign.body.comment.id}`, owner.token, 'DELETE', undefined, 1)).response.status).toBe(404)
    await f.db.familyMember.create({ data: { familyId: otherFamily.id, userId: owner.id, role: 'full' } })
    expect((await mutate(`${f.path(otherFamily.id, otherMemory.id)}/${foreign.body.comment.id}`, owner.token, 'DELETE', undefined, 1)).response.status).toBe(403)
  })
})
