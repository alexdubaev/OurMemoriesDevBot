import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { commentFixtures } from './infrastructure/comment-test-fixtures'

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip
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
        ...(version !== undefined ? { 'If-Match': `"${version}"` } : {}),
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
    expect(Date.parse(updated.body.comment.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(created.body.comment.updatedAt),
    )
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
    expect((await mutate(`${path}/${foreignId}`, full.token, 'DELETE', undefined, 1)).response.status).toBe(403)
    const deleted = await mutate(`${path}/${foreignId}`, owner.token, 'DELETE', undefined, 1)
    expect(deleted.response.status).toBe(200)
    expect(deleted.body.summary.count).toBe(0)
    expect(deleted.response.headers.get('cache-control')).toBe('private, no-store')
    expect((await mutate(`${path}/${foreignId}`, owner.token, 'DELETE')).response.status).toBe(200)
  })

  test('rejects malformed and stale mutation requests and scopes errors privately', async () => {
    const owner = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    const path = f.path(family.id, memory.id)
    const created = await f.request(path, owner.token, 'POST', { body: 'x' }, randomUUID())
    const id = created.body.comment.id
    expect((await mutate(`${path}/${id}`, owner.token, 'PATCH', { body: 'x', expectedVersion: 1, authorId: owner.id })).response.status).toBe(400)
    expect((await mutate(`${path}/${id}`, owner.token, 'DELETE')).response.status).toBe(400)
    const stale = await mutate(`${path}/${id}`, owner.token, 'DELETE', undefined, 9)
    expect(stale.response.status).toBe(409)
    expect(stale.response.headers.get('cache-control')).toBe('private, no-store')
  })
})
