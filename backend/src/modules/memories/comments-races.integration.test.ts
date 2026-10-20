import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { commentFixtures } from './infrastructure/comment-test-fixtures'

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip
suite('COM-2 comment mutation transaction races', () => {
  const f = commentFixtures()
  afterAll(f.cleanup)

  test('a write waiting behind membership revocation observes the revoked membership', async () => {
    const owner = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner),
      member = await f.user()
    await f.db.familyMember.create({
      data: { familyId: family.id, userId: member.id, role: 'viewer' },
    })
    const create = await f.request(f.path(family.id, memory.id), member.token, 'POST', { body: 'before revoke' }, randomUUID())
    const commentId = create.body.comment.id
    const blocker = await f.blocker(
      'UPDATE family_members SET revoked_at=now() WHERE family_id=$1 AND user_id=$2',
      [family.id, member.id],
    )
    try {
      const write = f.app.request(`${f.path(family.id, memory.id)}/${commentId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${member.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'after revoke', expectedVersion: 1 }),
      })
      await f.waitLocked(blocker, 'SELECT user_id FROM family_members')
      await blocker.query('COMMIT')
      expect((await write).status).toBe(404)
      expect(await f.db.memoryComment.findUniqueOrThrow({ where: { id: commentId } })).toMatchObject({
        body: 'before revoke', version: 1,
      })
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      await blocker.end()
    }
  })

  test('concurrent same-version edits allow only one update', async () => {
    const owner = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    const path = f.path(family.id, memory.id)
    const created = await f.request(path, owner.token, 'POST', { body: 'initial' }, randomUUID())
    const id = created.body.comment.id
    const blocker = await f.blocker('SELECT id FROM memory_comments WHERE id=$1 FOR UPDATE', [id])
    try {
      const edit = (body: string) => f.app.request(`${path}/${id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, expectedVersion: 1 }),
      })
      const first = edit('one')
      await f.waitLocked(blocker, 'memory_comments')
      const second = edit('two')
      await f.waitLocked(blocker, 'SELECT id FROM memories')
      await blocker.query('COMMIT')
      const responses = await Promise.all([first, second])
      expect(responses.map((response) => response.status)).toEqual([200, 409])
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      await blocker.end()
    }
    const saved = await f.db.memoryComment.findUniqueOrThrow({ where: { id } })
    expect(['one', 'two']).toContain(saved.body)
    expect(saved.version).toBe(2)
  })

  test('controlled edit/delete overlap preserves both lock winners', async () => {
    const owner = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    const path = f.path(family.id, memory.id)
    const editFirst = await f.request(path, owner.token, 'POST', { body: 'edit first' }, randomUUID())
    const firstId = editFirst.body.comment.id
    const patchThenDeleteBlocker = await f.blocker('SELECT id FROM memory_comments WHERE id=$1 FOR UPDATE', [firstId])
    try {
      const patch = f.app.request(`${path}/${firstId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'edited', expectedVersion: 1 }),
      })
      await f.waitLocked(patchThenDeleteBlocker, 'memory_comments')
      const del = f.app.request(`${path}/${firstId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}`, 'If-Match': '1' },
      })
      await f.waitLocked(patchThenDeleteBlocker, 'SELECT id FROM memories')
      await patchThenDeleteBlocker.query('COMMIT')
      expect((await patch).status).toBe(200)
      expect((await del).status).toBe(409)
      expect((await f.app.request(`${path}/${firstId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}`, 'If-Match': '2' },
      })).status).toBe(200)
      expect(await f.db.memoryComment.findUniqueOrThrow({ where: { id: firstId } })).toMatchObject({ body: '', version: 3 })
    } finally {
      await patchThenDeleteBlocker.query('ROLLBACK').catch(() => undefined)
      await patchThenDeleteBlocker.end()
    }

    const deleteFirst = await f.request(path, owner.token, 'POST', { body: 'delete first' }, randomUUID())
    const secondId = deleteFirst.body.comment.id
    const deleteThenPatchBlocker = await f.blocker('SELECT id FROM memory_comments WHERE id=$1 FOR UPDATE', [secondId])
    try {
      const del = f.app.request(`${path}/${secondId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}`, 'If-Match': '1' },
      })
      await f.waitLocked(deleteThenPatchBlocker, 'memory_comments')
      const patch = f.app.request(`${path}/${secondId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'too late', expectedVersion: 1 }),
      })
      await f.waitLocked(deleteThenPatchBlocker, 'SELECT id FROM memories')
      await deleteThenPatchBlocker.query('COMMIT')
      expect((await del).status).toBe(200)
      expect((await patch).status).toBe(409)
      expect(await f.db.memoryComment.findUniqueOrThrow({ where: { id: secondId } })).toMatchObject({ body: '', version: 2 })
    } finally {
      await deleteThenPatchBlocker.query('ROLLBACK').catch(() => undefined)
      await deleteThenPatchBlocker.end()
    }
    expect(await f.db.memoryComment.count({ where: { memoryId: memory.id, deletedAt: null } })).toBe(0)
  })

  test('a comment write waiting on a parent memory delete cannot recreate the deleted target', async () => {
    const owner = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    const created = await f.request(f.path(family.id, memory.id), owner.token, 'POST', { body: 'before parent purge' }, randomUUID())
    const commentId = created.body.comment.id
    const blocker = await f.blocker('SELECT id FROM memories WHERE id=$1 FOR UPDATE', [memory.id])
    try {
      const write = f.app.request(`${f.path(family.id, memory.id)}/${commentId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'racing write', expectedVersion: 1 }),
      })
      await f.waitLocked(blocker, 'SELECT id FROM memories')
      await blocker.query('DELETE FROM memories WHERE id=$1', [memory.id])
      await blocker.query('COMMIT')
      expect((await write).status).toBe(404)
      expect(await f.db.memoryComment.count({ where: { id: commentId } })).toBe(0)
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined)
      await blocker.end()
    }
  })

  test('a revoked author cannot repeat a previously authorized delete', async () => {
    const owner = await f.user(), member = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    await f.db.familyMember.create({ data: { familyId: family.id, userId: member.id, role: 'viewer' } })
    const path = f.path(family.id, memory.id)
    const created = await f.request(path, member.token, 'POST', { body: 'member comment' }, randomUUID())
    expect((await f.app.request(`${path}/${created.body.comment.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${member.token}`, 'If-Match': '1' },
    })).status).toBe(200)
    await f.db.familyMember.update({
      where: { familyId_userId: { familyId: family.id, userId: member.id } },
      data: { revokedAt: new Date() },
    })
    expect((await f.app.request(`${path}/${created.body.comment.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${member.token}`, 'If-Match': '1' },
    })).status).toBe(404)
  })

  test('a write that holds membership share lock can finish before a waiting revoke', async () => {
    const owner = await f.user(), member = await f.user(), family = await f.family(owner), memory = await f.memory(family, owner)
    await f.db.familyMember.create({ data: { familyId: family.id, userId: member.id, role: 'viewer' } })
    const path = f.path(family.id, memory.id)
    const created = await f.request(path, member.token, 'POST', { body: 'before edit' }, randomUUID())
    const commentId = created.body.comment.id
    const commentBlocker = await f.blocker('SELECT id FROM memory_comments WHERE id=$1 FOR UPDATE', [commentId])
    const revoker = new Client({ connectionString: process.env.TEST_DATABASE_URL! })
    await revoker.connect()
    await revoker.query('BEGIN')
    try {
      const write = f.app.request(`${path}/${commentId}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${member.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'write wins', expectedVersion: 1 }),
      })
      await f.waitLocked(commentBlocker, 'memory_comments')
      const revoke = revoker.query('UPDATE family_members SET revoked_at=now() WHERE family_id=$1 AND user_id=$2', [family.id, member.id])
      await f.waitLocked(commentBlocker, 'UPDATE family_members')
      await commentBlocker.query('COMMIT')
      expect((await write).status).toBe(200)
      await revoke
      await revoker.query('COMMIT')
      expect((await f.request(path, member.token)).response.status).toBe(404)
      expect(await f.db.memoryComment.findUniqueOrThrow({ where: { id: commentId } })).toMatchObject({ body: 'write wins', version: 2 })
    } finally {
      await commentBlocker.query('ROLLBACK').catch(() => undefined)
      await commentBlocker.end()
      await revoker.query('ROLLBACK').catch(() => undefined)
      await revoker.end()
    }
  })
})
