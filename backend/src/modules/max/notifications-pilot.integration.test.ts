import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomInt, randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { createPrismaIdempotencyExecutor } from '../../idempotency'
import { createMaxApi, createPilotNotificationDelivery } from './index'
import { createPrismaFamilyAccess } from '../families'
import { createSourceMemoryPublisher } from '../memories'
import { pilotStopPrefix } from '../../max-notifications-pilot'
import { createMaxAcceptUpdate } from './application/accept-update'
import { createMaxPayloadCrypto } from './infrastructure/payload-crypto'
import { PrismaMaxRepository } from './infrastructure/prisma-max-repository'
import { createMaxWebhook } from './transport/webhook'
import { taskHandlers } from '../../outbox/handlers'
import type { TaskHandlerContext } from '../../outbox'
import { createComposedAlbumSourceCatalog, PrismaAlbumRepository } from '../albums'
import { createAlbumMemorySourceCatalog } from '../memories'
import { createPrismaAlbumPhotoSourceCatalog } from '../media'
import { signAccessToken } from '../auth'

const databaseUrl = requireIntegrationDatabaseUrl()
const botId = 900
const randomSubject = () => `8${randomInt(0, 281_474_976_710_655).toString().padStart(15, '0')}`
const pilotSince = '2026-10-01T00:00:00.000Z'

