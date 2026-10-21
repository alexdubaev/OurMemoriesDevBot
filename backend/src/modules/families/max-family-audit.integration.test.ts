import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import type { BackendRuntime } from '../../runtime'
import { createPrivateStorage } from '../../storage'
import { pngFixture } from '../../storage/storage-contract'
import type { MaxApiPort } from '../max'
import { createMaxModule } from '../max'

const databaseUrl = requireIntegrationDatabaseUrl()
const maxBotToken = '987654:max-family-audit-synthetic'

describe('MAX family invitation and access audit', () => {
  const prisma = createPrisma(databaseUrl)
  const env = loadEnv({
    DATABASE_URL: databaseUrl,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    MAX_ENABLED: 'true',
    MAX_BOT_TOKEN: maxBotToken,
    MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
    MAX_WEBHOOK_URL: 'https://max.example.test/webhook',
    MAX_WEBHOOK_SECRET: 'M'.repeat(43),
    MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
    MAX_MINI_APP_URL: 'https://app.example.test',
    CORS_ORIGINS: 'http://localhost:5173',
    MULTI_FAMILY_ACTIVATION: 'on',
    AUTH_RATE_LIMIT_MAX: '10000',
  })
  const storageRoot = resolve(`.scratch/max-family-audit-storage-${randomUUID()}`)
  const ownedUserIds = new Set<string>()
  const ownedFamilyIds = new Set<string>()
  let app: ReturnType<typeof createApp>
  let privateStorage: ReturnType<typeof createPrivateStorage>

  beforeEach(async () => {
    await mkdir(storageRoot, { recursive: true })
    await prisma.taskOutbox.deleteMany()
    await prisma.idempotencyRecord.deleteMany()
    await prisma.memoryLike.deleteMany()
    await prisma.maxVideoReference.deleteMany()
    await prisma.maxOutboundSource.deleteMany()
    await prisma.maxVideoUploadSession.deleteMany()
    await prisma.memoryMedia.deleteMany()
    await prisma.memory.deleteMany()
    await prisma.child.updateMany({ data: { avatarMediaId: null } })
    await prisma.mediaVariant.deleteMany()
    await prisma.uploadReservation.deleteMany()
    await prisma.mediaAsset.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.maxAuthReplay.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
    const storageEnv = loadEnv({
      DATABASE_URL: databaseUrl,
      JWT_SECRET: '0123456789abcdef'.repeat(4),
      MAX_ENABLED: 'true', MAX_BOT_TOKEN: maxBotToken, MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
      MAX_WEBHOOK_URL: 'https://max.example.test/webhook', MAX_WEBHOOK_SECRET: 'M'.repeat(43),
      MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43), MAX_MINI_APP_URL: 'https://app.example.test',
      CORS_ORIGINS: 'http://localhost:5173', MULTI_FAMILY_ACTIVATION: 'on', AUTH_RATE_LIMIT_MAX: '10000',
      PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
      PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://127.0.0.1:4000', PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '10000000',
    })
    privateStorage = createPrivateStorage(storageEnv)
    app = createApp({ env: storageEnv, prisma, privateStorage })
  })

  afterAll(async () => {
    const familyIds = [...ownedFamilyIds]
    if (familyIds.length > 0) await prisma.family.deleteMany({ where: { id: { in: familyIds } } })
    const userIds = [...ownedUserIds]
    if (userIds.length > 0) {
      const identities = await prisma.externalIdentity.findMany({ where: { userId: { in: userIds } }, select: { id: true, provider: true, subject: true } })
      const identityIds = identities.map(({ id }) => id)
      await prisma.browserLoginChallenge.deleteMany({ where: { approvedExternalIdentityId: { in: identityIds } } })
      await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.pilotAdmission.deleteMany({ where: { OR: identities.map(({ provider, subject }) => ({ provider, subject })) } })
      await prisma.externalIdentity.deleteMany({ where: { id: { in: identityIds } } })
      await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    }
    await prisma.$disconnect()
    await rm(storageRoot, { recursive: true, force: true })
  })

  test('serves published private photo to an invited viewer and denies it after revocation', async () => {
    const owner = await maxActor(740001, 'Photo owner')
    const viewer = await maxActor(740002, 'Photo viewer')
    const outsider = await maxActor(740003, 'Photo outsider')
    const family = await createFamily(owner.token, 'Фото старой истории')
    const invite = await createInvite(owner.token, family.id, 'viewer')

    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => app.fetch(request) })
    const base = `http://127.0.0.1:${server.port}`
    try {
      const familyPath = `/api/v1/families/${family.id}`
      const pending = await request(`${familyPath}/uploads`, owner.token, 'POST', {
        purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
      })
      expect(pending.response.status).toBe(201)
      expect((await request(`${familyPath}/media/${pending.body.assetId}/content?variant=original`, owner.token)).response.status).toBe(404)
      const reservation = await fetch(`${base}${familyPath}/uploads`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength }),
      })
      expect(reservation.status).toBe(201)
      const ticket = await reservation.json() as any
      const signed = new URL(ticket.upload.url)
      const transferred = await fetch(`${base}${signed.pathname}${signed.search}`, {
        method: 'PUT', headers: ticket.upload.headers, body: pngFixture as unknown as BodyInit,
      })
      expect(transferred.status).toBe(200)
      const finalized = await fetch(`${base}${familyPath}/uploads/${ticket.upload.uploadId}/finalize`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
      })
      expect(finalized.status).toBe(200)
      const memoryResponse = await fetch(`${base}${familyPath}/memories`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ kind: 'photo', childId: (await prisma.child.findFirstOrThrow({ where: { familyId: family.id } })).id,
          body: '', occurredAt: new Date('2026-01-01T00:00:00Z').toISOString(), mediaIds: [ticket.assetId] }),
      })
      expect(memoryResponse.status).toBe(201)
      const unpublishedForGuest = await request('/api/v1/invites/preview', viewer.token, 'POST', { token: invite.body.rawToken })
      expect(unpublishedForGuest.response.status).toBe(200)
      expect((await request(`${familyPath}/memories`, viewer.token)).response.status).toBe(404)
      const contentPath = `${familyPath}/media/${ticket.assetId}/content?variant=original`
      expect((await fetch(`${base}${contentPath}`, { headers: { Authorization: `Bearer ${viewer.token}` } })).status).toBe(404)
      expect((await request('/api/v1/invites/accept', viewer.token, 'POST', { token: invite.body.rawToken })).response.status).toBe(200)
      const feed = await request(`${familyPath}/memories`, viewer.token)
      expect(feed.body.items).toContainEqual(expect.objectContaining({ id: (await memoryResponse.json() as any).id, kind: 'photo' }))
      expect((await request(`${familyPath}/memories?unreadOnly=true`, viewer.token)).body.items).toHaveLength(0)

      const get = await fetch(`${base}${contentPath}`, { headers: { Authorization: `Bearer ${viewer.token}` } })
      expect(get.status).toBe(200)
      expect(new Uint8Array(await get.arrayBuffer())).toEqual(pngFixture)
      const etag = get.headers.get('etag')
      const displayPath = contentPath.replace('variant=original', 'variant=display')
      const display = await fetch(`${base}${displayPath}`, { headers: { Authorization: `Bearer ${viewer.token}` } })
      expect(display.status).toBe(200)
      expect((await fetch(`${base}${displayPath.replace('variant=display', 'variant=preview')}`, {
        headers: { Authorization: `Bearer ${viewer.token}` },
      })).status).toBe(200)
      const displayEtag = display.headers.get('etag')
      expect(displayEtag).toBeTruthy()
      const notModified = await fetch(`${base}${displayPath}`, { headers: { Authorization: `Bearer ${viewer.token}`, 'If-None-Match': displayEtag! } })
      expect(notModified.status).toBe(304)
      const head = await fetch(`${base}${displayPath}`, { method: 'HEAD', headers: { Authorization: `Bearer ${viewer.token}` } })
      expect(head.status).toBe(200)
      const range = await fetch(`${base}${contentPath}`, { headers: { Authorization: `Bearer ${viewer.token}`, Range: 'bytes=0-7' } })
      expect(range.status).toBe(206)
      expect(new Uint8Array(await range.arrayBuffer())).toEqual(pngFixture.subarray(0, 8))
      expect((await fetch(`${base}${contentPath}`, { headers: { Authorization: `Bearer ${outsider.token}` } })).status).toBe(404)
      expect((await fetch(`${base}${contentPath}`)).status).toBe(401)

      const playbackSession = await fetch(`${base}${familyPath}/media/playback-session`, {
        method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` },
      })
      expect(playbackSession.status).toBe(204)
      const cookie = playbackSession.headers.get('set-cookie')!.split(';', 1)[0]!
      const removal = await request(`/api/v1/families/${family.id}/members/${viewer.userId}`, owner.token, 'DELETE', {
        expectedVersion: (await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: family.id, userId: viewer.userId } } })).version,
      })
      expect(removal.response.status).toBe(204)
      expect((await fetch(`${base}${contentPath}`, { headers: { Authorization: `Bearer ${viewer.token}` } })).status).toBe(404)
      expect((await fetch(`${base}${contentPath}`, { headers: { Cookie: cookie } })).status).toBe(404)
      expect((await fetch(`${base}${displayPath}`, { method: 'HEAD', headers: { Authorization: `Bearer ${viewer.token}` } })).status).toBe(404)
      expect((await fetch(`${base}${contentPath}`, { headers: { Authorization: `Bearer ${viewer.token}`, Range: 'bytes=0-7' } })).status).toBe(404)
      expect((await request(`${familyPath}/memories`, viewer.token)).response.status).toBe(404)
    } finally {
      server.stop(true)
    }
  })

  test('assigns invite roles server-side, preserves all-family isolation, and revokes access immediately', async () => {
    const owner = await maxActor(710001, 'Owner')
    const guest = await maxActor(710002, 'Guest')
    const otherOwner = await maxActor(710003, 'Other owner')
    const familyA = await createFamily(owner.token, 'Одинаковое имя')
    const familyB = await createFamily(otherOwner.token, 'Одинаковое имя')

    const invite = await createInvite(owner.token, familyA.id, 'viewer')
    if (invite.response.status !== 201) throw new Error(`invite create ${invite.response.status}: ${JSON.stringify(invite.body)}`)
    const preview = await request('/api/v1/invites/preview', guest.token, 'POST', { token: invite.body.rawToken })
    expect(preview.response.status).toBe(200)
    expect(JSON.stringify(preview.body)).not.toMatch(/media|memory|child.*avatar/i)
    expect((await request(`/api/v1/families/${familyA.id}/memories`, guest.token)).response.status).toBe(404)

    const accepted = await request('/api/v1/invites/accept', guest.token, 'POST', { token: invite.body.rawToken })
    expect(accepted.response.status).toBe(200)
    expect(accepted.body.membership.role).toBe('viewer')
    const viewerHome = await app.request('/api/v1/me/families', { headers: authHeaders(guest.token) })
    expect((await viewerHome.json() as any).items.find((item: any) => item.familyId === familyA.id).capabilities.canPublishVideo).toBe(false)
    expect((await request('/api/v1/invites/accept', guest.token, 'POST', { token: invite.body.rawToken })).body)
      .toEqual(accepted.body)
    expect((await request(`/api/v1/families/${familyA.id}`, guest.token)).response.status).toBe(200)
    expect((await request(`/api/v1/families/${familyB.id}`, guest.token)).response.status).toBe(404)
    expect((await createInvite(guest.token, familyA.id, 'full')).response.status).toBe(403)

    const fullInvite = await createInvite(owner.token, familyA.id, 'full')
    const fullGuest = await maxActor(710004, 'Full guest')
    const fullAccepted = await request('/api/v1/invites/accept', fullGuest.token, 'POST', { token: fullInvite.body.rawToken })
    expect(fullAccepted.response.status).toBe(200)
    expect(fullAccepted.body.membership.role).toBe('full')
    const fullHome = await app.request('/api/v1/me/families', { headers: authHeaders(fullGuest.token) })
    expect((await fullHome.json() as any).items.find((item: any) => item.familyId === familyA.id).capabilities.canPublishVideo).toBe(true)
    expect((await request(`/api/v1/families/${familyA.id}`, fullGuest.token, 'PATCH', { name: 'tampered' })).response.status).toBe(403)

    const activeFamilies = await app.request('/api/v1/me/families', { headers: authHeaders(guest.token) })
    expect((await activeFamilies.json() as any).items.map((item: any) => [item.familyId, item.role]))
      .toContainEqual([familyA.id, 'viewer'])
    const ownFamily = await createFamily(guest.token, 'Своя семья')
    expect((await request(`/api/v1/families/${ownFamily.id}`, guest.token)).response.status).toBe(200)

    const members = await request(`/api/v1/families/${familyA.id}/members`, owner.token)
    const guestMember = members.body.items.find((member: any) => member.userId === guest.userId)
    const promoted = await request(`/api/v1/families/${familyA.id}/members/${guest.userId}`, owner.token, 'PATCH', {
      role: 'full', expectedVersion: guestMember.version,
    })
    expect(promoted.response.status).toBe(200)
    expect((await request(`/api/v1/families/${familyA.id}/members`, guest.token)).body.items
      .find((member: any) => member.userId === guest.userId).role).toBe('full')
    const demoted = await request(`/api/v1/families/${familyA.id}/members/${guest.userId}`, owner.token, 'PATCH', {
      role: 'viewer', expectedVersion: promoted.body.membership.version,
    })
    expect(demoted.response.status).toBe(200)
    expect((await request(`/api/v1/families/${familyA.id}/members`, guest.token)).body.items
      .find((member: any) => member.userId === guest.userId).role).toBe('viewer')

    const removal = await request(`/api/v1/families/${familyA.id}/members/${guest.userId}`, owner.token, 'DELETE', {
      expectedVersion: demoted.body.membership.version,
    })
    expect(removal.response.status).toBe(204)
    expect((await request(`/api/v1/families/${familyA.id}`, guest.token)).response.status).toBe(404)
    expect((await request(`/api/v1/families/${ownFamily.id}`, guest.token)).response.status).toBe(200)
  })

  test('enforces invite-role capabilities on real memory actions and ignores invite identity tampering', async () => {
    const owner = await maxActor(711001, 'Capability owner')
    const viewer = await maxActor(711002, 'Capability viewer')
    const full = await maxActor(711003, 'Capability full')
    const outsider = await maxActor(711004, 'Capability outsider')
    const family = await createFamily(owner.token, 'Проверка прав')
    const viewerInvite = await createInvite(owner.token, family.id, 'viewer')
    const fullInvite = await createInvite(owner.token, family.id, 'full')

    const tamperedAccept = await request('/api/v1/invites/accept', viewer.token, 'POST', {
      token: viewerInvite.body.rawToken, familyId: randomUUID(), userId: outsider.userId, role: 'full',
    })
    expect(tamperedAccept.response.status).toBe(422)
    expect(await prisma.familyMember.count({ where: { familyId: family.id, userId: outsider.userId, revokedAt: null } })).toBe(0)
    const viewerAccepted = await request('/api/v1/invites/accept', viewer.token, 'POST', { token: viewerInvite.body.rawToken })
    expect(viewerAccepted.body.membership).toMatchObject({ userId: viewer.userId, role: 'viewer' })
    expect((await request('/api/v1/invites/accept', full.token, 'POST', { token: fullInvite.body.rawToken })).body.membership.role).toBe('full')

    const childId = (await prisma.child.findFirstOrThrow({ where: { familyId: family.id } })).id
    const owned = await request(`/api/v1/families/${family.id}/memories`, owner.token, 'POST', {
      kind: 'note', childId, body: 'Synthetic role audit memory', occurredAt: '2026-01-01T00:00:00.000Z',
    }, randomUUID())
    expect(owned.response.status).toBe(201)
    const memoryPath = `/api/v1/families/${family.id}/memories/${owned.body.id}`

    expect((await request(`/api/v1/families/${family.id}/memories`, viewer.token, 'POST', {
      kind: 'note', childId, body: 'viewer must not publish', occurredAt: '2026-01-02T00:00:00.000Z',
    }, randomUUID())).response.status).toBe(403)
    expect((await request(memoryPath, viewer.token, 'PATCH', {
      body: 'viewer must not edit', occurredAt: '2026-01-01T00:00:00.000Z', expectedVersion: owned.body.version,
    })).response.status).toBe(403)
    const viewerDelete = await app.request(memoryPath, { method: 'DELETE', headers: { ...authHeaders(viewer.token), 'If-Match': String(owned.body.version) } })
    expect(viewerDelete.status).toBe(403)
    const viewerReaction = await request(`${memoryPath}/reaction`, viewer.token, 'PUT', { reaction: 'heart' })
    expect(viewerReaction.response.status).toBe(200)

    expect((await request(`/api/v1/families/${family.id}/memories`, full.token, 'POST', {
      kind: 'note', childId, body: 'Full can publish', occurredAt: '2026-01-03T00:00:00.000Z',
    }, randomUUID())).response.status).toBe(201)
    const updated = await request(memoryPath, full.token, 'PATCH', {
      body: 'Full can edit', occurredAt: '2026-01-01T00:00:00.000Z', expectedVersion: owned.body.version,
    })
    expect(updated.response.status).toBe(200)
    const deleted = await app.request(memoryPath, { method: 'DELETE', headers: { ...authHeaders(full.token), 'If-Match': String(updated.body.version) } })
    expect(deleted.status).toBe(204)

    const pendingOwnerInvite = await createInvite(owner.token, family.id, 'viewer')
    expect(pendingOwnerInvite.response.status).toBe(201)
    expect((await request(`/api/v1/families/${family.id}/invites/${pendingOwnerInvite.body.id}`, full.token, 'DELETE')).response.status).toBe(404)
    const ownerInvites = await request(`/api/v1/families/${family.id}/invites`, owner.token)
    expect(ownerInvites.body.items).toContainEqual(expect.objectContaining({ id: pendingOwnerInvite.body.id }))
    expect((await request(`/api/v1/families/${family.id}/invites/${pendingOwnerInvite.body.id}`, owner.token, 'DELETE')).response.status).toBe(204)
    const fullInviteCreated = await createInvite(full.token, family.id, 'viewer')
    expect(fullInviteCreated.response.status).toBe(201)
    expect((await request(`/api/v1/families/${family.id}/invites/${fullInviteCreated.body.id}`, full.token, 'DELETE')).response.status).toBe(204)
    const viewerMember = (await request(`/api/v1/families/${family.id}/members`, owner.token)).body.items.find((member: any) => member.userId === viewer.userId)
    expect((await request(`/api/v1/families/${family.id}/members/${viewer.userId}`, full.token, 'PATCH', {
      role: 'full', expectedVersion: viewerMember.version,
    })).response.status).toBe(403)
    expect((await request(`/api/v1/families/${family.id}/members/${viewer.userId}`, full.token, 'DELETE', {
      expectedVersion: viewerMember.version,
    })).response.status).toBe(403)
    expect((await request(`/api/v1/families/${family.id}`, full.token, 'PATCH', { name: 'tampered' })).response.status).toBe(403)
  })

  test('signed MAX invited Full member can reserve and publish video while Viewer is denied', async () => {
    const owner = await maxActor(712001, 'Video owner')
    const full = await maxActor(712002, 'Video full member')
    const viewer = await maxActor(712003, 'Video viewer')
    const family = await createFamily(owner.token, 'MAX full video audit')
    const childId = (await prisma.child.findFirstOrThrow({ where: { familyId: family.id } })).id
    const fullInvite = await createInvite(owner.token, family.id, 'full')
    expect(fullInvite.response.status).toBe(201)
    const fullAccepted = await request('/api/v1/invites/accept', full.token, 'POST', { token: fullInvite.body.rawToken })
    expect(fullAccepted.response.status).toBe(200)
    expect(fullAccepted.body.membership).toMatchObject({ userId: full.userId, role: 'full' })
    const viewerInvite = await createInvite(owner.token, family.id, 'viewer')
    expect(viewerInvite.response.status).toBe(201)
    const viewerAccepted = await request('/api/v1/invites/accept', viewer.token, 'POST', { token: viewerInvite.body.rawToken })
    expect(viewerAccepted.response.status).toBe(200)
    expect(viewerAccepted.body.membership).toMatchObject({ userId: viewer.userId, role: 'viewer' })

    let providerRecipientId = ''
    let providerSends = 0
    const providerMessageId = `max-family-audit-video-${randomUUID()}`
    const api: MaxApiPort = {
      getMe: async () => ({ userId: 987654, username: 'OurMemoriesDevBot', isBot: true }),
      getSubscriptions: async () => [], createSubscription: async () => ({ success: true }),
      deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
      createVideoUpload: async () => ({ url: 'https://upload.example.test/max-family-audit/video', token: 'synthetic-provider-upload-token' }),
      sendVideoMessage: async ({ userId }) => { providerRecipientId = userId; providerSends += 1; return { messageId: providerMessageId } },
      getMessage: async (messageId) => ({
        messageId, senderId: '987654', recipientId: providerRecipientId,
        attachments: [{ kind: 'video', providerAttachmentId: 'max-family-audit-video-attachment', currentToken: 'synthetic-video-token', inboundDurationSeconds: 2, width: 640, height: 360 }],
      }),
    }
    const maxModule = createMaxModule({
      runtime: { env, prisma, privateStorage } as unknown as BackendRuntime,
      identity: { userId: 987654, username: 'OurMemoriesDevBot', isBot: true }, api,
    })
    const videoApp = createApp({ env, prisma, privateStorage, maxRoutes: maxModule.routes })
    const videoPath = `/api/v1/families/${family.id}/max-video-uploads`
    const idempotencyKey = randomUUID()
    const reserveBody = {
      childId, body: 'Full member MAX video', occurredAt: new Date('2026-01-04T10:00:00.000Z').toISOString(),
      fileName: 'synthetic.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey,
    }
    const postAs = (token: string, path: string, body: unknown) => videoApp.request(path, {
      method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })

    const fullReserve = await postAs(full.token, `${videoPath}/reserve`, reserveBody)
    expect(fullReserve.status).toBe(201)
    const reservation = await fullReserve.json() as { sessionId: string; uploadToken: string; state: string }
    expect(reservation.state).toBe('reserved')
    expect(reservation.uploadToken).toBe('synthetic-provider-upload-token')
    const replayedReserve = await postAs(full.token, `${videoPath}/reserve`, reserveBody)
    expect(replayedReserve.status).toBe(201)
    expect(await replayedReserve.json()).toMatchObject({ sessionId: reservation.sessionId, state: 'existing' })

    const viewerReserve = await postAs(viewer.token, `${videoPath}/reserve`, { ...reserveBody, idempotencyKey: randomUUID() })
    expect(viewerReserve.status).toBe(403)
    expect(await prisma.maxVideoUploadSession.count({ where: { familyId: family.id } })).toBe(1)

    const finalizePath = `${videoPath}/${reservation.sessionId}/finalize`
    const finalizeBody = { uploadToken: reservation.uploadToken }
    const finalized = await postAs(full.token, finalizePath, finalizeBody)
    expect(finalized.status).toBe(200)
    const finalResult = await finalized.json() as { state: string; sessionId: string; memoryId: string }
    expect(finalResult).toMatchObject({ state: 'finalized', sessionId: reservation.sessionId })
    const replayedFinalize = await postAs(full.token, finalizePath, finalizeBody)
    expect(replayedFinalize.status).toBe(200)
    expect(await replayedFinalize.json()).toMatchObject({ state: 'finalized', sessionId: reservation.sessionId, memoryId: finalResult.memoryId })
    expect(providerSends).toBe(1)
    expect(await prisma.memory.count({ where: { familyId: family.id, kind: 'video', authorId: full.userId, status: 'published' } })).toBe(1)
    expect(await prisma.maxOutboundSource.count({ where: { familyId: family.id } })).toBe(1)
    expect(await prisma.maxVideoReference.count({ where: { familyId: family.id, memoryId: finalResult.memoryId } })).toBe(1)
  })

  test('rejects expired, revoked, used-by-other and invented invitation tokens; accepts concurrent retries once', async () => {
    const owner = await maxActor(720001, 'Owner')
    const first = await maxActor(720002, 'First')
    const second = await maxActor(720003, 'Second')
    const family = await createFamily(owner.token, 'Семья')

    const expired = await createInvite(owner.token, family.id, 'viewer')
    if (expired.response.status !== 201) throw new Error(`invite create ${expired.response.status}: ${JSON.stringify(expired.body)}`)
    await prisma.familyInvite.update({ where: { id: expired.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await request('/api/v1/invites/accept', first.token, 'POST', { token: expired.body.rawToken })).response.status).toBe(410)
    const revoked = await createInvite(owner.token, family.id, 'viewer')
    expect((await request(`/api/v1/families/${family.id}/invites/${revoked.body.id}`, owner.token, 'DELETE')).response.status).toBe(204)
    expect((await request('/api/v1/invites/accept', first.token, 'POST', { token: revoked.body.rawToken })).response.status).toBe(410)
    const revokedInvite = await prisma.familyInvite.findUniqueOrThrow({
      where: { id: revoked.body.id }, select: { acceptedBy: true, acceptedAt: true, revokedAt: true },
    })
    expect(revokedInvite.acceptedBy).toBeNull()
    expect(revokedInvite.acceptedAt).toBeNull()
    expect(revokedInvite.revokedAt).toBeInstanceOf(Date)
    expect(await prisma.familyMember.count({ where: { familyId: family.id, userId: first.userId, revokedAt: null } })).toBe(0)
    expect((await request('/api/v1/invites/preview', first.token, 'POST', { token: 'x'.repeat(43) })).response.status).toBe(404)

    const usable = await createInvite(owner.token, family.id, 'viewer')
    const attempts = await Promise.all([
      request('/api/v1/invites/accept', first.token, 'POST', { token: usable.body.rawToken }),
      request('/api/v1/invites/accept', first.token, 'POST', { token: usable.body.rawToken }),
    ])
    expect(attempts.map(({ response }) => response.status)).toEqual([200, 200])
    expect(attempts[0].body).toEqual(attempts[1].body)
    expect(await prisma.familyMember.count({ where: { familyId: family.id, userId: first.userId, revokedAt: null } })).toBe(1)
    const other = await request('/api/v1/invites/accept', second.token, 'POST', { token: usable.body.rawToken })
    expect(other.response.status).toBe(409)
    expect((await request(`/api/v1/families/${family.id}/invites/${usable.body.id}`, owner.token, 'DELETE')).response.status).toBe(404)
    const acceptedInvite = await prisma.familyInvite.findUniqueOrThrow({
      where: { id: usable.body.id }, select: { acceptedBy: true, acceptedAt: true, revokedAt: true },
    })
    expect(acceptedInvite.acceptedBy).toBe(first.userId)
    expect(acceptedInvite.acceptedAt).toBeInstanceOf(Date)
    expect(acceptedInvite.revokedAt).toBeNull()
    expect(await prisma.familyMember.count({ where: { familyId: family.id, userId: first.userId, revokedAt: null } })).toBe(1)

    const acceptOrRevoke = await createInvite(owner.token, family.id, 'viewer')
    const racedAcceptor = await maxActor(720004, 'Racing acceptor')
    const [racedAccept, racedRevoke] = await Promise.all([
      request('/api/v1/invites/accept', racedAcceptor.token, 'POST', { token: acceptOrRevoke.body.rawToken }),
      request(`/api/v1/families/${family.id}/invites/${acceptOrRevoke.body.id}`, owner.token, 'DELETE'),
    ])
    expect([[204, 410], [404, 200]]).toContainEqual([racedRevoke.response.status, racedAccept.response.status])
    const racedInvite = await prisma.familyInvite.findUniqueOrThrow({
      where: { id: acceptOrRevoke.body.id }, select: { acceptedBy: true, acceptedAt: true, revokedAt: true },
    })
    const activeRacedMemberships = await prisma.familyMember.count({
      where: { familyId: family.id, userId: racedAcceptor.userId, revokedAt: null },
    })
    if (racedAccept.response.status === 200) {
      expect(racedInvite.acceptedBy).toBe(racedAcceptor.userId)
      expect(racedInvite.acceptedAt).toBeInstanceOf(Date)
      expect(racedInvite.revokedAt).toBeNull()
      expect(activeRacedMemberships).toBe(1)
    } else {
      expect(racedInvite.acceptedBy).toBeNull()
      expect(racedInvite.acceptedAt).toBeNull()
      expect(racedInvite.revokedAt).toBeInstanceOf(Date)
      expect(activeRacedMemberships).toBe(0)
    }
  })

  test('serializes competing invitees and stale member versions, then invalidates upload and epoch on removal', async () => {
    const owner = await maxActor(725001, 'Concurrency owner')
    const first = await maxActor(725002, 'Concurrency first')
    const second = await maxActor(725003, 'Concurrency second')
    const family = await createFamily(owner.token, 'Семья гонок')
    const invite = await createInvite(owner.token, family.id, 'full')
    const inviteAttempts = await Promise.all([
      request('/api/v1/invites/accept', first.token, 'POST', { token: invite.body.rawToken }),
      request('/api/v1/invites/accept', second.token, 'POST', { token: invite.body.rawToken }),
    ])
    expect(inviteAttempts.map(({ response }) => response.status).sort()).toEqual([200, 409])
    const member = inviteAttempts[0].response.status === 200 ? first : second
    const initialMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: member.userId } },
    })
    const roleRaces = await Promise.all([
      request(`/api/v1/families/${family.id}/members/${member.userId}`, owner.token, 'PATCH', {
        role: 'viewer', expectedVersion: initialMembership.version,
      }),
      request(`/api/v1/families/${family.id}/members/${member.userId}`, owner.token, 'PATCH', {
        role: 'full', expectedVersion: initialMembership.version,
      }),
    ])
    expect(roleRaces.map(({ response }) => response.status).sort()).toEqual([200, 409])
    let currentMember = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: member.userId } },
    })
    if (currentMember.role !== 'full') {
      const promoted = await request(`/api/v1/families/${family.id}/members/${member.userId}`, owner.token, 'PATCH', {
        role: 'full', expectedVersion: currentMember.version,
      })
      expect(promoted.response.status).toBe(200)
      currentMember = await prisma.familyMember.findUniqueOrThrow({
        where: { familyId_userId: { familyId: family.id, userId: member.userId } },
      })
    }

    const child = await prisma.child.findFirstOrThrow({ where: { familyId: family.id } })
    const publishAndDemote = await Promise.all([
      request(`/api/v1/families/${family.id}/members/${member.userId}`, owner.token, 'PATCH', {
        role: 'viewer', expectedVersion: currentMember.version,
      }),
      request(`/api/v1/families/${family.id}/memories`, member.token, 'POST', {
        kind: 'note', childId: child.id, body: 'Concurrent synthetic note', occurredAt: new Date().toISOString(),
      }, randomUUID()),
    ])
    expect(publishAndDemote[0].response.status).toBe(200)
    expect([201, 403]).toContain(publishAndDemote[1].response.status)
    expect(await prisma.memory.count({ where: { familyId: family.id } })).toBe(publishAndDemote[1].response.status === 201 ? 1 : 0)

    currentMember = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: member.userId } },
    })
    const removed = await request(`/api/v1/families/${family.id}/members/${member.userId}`, owner.token, 'DELETE', {
      expectedVersion: currentMember.version,
    })
    expect(removed.response.status).toBe(204)
    const nextInvite = await createInvite(owner.token, family.id, 'full')
    expect((await request('/api/v1/invites/accept', member.token, 'POST', { token: nextInvite.body.rawToken })).response.status).toBe(200)
    const rejoined = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.id, userId: member.userId } },
    })
    expect(rejoined.membershipEpoch).toBe(initialMembership.membershipEpoch + 1)

    const uploadServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => app.fetch(request) })
    const uploadBase = `http://127.0.0.1:${uploadServer.port}`
    let releaseFinalizeProbe!: () => void
    let notifyFinalizeProbe!: () => void
    const finalizeProbeReached = new Promise<void>((resolveProbe) => { notifyFinalizeProbe = resolveProbe })
    const finalizeProbeRelease = new Promise<void>((resolveProbe) => { releaseFinalizeProbe = resolveProbe })
    const originalHeadObject = privateStorage.storage.headObject.bind(privateStorage.storage)
    try {
      const uploadReservation = await request(`/api/v1/families/${family.id}/uploads`, member.token, 'POST', {
        purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
      })
      expect(uploadReservation.response.status).toBe(201)
      const signed = new URL(uploadReservation.body.upload.url)
      const uploaded = await fetch(`${uploadBase}${signed.pathname}${signed.search}`, {
        method: 'PUT', headers: uploadReservation.body.upload.headers, body: pngFixture as unknown as BodyInit,
      })
      expect(uploaded.status).toBe(200)
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: uploadReservation.body.assetId } })
      privateStorage.storage.headObject = async (key) => {
        if (key === asset.originalKey) {
          notifyFinalizeProbe()
          await finalizeProbeRelease
        }
        return originalHeadObject(key)
      }
      const finalizePromise = request(`/api/v1/families/${family.id}/uploads/${uploadReservation.body.upload.uploadId}/finalize`, member.token, 'POST')
      await finalizeProbeReached
      const removalDuringFinalize = await request(`/api/v1/families/${family.id}/members/${member.userId}`, owner.token, 'DELETE', {
        expectedVersion: rejoined.version,
      })
      expect(removalDuringFinalize.response.status).toBe(204)
      releaseFinalizeProbe()
      const finalize = await finalizePromise
      expect([403, 404]).toContain(finalize.response.status)
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).originalStatus).toBe('failed')
    } finally {
      privateStorage.storage.headObject = originalHeadObject
      releaseFinalizeProbe()
      uploadServer.stop(true)
    }
  })

  test('browser/PWA login uses start, MAX signed start_param approval, and verifier-bound redemption', async () => {
    const browserStart = await app.request('/api/v1/auth/browser-link/start', {
      method: 'POST', headers: { Origin: 'http://localhost:5173' },
    })
    expect(browserStart.status).toBe(200)
    const challenge = await browserStart.json() as { challengeId: string; startParam: string }
    const verifierCookie = browserStart.headers.get('set-cookie')!.split(';', 1)[0]!
    expect(challenge.startParam).toBe(`browser_${challenge.challengeId}`)
    const outsiderStatus = await app.request(`/api/v1/auth/browser-link/${challenge.challengeId}/status`)
    expect(outsiderStatus.status).toBe(401)

    const actor = await maxActor(730001, 'PWA MAX approver')
    const approvalData = signMaxInitData({ id: 730001, first_name: 'PWA MAX approver' }, randomUUID(), challenge.startParam)
    const approval = await app.request(`/api/v1/auth/browser-link/${challenge.challengeId}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: approvalData, approved: true }),
    })
    expect(approval.status).toBe(200)
    const wrongVerifier = await app.request(`/api/v1/auth/browser-link/${challenge.challengeId}/redeem`, {
      method: 'POST', headers: { Origin: 'http://localhost:5173' },
    })
    expect(wrongVerifier.status).toBe(401)
    const redeemed = await app.request(`/api/v1/auth/browser-link/${challenge.challengeId}/redeem`, {
      method: 'POST', headers: { Origin: 'http://localhost:5173', Cookie: verifierCookie },
    })
    expect(redeemed.status).toBe(200)
    expect(redeemed.headers.get('set-cookie')).toContain('web_app_demo_refresh=')
    expect(redeemed.headers.get('set-cookie')).toContain('web_app_demo_browser_link=; Max-Age=0')
    const status = await app.request(`/api/v1/auth/browser-link/${challenge.challengeId}/status`, {
      headers: { Cookie: verifierCookie },
    })
    expect(status.status).toBe(200)
  })

  async function maxActor(id: number, name: string) {
    const initData = signMaxInitData({ id, first_name: name }, randomUUID())
    const auth = await app.request('/api/v1/auth/max', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ initData }),
    })
    expect(auth.status).toBe(200)
    const data = await auth.json() as any
    ownedUserIds.add(data.user.id as string)
    const identity = await prisma.externalIdentity.findFirstOrThrow({ where: { provider: 'max', subject: String(id) } })
    await prisma.pilotAdmission.create({ data: { provider: 'max', subject: String(id) } })
    return { userId: data.user.id as string, token: data.accessToken as string }
  }

  async function createFamily(token: string, name: string) {
    const result = await request('/api/v1/families', token, 'POST', { name, timezone: 'Europe/Moscow' }, randomUUID())
    expect(result.response.status).toBe(201)
    const familyId = result.body.family.id as string
    ownedFamilyIds.add(familyId)
    // A newly-created family is intentionally incomplete; finish its profile through the real API
    // because invite issuance is gated on the owner completing it.
    const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId } })
    const avatar = await prisma.mediaAsset.create({ data: {
      familyId, uploaderId: family.ownerUserId, sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
      originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'), byteSize: 1n, width: 1, height: 1,
      originalStatus: 'stored', renditionStatus: 'ready',
    } })
    const profile = await request(`/api/v1/families/${familyId}/child`, token, 'PUT', {
      name: 'Синтетический профиль', birthDate: '2024-01-01', sex: 'girl', avatarMediaId: avatar.id,
      avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    })
    expect(profile.response.status).toBe(200)
    return { id: familyId }
  }

  function createInvite(token: string, familyId: string, role: 'full' | 'viewer') {
    return request(`/api/v1/families/${familyId}/invites`, token, 'POST', { role }, randomUUID())
  }

  async function request(path: string, token: string, method = 'GET', body?: unknown, key?: string) {
    const response = await app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) as any : null }
  }
})

function signMaxInitData(user: { id: number; first_name: string }, queryId: string, startParam?: string) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: queryId, user: JSON.stringify(user) })
  if (startParam) params.set('start_param', startParam)
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  params.set('hash', createHmac('sha256', secret).update(dataCheck).digest('hex'))
  return params.toString()
}

function authHeaders(token: string) { return { Authorization: `Bearer ${token}` } }
