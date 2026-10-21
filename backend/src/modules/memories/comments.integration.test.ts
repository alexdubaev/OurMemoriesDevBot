import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  commentPageSchema,
  memoryDtoSchema,
  memoryPageSchema,
} from '@web-app-demo/contracts'
import { createApp } from '../../app'
import { commentFixtures } from './infrastructure/comment-test-fixtures'
import { Client } from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const databaseUrl = requireIntegrationDatabaseUrl()
const suite = describe
suite('COM-1 comments', () => {
  const f = commentFixtures()
  afterAll(f.cleanup)
  test('additive migration upgrades the actual base schema and leaves existing memory data intact', async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!)
    const databaseName = `com1_upgrade_${randomUUID().replaceAll('-', '')}_test`
    const admin = new Client({ connectionString: url.toString() })
    await admin.connect()
    url.pathname = `/${databaseName}`
    const upgraded = new Client({ connectionString: url.toString() })
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`)
      await upgraded.connect()
      const root = resolve(import.meta.dir, '../../../prisma/migrations')
      const migrations = (await readdir(root))
        .filter((name) => /^\d{14}_/.test(name))
        .sort()
      const boundary = migrations.findIndex((name) =>
        name.endsWith('_memory_comments'),
      )
      expect(boundary).toBeGreaterThan(0)
      for (const migration of migrations.slice(0, boundary))
        await upgraded.query(
          await readFile(resolve(root, migration, 'migration.sql'), 'utf8'),
        )
      const userId = randomUUID(),
        familyId = randomUUID(),
        childId = randomUUID(),
        memoryId = randomUUID()
      await upgraded.query('BEGIN')
      await upgraded.query('SET CONSTRAINTS ALL DEFERRED')
      await upgraded.query(
        "INSERT INTO users(id,display_name,updated_at) VALUES($1,'Synthetic',now())",
        [userId],
      )
      await upgraded.query(
        "INSERT INTO families(id,owner_user_id,name,timezone,updated_at) VALUES($1,$2,'Synthetic','Europe/Moscow',now())",
        [familyId, userId],
      )
      await upgraded.query(
        "INSERT INTO family_members(family_id,user_id,role) VALUES($1,$2,'full')",
        [familyId, userId],
      )
      await upgraded.query(
        "INSERT INTO children(id,family_id,display_name,updated_at) VALUES($1,$2,'Synthetic',now())",
        [childId, familyId],
      )
      await upgraded.query(
        "INSERT INTO memories(id,family_id,child_id,author_id,kind,body,occurred_at,first_published_at,updated_at) VALUES($1,$2,$3,$4,'note','Existing',now(),now(),now())",
        [memoryId, familyId, childId, userId],
      )
      await upgraded.query('COMMIT')
      const before = (
        await upgraded.query('SELECT * FROM memories WHERE id=$1', [memoryId])
      ).rows
      await upgraded.query(
        await readFile(
          resolve(root, migrations[boundary]!, 'migration.sql'),
          'utf8',
        ),
      )
      expect(
        (await upgraded.query('SELECT * FROM memories WHERE id=$1', [memoryId]))
          .rows,
      ).toEqual(before)
      expect(
        (
          await upgraded.query(
            'SELECT count(*)::int AS count FROM memory_comments',
          )
        ).rows[0].count,
      ).toBe(0)
      await upgraded.query(
        "INSERT INTO memory_comments(family_id,memory_id,author_id,body,create_request_id,initial_payload_hash) VALUES($1,$2,$3,'New',$4,'hash')",
        [familyId, memoryId, userId, randomUUID()],
      )
      await upgraded.query('DELETE FROM memories WHERE id=$1', [memoryId])
      expect(
        (
          await upgraded.query(
            'SELECT count(*)::int AS count FROM memory_comments',
          )
        ).rows[0].count,
      ).toBe(0)
    } finally {
      await upgraded.end().catch(() => undefined)
      await admin.query(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      )
      await admin.end()
    }
  })
  test('create_for_member_roles, server_authorship and legacy_unchanged', async () => {
    const owner = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner)
    const before = await f.db.memory.findUniqueOrThrow({
      where: { id: memory.id },
    })
    const familyBefore = await f.db.family.findUniqueOrThrow({
      where: { id: family.id },
    })
    for (const role of ['owner', 'full', 'viewer'] as const) {
      const actor = role === 'owner' ? owner : await f.user()
      if (role !== 'owner')
        await f.db.familyMember.create({
          data: {
            familyId: family.id,
            userId: actor.id,
            role,
            familyDisplayName: 'Семейное имя',
          },
        })
      const result = await f.request(
        f.path(family.id, memory.id),
        actor.token,
        'POST',
        { body: '  <b>Привет</b>\r\n😀  ' },
        randomUUID(),
      )
      expect(result.response.status).toBe(201)
      expect(result.body.comment).toMatchObject({
        body: '<b>Привет</b>\n😀',
        author: {
          id: actor.id,
          name: role === 'owner' ? 'Человек' : 'Семейное имя',
        },
        capabilities: { edit: true, delete: true },
      })
      if (role === 'viewer')
        expect(
          (
            await f.request(
              `/api/v1/families/${family.id}/memories`,
              actor.token,
              'POST',
              {
                kind: 'photo',
                childId: family.childId,
                mediaIds: [randomUUID()],
                body: '',
                occurredAt: new Date().toISOString(),
              },
              randomUUID(),
            )
          ).response.status,
        ).toBe(403)
    }
    expect(
      await f.db.memory.findUniqueOrThrow({ where: { id: memory.id } }),
    ).toEqual(before)
    expect(
      await f.db.family.findUniqueOrThrow({ where: { id: family.id } }),
    ).toEqual(familyBefore)
    expect(
      await f.db.memorySeen.count({ where: { memoryId: memory.id } }),
    ).toBe(0)
    const listed = await f.request(f.path(family.id, memory.id), owner.token)
    expect(commentPageSchema.safeParse(listed.body).success).toBe(true)
    expect(listed.body.summary.count).toBe(3)
    expect(
      memoryDtoSchema.safeParse(
        (
          await f.request(
            `/api/v1/families/${family.id}/memories/${memory.id}`,
            owner.token,
          )
        ).body,
      ).success,
    ).toBe(true)
    expect(
      memoryPageSchema.safeParse(
        (await f.request(`/api/v1/families/${family.id}/memories`, owner.token))
          .body,
      ).success,
    ).toBe(true)
    const createdMemory = await f.request(
      `/api/v1/families/${family.id}/memories`,
      owner.token,
      'POST',
      {
        kind: 'note',
        childId: family.childId,
        body: 'Legacy create',
        occurredAt: new Date().toISOString(),
      },
      randomUUID(),
    )
    expect(createdMemory.response.status).toBe(201)
    expect(memoryDtoSchema.safeParse(createdMemory.body).success).toBe(true)
    expect(
      (
        await f.request(
          f.path(family.id, memory.id),
          owner.token,
          'POST',
          { body: 'a', authorId: owner.id },
          randomUUID(),
        )
      ).response.status,
    ).toBe(400)
  })
  test('MAX publication comments retain human identity and private avatar crop, revoked author avatar is hidden', async () => {
    const owner = await f.user(),
      author = await f.user('Профиль'),
      family = await f.family(owner),
      memory = await f.memory(family, owner)
    await f.db.familyMember.create({
      data: {
        familyId: family.id,
        userId: author.id,
        role: 'viewer',
        familyDisplayName: 'Папа',
      },
    })
    const crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    const avatar = await f.db.userAvatar.create({
      data: {
        userId: author.id,
        state: 'ready',
        objectKey: `avatars/${randomUUID()}`,
        contentType: 'image/png',
        byteSize: 1,
        expiresAt: new Date(Date.now() + 3600_000),
        avatarCrop: crop,
      },
    })
    const inbox = await f.db.maxInbox.create({
      data: {
        eventKey: randomUUID(),
        botId: 900n,
        eventKind: 'message_created',
        encryptedPayload: Buffer.from([1]),
        encryptionIv: Buffer.from([1]),
        encryptionAuthTag: Buffer.from([1]),
      },
    })
    try {
      await f.db.maxSource.create({
        data: {
          inboxId: inbox.id,
          botId: 900n,
          senderSubject: '31001',
          recipientId: -123n,
          messageId: randomUUID(),
          status: 'published',
          plannedMemoryId: memory.id,
          memoryId: memory.id,
          userId: owner.id,
          familyId: family.id,
          childId: family.childId,
        },
      })
      const response = await f.request(
        f.path(family.id, memory.id),
        author.token,
        'POST',
        { body: 'Человек' },
        randomUUID(),
      )
      expect(response.body.comment.author).toEqual({
        id: author.id,
        name: 'Папа',
        avatarPath: `/api/v1/families/${family.id}/media/avatars/${author.id}/${avatar.id}/content`,
        avatarCrop: crop,
      })
      await f.db.familyMember.update({
        where: { familyId_userId: { familyId: family.id, userId: author.id } },
        data: { revokedAt: new Date() },
      })
      const listed = await f.request(f.path(family.id, memory.id), owner.token)
      expect(listed.body.items[0].author).toMatchObject({
        id: author.id,
        name: 'Папа',
        avatarPath: null,
        avatarCrop: null,
      })
    } finally {
      await f.db.maxInbox.delete({ where: { id: inbox.id } })
    }
  })
  test('private_scope and published_only including composite FK and parent purge', async () => {
    const owner = await f.user(),
      family = await f.family(owner),
      outsider = await f.user(),
      other = await f.family(outsider)
    const memory = await f.memory(family, owner)
    for (const token of [undefined, outsider.token]) {
      expect(
        (await f.request(f.path(family.id, memory.id), token)).response.status,
      ).toBe(token ? 404 : 401)
      expect(
        (
          await f.request(
            `/api/v1/families/${family.id}/memories/comment-summaries`,
            token,
            'POST',
            { memoryIds: [memory.id] },
          )
        ).response.status,
      ).toBe(token ? 404 : 401)
    }
    expect(
      (await f.request(f.path(other.id, memory.id), outsider.token)).response
        .status,
    ).toBe(404)
    for (const kind of ['note', 'photo', 'video', 'voice', 'media'] as const) {
      const row = await f.memory(family, owner, kind)
      expect(
        (
          await f.request(
            f.path(family.id, row.id),
            owner.token,
            'POST',
            { body: kind },
            randomUUID(),
          )
        ).response.status,
      ).toBe(201)
    }
    for (const status of ['processing', 'deleted'] as const) {
      await f.db.memory.update({
        where: { id: memory.id },
        data: { status, deletedAt: status === 'deleted' ? new Date() : null },
      })
      expect(
        (await f.request(f.path(family.id, memory.id), owner.token)).response
          .status,
      ).toBe(404)
    }
    await f.db.memory.update({
      where: { id: memory.id },
      data: { status: 'published', deletedAt: null },
    })
    const write = await f.request(
      f.path(family.id, memory.id),
      owner.token,
      'POST',
      { body: 'a' },
      randomUUID(),
    )
    expect(write.response.status).toBe(201)
    await expect(
      Promise.resolve(
        f.db.memoryComment.create({
          data: {
            familyId: other.id,
            memoryId: memory.id,
            authorId: outsider.id,
            body: 'bad',
            createRequestId: randomUUID(),
            initialPayloadHash: 'hash',
          },
        }),
      ),
    ).rejects.toThrow()
    await expect(
      Promise.resolve(
        f.db.memoryComment.create({
          data: {
            familyId: family.id,
            memoryId: memory.id,
            authorId: outsider.id,
            body: 'bad',
            createRequestId: randomUUID(),
            initialPayloadHash: 'hash',
          },
        }),
      ),
    ).rejects.toThrow()
    await f.db.memory.delete({ where: { id: memory.id } })
    expect(
      await f.db.memoryComment.count({ where: { memoryId: memory.id } }),
    ).toBe(0)
    const member = await f.user()
    await f.db.familyMember.create({
      data: { familyId: family.id, userId: member.id, role: 'viewer' },
    })
    const live = await f.memory(family, owner)
    await f.request(
      f.path(family.id, live.id),
      member.token,
      'POST',
      { body: 'history' },
      randomUUID(),
    )
    await f.db.familyMember.update({
      where: { familyId_userId: { familyId: family.id, userId: member.id } },
      data: { revokedAt: new Date() },
    })
    expect(
      (await f.request(f.path(family.id, live.id), member.token)).response
        .status,
    ).toBe(404)
    expect(
      (await f.request(f.path(family.id, live.id), owner.token)).body.summary
        .count,
    ).toBe(1)
    await f.db.user.delete({ where: { id: member.id } })
    expect(
      await f.db.memoryComment.count({ where: { memoryId: live.id } }),
    ).toBe(0)
    await f.db.family.update({
      where: { id: family.id },
      data: { status: 'deleted' },
    })
    expect(
      (await f.request(f.path(family.id, live.id), owner.token)).response
        .status,
    ).toBe(404)
  })
  test('pagination is stable for 65 equal millisecond timestamps and cursor survives anchor deletion', async () => {
    const owner = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner),
      other = await f.memory(family, owner)
    const createdAt = new Date('2026-10-20T12:34:56.789Z')
    await f.db.memoryComment.createMany({
      data: Array.from({ length: 65 }, () => ({
        id: randomUUID(),
        familyId: family.id,
        memoryId: memory.id,
        authorId: owner.id,
        body: 'x',
        createRequestId: randomUUID(),
        initialPayloadHash: 'hash',
        createdAt,
      })),
    })
    const first = await f.request(
      f.path(family.id, memory.id) + '?limit=50',
      owner.token,
    )
    expect(first.body.items).toHaveLength(50)
    expect(
      (
        await f.request(
          f.path(family.id, other.id) +
            '?cursor=' +
            encodeURIComponent(first.body.nextCursor),
          owner.token,
        )
      ).response.status,
    ).toBe(400)
    const foreignOwner = await f.user(),
      foreignFamily = await f.family(foreignOwner),
      foreignMemory = await f.memory(foreignFamily, foreignOwner)
    expect(
      (
        await f.request(
          f.path(foreignFamily.id, foreignMemory.id) +
            '?cursor=' +
            encodeURIComponent(first.body.nextCursor),
          foreignOwner.token,
        )
      ).response.status,
    ).toBe(400)
    await f.db.memoryComment.delete({
      where: { id: first.body.items.at(-1).id },
    })
    const second = await f.request(
      f.path(family.id, memory.id) +
        '?limit=50&cursor=' +
        encodeURIComponent(first.body.nextCursor),
      owner.token,
    )
    expect(second.body.items).toHaveLength(15)
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map(
          (row: { id: string }) => row.id,
        ),
      ).size,
    ).toBe(65)
    expect(second.body.nextCursor).toBeNull()
    for (const query of ['?limit=51', '?cursor=bad'])
      expect(
        (await f.request(f.path(family.id, memory.id) + query, owner.token))
          .response.status,
      ).toBe(400)
  })
  test('batch_counts returns only accessible memories with bounded query count', async () => {
    const owner = await f.user(),
      family = await f.family(owner)
    const rows = await Promise.all(
      Array.from({ length: 50 }, () => f.memory(family, owner)),
    )
    const outsider = await f.user(),
      other = await f.family(outsider),
      foreign = await f.memory(other, outsider)
    await f.request(
      f.path(family.id, rows[0]!.id),
      owner.token,
      'POST',
      { body: 'one' },
      randomUUID(),
    )
    const queries: string[] = []
    const proxy = new Proxy(f.db, {
      get(target, prop) {
        if (prop !== '$transaction') return Reflect.get(target, prop)
        return (callback: any) =>
          target.$transaction((tx: any) =>
            callback(
              new Proxy(tx, {
                get(t, p) {
                  const value = Reflect.get(t, p)
                  if (p === '$queryRaw')
                    return (...args: any[]) => {
                      queries.push(String(p))
                      return value.apply(t, args)
                    }
                  if (
                    ['memory', 'memoryComment', 'familyMember'].includes(
                      String(p),
                    )
                  )
                    return new Proxy(value, {
                      get(model, method) {
                        const fn = Reflect.get(model, method)
                        return typeof fn === 'function'
                          ? (...args: any[]) => {
                              queries.push(`${String(p)}.${String(method)}`)
                              return fn.apply(model, args)
                            }
                          : fn
                      },
                    })
                  return value
                },
              }),
            ),
          )
      },
    })
    const target = createApp({ env: f.env, prisma: proxy })
    const result = await f.request(
      `/api/v1/families/${family.id}/memories/comment-summaries`,
      owner.token,
      'POST',
      { memoryIds: rows.map((row) => row.id) },
      undefined,
      target,
    )
    expect(result.response.status).toBe(200)
    expect(result.body.items).toHaveLength(50)
    expect(
      result.body.items.find(
        (row: { memoryId: string }) => row.memoryId === rows[0]!.id,
      ).count,
    ).toBe(1)
    expect(queries.length).toBeLessThan(10)
    const hidden = await f.request(
      `/api/v1/families/${family.id}/memories/comment-summaries`,
      owner.token,
      'POST',
      { memoryIds: [rows[1]!.id, foreign.id, randomUUID()] },
    )
    expect(hidden.body.items).toEqual([
      {
        memoryId: rows[1]!.id,
        count: 0,
        capabilities: { read: true, create: true },
      },
    ])
  })
  test('all success, validation, auth, body limit and rate limit responses are private no-store', async () => {
    const owner = await f.user(),
      family = await f.family(owner),
      memory = await f.memory(family, owner),
      path = f.path(family.id, memory.id)
    const results = [
      await f.request(path, owner.token),
      await f.request(path),
      await f.request(path, owner.token, 'POST', { body: ' ' }, randomUUID()),
      await f.request(
        path,
        owner.token,
        'POST',
        { body: 'x'.repeat(17000) },
        randomUUID(),
      ),
    ]
    expect(results.map((row) => row.response.status)).toEqual([
      200, 401, 400, 413,
    ])
    const rateApp = createApp({
      env: { ...f.env, AUTH_RATE_LIMIT_MAX: 1 },
      prisma: f.db,
    })
    await f.request(
      path,
      owner.token,
      'POST',
      { body: 'first' },
      randomUUID(),
      rateApp,
    )
    const limited = await f.request(
      path,
      owner.token,
      'POST',
      { body: 'second' },
      randomUUID(),
      rateApp,
    )
    expect(limited.response.status).toBe(429)
    for (const result of [...results, limited])
      expect(result.response.headers.get('cache-control')).toBe(
        'private, no-store',
      )
  })
})