describe('MAX notification pilot PostgreSQL integration', () => {
  const prisma = createPrisma(databaseUrl!)
  const envInput = {
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    MAX_ENABLED: 'true',
    MAX_BOT_TOKEN: '987654:max-pilot-integration-secret',
    MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
    MAX_WEBHOOK_URL: 'https://api.example.test/webhooks/max',
    MAX_WEBHOOK_SECRET: 'M'.repeat(43),
    MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
    MAX_MINI_APP_URL: 'https://app.example.test',
    MAX_NOTIFICATIONS_PILOT_ENABLED: 'true',
    MAX_NOTIFICATIONS_AUDIENCE: 'owner',
    MAX_NOTIFICATIONS_PILOT_SINCE: pilotSince,
    CORS_ORIGINS: 'http://localhost:5173',
  }
  let env: ReturnType<typeof loadEnv>
  let app: ReturnType<typeof createApp>
  let familyId = ''
  let ownerId = ''
  let familyOwnerId = ''
  let childId = ''
  let sessionId = ''
  let subject = ''
  let inboxEventKeys: string[] = []
  let extraFamilyIds: string[] = []
  let extraUserIds: string[] = []

  beforeEach(async () => {
    inboxEventKeys = []
    extraFamilyIds = []
    extraUserIds = []
    subject = randomSubject()
    ownerId = randomUUID()
    familyOwnerId = randomUUID()
    await prisma.user.create({ data: { id: ownerId, displayName: 'Pilot owner' } })
    await prisma.user.create({ data: { id: familyOwnerId, displayName: 'Synthetic family owner' } })
    sessionId = (await prisma.authSession.create({ data: {
      userId: ownerId, refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(), expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
    } })).id
    env = loadEnv({ ...envInput, CONTROL_OWNER_USER_IDS: ownerId, MAX_NOTIFICATIONS_PILOT_SUBJECT: subject })
    app = createApp({ env, prisma })
    familyId = randomUUID()
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: familyId, ownerUserId: familyOwnerId, name: 'Synthetic pilot family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId, userId: familyOwnerId, role: 'full' } })
      await tx.familyMember.create({ data: { familyId, userId: ownerId, role: 'full' } })
    })
    childId = (await prisma.child.create({ data: { familyId, displayName: 'Pilot child' } })).id
  })

  afterEach(async () => {
    if (inboxEventKeys.length) await prisma.maxInbox.deleteMany({ where: { eventKey: { in: inboxEventKeys } } })
    if (familyId) {
      await prisma.taskOutbox.deleteMany({ where: { dedupeKey: { contains: familyId } } })
      await prisma.memoryChildTag.deleteMany({ where: { familyId } })
      await prisma.family.deleteMany({ where: { id: familyId } })
    }
    if (extraFamilyIds.length) {
      await prisma.memoryChildTag.deleteMany({ where: { familyId: { in: extraFamilyIds } } })
      await prisma.family.deleteMany({ where: { id: { in: extraFamilyIds } } })
    }
    if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } })
    if (familyOwnerId) await prisma.user.deleteMany({ where: { id: familyOwnerId } })
    if (extraUserIds.length) await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } })
  })

  afterAll(async () => { await prisma.$disconnect() })

  function pilotConfig(owner = ownerId) {
    return { ...env, CONTROL_OWNER_USER_IDS: [owner] }
  }

  function familyConfig(overrides: Record<string, string> = {}) {
    return loadEnv({ ...envInput, CONTROL_OWNER_USER_IDS: '', MAX_NOTIFICATIONS_PILOT_SUBJECT: '',
      MAX_NOTIFICATIONS_AUDIENCE: 'family', ...overrides })
  }

  async function addMember(role: 'full' | 'viewer' = 'full', displayName = 'Synthetic family member') {
    const userId = randomUUID()
    extraUserIds.push(userId)
    await prisma.user.create({ data: { id: userId, displayName } })
    await prisma.familyMember.create({ data: { familyId, userId, role } })
    return userId
  }

  async function addOtherFamilyMember(displayName = 'Unrelated family member') {
    const userId = randomUUID()
    const otherFamilyId = randomUUID()
    extraUserIds.push(userId)
    extraFamilyIds.push(otherFamilyId)
    await prisma.user.create({ data: { id: userId, displayName } })
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: otherFamilyId, ownerUserId: userId, name: 'Unrelated synthetic family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: otherFamilyId, userId, role: 'full' } })
    })
    return userId
  }

  async function engage(owner = ownerId, startedAt = new Date(Date.now() - 60_000), identitySubject = subject) {
    await prisma.externalIdentity.create({ data: { userId: owner, provider: 'max', subject: identitySubject } })
    const inbox = await prisma.maxInbox.create({ data: {
      eventKey: `test-welcome:${randomUUID()}`, botId: BigInt(botId), eventKind: 'bot_started', status: 'processed',
      encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0), processedAt: new Date(),
    } })
    inboxEventKeys.push(inbox.eventKey)
    await prisma.maxOutgoingResponse.create({ data: {
      inboxId: inbox.id, destinationUserId: BigInt(identitySubject), kind: 'welcome', text: 'Welcome', deliveredAt: new Date(),
      buttons: { pilotStartedAt: startedAt.toISOString() },
    } })
  }

  async function access() {
    return createPrismaFamilyAccess(prisma)
  }

  async function photo(owner = ownerId) {
    return prisma.mediaAsset.create({ data: {
      familyId, uploaderId: owner, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey: `synthetic/${randomUUID()}`, declaredMime: 'image/jpeg', verifiedMime: 'image/jpeg', sha256: randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      byteSize: 3, width: 640, height: 480, originalStatus: 'stored', renditionStatus: 'ready',
    } })
  }

  async function media(kind: 'photo' | 'video' | 'voice') {
    const mime = kind === 'photo' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/ogg'
    return prisma.mediaAsset.create({ data: {
      familyId, uploaderId: ownerId, sourceKind: 'upload', purpose: 'memory', mediaKind: kind,
      originalKey: `synthetic/${randomUUID()}`, declaredMime: mime, verifiedMime: mime,
      sha256: randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64), byteSize: 3,
      ...(kind === 'photo' || kind === 'video' ? { width: 640, height: 480 } : {}),
      originalStatus: 'stored', renditionStatus: 'ready',
    } })
  }

  async function authToken() {
    return `Bearer ${await signAccessToken({ sub: ownerId, sessionId }, env)}`
  }

  async function createAlbumRepo() {
    return new PrismaAlbumRepository(prisma, createPrismaIdempotencyExecutor(prisma),
      createComposedAlbumSourceCatalog(createAlbumMemorySourceCatalog(), createPrismaAlbumPhotoSourceCatalog()), pilotConfig())
  }

  async function createAlbumRows(title: string) {
    const album = await prisma.album.create({ data: {
      familyId, kind: 'free', title, createActorId: ownerId, createOperation: 'test:create',
      createRequestId: randomUUID(), initialPayloadHash: 'a'.repeat(64),
    } })
    const entry = await prisma.albumEntry.create({ data: { familyId, albumId: album.id, kind: 'event', orderKey: 1, title: 'Photo group' } })
    return { album, entry }
  }

  async function outboxForFamily() {
    return prisma.taskOutbox.findMany({ where: { type: 'max:notify-pilot', dedupeKey: { contains: familyId } }, orderBy: { createdAt: 'asc' } })
  }

  async function drainPilot(config: ReturnType<typeof loadEnv>, api: ReturnType<typeof fakeApi>, now = new Date(Date.now() + 60_000)) {
    const deliver = createPilotNotificationDelivery({ prisma, config, api })
    const handler = { 'max:notify-pilot': { ...taskHandlers['max:notify-pilot'],
      run: ({ payload }: TaskHandlerContext) => deliver(payload) } }
    const { drainTaskOutbox } = await import('../../outbox')
    return drainTaskOutbox({ prisma, env: config } as never, { handlers: handler, now, clock: () => now })
  }

  async function publishFamilyNote(config: ReturnType<typeof loadEnv>, body: string) {
    const memoryId = randomUUID()
    await createSourceMemoryPublisher(prisma, await access(), config).publish({
      familyId, principal: { userId: ownerId, sessionId },
    }, { id: memoryId, kind: 'note', body, occurredAt: new Date(), mediaIds: [] })
    return prisma.taskOutbox.findMany({ where: { type: 'max:notify-pilot', dedupeKey: { startsWith: `feed:${familyId}:${memoryId}` } }, orderBy: { createdAt: 'asc' } })
  }

  function fakeApi(options: {
    onGetMe?: () => Promise<void>
    onSend?: (request: { url: URL; body: Record<string, unknown> }) => Promise<Response | void>
  } = {}) {
    return createMaxApi('integration-only-token', { fetch: async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname === '/me') {
        await options.onGetMe?.()
        return Response.json({ user_id: botId, username: 'OurMemoriesMaxBot', is_bot: true })
      }
      if (url.pathname === '/messages') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        const response = await options.onSend?.({ url, body })
        return response ?? Response.json({ message: { body: { mid: 'fake-message' } } })
      }
      throw new Error(`Unexpected fake MAX endpoint ${url.pathname}`)
    } })
  }

  test('HTTP feed publication wires the pilot and duplicate source replay creates one durable intent', async () => {
    await engage()
    const token = await authToken()
    const response = await app.request(`/api/v1/families/${familyId}/memories`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ kind: 'note', body: 'A note from the family', occurredAt: new Date().toISOString() }),
    })
    expect(response.status).toBe(201)
    const published = await response.json() as { id: string }
    expect(await outboxForFamily()).toHaveLength(1)

    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    const replay = await publisher.publish(scope, {
      id: published.id, kind: 'note', body: 'A note from the family', occurredAt: new Date(), mediaIds: [],
    })
    expect(replay).toBe(published.id)
    const [intent] = await outboxForFamily()
    expect(await outboxForFamily()).toHaveLength(1)
    let sentBody: Record<string, unknown> | undefined
    const api = fakeApi({ onSend: async ({ body }) => { sentBody = body } })
    expect(await createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })(intent!.payload)).toBe('done')
    expect(sentBody).toMatchObject({ text: 'В семейной ленте — новая заметка ✨' })
  })

  test('photo, video, voice, and mixed feed publications each get one correctly classified intent', async () => {
    await engage()
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    const twoPhotos = await Promise.all([media('photo'), media('photo')])
    const video = await media('video')
    const voice = await media('voice')
    const mixedPhoto = await media('photo')
    const mixedVideo = await media('video')
    const expected = new Map<string, string>()
    const inputs = [
      { kind: 'photo' as const, body: '', mediaIds: twoPhotos.map(({ id }) => id), text: 'В семейной ленте — новые фото 📸' },
      { kind: 'video' as const, body: '', mediaIds: [video.id], text: 'В семейной ленте — новое видео 🎬' },
      { kind: 'voice' as const, body: '', mediaIds: [voice.id], text: 'В семейной ленте — новое голосовое сообщение 🎤' },
      { kind: 'media' as const, body: '', mediaIds: [mixedPhoto.id, mixedVideo.id], text: 'В семейной ленте — новая публикация 📷' },
    ]
    for (const input of inputs) {
      const id = randomUUID()
      await publisher.publish(scope, { id, kind: input.kind, body: input.body, occurredAt: new Date(), mediaIds: input.mediaIds })
      expected.set(id, input.text)
    }
    const intents = await outboxForFamily()
    expect(intents).toHaveLength(inputs.length)
    const texts: string[] = []
    const deliver = createPilotNotificationDelivery({ prisma, config: pilotConfig(), api: fakeApi({ onSend: async ({ body }) => { texts.push(String(body.text)) } }) })
    for (const intent of intents) {
      const payload = intent.payload as { memoryId: string }
      expect(await deliver(intent.payload)).toBe('done')
      expect(texts.at(-1)).toBe(expected.get(payload.memoryId))
    }
  })

  test('processing feed memory creates no intent until publication commits, then one intent on replay', async () => {
    await engage()
    const memoryId = randomUUID()
    await prisma.memory.create({ data: {
      id: memoryId, familyId, childId, authorId: ownerId, kind: 'note', body: 'Processing draft',
      occurredAt: new Date(), status: 'processing',
    } })
    expect(await outboxForFamily()).toHaveLength(0)
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const input = { id: memoryId, kind: 'note' as const, body: 'Completed publication', occurredAt: new Date(), mediaIds: [] as string[] }
    expect(await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, input)).toBe(memoryId)
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memoryId } })).toMatchObject({ status: 'published' })
    expect(await outboxForFamily()).toHaveLength(1)
    await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, input)
    expect(await outboxForFamily()).toHaveLength(1)
  })

  test('HTTP album setSources counts a photo set once and delivery uses the current renamed title and open-app button', async () => {
    await engage()
    const albumRepo = await createAlbumRepo()
    const { album, entry } = await createAlbumRows('Original')
    const first = await photo()
    const second = await photo()
    const token = await authToken()
    const scopeCheck = await prisma.$queryRaw<Array<{ userCount: bigint; sessionCount: bigint; familyCount: bigint; memberCount: bigint }>>`
      SELECT (SELECT count(*) FROM users WHERE id=${ownerId}::uuid) AS "userCount",
             (SELECT count(*) FROM auth_sessions WHERE id=${sessionId}::uuid AND user_id=${ownerId}::uuid AND revoked_at IS NULL AND expires_at > now()) AS "sessionCount",
             (SELECT count(*) FROM families WHERE id=${familyId}::uuid AND status='active') AS "familyCount",
             (SELECT count(*) FROM family_members WHERE family_id=${familyId}::uuid AND user_id=${ownerId}::uuid AND revoked_at IS NULL) AS "memberCount"
    `
    expect(scopeCheck).toEqual([{ userCount: 1n, sessionCount: 1n, familyCount: 1n, memberCount: 1n }])
    const setSourcesPath = `/api/v1/families/${familyId}/albums/${album.id}/entries/${entry.id}/sources`
    const setSourcesKey = randomUUID()
    const setSourcesBody = { expectedVersion: 1, sources: [first.id, second.id].map((sourceId) => ({ memoryId: null, sourceKind: 'private_storage', sourceId })) }
    const sendSources = () => app.request(setSourcesPath, {
      method: 'PUT', headers: { authorization: token, 'content-type': 'application/json', 'idempotency-key': setSourcesKey },
      body: JSON.stringify(setSourcesBody),
    })
    const firstResponses = await Promise.all([sendSources(), sendSources()])
    const sourceResponseBodies = await Promise.all(firstResponses.map(async (result) => result.clone().text()))
    if (firstResponses.some((result) => result.status !== 200)) throw new Error(sourceResponseBodies.join('\n'))
    const [intent] = await outboxForFamily()
    expect(intent?.payload).toMatchObject({ kind: 'album', photoCount: 2, albumId: album.id, entryId: entry.id })
    expect(await prisma.albumPhoto.count({ where: { familyId } })).toBe(2)
    await prisma.idempotencyRecord.deleteMany({ where: {
      actorUserId: ownerId, operation: `albums:${album.id}:entries:${entry.id}:sources`, key: setSourcesKey,
    } })
    expect((await app.request(setSourcesPath, {
      method: 'PUT', headers: { authorization: token, 'content-type': 'application/json', 'idempotency-key': setSourcesKey },
      body: JSON.stringify(setSourcesBody),
    })).status).toBe(200)
    expect(await outboxForFamily()).toHaveLength(1)

    // A direct repository invocation with the same already-linked photos creates no new-photo event.
    await albumRepo.setSources({ familyId, principal: { userId: ownerId, sessionId } }, album.id, entry.id,
      { expectedVersion: 2, sources: [first.id, second.id].map((sourceId) => ({ memoryId: null, sourceKind: 'private_storage' as const, sourceId })) }, randomUUID(), 'b'.repeat(64))
    await albumRepo.updateAlbum({ familyId, principal: { userId: ownerId, sessionId } }, album.id,
      { expectedVersion: 3, title: 'Renamed «family» album' })
    const nextEntry = await prisma.albumEntry.create({ data: { familyId, albumId: album.id, kind: 'event', orderKey: 2, title: 'Second event' } })
    await albumRepo.reorderEntry({ familyId, principal: { userId: ownerId, sessionId } }, album.id,
      { expectedVersion: 4, entryId: nextEntry.id, beforeEntryId: entry.id })
    const firstPhotoSource = await prisma.albumEntrySource.findFirstOrThrow({ where: { entryId: entry.id, sourceId: first.id } })
    await albumRepo.updateAlbum({ familyId, principal: { userId: ownerId, sessionId } }, album.id,
      { expectedVersion: 5, coverSourceId: firstPhotoSource.id })
    expect(await outboxForFamily()).toHaveLength(1)

    let sent: { url: URL; body: Record<string, unknown> } | undefined
    const api = fakeApi({ onSend: async (request) => { sent = request } })
    const deliver = createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })
    expect(await deliver(intent!.payload)).toBe('done')
    expect(sent?.url.searchParams.get('user_id')).toBe(subject)
    expect(sent?.body).toMatchObject({ text: 'В альбоме «Renamed family album» — 2 новых фото 📸',
      attachments: [{ type: 'inline_keyboard', payload: { buttons: [[{
        type: 'open_app', text: 'Открыть memoLy', web_app: 'OurMemoriesMaxBot',
      }]] } }] })
  })

  test('attaching a published feed photo creates one album intent without another feed intent', async () => {
    await engage()
    const asset = await photo()
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const memoryId = randomUUID()
    await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, {
      id: memoryId, kind: 'photo', body: '', occurredAt: new Date(), mediaIds: [asset.id],
    })
    expect(await prisma.taskOutbox.count({ where: { type: 'max:notify-pilot', dedupeKey: { startsWith: `feed:${familyId}:` } } })).toBe(1)
    const repository = await createAlbumRepo()
    const { album, entry } = await createAlbumRows('Photo from the feed')
    await repository.setSources({ familyId, principal: { userId: ownerId, sessionId } }, album.id, entry.id, {
      expectedVersion: 1, sources: [{ memoryId, sourceKind: 'private_storage', sourceId: asset.id }],
    }, randomUUID(), 'd'.repeat(64))
    const intents = await outboxForFamily()
    expect(intents).toHaveLength(2)
    expect(intents.map((task) => (task.payload as { kind?: string }).kind).sort()).toEqual(['album', 'feed'])
    expect(await prisma.taskOutbox.count({ where: { type: 'max:notify-pilot', dedupeKey: { startsWith: `feed:${familyId}:` } } })).toBe(1)
  })

  test('one configured MAX identity is the only recipient; another family member and family are not fanned out to', async () => {
    await engage()
    const secondUserId = randomUUID()
    const secondFamilyOwnerId = randomUUID()
    const secondFamilyId = randomUUID()
    extraUserIds.push(secondUserId, secondFamilyOwnerId)
    extraFamilyIds.push(secondFamilyId)
    await prisma.user.create({ data: { id: secondUserId, displayName: 'Other family member' } })
    await prisma.familyMember.create({ data: { familyId, userId: secondUserId, role: 'full' } })
    await engage(secondUserId, undefined, randomSubject())
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    await publisher.publish({ familyId, principal: { userId: secondUserId, sessionId: randomUUID() } }, {
      id: randomUUID(), kind: 'note', body: 'Authored by another member', occurredAt: new Date(), mediaIds: [],
    })
    const [intent] = await outboxForFamily()
    expect(await outboxForFamily()).toHaveLength(1)
    let destination: string | null = null
    const api = fakeApi({ onSend: async ({ url }) => { destination = url.searchParams.get('user_id') } })
    expect(await createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })(intent!.payload)).toBe('done')
    expect(destination as string | null).toBe(subject)

    await prisma.user.create({ data: { id: secondFamilyOwnerId, displayName: 'Other family owner' } })
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
      await tx.family.create({ data: { id: secondFamilyId, ownerUserId: secondFamilyOwnerId, name: 'Other synthetic family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: secondFamilyId, userId: secondFamilyOwnerId, role: 'full' } })
    })
    await prisma.child.create({ data: { familyId: secondFamilyId, displayName: 'Other child' } })
    await engage(secondFamilyOwnerId, undefined, randomSubject())
    await publisher.publish({ familyId: secondFamilyId, principal: { userId: secondFamilyOwnerId, sessionId: randomUUID() } }, {
      id: randomUUID(), kind: 'note', body: 'Other family publication', occurredAt: new Date(), mediaIds: [],
    })
    expect(await prisma.taskOutbox.count({ where: { type: 'max:notify-pilot', dedupeKey: { startsWith: `feed:${secondFamilyId}:` } } })).toBe(0)
  })

  test('family audience HTTP feed replay fans out once to each eligible active member', async () => {
    await engage()
    const viewerId = await addMember('viewer', 'Eligible viewer')
    const viewerSubject = randomSubject()
    await engage(viewerId, undefined, viewerSubject)

    const ambiguousId = await addMember('full', 'Ambiguous identity member')
    await engage(ambiguousId, undefined, randomSubject())
    await engage(ambiguousId, undefined, randomSubject())
    const inactiveId = await addMember('full', 'Inactive control user')
    await engage(inactiveId, undefined, randomSubject())
    await prisma.user.update({ where: { id: inactiveId }, data: { controlState: 'trashed' } })
    const unengagedId = await addMember('full', 'Unengaged member')
    await prisma.externalIdentity.create({ data: { userId: unengagedId, provider: 'max', subject: randomSubject() } })
    const unrelatedId = await addOtherFamilyMember()
    await engage(unrelatedId, undefined, randomSubject())

    const config = familyConfig()
    app = createApp({ env: config, prisma })
    const token = await authToken()
    const key = randomUUID()
    const body = JSON.stringify({ kind: 'note', body: 'Family audience note', occurredAt: new Date().toISOString() })
    const request = () => app.request(`/api/v1/families/${familyId}/memories`, {
      method: 'POST', headers: { authorization: token, 'content-type': 'application/json', 'idempotency-key': key },
      body,
    })
    const responses = await Promise.all([request(), request()])
    expect(responses.map(({ status }) => status).every((status) => status === 200 || status === 201)).toBe(true)
    const created = await Promise.all(responses.map(async (response) => await response.json() as { id: string }))
    expect(new Set(created.map(({ id }) => id)).size).toBe(1)

    const intents = await outboxForFamily()
    expect(intents).toHaveLength(2)
    const identities = await prisma.externalIdentity.findMany({ where: { userId: { in: [ownerId, viewerId] }, provider: 'max' }, select: { id: true, userId: true } })
    expect(intents.map(({ dedupeKey }) => dedupeKey).sort()).toEqual(identities.map(({ id }) => `feed:${familyId}:${created[0]!.id}:recipient:${id}`).sort())
    expect(intents.every(({ payload }) => (payload as { audience?: string }).audience === 'family')).toBe(true)

    const sent: Array<{ destination: string | null; body: Record<string, unknown> }> = []
    const metrics = await drainPilot(config, fakeApi({ onSend: async ({ url, body }) => {
      sent.push({ destination: url.searchParams.get('user_id'), body })
    } }))
    expect(metrics.done).toBe(2)
    expect(sent.map(({ destination }) => destination).sort()).toEqual([subject, viewerSubject].sort())
    expect(sent.every(({ body }) => body.text === 'В семейной ленте — новая заметка ✨' &&
      (body.attachments as Array<{ payload?: { buttons?: Array<Array<{ type?: string }>> } }>)[0]?.payload?.buttons?.[0]?.[0]?.type === 'open_app')).toBe(true)
    const delivered = await prisma.taskOutbox.findMany({ where: { id: { in: intents.map(({ id }) => id) } } })
    expect(delivered.every(({ status, payload, redactedAt }) => status === 'done' && JSON.stringify(payload) === '{}' && redactedAt !== null)).toBe(true)
  })

  test('family audience album batch replay creates one intent per recipient and skips a revoked member', async () => {
    await engage()
    const viewerId = await addMember('viewer', 'Album viewer')
    const viewerSubject = randomSubject()
    await engage(viewerId, undefined, viewerSubject)
    const config = familyConfig()
    app = createApp({ env: config, prisma })
    const { album, entry } = await createAlbumRows('Family album')
    const photos = await Promise.all([photo(), photo()])
    const token = await authToken()
    const key = randomUUID()
    const path = `/api/v1/families/${familyId}/albums/${album.id}/entries/${entry.id}/sources`
    const body = { expectedVersion: 1, sources: photos.map(({ id }) => ({ memoryId: null, sourceKind: 'private_storage', sourceId: id })) }
    const sendSources = () => app.request(path, {
      method: 'PUT', headers: { authorization: token, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
    })
    const responses = await Promise.all([sendSources(), sendSources()])
    expect(responses.map(({ status }) => status)).toEqual([200, 200])
    await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: ownerId, operation: `albums:${album.id}:entries:${entry.id}:sources`, key } })
    expect((await sendSources()).status).toBe(200)

    const intents = await prisma.taskOutbox.findMany({ where: { type: 'max:notify-pilot', dedupeKey: { startsWith: `album:${familyId}:${album.id}:${entry.id}:` } }, orderBy: { createdAt: 'asc' } })
    expect(intents).toHaveLength(2)
    expect(intents.every(({ payload }) => (payload as { photoCount?: number }).photoCount === 2)).toBe(true)
    expect(await prisma.albumPhoto.count({ where: { familyId } })).toBe(2)
    await prisma.familyMember.update({ where: { familyId_userId: { familyId, userId: viewerId } }, data: { revokedAt: new Date() } })

    const sent: Array<{ destination: string | null; body: Record<string, unknown> }> = []
    const metrics = await drainPilot(config, fakeApi({ onSend: async ({ url, body: message }) => {
      sent.push({ destination: url.searchParams.get('user_id'), body: message })
    } }))
    expect(metrics.done).toBe(1)
    expect(metrics.skipped).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ destination: subject })
    expect(sent[0]!.body.text).toBe('В альбоме «Family album» — 2 новых фото 📸')
    expect((sent[0]!.body.attachments as Array<{ payload?: { buttons?: Array<Array<{ type?: string }>> } }>)[0]?.payload?.buttons?.[0]?.[0]?.type).toBe('open_app')
    const finalized = await prisma.taskOutbox.findMany({ where: { id: { in: intents.map(({ id }) => id) } } })
    expect(finalized.map(({ status }) => status).sort()).toEqual(['done', 'skipped'])
  })

  test('family audience retries only the recipient whose MAX send was rate limited', async () => {
    await engage()
    const viewerId = await addMember('viewer', 'Retry viewer')
    const viewerSubject = randomSubject()
    await engage(viewerId, undefined, viewerSubject)
    const config = familyConfig()
    const intents = await publishFamilyNote(config, 'Retry family note')
    expect(intents).toHaveLength(2)
    const identities = await prisma.externalIdentity.findMany({ where: { userId: { in: [ownerId, viewerId] }, provider: 'max' }, select: { id: true, userId: true } })
    const ownerIdentity = identities.find(({ userId }) => userId === ownerId)!
    const viewerIdentity = identities.find(({ userId }) => userId === viewerId)!
    const intentFor = (identityId: string) => intents.find(({ payload }) => (payload as { identityId?: string }).identityId === identityId)!
    const sends: string[] = []
    let viewerAttempts = 0
    const api = fakeApi({ onSend: async ({ url }) => {
      const destination = url.searchParams.get('user_id')!
      sends.push(destination)
      if (destination === viewerSubject && ++viewerAttempts === 1) {
        return Response.json({ code: 'rate_limited' }, { status: 429, headers: { 'retry-after': '7' } })
      }
    } })
    const now = new Date(Date.now() + 60_000)
    const first = await drainPilot(config, api, now)
    expect(first.done).toBe(1)
    expect(first.transientFailed).toBe(1)
    expect(await prisma.taskOutbox.findUniqueOrThrow({ where: { id: intentFor(ownerIdentity.id).id } })).toMatchObject({ status: 'done', attempts: 1, payload: {} })
    const pending = await prisma.taskOutbox.findUniqueOrThrow({ where: { id: intentFor(viewerIdentity.id).id } })
    expect(pending).toMatchObject({ status: 'pending', attempts: 1 })
    expect(pending.scheduledFor.getTime()).toBe(now.getTime() + 7_000)

    const later = new Date(now.getTime() + 8_000)
    const second = await drainPilot(config, api, later)
    expect(second.done).toBe(1)
    expect(await prisma.taskOutbox.findUniqueOrThrow({ where: { id: intentFor(viewerIdentity.id).id } })).toMatchObject({ status: 'done', attempts: 2, payload: {} })
    expect(sends.filter((destination) => destination === subject)).toHaveLength(1)
    expect(sends.filter((destination) => destination === viewerSubject)).toHaveLength(2)
  })

  test('family-targeted tasks skip audience, enablement, and generation changes without falling back; legacy owner payload still delivers', async () => {
    await engage()
    const viewerId = await addMember('viewer', 'Audience-change viewer')
    await engage(viewerId, undefined, randomSubject())
    const config = familyConfig()
    const sent: string[] = []
    const api = fakeApi({ onSend: async ({ url }) => { sent.push(url.searchParams.get('user_id')!) } })

    const modeChanged = await publishFamilyNote(config, 'Mode changed')
    expect(modeChanged).toHaveLength(2)
    const ownerMode = loadEnv({ ...envInput, CONTROL_OWNER_USER_IDS: ownerId, MAX_NOTIFICATIONS_PILOT_SUBJECT: subject,
      MAX_NOTIFICATIONS_AUDIENCE: 'owner' })
    const modeMetrics = await drainPilot(ownerMode, api)
    expect(modeMetrics.skipped).toBe(2)
    expect(sent).toEqual([])
    expect((await prisma.taskOutbox.findMany({ where: { id: { in: modeChanged.map(({ id }) => id) } } })).every(({ status }) => status === 'skipped')).toBe(true)

    const disabledTasks = await publishFamilyNote(config, 'Disabled before drain')
    const disabledConfig = familyConfig({ MAX_NOTIFICATIONS_PILOT_ENABLED: 'false' })
    expect((await drainPilot(disabledConfig, api)).skipped).toBe(2)
    expect((await prisma.taskOutbox.findMany({ where: { id: { in: disabledTasks.map(({ id }) => id) } } })).every(({ status }) => status === 'skipped')).toBe(true)

    const oldGenerationTasks = await publishFamilyNote(config, 'Generation changed')
    const changedGeneration = familyConfig({ MAX_NOTIFICATIONS_PILOT_SINCE: '2026-09-01T00:00:00.000Z' })
    expect((await drainPilot(changedGeneration, api)).skipped).toBe(2)
    expect((await prisma.taskOutbox.findMany({ where: { id: { in: oldGenerationTasks.map(({ id }) => id) } } })).every(({ status }) => status === 'skipped')).toBe(true)
    expect(sent).toEqual([])

    const [legacyOwnerTask] = await publishFamilyNote(pilotConfig(), 'Legacy owner payload')
    const legacyPayload = { ...(legacyOwnerTask!.payload as Record<string, unknown>) }
    delete legacyPayload.audience
    expect(await createPilotNotificationDelivery({ prisma, config, api })(legacyPayload)).toBe('skipped')
    expect(await createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })(legacyPayload)).toBe('done')
    expect(sent).toEqual([subject])
  })

  test('concurrent replay of one source publication leaves one intent; membership epoch change skips delivery', async () => {
    await engage()
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    const memoryId = randomUUID()
    const input = { id: memoryId, kind: 'note' as const, body: 'Concurrent note', occurredAt: new Date(), mediaIds: [] as string[] }
    const results = await Promise.all([publisher.publish(scope, input), publisher.publish(scope, input)])
    expect(results).toEqual([memoryId, memoryId])
    const { album, entry } = await createAlbumRows('Epoch boundary')
    const asset = await photo()
    await (await createAlbumRepo()).setSources(scope, album.id, entry.id, { expectedVersion: 1,
      sources: [{ memoryId: null, sourceKind: 'private_storage', sourceId: asset.id }] }, randomUUID(), 'f'.repeat(64))
    const intents = await outboxForFamily()
    expect(intents).toHaveLength(2)
    const feedIntent = intents.find((task) => (task.payload as { kind?: string }).kind === 'feed')!
    const albumIntent = intents.find((task) => (task.payload as { kind?: string }).kind === 'album')!

    await prisma.familyMember.update({ where: { familyId_userId: { familyId, userId: ownerId } }, data: { membershipEpoch: { increment: 1 } } })
    let sends = 0
    const api = fakeApi({ onSend: async () => { sends += 1 } })
    const deliver = createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })
    expect(await deliver(feedIntent.payload)).toBe('skipped')
    expect(await deliver(albumIntent.payload)).toBe('skipped')
    expect(sends).toBe(0)
    await prisma.familyMember.update({ where: { familyId_userId: { familyId, userId: ownerId } }, data: { revokedAt: new Date() } })
    expect(await deliver(feedIntent.payload)).toBe('skipped')
    expect(await deliver(albumIntent.payload)).toBe('skipped')
    expect(sends).toBe(0)
  })

  test('album createEntry replay after its idempotency record is removed keeps one source intent', async () => {
    await engage()
    const repository = await createAlbumRepo()
    const { album } = await createAlbumRows('Create entry source')
    const asset = await photo()
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    const key = randomUUID()
    const request = {
      expectedVersion: 1, kind: 'work' as const, title: 'First photo',
      sources: [{ memoryId: null, sourceKind: 'private_storage' as const, sourceId: asset.id }],
    }
    const first = await repository.createEntry(scope, album.id, request, key, 'c'.repeat(64))
    expect(await outboxForFamily()).toHaveLength(1)
    await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: ownerId, operation: `albums:${album.id}:entries:create`, key } })
    await repository.updateAlbum(scope, album.id, { expectedVersion: 2, title: 'Updated before replay' })
    const replay = await repository.createEntry(scope, album.id, request, key, 'c'.repeat(64))
    expect(replay.entry.id).toBe(first.entry.id)
    expect(replay.replayed).toBe(true)
    expect(await prisma.albumEntry.count({ where: { albumId: album.id } })).toBe(2)
    expect(await outboxForFamily()).toHaveLength(1)
  })

  test('an unavailable album photo rolls back registration, source operation, and notification intent', async () => {
    await engage()
    const repository = await createAlbumRepo()
    const { album, entry } = await createAlbumRows('Waiting photo')
    const pending = await prisma.mediaAsset.create({ data: {
      familyId, uploaderId: ownerId, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey: `synthetic/${randomUUID()}`, declaredMime: 'image/jpeg', verifiedMime: 'image/jpeg',
      sha256: randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64), byteSize: 3,
      width: 640, height: 480, originalStatus: 'pending', renditionStatus: 'pending',
    } })
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    await expect(repository.setSources(scope, album.id, entry.id, { expectedVersion: 1,
      sources: [{ memoryId: null, sourceKind: 'private_storage', sourceId: pending.id }] }, randomUUID(), 'e'.repeat(64))).rejects.toThrow()
    expect(await prisma.albumPhoto.count({ where: { mediaId: pending.id } })).toBe(0)
    expect(await prisma.albumEntrySource.count({ where: { entryId: entry.id } })).toBe(0)
    expect(await prisma.albumSourceOperation.count({ where: { entryId: entry.id } })).toBe(0)
    expect(await outboxForFamily()).toHaveLength(0)
  })

  test('notifications cover persisted titles for free, year, events, and workshop albums', async () => {
    await engage()
    const repository = await createAlbumRepo()
    const child = await prisma.child.create({ data: { familyId, displayName: 'Pilot child' } })
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    const fixtures = [
      { kind: 'free' as const, childId: null, entryKind: 'event' as const, monthNumber: null, title: 'Free title' },
      { kind: 'year' as const, childId: child.id, entryKind: 'month' as const, monthNumber: 1, title: 'Year title' },
      { kind: 'events' as const, childId: child.id, entryKind: 'event' as const, monthNumber: null, title: 'Events title' },
      { kind: 'workshop' as const, childId: child.id, entryKind: 'work' as const, monthNumber: null, title: 'Workshop title' },
    ]
    for (const [index, fixture] of fixtures.entries()) {
      const album = await prisma.album.create({ data: {
        familyId, kind: fixture.kind, childId: fixture.childId, title: fixture.title,
        createActorId: ownerId, createOperation: 'test:create', createRequestId: randomUUID(), initialPayloadHash: String(index).repeat(64),
      } })
      const entry = await prisma.albumEntry.create({ data: {
        familyId, albumId: album.id, kind: fixture.entryKind, monthNumber: fixture.monthNumber, orderKey: 1,
        title: fixture.kind === 'free' || fixture.kind === 'events' ? 'First moment' : null,
      } })
      const asset = await photo()
      await repository.setSources(scope, album.id, entry.id, { expectedVersion: 1,
        sources: [{ memoryId: null, sourceKind: 'private_storage', sourceId: asset.id }] }, randomUUID(), `${index}`.repeat(64))
      await repository.updateAlbum(scope, album.id, { expectedVersion: 2, title: `Renamed ${fixture.kind}` })
    }
    const intents = await outboxForFamily()
    expect(intents).toHaveLength(fixtures.length)
    const texts: string[] = []
    const api = fakeApi({ onSend: async ({ body }) => { texts.push(String(body.text)) } })
    const deliver = createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })
    for (const [index, fixture] of fixtures.entries()) {
      expect(await deliver(intents[index]!.payload)).toBe('done')
    }
    expect(texts).toEqual(fixtures.map(({ kind }) => `Новое фото в альбоме «Renamed ${kind}» 📸`))
  })

  test('no engagement or disabled pilot creates work; a failed publication rolls back both memory and intent', async () => {
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    const ineligibleId = randomUUID()
    await publisher.publish(scope, { id: ineligibleId, kind: 'note', body: 'No welcome', occurredAt: new Date(), mediaIds: [] })
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: ineligibleId } })).toBeTruthy()
    expect(await outboxForFamily()).toHaveLength(0)

    await engage()
    const missingPinnedSubjectId = randomUUID()
    await createSourceMemoryPublisher(prisma, await access(), {
      ...pilotConfig(), MAX_NOTIFICATIONS_PILOT_SUBJECT: undefined,
    }).publish(scope, { id: missingPinnedSubjectId, kind: 'note', body: 'No pinned subject', occurredAt: new Date(), mediaIds: [] })
    const wrongPinnedSubjectId = randomUUID()
    await createSourceMemoryPublisher(prisma, await access(), {
      ...pilotConfig(), MAX_NOTIFICATIONS_PILOT_SUBJECT: randomSubject(),
    }).publish(scope, { id: wrongPinnedSubjectId, kind: 'note', body: 'Wrong pinned subject', occurredAt: new Date(), mediaIds: [] })
    const maxDisabledId = randomUUID()
    await createSourceMemoryPublisher(prisma, await access(), {
      ...pilotConfig(), MAX_ENABLED: false,
    }).publish(scope, { id: maxDisabledId, kind: 'note', body: 'MAX disabled', occurredAt: new Date(), mediaIds: [] })
    expect(await outboxForFamily()).toHaveLength(0)

    await prisma.externalIdentity.create({ data: { userId: ownerId, provider: 'max', subject: randomSubject() } })
    const ambiguousId = randomUUID()
    await publisher.publish(scope, { id: ambiguousId, kind: 'note', body: 'Ambiguous MAX identity', occurredAt: new Date(), mediaIds: [] })
    expect(await outboxForFamily()).toHaveLength(0)

    const disabledId = randomUUID()
    await createSourceMemoryPublisher(prisma, await access(), { ...pilotConfig(), MAX_NOTIFICATIONS_PILOT_ENABLED: false })
      .publish(scope, { id: disabledId, kind: 'note', body: 'Pilot disabled', occurredAt: new Date(), mediaIds: [] })
    expect(await outboxForFamily()).toHaveLength(0)

    const failedId = randomUUID()
    await expect(publisher.publish(scope, { id: failedId, kind: 'note', body: 'Rollback', occurredAt: new Date(), mediaIds: [] }, async () => {
      throw new Error('fixture failure after memory write')
    })).rejects.toThrow('fixture failure after memory write')
    expect(await prisma.memory.findUnique({ where: { id: failedId } })).toBeNull()
    expect(await outboxForFamily()).toHaveLength(0)
  })

  test('rechecks bot_stopped state after provider identity lookup and never sends after opt-out', async () => {
    await engage()
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, {
      id: randomUUID(), kind: 'note', body: 'Stopped recipient', occurredAt: new Date(), mediaIds: [],
    })
    const [intent] = await outboxForFamily()
    let sends = 0
    const api = fakeApi({
      async onGetMe() {
        const occurredAt = new Date().toISOString()
        const eventKey = `${pilotStopPrefix(String(botId), subject)}${occurredAt}`
        await prisma.maxInbox.create({ data: {
          eventKey, botId: BigInt(botId), eventKind: 'bot_stopped',
          encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
        } })
        inboxEventKeys.push(eventKey)
      },
      async onSend() { sends += 1 },
    })
    expect(await createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })(intent!.payload)).toBe('skipped')
    expect(sends).toBe(0)
  })

  test('bot_stopped webhook is authenticated, durably processed, and deduplicated', async () => {
    const secret = 'S'.repeat(43)
    const crypto = createMaxPayloadCrypto(Buffer.alloc(32, 12).toString('base64url'))
    const accept = createMaxAcceptUpdate({ botId: String(botId), repository: new PrismaMaxRepository(prisma), encrypt: crypto.encrypt })
    const webhook = createMaxWebhook({ secret, bodyLimitBytes: 64 * 1024, acceptUpdate: accept })
    const timestamp = 1_800_000_000_000
    const stoppedAt = new Date(timestamp).toISOString()
    const eventKey = `${pilotStopPrefix(String(botId), subject)}${stoppedAt}`
    inboxEventKeys.push(eventKey)
    const update = { update_type: 'bot_stopped', timestamp, chat_id: Number(subject), user: { user_id: Number(subject) } }
    const body = JSON.stringify(update)
    const denied = await webhook.request('/webhooks/max', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Max-Bot-Api-Secret': 'wrong' }, body,
    })
    expect(denied.status).toBe(401)
    const headers = { 'Content-Type': 'application/json', 'X-Max-Bot-Api-Secret': secret }
    expect((await webhook.request('/webhooks/max', { method: 'POST', headers, body })).status).toBe(200)
    expect((await webhook.request('/webhooks/max', { method: 'POST', headers, body })).status).toBe(200)
    expect(await prisma.maxInbox.count({ where: { eventKey } })).toBe(1)
    const stopped = await prisma.maxInbox.findUniqueOrThrow({ where: { eventKey } })
    expect(stopped.status).toBe('processed')
    expect([stopped.encryptedPayload.byteLength, stopped.encryptionIv.byteLength, stopped.encryptionAuthTag.byteLength]).toEqual([0, 0, 0])
    expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: stopped.id } })).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:process', dedupeKey: { contains: stopped.id } } })).toBe(0)
  })

  test('a stop before the latest start does not suppress delivery; a rebound identity invalidates queued work', async () => {
    const startedAt = new Date(Date.now() - 30_000)
    const stoppedAt = new Date(startedAt.getTime() - 10_000).toISOString()
    const stopEventKey = `${pilotStopPrefix(String(botId), subject)}${stoppedAt}`
    inboxEventKeys.push(stopEventKey)
    await prisma.maxInbox.create({ data: {
      eventKey: stopEventKey, botId: BigInt(botId), eventKind: 'bot_stopped',
      encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
    } })
    await engage(ownerId, startedAt)
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const memoryId = randomUUID()
    await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, {
      id: memoryId, kind: 'note', body: 'Rebound identity', occurredAt: new Date(), mediaIds: [],
    })
    let sends = 0
    const api = fakeApi({ onSend: async () => { sends += 1 } })
    const deliver = createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })
    const [firstIntent] = await outboxForFamily()
    expect(await deliver(firstIntent!.payload)).toBe('done')
    expect(sends).toBe(1)

    await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, {
      id: randomUUID(), kind: 'note', body: 'Rebound identity', occurredAt: new Date(), mediaIds: [],
    })
    const intents = await outboxForFamily()
    expect(intents).toHaveLength(2)
    await prisma.externalIdentity.deleteMany({ where: { userId: ownerId, provider: 'max', subject } })
    await prisma.externalIdentity.create({ data: { userId: ownerId, provider: 'max', subject } })
    expect(await deliver(intents[1]!.payload)).toBe('skipped')
    expect(sends).toBe(1)
  })

  test('a MAX outage cannot block a concurrent family publication', async () => {
    await engage()
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const scope = { familyId, principal: { userId: ownerId, sessionId } }
    await publisher.publish(scope, { id: randomUUID(), kind: 'note', body: 'First', occurredAt: new Date(), mediaIds: [] })
    const [intent] = await outboxForFamily()
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const providerWait = new Promise<void>((resolve) => { release = resolve })
    const api = fakeApi({ onGetMe: async () => { enter(); await providerWait } })
    const delivery = createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })(intent!.payload)
    await entered
    const secondId = randomUUID()
    const saving = publisher.publish(scope, { id: secondId, kind: 'note', body: 'Concurrent', occurredAt: new Date(), mediaIds: [] })
    let timer: ReturnType<typeof setTimeout> | undefined
    let state: string
    try {
      state = await Promise.race([saving.then(() => 'saved'), new Promise<string>((resolve) => { timer = setTimeout(() => resolve('blocked'), 1_500) })])
    } finally { if (timer) clearTimeout(timer); release() }
    await Promise.all([delivery, saving])
    expect(state!).toBe('saved')
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: secondId }, select: { status: true } })).toEqual({ status: 'published' })
    expect(await outboxForFamily()).toHaveLength(2)
  })

  test('revocation during MAX identity lookup is observed immediately before delivery', async () => {
    await engage()
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, {
      id: randomUUID(), kind: 'note', body: 'Revoke during lookup', occurredAt: new Date(), mediaIds: [],
    })
    const [intent] = await outboxForFamily()
    let sends = 0
    const api = fakeApi({ onGetMe: async () => {
      await prisma.familyMember.update({ where: { familyId_userId: { familyId, userId: ownerId } }, data: { revokedAt: new Date() } })
    }, onSend: async () => { sends++ } })
    expect(await createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })(intent!.payload)).toBe('skipped')
    expect(sends).toBe(0)
  })

  test('outbox retries a 429, then records the successful provider delivery in PostgreSQL', async () => {
    await engage()
    const publisher = createSourceMemoryPublisher(prisma, await access(), pilotConfig())
    const memoryId = randomUUID()
    await publisher.publish({ familyId, principal: { userId: ownerId, sessionId } }, {
      id: memoryId, kind: 'note', body: 'Retry note', occurredAt: new Date(), mediaIds: [],
    })
    const [intent] = await outboxForFamily()
    expect(intent).toBeTruthy()
    let sendAttempts = 0
    const api = fakeApi({ onSend: async () => {
      sendAttempts += 1
      if (sendAttempts === 1) return Response.json({ code: 'rate_limited' }, { status: 429, headers: { 'retry-after': '7' } })
    } })
    const deliver = createPilotNotificationDelivery({ prisma, config: pilotConfig(), api })
    const now = new Date()
    const handler = { 'max:notify-pilot': { ...taskHandlers['max:notify-pilot'], run: ({ payload }: TaskHandlerContext) => deliver(payload) } }
    const { drainTaskOutbox } = await import('../../outbox')
    const runtime = { prisma } as never
    const first = await drainTaskOutbox(runtime, { handlers: handler, now, clock: () => now })
    expect(first.transientFailed).toBe(1)
    let row = await prisma.taskOutbox.findUniqueOrThrow({ where: { id: intent!.id } })
    expect(row).toMatchObject({ status: 'pending', attempts: 1 })
    expect(row.scheduledFor.getTime()).toBe(now.getTime() + 7_000)

    const later = new Date(now.getTime() + 8_000)
    const second = await drainTaskOutbox(runtime, { handlers: handler, now: later, clock: () => later })
    expect(second.done).toBe(1)
    row = await prisma.taskOutbox.findUniqueOrThrow({ where: { id: intent!.id } })
    expect(row).toMatchObject({ status: 'done', attempts: 2, payload: {} })
    expect(sendAttempts).toBe(2)

    const disabledMemoryId = randomUUID()
    await createSourceMemoryPublisher(prisma, await access(), pilotConfig()).publish({
      familyId, principal: { userId: ownerId, sessionId },
    }, { id: disabledMemoryId, kind: 'note', body: 'Disable before drain', occurredAt: new Date(), mediaIds: [] })
    const disabledIntent = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: {
      type: 'max:notify-pilot', dedupeKey: `feed:${familyId}:${disabledMemoryId}`,
    } } })
    const disabledEnv = loadEnv({ ...envInput, CONTROL_OWNER_USER_IDS: ownerId,
      MAX_NOTIFICATIONS_PILOT_ENABLED: 'false', MAX_NOTIFICATIONS_PILOT_SUBJECT: subject })
    const { skipped } = await drainTaskOutbox({ prisma, env: disabledEnv } as never, {
      handlers: { 'max:notify-pilot': taskHandlers['max:notify-pilot'] }, now: new Date(),
    })
    expect(skipped).toBe(1)
    expect(await prisma.taskOutbox.findUniqueOrThrow({ where: { id: disabledIntent.id } })).toMatchObject({ status: 'skipped', payload: {} })
  })
})
