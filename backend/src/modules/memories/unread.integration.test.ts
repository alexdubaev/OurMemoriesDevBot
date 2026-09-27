import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { activateUnreadFamily } from '../../../scripts/activate-unread-tracking'
import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { signAccessToken } from '../auth'
import { createPrismaFamilyAccess } from '../families'
import { createSourceMemoryPublisher } from './infrastructure/source-memory-publisher'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('personal unread memories', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000',
  })
  const app = createApp({ env, prisma })
  const publisher = createSourceMemoryPublisher(prisma, createPrismaFamilyAccess(prisma))

  beforeEach(clearFixtures)
  afterAll(async () => { await clearFixtures(); await prisma.$disconnect() })

  test('B7 activation serializes and preserves the first family boundary on retry', async () => {
    const owner = await user('owner', '39100')
    const family = await createFamily(owner)
    const archived = await note(owner, family, 'archive before activation')
    expect(archived.response.status).toBe(201)
    const results = await Promise.all([
      activateUnreadFamily(prisma, family.id),
      activateUnreadFamily(prisma, family.id),
    ])
    expect(results.sort()).toEqual(['activated', 'already_active'])
    const first = await prisma.family.findUniqueOrThrow({ where: { id: family.id } })
    expect(first.unreadTrackingActivatedAt).not.toBeNull()
    expect(first.publicationOrdinal).toBe(0n)
    expect(await activateUnreadFamily(prisma, family.id)).toBe('already_active')
    const retried = await prisma.family.findUniqueOrThrow({ where: { id: family.id } })
    expect(retried.unreadTrackingActivatedAt).toEqual(first.unreadTrackingActivatedAt)
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: archived.body.id } })).firstPublishedOrdinal).toBeNull()
  })

  test('B7 activation stops on a pre-activation ordinal inconsistency', async () => {
    const owner = await user('owner', '39099')
    const family = await createFamily(owner)
    await prisma.family.update({ where: { id: family.id }, data: { publicationOrdinal: 1n } })
    await expect(activateUnreadFamily(prisma, family.id)).rejects.toThrow('inconsistent')
    expect((await prisma.family.findUniqueOrThrow({ where: { id: family.id } })).unreadTrackingActivatedAt).toBeNull()
    await prisma.family.update({ where: { id: family.id }, data: { publicationOrdinal: 0n } })
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: family.id, userId: owner.id } },
      data: { unreadBaselineOrdinal: 1n } })
    await expect(activateUnreadFamily(prisma, family.id)).rejects.toThrow('member baseline is inconsistent')
    expect((await prisma.family.findUniqueOrThrow({ where: { id: family.id } })).unreadTrackingActivatedAt).toBeNull()
  })

  test('activation excludes archive, counts delayed publications once, and keeps edits and retries quiet', async () => {
    const owner = await user('owner', '39101')
    const viewer = await user('viewer', '39102')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    const old = await note(owner, family, 'archive')
    expect(old.response.status).toBe(201)
    expect(await count(viewer)).toEqual({ unreadCount: null, unreadState: 'not_enabled' })
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: old.body.id } })).firstPublishedOrdinal).toBeNull()
    const preActivationSourceId = randomUUID()
    const scope = { familyId: family.id, principal: { userId: owner.id, sessionId: owner.sessionId } }
    const preActivationSource = () => publisher.publish(scope, { id: preActivationSourceId, childId: family.childId,
      kind: 'note', body: 'old source', occurredAt: new Date('2018-01-01'), mediaIds: [] })
    await preActivationSource()
    await activate(family.id)
    await preActivationSource()
    const fresh = await note(owner, family, 'delayed', '2020-01-01T00:00:00.000Z')
    expect(fresh.response.status).toBe(201)
    const sourceId = randomUUID()
    const source = () => publisher.publish({ familyId: family.id, principal: { userId: owner.id, sessionId: owner.sessionId } },
      { id: sourceId, childId: family.childId, kind: 'note', body: 'source', occurredAt: new Date('2019-01-01'), mediaIds: [] })
    await source()
    await source()
    expect((await prisma.family.findUniqueOrThrow({ where: { id: family.id } })).publicationOrdinal).toBe(2n)
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: fresh.body.id } })).firstPublishedOrdinal).toBe(1n)
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: sourceId } })).firstPublishedOrdinal).toBe(2n)
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: preActivationSourceId } })).firstPublishedOrdinal).toBeNull()
    expect(await count(viewer)).toEqual({ unreadCount: 2, unreadState: 'ready' })
    expect(await count(owner)).toEqual({ unreadCount: 0, unreadState: 'ready' })
    const edit = await api(owner, `/families/${family.id}/memories/${fresh.body.id}`, 'PATCH',
      { body: 'edited', occurredAt: fresh.body.occurredAt, expectedVersion: 1 })
    expect(edit.response.status).toBe(200)
    expect(await count(viewer)).toEqual({ unreadCount: 2, unreadState: 'ready' })
    await prisma.memory.update({ where: { id: old.body.id }, data: { body: 'archive edit' } })
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: old.body.id } })).firstPublishedOrdinal).toBeNull()
  })

  test('seen batch is atomic, viewer-authorized, epoch-bound and idempotent across sessions', async () => {
    const owner = await user('owner', '39103')
    const viewer = await user('viewer', '39104')
    const outsider = await user('outsider', '39105')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    await activate(family.id)
    const first = await note(owner, family, 'first')
    const second = await note(owner, family, 'second')
    const invalid = randomUUID()
    const path = `/families/${family.id}/memories/seen`
    const payload = { memoryIds: [first.body.id, second.body.id, first.body.id], expectedMembershipEpoch: 1 }
    expect((await api(viewer, path, 'POST', { ...payload, memoryIds: [first.body.id, invalid] })).response.status).toBe(404)
    expect(await prisma.memorySeen.count()).toBe(0)
    expect((await api(outsider, path, 'POST', payload)).response.status).toBe(404)
    const otherFamily = await createFamily(outsider)
    const foreign = await note(outsider, otherFamily, 'foreign')
    expect((await api(viewer, path, 'POST', { memoryIds: [first.body.id, foreign.body.id],
      expectedMembershipEpoch: 1 })).response.status).toBe(404)
    expect(await prisma.memorySeen.count()).toBe(0)
    expect((await api(viewer, path, 'POST', { memoryIds: [], expectedMembershipEpoch: 1 })).response.status).toBe(422)
    expect((await api(viewer, path, 'POST', { memoryIds: Array.from({ length: 51 }, () => first.body.id), expectedMembershipEpoch: 1 })).response.status).toBe(422)
    const secondIdentity = await prisma.externalIdentity.findFirstOrThrow({ where: { userId: viewer.id } })
    const secondSession = await prisma.authSession.create({ data: {
      userId: viewer.id, externalIdentityId: secondIdentity.id,
      refreshTokenHash: 'second-viewer-hash', refreshTokenFamilyHash: 'second-viewer-family',
      expiresAt: new Date(Date.now() + 60_000),
    } })
    const secondViewerSession = { ...viewer, sessionId: secondSession.id,
      token: await signAccessToken({ sub: viewer.id, sessionId: secondSession.id }, env) }
    const both = await Promise.all([api(viewer, path, 'POST', payload), api(secondViewerSession, path, 'POST', payload)])
    expect(both.map(({ response }) => response.status)).toEqual([204, 204])
    expect(await prisma.memorySeen.count()).toBe(2)
    expect(await count(viewer)).toEqual({ unreadCount: 0, unreadState: 'ready' })
    expect((await api(viewer, path, 'POST', payload)).response.status).toBe(204)
    expect(await prisma.memorySeen.count()).toBe(2)
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: family.id, userId: viewer.id } },
      data: { membershipEpoch: { increment: 1 }, unreadBaselineOrdinal: 0n } })
    const stale = await api(viewer, path, 'POST', payload)
    expect(stale.response.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
    expect(await count(viewer)).toEqual({ unreadCount: 2, unreadState: 'ready' })
    expect((await api(viewer, path, 'POST', { ...payload, expectedMembershipEpoch: 2 })).response.status).toBe(204)
    expect(await prisma.memorySeen.count()).toBe(4)
  })

  test('unread keyset cursor isolates user, family and mode while additions and seen change the set', async () => {
    const owner = await user('owner', '39106')
    const viewer = await user('viewer', '39107')
    const secondViewer = await user('viewer2', '39108')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    await invite(owner, secondViewer, family.id)
    await activate(family.id)
    const ids: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const result = await note(owner, family, `memory ${index}`, `2026-09-0${index + 1}T10:00:00.000Z`)
      ids.push(result.body.id)
    }
    const first = await api(viewer, `/families/${family.id}/memories?unreadOnly=true&limit=2`, 'GET')
    expect(first.response.status).toBe(200)
    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([ids[3], ids[2]])
    const cursor = encodeURIComponent(first.body.nextCursor)
    expect((await api(owner, `/families/${family.id}/memories?unreadOnly=true&limit=2&cursor=${cursor}`, 'GET')).response.status).toBe(422)
    expect((await api(secondViewer, `/families/${family.id}/memories?unreadOnly=true&limit=2&cursor=${cursor}`, 'GET')).response.status).toBe(422)
    expect((await api(viewer, `/families/${family.id}/memories?limit=2&cursor=${cursor}`, 'GET')).response.status).toBe(422)
    const otherOwner = await user('other owner', '39116')
    const otherFamily = await createFamily(otherOwner)
    const otherInvite = await api(otherOwner, `/families/${otherFamily.id}/invites`, 'POST', { role: 'viewer' }, randomUUID())
    const enabledApp = createApp({ env: { ...env, MULTI_FAMILY_ACTIVATION: 'on' }, prisma })
    const accepted = await enabledApp.request('/api/v1/invites/accept', { method: 'POST', headers: {
      Authorization: `Bearer ${viewer.token}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ token: otherInvite.body.rawToken }) })
    expect(accepted.status).toBe(200)
    expect((await api(viewer, `/families/${otherFamily.id}/memories?unreadOnly=true&limit=2&cursor=${cursor}`, 'GET')).response.status).toBe(422)
    const added = await note(owner, family, 'late publish', '2010-01-01T00:00:00.000Z')
    expect(added.response.status).toBe(201)
    expect((await api(viewer, `/families/${family.id}/memories/seen`, 'POST',
      { memoryIds: [ids[3]], expectedMembershipEpoch: 1 })).response.status).toBe(204)
    await prisma.memory.update({ where: { id: ids[0] }, data: { status: 'deleted', deletedAt: new Date() } })
    const second = await api(viewer, `/families/${family.id}/memories?unreadOnly=true&limit=2&cursor=${cursor}`, 'GET')
    expect(second.response.status).toBe(200)
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([ids[1]])
    expect(second.body.nextCursor).toBeNull()
    const refreshed = await api(viewer, `/families/${family.id}/memories?unreadOnly=true`, 'GET')
    expect(refreshed.body.items.map((item: { id: string }) => item.id)).toContain(added.body.id)
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: family.id, userId: viewer.id } },
      data: { membershipEpoch: { increment: 1 } } })
    const stale = await api(viewer, `/families/${family.id}/memories?unreadOnly=true&limit=2&cursor=${cursor}`, 'GET')
    expect(stale.response.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
  })

  test('unread cursor restarts after event-date edits across the page boundary in either direction', async () => {
    const owner = await user('owner', '39124')
    const viewer = await user('viewer', '39125')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    await activate(family.id)
    const older = await note(owner, family, 'older', '2026-09-01T10:00:00.000Z')
    const newer = await note(owner, family, 'newer', '2026-09-02T10:00:00.000Z')
    const path = `/families/${family.id}/memories?unreadOnly=true&limit=1`

    const first = await api(viewer, path, 'GET')
    expect(first.body.items[0].id).toBe(newer.body.id)
    expect((await api(owner, `/families/${family.id}/memories/${older.body.id}`, 'PATCH', {
      body: 'older moved forward', occurredAt: '2026-09-03T10:00:00.000Z', expectedVersion: 1,
    })).response.status).toBe(200)
    const skipped = await api(viewer, `${path}&cursor=${encodeURIComponent(first.body.nextCursor)}`, 'GET')
    expect(skipped.response.status).toBe(409)
    expect(skipped.body.error.code).toBe('VERSION_CONFLICT')

    const refreshed = await api(viewer, path, 'GET')
    expect(refreshed.body.items[0].id).toBe(older.body.id)
    expect((await api(owner, `/families/${family.id}/memories/${older.body.id}`, 'PATCH', {
      body: 'older moved back', occurredAt: '2026-08-31T10:00:00.000Z', expectedVersion: 2,
    })).response.status).toBe(200)
    const duplicate = await api(viewer, `${path}&cursor=${encodeURIComponent(refreshed.body.nextCursor)}`, 'GET')
    expect(duplicate.response.status).toBe(409)
    expect(duplicate.body.error.code).toBe('VERSION_CONFLICT')
  })

  test('guard rejects untracked published writes after activation but permits historical edits', async () => {
    const owner = await user('owner', '39109')
    const family = await createFamily(owner)
    const old = await note(owner, family, 'old')
    await activate(family.id)
    await expect(Promise.resolve(prisma.memory.create({ data: {
      familyId: family.id, childId: family.childId, authorId: owner.id,
      kind: 'note', body: 'bypass', occurredAt: new Date('2020-01-01'),
    } }))).rejects.toThrow()
    await prisma.memory.update({ where: { id: old.body.id }, data: { body: 'safe archive edit' } })
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: old.body.id } })).firstPublishedOrdinal).toBeNull()
  })

  test('processing publication and concurrent source and web writes allocate distinct ordinals', async () => {
    const owner = await user('owner', '39110')
    const viewer = await user('viewer', '39111')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    await activate(family.id)
    const processing = await prisma.memory.create({ data: {
      familyId: family.id, childId: family.childId, authorId: owner.id, kind: 'note',
      body: 'processing', occurredAt: new Date('2020-01-01'), status: 'processing',
    } })
    const scope = { familyId: family.id, principal: { userId: owner.id, sessionId: owner.sessionId } }
    const publish = (id: string, body: string) => publisher.publish(scope,
      { id, childId: family.childId, kind: 'note', body, occurredAt: new Date('2019-01-01'), mediaIds: [] })
    await publish(processing.id, 'processing')
    expect((await prisma.memory.findUniqueOrThrow({ where: { id: processing.id } })).firstPublishedOrdinal).toBe(1n)
    const sourceId = randomUUID()
    const [webResult] = await Promise.all([note(owner, family, 'web'), publish(sourceId, 'source')])
    expect(webResult.response.status).toBe(201)
    expect((await prisma.family.findUniqueOrThrow({ where: { id: family.id } })).publicationOrdinal).toBe(3n)
    const ordinals = await prisma.memory.findMany({ where: { familyId: family.id }, select: { firstPublishedOrdinal: true } })
    expect(ordinals.map((row) => row.firstPublishedOrdinal?.toString()).sort()).toEqual(['1', '2', '3'])
    expect(await count(viewer)).toEqual({ unreadCount: 3, unreadState: 'ready' })
  })

  test('rejoin captures the committed boundary and old epoch seen never suppresses new publications', async () => {
    const owner = await user('owner', '39112')
    const viewer = await user('viewer', '39113')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    await activate(family.id)
    const before = await note(owner, family, 'before')
    const path = `/families/${family.id}/memories/seen`
    expect((await api(viewer, path, 'POST', { memoryIds: [before.body.id], expectedMembershipEpoch: 1 })).response.status).toBe(204)
    const member = await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: family.id, userId: viewer.id } } })
    expect((await api(owner, `/families/${family.id}/members/${viewer.id}`, 'DELETE',
      { expectedVersion: member.version })).response.status).toBe(204)
    expect((await api(viewer, path, 'POST', { memoryIds: [before.body.id], expectedMembershipEpoch: 1 })).response.status).toBe(404)
    const whileAway = await note(owner, family, 'while away')
    await invite(owner, viewer, family.id)
    const rejoined = await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: family.id, userId: viewer.id } } })
    expect(rejoined.membershipEpoch).toBe(2)
    expect(rejoined.unreadBaselineOrdinal).toBe(2n)
    expect(await count(viewer)).toEqual({ unreadCount: 0, unreadState: 'ready' })
    expect((await api(viewer, path, 'POST', { memoryIds: [whileAway.body.id], expectedMembershipEpoch: 1 })).response.status).toBe(409)
    await note(owner, family, 'after rejoin')
    expect(await count(viewer)).toEqual({ unreadCount: 1, unreadState: 'ready' })
  })

  test('first join after activation starts at the committed family ordinal', async () => {
    const owner = await user('owner', '39117')
    const viewer = await user('viewer', '39118')
    const family = await createFamily(owner)
    await activate(family.id)
    await note(owner, family, 'before joining')
    await invite(owner, viewer, family.id)
    const membership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: viewer.id } },
    })
    expect(membership.membershipEpoch).toBe(1)
    expect(membership.unreadBaselineOrdinal).toBe(1n)
    expect(await count(viewer)).toEqual({ unreadCount: 0, unreadState: 'ready' })
    await note(owner, family, 'after joining')
    expect(await count(viewer)).toEqual({ unreadCount: 1, unreadState: 'ready' })
  })

  test('counter failure leaves family cards available and reports unavailable', async () => {
    const owner = await user('owner', '39119')
    const family = await createFamily(owner)
    await activate(family.id)
    const faultyDb = new Proxy(prisma, { get(target, property) {
      const value = Reflect.get(target, property)
      if (property === '$queryRaw') return (...args: unknown[]) => {
        const input = args[0] as { strings?: string[] } | string[]
        const sql = Array.isArray(input) ? input.join('') : input.strings?.join('')
        if (sql?.includes('"unreadCount"')) throw new Error('synthetic counter failure')
        return (value as (...arguments_: unknown[]) => unknown).apply(target, args)
      }
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const faultyApp = createApp({ env, prisma: faultyDb })
    const response = await faultyApp.request('/api/v1/me/families', {
      headers: { Authorization: `Bearer ${owner.token}` },
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { items: Array<{ familyId: string; unreadState: string; unreadCount: number | null }> }
    expect(body.items[0]).toMatchObject({ familyId: family.id, unreadCount: null, unreadState: 'unavailable' })
  })

  test('deleted or processing memory makes the entire seen batch fail', async () => {
    const owner = await user('owner', '39114')
    const viewer = await user('viewer', '39115')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    await activate(family.id)
    const valid = await note(owner, family, 'valid')
    const deleted = await note(owner, family, 'deleted')
    const processing = await prisma.memory.create({ data: {
      familyId: family.id, childId: family.childId, authorId: owner.id, kind: 'note', body: 'processing',
      occurredAt: new Date('2020-01-01'), status: 'processing',
    } })
    await prisma.memory.update({ where: { id: deleted.body.id }, data: { status: 'deleted', deletedAt: new Date() } })
    for (const invalidId of [deleted.body.id, processing.id]) {
      const result = await api(viewer, `/families/${family.id}/memories/seen`, 'POST',
        { memoryIds: [valid.body.id, invalidId], expectedMembershipEpoch: 1 })
      expect(result.response.status).toBe(404)
      expect(await prisma.memorySeen.count()).toBe(0)
    }
    expect(await count(viewer)).toEqual({ unreadCount: 1, unreadState: 'ready' })
  })

  test('publish and first join race has one committed ordinal boundary', async () => {
    const owner = await user('owner', '39120')
    const viewer = await user('viewer', '39121')
    const family = await createFamily(owner)
    await activate(family.id)
    const invitation = await api(owner, `/families/${family.id}/invites`, 'POST', { role: 'viewer' }, randomUUID())
    const [published, accepted] = await Promise.all([
      note(owner, family, 'racing publication'),
      api(viewer, '/invites/accept', 'POST', { token: invitation.body.rawToken }),
    ])
    expect(published.response.status).toBe(201)
    expect(accepted.response.status).toBe(200)
    const member = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: viewer.id } },
    })
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: published.body.id } })
    expect(memory.firstPublishedOrdinal).toBe(1n)
    expect(member.unreadBaselineOrdinal === 0n || member.unreadBaselineOrdinal === 1n).toBe(true)
    expect(await count(viewer)).toEqual({ unreadCount: member.unreadBaselineOrdinal === 1n ? 0 : 1,
      unreadState: 'ready' })
  })

  test('seen and revocation serialize without a stale post-revocation write', async () => {
    const owner = await user('owner', '39122')
    const viewer = await user('viewer', '39123')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    await activate(family.id)
    const memory = await note(owner, family, 'race')
    const member = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: viewer.id } },
    })
    const seen = () => api(viewer, `/families/${family.id}/memories/seen`, 'POST',
      { memoryIds: [memory.body.id], expectedMembershipEpoch: member.membershipEpoch })
    const [seenResult, removed] = await Promise.all([
      seen(), api(owner, `/families/${family.id}/members/${viewer.id}`, 'DELETE', { expectedVersion: member.version }),
    ])
    expect([204, 404]).toContain(seenResult.response.status)
    expect(removed.response.status).toBe(204)
    expect((await seen()).response.status).toBe(404)
    expect((await prisma.memorySeen.count()) <= 1).toBe(true)
  })

  test('count uses the ordinal index with a representative populated family', async () => {
    const owner = await user('owner', '39124')
    const viewer = await user('viewer', '39125')
    const family = await createFamily(owner)
    await invite(owner, viewer, family.id)
    // Synthetic indexed-data fixture: no archive backfill or production activation is performed.
    await prisma.memory.createMany({ data: Array.from({ length: 2_000 }, (_, index) => ({
      familyId: family.id, childId: family.childId, authorId: owner.id,
      kind: 'note' as const, body: `synthetic ${index}`,
      occurredAt: new Date('2020-01-01'), firstPublishedOrdinal: BigInt(index + 1),
    })) })
    await prisma.family.update({ where: { id: family.id }, data: {
      publicationOrdinal: 2_000n, unreadTrackingActivatedAt: new Date(),
    } })
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: family.id, userId: viewer.id } },
      data: { unreadBaselineOrdinal: 1_900n } })
    const latest = await prisma.memory.findMany({ where: { familyId: family.id,
      firstPublishedOrdinal: { gt: 1_950n } }, select: { id: true } })
    await prisma.memorySeen.createMany({ data: latest.map(({ id }) => ({
      familyId: family.id, userId: viewer.id, membershipEpoch: 1, memoryId: id,
    })) })
    expect(await count(viewer)).toEqual({ unreadCount: 50, unreadState: 'ready' })
    await prisma.$executeRaw`ANALYZE memories`
    const plan = await prisma.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT fm.family_id, fm.membership_epoch, COUNT(m.id)
        FROM family_members fm JOIN families f ON f.id = fm.family_id
        LEFT JOIN memories m ON m.family_id = fm.family_id
          AND m.first_published_ordinal > COALESCE(fm.unread_baseline_ordinal, 0)
          AND m.first_published_ordinal <= f.publication_ordinal
          AND m.status = 'published' AND m.deleted_at IS NULL AND m.author_id <> ${viewer.id}::uuid
          AND NOT EXISTS (SELECT 1 FROM memory_seen s WHERE s.family_id = fm.family_id
            AND s.user_id = fm.user_id AND s.membership_epoch = fm.membership_epoch AND s.memory_id = m.id)
       WHERE fm.user_id = ${viewer.id}::uuid AND fm.revoked_at IS NULL
         AND f.status = 'active' AND f.unread_tracking_activated_at IS NOT NULL
         AND fm.family_id IN (${family.id}::uuid)
       GROUP BY fm.family_id, fm.membership_epoch
    `
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n')
    expect(planText).toContain('memories_family_id_first_published_ordinal_key')
    expect(planText).toContain('actual time=')
    console.info(`unread count plan, 2,000 rows: ${plan.find((row) => row['QUERY PLAN'].includes('Execution Time'))?.['QUERY PLAN']?.trim()}`)
  })

  async function clearFixtures() {
    await prisma.idempotencyRecord.deleteMany()
    await prisma.memorySeen.deleteMany()
    await prisma.memoryLike.deleteMany()
    await prisma.memoryMedia.deleteMany()
    await prisma.memory.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.mediaAsset.deleteMany()
    await prisma.family.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
  }

  async function user(name: string, subject: string) {
    const record = await prisma.user.create({ data: { displayName: name } })
    const identity = await prisma.externalIdentity.create({ data: { userId: record.id, provider: 'telegram', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
    const session = await prisma.authSession.create({ data: {
      userId: record.id, externalIdentityId: identity.id, refreshTokenHash: `hash-${subject}`,
      refreshTokenFamilyHash: `family-${subject}`, expiresAt: new Date(Date.now() + 60_000),
    } })
    return { id: record.id, sessionId: session.id, token: await signAccessToken({ sub: record.id, sessionId: session.id }, env) }
  }

  async function createFamily(owner: Awaited<ReturnType<typeof user>>) {
    const created = await api(owner, '/families', 'POST', { name: 'Family', timezone: 'Europe/Moscow' }, randomUUID())
    expect(created.response.status).toBe(201)
    const avatar = await prisma.mediaAsset.create({ data: {
      familyId: created.body.family.id, uploaderId: owner.id, sourceKind: 'upload', purpose: 'child_avatar',
      mediaKind: 'photo', originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png',
      verifiedMime: 'image/png', sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: 1n,
      width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    const child = await prisma.child.create({ data: { familyId: created.body.family.id, displayName: 'Test child',
      birthDate: new Date('2024-01-01'), sex: 'girl', avatarMediaId: avatar.id,
      avatarCrop: { x: 0, y: 0, width: 1, height: 1 } } })
    return { id: created.body.family.id as string, childId: child.id }
  }

  async function invite(owner: Awaited<ReturnType<typeof user>>, member: Awaited<ReturnType<typeof user>>, familyId: string) {
    const result = await api(owner, `/families/${familyId}/invites`, 'POST', { role: 'viewer' }, randomUUID())
    expect(result.response.status).toBe(201)
    expect((await api(member, '/invites/accept', 'POST', { token: result.body.rawToken })).response.status).toBe(200)
  }

  async function activate(familyId: string) {
    await activateUnreadFamily(prisma, familyId)
  }

  function note(owner: Awaited<ReturnType<typeof user>>, family: { id: string; childId: string }, body: string,
    occurredAt = '2026-09-01T10:00:00.000Z') {
    return api(owner, `/families/${family.id}/memories`, 'POST', { kind: 'note', childId: family.childId, body, occurredAt }, randomUUID())
  }

  async function count(member: Awaited<ReturnType<typeof user>>) {
    const result = await api(member, '/me/families', 'GET')
    expect(result.response.status).toBe(200)
    const { unreadCount, unreadState } = result.body.items[0]
    return { unreadCount, unreadState }
  }

  async function api(actor: Awaited<ReturnType<typeof user>>, path: string, method: string, body?: unknown, key?: string) {
    const response = await app.request(`/api/v1${path}`, { method, headers: {
      Authorization: `Bearer ${actor.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) as any : undefined }
  }
})
