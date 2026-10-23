import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPrisma, type DbClient } from '../../db'
import { createPrismaIdempotencyExecutor } from '../../idempotency'
import { createAlbumMemorySourceCatalog } from '../memories'
import type { FamilyScope } from '../families'
import { PrismaAlbumRepository } from './infrastructure/prisma-album-repository'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { createApp } from '../../app'
import { loadEnv } from '../../env'
import { signAccessToken } from '../auth'

const databaseUrl = requireIntegrationDatabaseUrl()
const env = loadEnv({ DATABASE_URL: databaseUrl, JWT_SECRET: '0123456789abcdef'.repeat(4), CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000' })
const httpDb = createPrisma(databaseUrl)
const app = createApp({ env, prisma: httpDb })

describe('album PostgreSQL invariants', () => {
  let db: DbClient
  let repository: PrismaAlbumRepository
  let userId: string
  let familyId: string
  let childId: string
  let otherFamilyId: string | undefined
  let otherOwnerId: string | undefined
  let extraUserIds: string[] = []
  let scope: FamilyScope

  beforeEach(async () => {
    db = createPrisma(databaseUrl!)
    repository = new PrismaAlbumRepository(db, createPrismaIdempotencyExecutor(db), createAlbumMemorySourceCatalog())
    userId = (await db.user.create({ data: { displayName: 'Синтетический участник' } })).id
    otherFamilyId = undefined
    otherOwnerId = undefined
    extraUserIds = []
    familyId = randomUUID()
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: familyId, ownerUserId: userId, name: 'Тест', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId, role: 'full' } })
    })
    childId = (await db.child.create({ data: { familyId, displayName: 'Ребёнок' } })).id
    const session = await db.authSession.create({ data: {
      userId, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
    } })
    scope = { familyId, principal: { userId, sessionId: session.id } }
  })

  afterEach(async () => {
    if (otherFamilyId) await db.family.deleteMany({ where: { id: otherFamilyId } })
    if (familyId) await db.family.deleteMany({ where: { id: familyId } })
    if (otherOwnerId) await db.user.deleteMany({ where: { id: otherOwnerId } })
    if (extraUserIds.length) await db.user.deleteMany({ where: { id: { in: extraUserIds } } })
    if (userId) await db.user.deleteMany({ where: { id: userId } })
    await db.$disconnect()
  })

  afterAll(async () => {
    await httpDb.$disconnect()
  })

  async function createAlbum(kind: 'free' | 'events' | 'workshop' = 'free') {
    const album = await db.album.create({ data: {
      familyId, childId: kind === 'free' ? null : childId, kind, title: 'Тестовый альбом',
      createActorId: userId, createOperation: 'test:create', createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64),
    } })
    return album
  }

  async function createEntry(albumId: string, values: { title?: string | null; caption?: string | null; dateValue?: string | null; precision?: 'day' | 'month' | 'year' | 'unknown'; orderKey?: number } = {}) {
    return db.albumEntry.create({ data: {
      familyId, albumId, kind: 'event', orderKey: values.orderKey ?? 1,
      title: values.title ?? null, caption: values.caption ?? null,
      dateValue: values.dateValue ?? null, datePrecision: values.precision ?? 'unknown',
    } })
  }

  async function createNote() {
    return db.memory.create({ data: {
      familyId, childId, authorId: userId, kind: 'note', body: 'Текст воспоминания', occurredAt: new Date('2026-01-10T12:00:00.000Z'), firstPublishedAt: new Date(),
    } })
  }

  async function createPhotoWithSlides(forFamilyId = familyId, authorId = userId, forChildId = childId) {
    const memory = await db.memory.create({ data: { familyId: forFamilyId, childId: forChildId, authorId, kind: 'photo', body: '', occurredAt: new Date(), firstPublishedAt: new Date() } })
    const assets = []
    for (let position = 0; position < 2; position += 1) {
      const asset = await db.mediaAsset.create({ data: {
        familyId: forFamilyId, uploaderId: authorId, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
        originalKey: `synthetic/${randomUUID()}`, declaredMime: 'image/jpeg', verifiedMime: 'image/jpeg', sha256: String(position + 1).repeat(64),
        byteSize: 1, width: 640 + position, height: 480 + position, originalStatus: 'stored', renditionStatus: 'ready',
      } })
      await db.memoryMedia.create({ data: { familyId: forFamilyId, memoryId: memory.id, mediaId: asset.id, position } })
      assets.push(asset)
    }
    return { memory, assets }
  }

  async function auth(userId: string, sessionId: string) {
    return `Bearer ${await signAccessToken({ sub: userId, sessionId }, env)}`
  }
  async function http(path: string, method = 'GET', token?: string, body?: unknown, key?: string, headers: Record<string, string> = {}) {
    return app.request(path, {
      method,
      headers: { ...(token ? { authorization: token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  test('keeps a newly attached stable note source in the entry', async () => {
    const album = await createAlbum()
    const entry = await createEntry(album.id)
    const memory = await createNote()
    await repository.setSources(scope, album.id, entry.id, { expectedVersion: 1, sources: [{ memoryId: memory.id, sourceKind: 'memory', sourceId: memory.id }] }, randomUUID(), 'd'.repeat(64))
    expect(await db.albumEntrySource.count({ where: { albumId: album.id, entryId: entry.id } })).toBe(1)
  })

  test('source updates remain replayable after shared idempotency expiry without stale-version conflicts or resurrection', async () => {
    const token = await auth(userId, scope.principal.sessionId)
    const album = await createAlbum()
    const entry = await createEntry(album.id, { title: 'Запись' })
    const memory = await createNote()
    const secondMemory = await createNote()
    const key = randomUUID()
    const body = { expectedVersion: 1, sources: [{ memoryId: memory.id, sourceKind: 'memory', sourceId: memory.id }] }
    const path = `/api/v1/families/${familyId}/albums/${album.id}/entries/${entry.id}/sources`

    const concurrent = await Promise.all([
      http(path, 'PUT', token, body, key),
      http(path, 'PUT', token, body, key),
    ])
    expect(concurrent.map(({ status }) => status)).toEqual([200, 200])
    const firstResult = await concurrent[0]!.json()
    const sourceId = firstResult.entry.sources[0].id
    const stableVersion = (await db.album.findUniqueOrThrow({ where: { id: album.id } })).version
    const stableEntryVersion = (await db.albumEntry.findUniqueOrThrow({ where: { id: entry.id } })).version
    await db.memory.update({ where: { id: memory.id }, data: { status: 'deleted', deletedAt: new Date() } })
    await db.idempotencyRecord.deleteMany({ where: { actorUserId: userId, operation: `albums:${album.id}:entries:${entry.id}:sources`, key } })

    const replay = await http(path, 'PUT', token, body, key)
    expect(replay.status).toBe(200)
    expect((await replay.json()).entry.sources).toMatchObject([{ id: sourceId, available: false, attachment: null, body: null }])
    expect((await db.album.findUniqueOrThrow({ where: { id: album.id } })).version).toBe(stableVersion)
    expect((await db.albumEntry.findUniqueOrThrow({ where: { id: entry.id } })).version).toBe(stableEntryVersion)
    expect(await db.albumEntrySource.count({ where: { albumId: album.id, entryId: entry.id } })).toBe(1)

    await db.idempotencyRecord.deleteMany({ where: { actorUserId: userId, operation: `albums:${album.id}:entries:${entry.id}:sources`, key } })
    const altered = await http(path, 'PUT', token, {
      expectedVersion: 1, sources: [{ memoryId: secondMemory.id, sourceKind: 'memory', sourceId: secondMemory.id }],
    }, key)
    expect(altered.status).toBe(409)
    expect((await db.album.findUniqueOrThrow({ where: { id: album.id } })).version).toBe(stableVersion)
    expect(await db.albumEntrySource.count({ where: { albumId: album.id, entryId: entry.id } })).toBe(1)

    const deletedEntry = await http(`/api/v1/families/${familyId}/albums/${album.id}/entries/${entry.id}`, 'DELETE', token, undefined, undefined, { 'if-match': String(stableVersion) })
    expect(deletedEntry.status).toBe(204)
    await db.idempotencyRecord.deleteMany({ where: { actorUserId: userId, operation: `albums:${album.id}:entries:${entry.id}:sources`, key } })
    const replayAfterDelete = await http(path, 'PUT', token, body, key)
    expect(replayAfterDelete.status).toBe(404)
    expect((await db.albumEntry.findUniqueOrThrow({ where: { id: entry.id } })).deletedAt).not.toBeNull()
    expect(await db.albumEntrySource.count({ where: { albumId: album.id, entryId: entry.id } })).toBe(0)
  })

  test('requires an event title even when the event already has a source', async () => {
    const album = await createAlbum('events')
    const memory = await createNote()
    const key = randomUUID()
    await expect(repository.createEntry(scope, album.id, {
      expectedVersion: 1, kind: 'event', title: null, caption: 'Описание',
      sources: [{ memoryId: memory.id, sourceKind: 'memory', sourceId: memory.id }],
    }, key, 'c'.repeat(64))).rejects.toThrow()
    expect(await db.albumEntry.count({ where: { albumId: album.id } })).toBe(0)
  })

  test('replays a durable create marker after another aggregate update', async () => {
    const album = await createAlbum('events')
    const key = randomUUID()
    const request = { expectedVersion: 1, kind: 'event' as const, title: 'Первый шаг', caption: 'Улыбнулся', sources: [] }
    const hash = 'b'.repeat(64)
    const first = await repository.createEntry(scope, album.id, request, key, hash)
    await repository.updateAlbum(scope, album.id, { expectedVersion: 2, title: 'Обновлённое имя' })
    await db.idempotencyRecord.deleteMany({ where: { actorUserId: userId, operation: `albums:${album.id}:entries:create`, key } })
    const replay = await repository.createEntry(scope, album.id, request, key, hash)
    expect(replay.entry.id).toBe(first.entry.id)
    expect(replay.replayed).toBe(true)
    expect(await db.albumEntry.count({ where: { albumId: album.id } })).toBe(1)
  })

  test('orders events by partial calendar date and keeps unknown dates last', async () => {
    const album = await createAlbum('events')
    const later = await createEntry(album.id, { title: 'Позже', caption: 'Текст', dateValue: '2025', precision: 'year', orderKey: 1 })
    const earlier = await createEntry(album.id, { title: 'Раньше', caption: 'Текст', dateValue: '2024-06', precision: 'month', orderKey: 2 })
    const unknown = await createEntry(album.id, { title: 'Без даты', caption: 'Текст', orderKey: 3 })
    const page = await repository.listEntries(scope, album.id, { limit: 10 })
    expect(page.items.map(({ id }) => id)).toEqual([earlier.id, later.id, unknown.id])
  })

  test('authenticated routes enforce family roles, year uniqueness, durable slots, replay and fresh source projection', async () => {
    const ownerSession = scope.principal.sessionId
    const ownerToken = await auth(userId, ownerSession)
    const yearPayload = { kind: 'year', title: 'Первый год', childId }
    const yearKey = randomUUID()
    expect((await http(`/api/v1/families/${familyId}/albums`, 'POST', ownerToken, yearPayload, yearKey)).status).toBe(201)
    await db.idempotencyRecord.deleteMany({ where: { actorUserId: userId, operation: 'albums:create', key: yearKey } })
    const repeated = await http(`/api/v1/families/${familyId}/albums`, 'POST', ownerToken, yearPayload, yearKey)
    expect(repeated.status).toBe(200)
    const yearAlbum = (await repeated.json()).album
    expect((await http(`/api/v1/families/${familyId}/albums`, 'POST', ownerToken, yearPayload, randomUUID())).status).toBe(409)
    const slots = await http(`/api/v1/families/${familyId}/albums/${yearAlbum.id}/entries`, 'GET', ownerToken)
    const slotItems = (await slots.json()).items
    expect(slotItems).toHaveLength(12)
    const cleared = await http(`/api/v1/families/${familyId}/albums/${yearAlbum.id}/entries/${slotItems[0].id}/clear`, 'POST', ownerToken, { expectedVersion: 1 })
    expect(cleared.status).toBe(200)
    expect((await cleared.json()).entry.kind).toBe('month')
    expect((await http(`/api/v1/families/${familyId}/albums/${yearAlbum.id}`, 'GET')).status).toBe(401)

    const viewerId = (await db.user.create({ data: { displayName: 'Зритель' } })).id
    extraUserIds.push(viewerId)
    await db.familyMember.create({ data: { familyId, userId: viewerId, role: 'viewer' } })
    const viewerSession = await db.authSession.create({ data: { userId: viewerId, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } })
    const viewerToken = await auth(viewerId, viewerSession.id)
    expect((await http(`/api/v1/families/${familyId}/albums/${yearAlbum.id}`, 'GET', viewerToken)).status).toBe(200)
    expect((await http(`/api/v1/families/${familyId}/albums`, 'POST', viewerToken, { kind: 'free', title: 'Нет', childId: null }, randomUUID())).status).toBe(403)
    const editorId = (await db.user.create({ data: { displayName: 'Полный участник' } })).id
    extraUserIds.push(editorId)
    await db.familyMember.create({ data: { familyId, userId: editorId, role: 'full' } })
    const editorSession = await db.authSession.create({ data: { userId: editorId, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } })
    const editorToken = await auth(editorId, editorSession.id)
    const outsiderId = (await db.user.create({ data: { displayName: 'Посторонний' } })).id
    extraUserIds.push(outsiderId)
    const outsiderSession = await db.authSession.create({ data: { userId: outsiderId, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } })
    const outsiderAlbum = await http(`/api/v1/families/${familyId}/albums/${yearAlbum.id}`, 'GET', await auth(outsiderId, outsiderSession.id))
    expect(outsiderAlbum.status).toBe(404)
    expect((await outsiderAlbum.json()).error.code).toBe('ALBUM_SCOPE_UNAVAILABLE')
    const missingAlbum = await http(`/api/v1/families/${familyId}/albums/${randomUUID()}`, 'GET', ownerToken)
    expect(missingAlbum.status).toBe(404)
    expect((await missingAlbum.json()).error.code).toBe('NOT_FOUND')
    await db.familyMember.update({ where: { familyId_userId: { familyId, userId: viewerId } }, data: { revokedAt: new Date(), membershipEpoch: { increment: 1 } } })
    const revokedAlbum = await http(`/api/v1/families/${familyId}/albums/${yearAlbum.id}`, 'GET', viewerToken)
    expect(revokedAlbum.status).toBe(404)
    expect((await revokedAlbum.json()).error.code).toBe('ALBUM_SCOPE_UNAVAILABLE')

    const freeKey = randomUUID()
    const freeResponse = await http(`/api/v1/families/${familyId}/albums`, 'POST', ownerToken, { kind: 'free', title: 'Заметки', childId: null }, freeKey)
    const freeId = (await freeResponse.json()).album.id
    const entryCreate = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries`, 'POST', ownerToken,
      { expectedVersion: 1, kind: 'work', title: 'Запись', sources: [] }, randomUUID())
    const entry = (await entryCreate.json()).entry
    const note = await createNote()
    const sourceKey = randomUUID()
    const sourceBody = { expectedVersion: 2, sources: [{ memoryId: note.id, sourceKind: 'memory', sourceId: note.id }] }
    const attached = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries/${entry.id}/sources`, 'PUT', ownerToken, sourceBody, sourceKey)
    expect(attached.status).toBe(200)
    const sourceLinkId = (await attached.json()).entry.sources[0].id
    const replay = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries/${entry.id}/sources`, 'PUT', ownerToken, sourceBody, sourceKey)
    expect(replay.status).toBe(200)
    expect((await replay.json()).entry.sources[0].id).toBe(sourceLinkId)
    otherFamilyId = randomUUID()
    otherOwnerId = (await db.user.create({ data: { displayName: 'Другая семья' } })).id
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: otherFamilyId!, ownerUserId: otherOwnerId!, name: 'Чужая', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: otherFamilyId!, userId: otherOwnerId!, role: 'full' } })
    })
    const foreignId = otherFamilyId
    const foreignChild = (await db.child.create({ data: { familyId: foreignId, displayName: 'Чужой ребёнок' } })).id
    const foreignNote = await db.memory.create({ data: { familyId: foreignId, childId: foreignChild, authorId: otherOwnerId, kind: 'note', body: 'private', occurredAt: new Date(), firstPublishedAt: new Date() } })
    const foreignAttach = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries/${entry.id}/sources`, 'PUT', ownerToken,
      { expectedVersion: 3, sources: [{ memoryId: foreignNote.id, sourceKind: 'memory', sourceId: foreignNote.id }] }, randomUUID())
    expect(foreignAttach.status).toBe(404)

    const { memory: photoMemory, assets } = await createPhotoWithSlides()
    const picker = await http(`/api/v1/families/${familyId}/media-picker?kind=photo`, 'GET', ownerToken)
    const pickerBody = await picker.json()
    const pickedMemory = pickerBody.items.find((item: { memoryId: string }) => item.memoryId === photoMemory.id)
    expect(pickedMemory.sources).toHaveLength(2)
    const photoEntryResponse = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries`, 'POST', ownerToken,
      { expectedVersion: 3, kind: 'work', title: 'Выбранный кадр', sources: [] }, randomUUID())
    const photoEntry = (await photoEntryResponse.json()).entry
    const selected = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries/${photoEntry.id}/sources`, 'PUT', ownerToken,
      { expectedVersion: 4, sources: [{ memoryId: photoMemory.id, sourceKind: 'private_storage', sourceId: assets[0]!.id }] }, randomUUID())
    const photoSource = (await selected.json()).entry.sources[0]
    expect(photoSource).toMatchObject({ kind: 'photo', available: true, attachment: { id: assets[0]!.id, width: 640, height: 480 } })
    expect(await db.albumEntrySource.count({ where: { entryId: photoEntry.id } })).toBe(1)
    const maxMemory = await db.memory.create({ data: {
      familyId, childId, authorId: userId, kind: 'video', body: 'MAX video', occurredAt: new Date(), firstPublishedAt: new Date(),
    } })
    const maxSessionId = randomUUID()
    await db.maxVideoUploadSession.create({ data: {
      id: maxSessionId, familyId, authorId: userId, childId, plannedMemoryId: randomUUID(), body: '', mode: 'attachment',
      occurredAt: new Date(), idempotencyFingerprint: randomUUID(), idempotencyKey: `album-test-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60_000), state: 'finalized',
    } })
    const outbound = await db.maxOutboundSource.create({ data: {
      uploadSessionId: maxSessionId, familyId, recipientId: BigInt(123), messageId: randomUUID(),
      providerAttachmentId: `synthetic-${randomUUID()}`, width: 1920, height: 1080, durationMs: 2500,
    } })
    const maxReference = await db.maxVideoReference.create({ data: {
      familyId, memoryId: maxMemory.id, outboundSourceId: outbound.id, attachmentPosition: 0,
      providerAttachmentId: outbound.providerAttachmentId, width: 1920, height: 1080, durationMs: 2500,
    } })
    const videoPicker = await http(`/api/v1/families/${familyId}/media-picker?kind=video`, 'GET', ownerToken)
    const pickedVideo = (await videoPicker.json()).items.find((item: { memoryId: string }) => item.memoryId === maxMemory.id)
    expect(pickedVideo.sources).toHaveLength(1)
    expect(pickedVideo.sources[0]).toMatchObject({ sourceKind: 'max_video', sourceId: maxReference.id, attachment: { id: maxReference.id, width: 1920 } })
    const maxEntryResponse = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries`, 'POST', ownerToken,
      { expectedVersion: 5, kind: 'work', title: 'MAX video', sources: [] }, randomUUID())
    expect(maxEntryResponse.status).toBe(201)
    const maxEntry = (await maxEntryResponse.json()).entry
    const maxAttached = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries/${maxEntry.id}/sources`, 'PUT', ownerToken,
      { expectedVersion: 6, sources: [{ memoryId: maxMemory.id, sourceKind: 'max_video', sourceId: maxReference.id }] }, randomUUID())
    expect(maxAttached.status).toBe(200)
    const maxProjected = (await maxAttached.json()).entry.sources[0]
    expect(maxProjected).toMatchObject({ sourceKind: 'max_video', sourceId: maxReference.id, available: true, attachment: { id: maxReference.id, width: 1920, height: 1080 } })
    const setCover = await http(`/api/v1/families/${familyId}/albums/${freeId}`, 'PATCH', ownerToken,
      { expectedVersion: 7, coverSourceId: photoSource.id })
    expect(setCover.status).toBe(200)
    expect((await setCover.json()).album.cover.id).toBe(photoSource.id)
    const foreignAlbum = await db.album.create({ data: {
      familyId: foreignId, childId: null, kind: 'free', title: 'Чужой альбом', createActorId: otherOwnerId!,
      createOperation: 'albums:create', createRequestId: randomUUID(), initialPayloadHash: 'e'.repeat(64),
    } })
    const foreignEntry = await db.albumEntry.create({ data: { familyId: foreignId, albumId: foreignAlbum.id, kind: 'work', orderKey: 1 } })
    const foreignPhotoLink = await db.albumEntrySource.create({ data: {
      familyId: foreignId, albumId: foreignAlbum.id, entryId: foreignEntry.id, memoryId: foreignNote.id,
      sourceKind: 'memory', sourceId: foreignNote.id, kind: 'photo', position: 0,
    } })
    expect((await http(`/api/v1/families/${familyId}/albums/${freeId}`, 'PATCH', ownerToken,
      { expectedVersion: 8, coverSourceId: foreignPhotoLink.id })).status).toBe(404)
    expect((await db.album.findUniqueOrThrow({ where: { id: freeId } })).version).toBe(8)
    await db.memory.update({ where: { id: note.id }, data: { status: 'deleted', deletedAt: new Date() } })
    const detail = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries/${entry.id}`, 'GET', ownerToken)
    const projected = (await detail.json()).entry.sources[0]
    expect(projected).toMatchObject({ id: sourceLinkId, available: false, attachment: null, body: null, occurredAt: null })
    expect(await db.albumEntrySource.count({ where: { id: sourceLinkId } })).toBe(1)
    const staleReplay = await http(`/api/v1/families/${familyId}/albums/${freeId}/entries/${entry.id}/sources`, 'PUT', ownerToken, sourceBody, sourceKey)
    expect(staleReplay.status).toBe(200)
    expect((await staleReplay.json()).entry.sources[0]).toMatchObject({ id: sourceLinkId, available: false, attachment: null, body: null, occurredAt: null })

    let releaseLock!: () => void
    let lockAcquired!: () => void
    const hold = new Promise<void>((resolve) => { releaseLock = resolve })
    const acquired = new Promise<void>((resolve) => { lockAcquired = resolve })
    const locker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM family_members WHERE family_id=${familyId}::uuid AND user_id=${editorId}::uuid FOR UPDATE`
      lockAcquired()
      await hold
      await tx.familyMember.update({ where: { familyId_userId: { familyId, userId: editorId } }, data: { revokedAt: new Date(), membershipEpoch: { increment: 1 } } })
    })
    await acquired
    await db.mediaAsset.update({ where: { id: assets[0]!.id }, data: { originalStatus: 'failed', deletedAt: new Date() } })
    const hiddenCover = await http(`/api/v1/families/${familyId}/albums/${freeId}`, 'GET', ownerToken)
    expect((await hiddenCover.json()).album.cover).toMatchObject({ sourceKind: 'max_video', sourceId: maxReference.id, available: true })
    const mutation = http(`/api/v1/families/${familyId}/albums/${freeId}`, 'PATCH', editorToken, { expectedVersion: 8, title: 'После отзыва' })
    const completedEarly = await Promise.race([mutation.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 75))])
    expect(completedEarly).toBe(false)
    releaseLock()
    await locker
    expect((await mutation).status).toBe(404)
    expect((await db.album.findUniqueOrThrow({ where: { id: freeId } })).version).toBe(8)
  })
})
