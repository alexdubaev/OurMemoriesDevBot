import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { commentFixtures } from './infrastructure/comment-test-fixtures'

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip
suite('COM-1 idempotency and lifecycle races', () => {
  const f = commentFixtures()
  afterAll(f.cleanup)
  test('idempotency_parallel and durable replay resolve the current row without old snapshots', async () => {
    const owner = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner),
      other = await f.memory(family, owner),
      key = randomUUID()
    const path = f.path(family.id, memory.id)
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        f.request(path, owner.token, 'POST', { body: ' same\r\n😀 ' }, key),
      ),
    )
    expect(results.map((row) => row.response.status).sort()).toEqual([
      200, 200, 200, 200, 200, 201,
    ])
    const id = results[0]!.body.comment.id
    expect(new Set(results.map((row) => row.body.comment.id)).size).toBe(1)
    expect(
      await f.db.memoryComment.count({ where: { memoryId: memory.id } }),
    ).toBe(1)
    const snapshot = await f.db.idempotencyRecord.findFirstOrThrow({
      where: { actorUserId: owner.id, key },
    })
    expect(snapshot.responseSnapshot).toEqual({ commentId: id })
    for (const [target, body] of [
      [path, 'different'],
      [f.path(family.id, other.id), 'same\n😀'],
    ])
      expect(
        (await f.request(target!, owner.token, 'POST', { body }, key)).response
          .status,
      ).toBe(409)
    await f.db.memoryComment.update({
      where: { id },
      data: { body: 'edited later', version: 2 },
    })
    expect(
      (await f.request(path, owner.token, 'POST', { body: 'same\n😀' }, key))
        .body.comment.body,
    ).toBe('edited later')
    await f.db.idempotencyRecord.deleteMany({
      where: { actorUserId: owner.id },
    })
    const replay = await f.request(
      path,
      owner.token,
      'POST',
      { body: 'same\n😀' },
      key,
    )
    expect(replay.response.status).toBe(200)
    expect(replay.body.comment).toMatchObject({
      id,
      body: 'edited later',
      version: 2,
    })
    expect(
      (
        await f.request(
          f.path(family.id, other.id),
          owner.token,
          'POST',
          { body: 'same\n😀' },
          key,
        )
      ).response.status,
    ).toBe(409)
    await f.db.memoryComment.update({
      where: { id },
      data: { body: '', deletedAt: new Date() },
    })
    expect(
      (await f.request(path, owner.token, 'POST', { body: 'same\n😀' }, key))
        .response.status,
    ).toBe(409)
    await f.db.idempotencyRecord.deleteMany({
      where: { actorUserId: owner.id },
    })
    expect(
      (await f.request(path, owner.token, 'POST', { body: 'same\n😀' }, key))
        .response.status,
    ).toBe(409)
    expect((await f.request(path, owner.token)).body.summary.count).toBe(0)
  })
  test('replay rechecks membership, memory and family rather than exposing a stored result', async () => {
    const owner = await f.user(),
      member = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner),
      key = randomUUID()
    await f.db.familyMember.create({
      data: { familyId: family.id, userId: member.id, role: 'viewer' },
    })
    const path = f.path(family.id, memory.id)
    expect(
      (await f.request(path, member.token, 'POST', { body: 'private' }, key))
        .response.status,
    ).toBe(201)
    await f.db.familyMember.update({
      where: { familyId_userId: { familyId: family.id, userId: member.id } },
      data: { revokedAt: new Date() },
    })
    expect(
      (await f.request(path, member.token, 'POST', { body: 'private' }, key))
        .response.status,
    ).toBe(404)
    await f.db.familyMember.update({
      where: { familyId_userId: { familyId: family.id, userId: member.id } },
      data: { revokedAt: null },
    })
    await f.db.memory.update({
      where: { id: memory.id },
      data: { deletedAt: new Date(), status: 'deleted' },
    })
    expect(
      (await f.request(path, member.token, 'POST', { body: 'private' }, key))
        .response.status,
    ).toBe(404)
    await f.db.memory.update({
      where: { id: memory.id },
      data: { deletedAt: null, status: 'published' },
    })
    await f.db.family.update({
      where: { id: family.id },
      data: { status: 'deleting' },
    })
    expect(
      (await f.request(path, member.token, 'POST', { body: 'private' }, key))
        .response.status,
    ).toBe(404)
  })
  test('revoke and delete winning their row lock prevent concurrent create', async () => {
    const owner = await f.user(),
      member = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner)
    await f.db.familyMember.create({
      data: { familyId: family.id, userId: member.id, role: 'viewer' },
    })
    for (const kind of ['member', 'memory'] as const) {
      const lock = await f.blocker(
        kind === 'member'
          ? 'SELECT user_id FROM family_members WHERE family_id=$1::uuid AND user_id=$2::uuid FOR UPDATE'
          : 'SELECT id FROM memories WHERE id=$1::uuid FOR UPDATE',
        kind === 'member' ? [family.id, member.id] : [memory.id],
      )
      try {
        const pending = f.request(
          f.path(family.id, memory.id),
          member.token,
          'POST',
          { body: 'race' },
          randomUUID(),
        )
        await f.waitLocked(
          lock,
          kind === 'member' ? 'family_members' : 'memories',
        )
        await lock.query(
          kind === 'member'
            ? 'UPDATE family_members SET revoked_at=now() WHERE family_id=$1::uuid AND user_id=$2::uuid'
            : "UPDATE memories SET deleted_at=now(), status='deleted' WHERE id=$1::uuid",
          kind === 'member' ? [family.id, member.id] : [memory.id],
        )
        await lock.query('COMMIT')
        expect((await pending).response.status).toBe(404)
      } finally {
        await lock.query('ROLLBACK')
        await lock.end()
      }
      await f.db.familyMember.update({
        where: { familyId_userId: { familyId: family.id, userId: member.id } },
        data: { revokedAt: null },
      })
    }
    expect(
      await f.db.memoryComment.count({ where: { memoryId: memory.id } }),
    ).toBe(0)
  })
})
