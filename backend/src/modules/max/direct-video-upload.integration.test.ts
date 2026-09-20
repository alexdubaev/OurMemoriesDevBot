import { afterAll, describe, expect, test } from 'bun:test'

import { randomUUID } from 'node:crypto'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import type { BackendRuntime } from '../../runtime'

import { createPrismaFamilyAccess, type FamilyAccess, type FamilyScope } from '../families'
import { createSourceMemoryPublisher } from '../memories'
import type { MaxApiPort, MaxDirectUploadRepository, MaxVideoUploadSession } from './application/ports'
import { createMaxDirectVideoUploadService } from './application/direct-video-upload'
import { PrismaMaxDirectUploadRepository } from './infrastructure/prisma-max-direct-upload-repository'
import { createMaxApi } from './infrastructure/max-api'
import { createMaxModule } from './index'

const scope: FamilyScope = {
  familyId: '11111111-1111-4111-8111-111111111111',
  principal: { userId: '22222222-2222-4222-8222-222222222222', sessionId: 'session-1' },
}
const childId = '33333333-3333-4333-8333-333333333333'

function session(overrides: Partial<MaxVideoUploadSession> = {}): MaxVideoUploadSession {
  const now = new Date('2026-09-20T10:00:00.000Z')
  return {
    id: '66666666-6666-4666-8666-666666666666', familyId: scope.familyId,
    authorId: scope.principal.userId, childId,
    plannedMemoryId: '44444444-4444-4444-8444-444444444444', body: 'caption',
    occurredAt: now, idempotencyFingerprint: 'fingerprint', idempotencyKey: 'request-1',
    expiresAt: new Date('2026-09-20T10:15:00.000Z'), state: 'reserved',
    providerUploadToken: 'provider-token', providerMessageId: null, providerSendIntentId: null, retryCount: 0,
    lastRetryAt: null, lastErrorCode: null, createdAt: now, updatedAt: now, ...overrides,
  }
}

function access(overrides: Partial<FamilyAccess> = {}): FamilyAccess {
  return {
    requireMember: async () => ({ role: 'full', isOwner: true }),
    requireFull: async () => undefined,
    requireOwner: async () => undefined,
    ...overrides,
  }
}

function api(overrides: Partial<MaxApiPort> = {}): MaxApiPort {
  return {
    getMe: async () => ({ userId: 1, username: 'OurMemoriesDevBot', isBot: true }),
    getSubscriptions: async () => [], createSubscription: async () => ({ success: true }),
    deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
    createVideoUpload: async () => ({ url: 'https://upload.max.example/video', token: 'provider-token' }),
    sendVideoMessage: async () => ({ messageId: 'message-1' }),
    getMessage: async () => ({ messageId: 'message-1', senderId: '1', recipientId: scope.principal.userId,
      attachments: [{ kind: 'video', providerAttachmentId: 'attachment-1', currentToken: 'opaque', inboundDurationSeconds: 1, width: 640, height: 360 }] }),
    ...overrides,
  }
}

function repository(initial = session()) {
  let current = initial
  let reservations = 0
  let outbound = 0
  let capabilityClaimed = false
  const repository: MaxDirectUploadRepository = {
    reserve: async (input) => {
      reservations += 1
      if (reservations === 1) current = { ...current, familyId: input.familyId, authorId: input.authorId, childId: input.childId,
        body: input.body, occurredAt: input.occurredAt, idempotencyFingerprint: input.idempotencyFingerprint,
        idempotencyKey: input.idempotencyKey, expiresAt: input.expiresAt, providerUploadToken: null, state: 'reserved' }
      return { session: current, created: reservations === 1 }
    },
    claimUploadCapability: async () => {
      if (current.providerUploadToken || capabilityClaimed || current.state === 'processing') return { session: current, claimed: false }
      capabilityClaimed = true
      current = { ...current, state: 'processing', providerSendIntentId: current.providerSendIntentId ?? 'send-intent-1', retryCount: current.retryCount + 1, lastRetryAt: new Date() }
      return { session: current, claimed: true }
    },
    persistUploadCapability: async (claimed, token) => {
      if (!capabilityClaimed || current.state !== 'processing' || current.retryCount !== claimed.retryCount) return { session: current, persisted: false }
      capabilityClaimed = false
      current = { ...current, state: 'reserved', providerUploadToken: token, lastErrorCode: null }
      return { session: current, persisted: true }
    },
    releaseUploadCapability: async (claimed, expired) => {
      if (capabilityClaimed && current.state === 'processing' && current.retryCount === claimed.retryCount) {
        capabilityClaimed = false
        current = { ...current, state: expired ? 'expired' : 'reserved', lastErrorCode: expired ? 'upload_expired' : 'upload_capability_unavailable' }
      }
      return current
    },
    createOutboundSource: async (input) => {
      outbound += 1
      return { id: '77777777-7777-4777-8777-777777777777', ...input, createdAt: new Date(), updatedAt: new Date() }
    },
    find: async () => current,
    claim: async () => {
      const sendIntentCreated = current.providerSendIntentId === null
      current = { ...current, state: 'processing', providerSendIntentId: current.providerSendIntentId ?? 'send-intent-1' }
      return { session: current, claimed: true, sendIntentCreated }
    },
    update: async (_session, patch) => { current = { ...current, ...patch }; return current },
    findRecipientId: async () => '123',
  }
  return { repository, getReservations: () => reservations, getOutbound: () => outbound, getSession: () => current,
    setSession: (next: MaxVideoUploadSession) => { current = next } }
}

describe('MAX direct video upload application service', () => {
  test('reserves only supported metadata and does not issue a second durable session on idempotent retry', async () => {
    const state = repository()
    let capabilityCalls = 0
    const service = createMaxDirectVideoUploadService({ access: access(), api: api({
      createVideoUpload: async () => {
        capabilityCalls += 1
        return { url: `https://upload.max.example/video-${capabilityCalls}`, token: `provider-token-${capabilityCalls}` }
      },
    }), repository: state.repository,
      publisher: { publish: async () => state.getSession().plannedMemoryId } as never, now: () => new Date('2026-09-20T10:00:00.000Z') })

    const first = await service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'request-1' })
    const second = await service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'request-1' })

    expect(first.sessionId).toBe(second.sessionId)
    expect(second.state).toBe('existing')
    expect(second).not.toHaveProperty('uploadUrl')
    expect(second).not.toHaveProperty('uploadToken')
    expect(state.getReservations()).toBe(2)
    expect(capabilityCalls).toBe(1)
    expect(state.getSession().providerUploadToken).toBe('provider-token-1')
    await expect(service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.exe', fileSize: 128, mimeType: 'application/octet-stream', idempotencyKey: 'bad' })).rejects.toMatchObject({ kind: 'invalid_input' })
    await expect(service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 250 * 1024 * 1024 + 1, mimeType: 'video/mp4', idempotencyKey: 'large' })).rejects.toMatchObject({ kind: 'invalid_input' })
  })

  test('recovers one capability after durable token persistence fails', async () => {
    const state = repository(session({ providerUploadToken: null }))
    let capabilityCalls = 0
    let updateCalls = 0
    const originalUpdate = state.repository.update
    const service = createMaxDirectVideoUploadService({ access: access(), api: api({
      createVideoUpload: async () => {
        capabilityCalls += 1
        return { url: 'https://upload.max.example/recovered', token: 'recovered-token' }
      },
    }), repository: {
      ...state.repository,
      persistUploadCapability: async (claimed, token) => {
        updateCalls += 1
        if (updateCalls === 1) throw new Error('database outage')
        return originalUpdate(claimed, { providerUploadToken: token }).then((updated) => ({ session: updated, persisted: true }))
      },
    }, publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })

    const input = { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'recover-1' }
    await expect(service.reserve(scope, input)).rejects.toMatchObject({ kind: 'retryable', code: 'upload_capability_unavailable' })
    const retry = await service.reserve(scope, input)

    expect(retry).toMatchObject({ state: 'reserved', uploadUrl: 'https://upload.max.example/recovered', uploadToken: 'recovered-token' })
    expect(capabilityCalls).toBe(1)
    expect(updateCalls).toBe(2)
    expect(state.getSession().providerUploadToken).toBe('recovered-token')
  })

  test('includes the caller idempotency key in the reservation fingerprint', async () => {
    const state = repository()
    const fingerprints: string[] = []
    const service = createMaxDirectVideoUploadService({ access: access(), api: api(), repository: {
      ...state.repository,
      reserve: async (input) => {
        fingerprints.push(input.idempotencyFingerprint)
        return state.repository.reserve(input)
      },
    }, publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })

    const input = { childId, body: 'same metadata', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4' }
    await service.reserve(scope, { ...input, idempotencyKey: 'operation-a' })
    await service.reserve(scope, { ...input, idempotencyKey: 'operation-b' })

    expect(fingerprints).toHaveLength(2)
    expect(fingerprints[0]).not.toBe(fingerprints[1])
  })

  test('rejects captions above 4000 Unicode code points while accepting the boundary', async () => {
    const state = repository()
    const service = createMaxDirectVideoUploadService({ access: access(), api: api(), repository: state.repository,
      publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })
    const input = { childId, occurredAt: '2026-09-20T10:00:00.000Z', fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4' }

    await expect(service.reserve(scope, { ...input, body: '🙂'.repeat(4_001), idempotencyKey: 'too-long' }))
      .rejects.toMatchObject({ kind: 'invalid_input' })
    await expect(service.reserve(scope, { ...input, body: '🙂'.repeat(4_000), idempotencyKey: 'at-boundary' }))
      .resolves.toMatchObject({ sessionId: session().id })
  })

  test('publishes a fixed memory once and bounds attachment-not-ready retries', async () => {
    const state = repository()
    let sends = 0
    let lookups = 0
    const service = createMaxDirectVideoUploadService({ access: access(), repository: state.repository,
      api: api({ sendVideoMessage: async () => { sends += 1; return { messageId: 'message-1' } },
        getMessage: async () => { lookups += 1; if (lookups < 2) throw Object.assign(new Error('not ready'), { code: 'attachment.not.ready', retryable: true }); return api().getMessage!('message-1') } }),
      publisher: { publish: async (_scope: FamilyScope, input: { id: string }) => { expect(input.id).toBe(session().plannedMemoryId); return input.id } } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })

    const result = await service.finalize(scope, session().id)
    expect(result.state).toBe('finalized')
    expect(sends).toBe(1)
    expect(lookups).toBe(2)
  })

  test('rechecks full membership and author ownership during finalize', async () => {
    const state = repository(session({ authorId: '99999999-9999-4999-8999-999999999999' }))
    const service = createMaxDirectVideoUploadService({ access: access({ requireFull: async () => { throw Object.assign(new Error('revoked'), { kind: 'forbidden' }) } }),
      api: api(), repository: state.repository, publisher: { publish: async () => state.getSession().plannedMemoryId } as never })
    await expect(service.finalize(scope, session().id)).rejects.toMatchObject({ kind: 'forbidden' })
  })

  test('rechecks current FULL membership after claiming and before sending', async () => {
    const state = repository()
    let checks = 0
    let sends = 0
    const service = createMaxDirectVideoUploadService({
      access: access({ requireFull: async () => {
        checks += 1
        if (checks === 2) throw Object.assign(new Error('revoked'), { kind: 'forbidden' })
      } }),
      api: api({ sendVideoMessage: async () => { sends += 1; return { messageId: 'message-1' } } }),
      repository: state.repository,
      publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z'),
    })

    await expect(service.finalize(scope, session().id)).rejects.toMatchObject({ kind: 'forbidden' })
    expect(checks).toBe(2)
    expect(sends).toBe(0)
    expect(state.getSession()).toMatchObject({ state: 'uploaded' })
  })

  test('recovers a sent provider message by durable intent after the post-send write is lost', async () => {
    const state = repository()
    let providerMessageWriteAttempts = 0
    let sends = 0
    const failingRepository: MaxDirectUploadRepository = {
      ...state.repository,
      update: async (current, patch) => {
        if (patch.providerMessageId && providerMessageWriteAttempts++ === 0) throw new Error('lost database write')
        return state.repository.update(current, patch)
      },
    }
    const firstService = createMaxDirectVideoUploadService({ access: access(), api: api({
      sendVideoMessage: async () => { sends += 1; return { messageId: 'message-1' } },
    }), repository: failingRepository, publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })

    await expect(firstService.finalize(scope, session().id)).rejects.toMatchObject({ kind: 'retryable', code: 'provider_unavailable' })

    const recoveryApi = Object.assign(api({
      sendVideoMessage: async () => { sends += 1; return { messageId: 'message-2' } },
      getMessage: async (messageId: string) => ({ ...(await api().getMessage!(messageId)), messageId }),
    }), {
      findVideoMessageByIntent: async () => ({ messageId: 'message-1' }),
    }) as MaxApiPort
    const secondService = createMaxDirectVideoUploadService({ access: access(), api: recoveryApi,
      repository: state.repository, publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:01:00.000Z') })

    await expect(secondService.finalize(scope, session().id)).resolves.toMatchObject({ state: 'finalized' })
    expect(sends).toBe(1)
  })

  test('does not resend after an uncertain send when the production MAX adapter has no idempotent lookup', async () => {
    const state = repository()
    let providerPosts = 0
    let lostProviderWrite = true
    let published = 0
    const productionApi = createMaxApi('max:test-token', { fetch: async (_input, init) => {
      if (init?.method === 'POST') providerPosts += 1
      return new Response(JSON.stringify({ message: { mid: 'uncertain-message-1' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    } })
    const failingRepository: MaxDirectUploadRepository = {
      ...state.repository,
      update: async (current, patch) => {
        if (lostProviderWrite && patch.providerMessageId) { lostProviderWrite = false; throw new Error('lost post-send write') }
        return state.repository.update(current, patch)
      },
    }
    const publisher = { publish: async () => { published += 1; return state.getSession().plannedMemoryId } } as never
    const firstService = createMaxDirectVideoUploadService({ access: access(), api: productionApi,
      repository: failingRepository, publisher, now: () => new Date('2026-09-20T10:00:00.000Z') })
    await expect(firstService.finalize(scope, session().id)).rejects.toMatchObject({ kind: 'retryable', code: 'provider_unavailable' })

    const restartedService = createMaxDirectVideoUploadService({ access: access(), api: productionApi,
      repository: state.repository, publisher, now: () => new Date('2026-09-20T10:01:00.000Z') })
    await expect(restartedService.finalize(scope, session().id)).rejects.toMatchObject({ kind: 'retryable', code: 'send_recovery_unavailable' })
    expect(providerPosts).toBe(1)
    expect(published).toBe(0)
    expect(state.getSession()).toMatchObject({ state: 'uploaded', lastErrorCode: 'send_recovery_unavailable', providerMessageId: null })
  })

  test('a leaked provider capability cannot publish a Memory for another authorized family member', async () => {
    const state = repository()
    let sends = 0
    let published = 0
    const service = createMaxDirectVideoUploadService({
      access: access(),
      api: api({ sendVideoMessage: async () => { sends += 1; return { messageId: 'message-1' } } }),
      repository: state.repository,
      publisher: { publish: async () => { published += 1; return state.getSession().plannedMemoryId } } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z'),
    })
    const reservation = await service.reserve(scope, {
      childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'synthetic.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'leak-1',
    })
    const leakedCapability = reservation.uploadToken
    expect(leakedCapability).toBeTruthy()

    const otherFullMember: FamilyScope = {
      familyId: scope.familyId,
      principal: { userId: '99999999-9999-4999-8999-999999999999', sessionId: 'other-session' },
    }
    await expect(service.finalize(otherFullMember, reservation.sessionId, leakedCapability)).rejects.toMatchObject({ kind: 'forbidden' })
    expect(sends).toBe(0)
    expect(published).toBe(0)
    expect(state.getSession().state).toBe('reserved')
  })

  test('does not send while another finalize owns the durable processing claim', async () => {
    const state = repository()
    let sends = 0
    const service = createMaxDirectVideoUploadService({ access: access(), repository: {
      ...state.repository,
      claim: async () => ({ session: state.getSession(), claimed: false }),
    }, api: api({ sendVideoMessage: async () => { sends += 1; return { messageId: 'message-1' } } }),
      publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })

    await expect(service.finalize(scope, session().id)).resolves.toMatchObject({ state: 'processing', retryable: true })
    expect(sends).toBe(0)
  })

  test('returns a retryable result and releases the claim after a provider failure', async () => {
    const state = repository()
    const service = createMaxDirectVideoUploadService({ access: access(), repository: state.repository,
      api: api({ sendVideoMessage: async () => { throw new Error('provider outage') } }),
      publisher: { publish: async () => state.getSession().plannedMemoryId } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })

    await expect(service.finalize(scope, session().id)).rejects.toMatchObject({ kind: 'retryable', code: 'provider_unavailable' })
    expect(state.getSession()).toMatchObject({ state: 'uploaded', lastErrorCode: 'provider_unavailable' })
  })

  test('does not publish after the reservation expires during provider processing', async () => {
    const state = repository()
    let currentNow = new Date('2026-09-20T10:00:00.000Z')
    let published = 0
    const service = createMaxDirectVideoUploadService({ access: access(), repository: state.repository,
      api: api({ getMessage: async () => {
        currentNow = new Date('2026-09-20T10:16:00.000Z')
        return api().getMessage!('message-1')
      } }),
      publisher: { publish: async () => { published += 1; return state.getSession().plannedMemoryId } } as never,
      now: () => currentNow })

    await expect(service.finalize(scope, session().id)).resolves.toMatchObject({ state: 'expired', retryable: false })
    expect(published).toBe(0)
  })

  test('does not finalize a provider message with multiple attachments', async () => {
    const state = repository()
    let published = 0
    const service = createMaxDirectVideoUploadService({ access: access(), repository: state.repository,
      api: api({ getMessage: async () => ({ ...(await api().getMessage!('message-1')), attachments: [
        { kind: 'video' as const, providerAttachmentId: 'attachment-1', currentToken: 'opaque', inboundDurationSeconds: 1, width: 640, height: 360 },
        { kind: 'image' as const, providerAttachmentId: 'attachment-2', url: 'https://max.example/image' },
      ] }) }),
      publisher: { publish: async () => { published += 1; return state.getSession().plannedMemoryId } } as never,
      now: () => new Date('2026-09-20T10:00:00.000Z') })

    await expect(service.finalize(scope, session().id)).rejects.toMatchObject({ kind: 'retryable', code: 'attachment_not_ready' })
    expect(published).toBe(0)
  })
})

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDatabaseDescribe = databaseUrl ? describe : describe.skip

maybeDatabaseDescribe('MAX direct video upload repository integration', () => {
  const prisma = createPrisma(databaseUrl!)

  afterAll(async () => { await prisma.$disconnect() })

  test('concurrent reservations return one committed session after a unique conflict', async () => {
    const user = await prisma.user.create({ data: { displayName: `direct-upload-${randomUUID()}` } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: `direct-upload-${randomUUID()}`, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Direct upload child' } })

    try {
      const repository = new PrismaMaxDirectUploadRepository(prisma)
      const input = {
        familyId: family.id, authorId: user.id, childId: child.id,
        body: 'concurrent video', occurredAt: new Date('2026-09-20T10:00:00.000Z'),
        idempotencyKey: `concurrent-${randomUUID()}`, idempotencyFingerprint: `fingerprint-${randomUUID()}`,
        expiresAt: new Date('2026-09-20T10:15:00.000Z'), now: new Date('2026-09-20T10:00:00.000Z'),
      }
      const reservations = await Promise.all(Array.from({ length: 10 }, () => repository.reserve({ ...input, plannedMemoryId: randomUUID() })))

      expect(reservations.filter((result) => result.created)).toHaveLength(1)
      expect([...new Set(reservations.map((result) => result.session.id))]).toHaveLength(1)
      expect(await prisma.maxVideoUploadSession.count({ where: { familyId: family.id } })).toBe(1)
    } finally {
      await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: family.id } })
      await prisma.child.delete({ where: { id: child.id } })
      await prisma.family.delete({ where: { id: family.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  test('two service instances share one durable capability claim', async () => {
    const user = await prisma.user.create({ data: { displayName: `direct-upload-${randomUUID()}` } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: `direct-upload-${randomUUID()}`, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Direct upload child' } })

    try {
      const repository = new PrismaMaxDirectUploadRepository(prisma)
      let capabilityCalls = 0
      const delayedApi = (label: string): MaxApiPort => api({
        createVideoUpload: async () => {
          capabilityCalls += 1
          await new Promise((resolve) => setTimeout(resolve, 20))
          return { url: `https://upload.max.example/${label}`, token: `token-${label}` }
        },
      })
      const serviceOptions = {
        access: access(), repository,
        publisher: { publish: async () => randomUUID() } as never,
        now: () => new Date('2026-09-20T10:00:00.000Z'),
      }
      const firstService = createMaxDirectVideoUploadService({ ...serviceOptions, api: delayedApi('first') })
      const secondService = createMaxDirectVideoUploadService({ ...serviceOptions, api: delayedApi('second') })
      const uploadScope: FamilyScope = { familyId: family.id, principal: { userId: user.id, sessionId: 'multi-instance-session' } }
      const input = { childId: child.id, body: 'multi-instance video', occurredAt: '2026-09-20T10:00:00.000Z',
        fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: `multi-${randomUUID()}` }

      const results = await Promise.all([firstService.reserve(uploadScope, input), secondService.reserve(uploadScope, input)])
      const reserved = results.find((result) => result.state === 'reserved')
      const existing = results.find((result) => result.state === 'existing')

      expect(results.filter((result) => result.state === 'reserved')).toHaveLength(1)
      expect(results.filter((result) => result.state === 'existing')).toHaveLength(1)
      expect(capabilityCalls).toBe(1)
      expect(reserved?.uploadToken).toBeTruthy()
      expect(existing).not.toHaveProperty('uploadUrl')
      expect(existing).not.toHaveProperty('uploadToken')
      const durable = await prisma.maxVideoUploadSession.findUniqueOrThrow({ where: { familyId_idempotencyKey: { familyId: family.id, idempotencyKey: input.idempotencyKey } } })
      expect(durable.providerUploadToken).toBe(reserved?.uploadToken ?? null)
    } finally {
      await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: family.id } })
      await prisma.child.delete({ where: { id: child.id } })
      await prisma.family.delete({ where: { id: family.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  test('different operation keys for identical metadata create separate durable reservations', async () => {
    const user = await prisma.user.create({ data: { displayName: `direct-upload-${randomUUID()}` } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: `direct-upload-${randomUUID()}`, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Distinct upload child' } })

    try {
      const repository = new PrismaMaxDirectUploadRepository(prisma)
      const service = createMaxDirectVideoUploadService({
        access: createPrismaFamilyAccess(prisma), api: api(), repository,
        publisher: { publish: async () => randomUUID() } as never,
        now: () => new Date('2026-09-20T10:00:00.000Z'),
      })
      const uploadScope: FamilyScope = { familyId: family.id, principal: { userId: user.id, sessionId: 'distinct-operation-session' } }
      const input = { childId: child.id, body: 'same metadata', occurredAt: '2026-09-20T10:00:00.000Z',
        fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4' }

      const first = await service.reserve(uploadScope, { ...input, idempotencyKey: 'operation-a' })
      const second = await service.reserve(uploadScope, { ...input, idempotencyKey: 'operation-b' })

      expect(first.sessionId).not.toBe(second.sessionId)
      expect(await prisma.maxVideoUploadSession.count({ where: { familyId: family.id } })).toBe(2)
    } finally {
      await prisma.memory.deleteMany({ where: { familyId: family.id } })
      await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: family.id } })
      await prisma.child.delete({ where: { id: child.id } })
      await prisma.family.delete({ where: { id: family.id } })
      await prisma.externalIdentity.deleteMany({ where: { userId: user.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  test('concurrent finalize sends once and publishes one fixed Memory in the real database', async () => {
    const user = await prisma.user.create({ data: { displayName: `direct-upload-${randomUUID()}` } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: `direct-upload-${randomUUID()}`, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Concurrent finalize child' } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject: '9001' } })

    try {
      const repository = new PrismaMaxDirectUploadRepository(prisma)
      const familyAccess = createPrismaFamilyAccess(prisma)
      const publisher = createSourceMemoryPublisher(prisma, familyAccess)
      let sends = 0
      const providerApi = api({
        sendVideoMessage: async () => {
          sends += 1
          await new Promise((resolve) => setTimeout(resolve, 50))
          return { messageId: 'concurrent-message-1' }
        },
        getMessage: async () => ({ messageId: 'concurrent-message-1', senderId: '1', recipientId: '9001',
          attachments: [{ kind: 'video', providerAttachmentId: 'concurrent-attachment-1', currentToken: 'opaque', inboundDurationSeconds: 1, width: 640, height: 360 }] }),
      })
      const serviceOptions = { access: familyAccess, api: providerApi, repository, publisher,
        now: () => new Date('2026-09-20T10:00:00.000Z') }
      const firstService = createMaxDirectVideoUploadService(serviceOptions)
      const secondService = createMaxDirectVideoUploadService(serviceOptions)
      const uploadScope: FamilyScope = { familyId: family.id, principal: { userId: user.id, sessionId: 'concurrent-finalize-session' } }
      const reservation = await firstService.reserve(uploadScope, { childId: child.id, body: 'concurrent finalize',
        occurredAt: '2026-09-20T10:00:00.000Z', fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: `concurrent-finalize-${randomUUID()}` })

      const results = await Promise.all([
        firstService.finalize(uploadScope, reservation.sessionId, reservation.uploadToken),
        secondService.finalize(uploadScope, reservation.sessionId, reservation.uploadToken),
      ])

      expect(results.some((result) => result.state === 'finalized')).toBe(true)
      expect(sends).toBe(1)
      expect(await prisma.memory.count({ where: { familyId: family.id } })).toBe(1)
      expect(await prisma.maxOutboundSource.count({ where: { familyId: family.id } })).toBe(1)
    } finally {
      await prisma.memory.deleteMany({ where: { familyId: family.id } })
      await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: family.id } })
      await prisma.child.delete({ where: { id: child.id } })
      await prisma.family.delete({ where: { id: family.id } })
      await prisma.externalIdentity.deleteMany({ where: { userId: user.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  test('restart recovers a provider message after the post-send database write is lost without a second send', async () => {
    const user = await prisma.user.create({ data: { displayName: `direct-upload-${randomUUID()}` } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: `direct-upload-${randomUUID()}`, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Recovery child' } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject: '9002' } })

    try {
      const repository = new PrismaMaxDirectUploadRepository(prisma)
      const familyAccess = createPrismaFamilyAccess(prisma)
      const publisher = createSourceMemoryPublisher(prisma, familyAccess)
      let sends = 0
      const baseApi = api({
        sendVideoMessage: async () => { sends += 1; return { messageId: 'recovery-message-1' } },
        getMessage: async () => ({ messageId: 'recovery-message-1', senderId: '1', recipientId: '9002',
          attachments: [{ kind: 'video', providerAttachmentId: 'recovery-attachment-1', currentToken: 'opaque', inboundDurationSeconds: 1, width: 640, height: 360 }] }),
      })
      const initialService = createMaxDirectVideoUploadService({ access: familyAccess, api: baseApi, repository,
        publisher, now: () => new Date('2026-09-20T10:00:00.000Z') })
      const uploadScope: FamilyScope = { familyId: family.id, principal: { userId: user.id, sessionId: 'recovery-session' } }
      const reservation = await initialService.reserve(uploadScope, { childId: child.id, body: 'recovery',
        occurredAt: '2026-09-20T10:00:00.000Z', fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: `recovery-${randomUUID()}` })
      let lost = true
      const failingRepository: MaxDirectUploadRepository = {
        reserve: repository.reserve.bind(repository), claimUploadCapability: repository.claimUploadCapability.bind(repository),
        persistUploadCapability: repository.persistUploadCapability.bind(repository), releaseUploadCapability: repository.releaseUploadCapability.bind(repository),
        createOutboundSource: repository.createOutboundSource.bind(repository), find: repository.find.bind(repository), claim: repository.claim.bind(repository),
        findOutboundSource: repository.findOutboundSource?.bind(repository), findRecipientId: repository.findRecipientId?.bind(repository), assertChild: repository.assertChild?.bind(repository),
        update: async (session, patch) => {
        if (lost && patch.providerMessageId) { lost = false; throw new Error('lost post-send write') }
        return repository.update(session, patch)
        },
      }

      const firstAttempt = createMaxDirectVideoUploadService({ access: familyAccess, api: baseApi, repository: failingRepository,
        publisher, now: () => new Date('2026-09-20T10:00:00.000Z') })
      await expect(firstAttempt.finalize(uploadScope, reservation.sessionId, reservation.uploadToken)).rejects.toMatchObject({ code: 'provider_unavailable' })

      const recoveryApi = Object.assign(api({
        sendVideoMessage: async () => { sends += 1; return { messageId: 'recovery-message-2' } },
        getMessage: baseApi.getMessage,
      }), { findVideoMessageByIntent: async () => ({ messageId: 'recovery-message-1' }) }) as MaxApiPort
      const restartedService = createMaxDirectVideoUploadService({ access: familyAccess, api: recoveryApi, repository,
        publisher, now: () => new Date('2026-09-20T10:01:00.000Z') })

      await expect(restartedService.finalize(uploadScope, reservation.sessionId, reservation.uploadToken)).resolves.toMatchObject({ state: 'finalized' })
      expect(sends).toBe(1)
      expect(await prisma.memory.count({ where: { familyId: family.id } })).toBe(1)
      expect((await prisma.maxVideoUploadSession.findUniqueOrThrow({ where: { id_familyId: { id: reservation.sessionId, familyId: family.id } } })).providerMessageId).toBe('recovery-message-1')
    } finally {
      await prisma.memory.deleteMany({ where: { familyId: family.id } })
      await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: family.id } })
      await prisma.child.delete({ where: { id: child.id } })
      await prisma.family.delete({ where: { id: family.id } })
      await prisma.externalIdentity.deleteMany({ where: { userId: user.id } })
      await prisma.user.delete({ where: { id: user.id } })
    }
  })

  test('a leaked capability cannot finalize through the authenticated route for another member, family, or session', async () => {
    const env = loadEnv({
      DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4),
      MAX_ENABLED: 'true', MAX_BOT_TOKEN: 'max:test-only-token', MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
      MAX_INBOX_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64url'),
      MAX_WEBHOOK_URL: 'https://api.example.test/webhooks/max', MAX_WEBHOOK_SECRET: 'M'.repeat(43),
      MAX_MINI_APP_URL: 'https://app.example.test',
    })
    let sends = 0
    const module = createMaxModule({
      runtime: { env, prisma } as unknown as BackendRuntime,
      identity: { userId: 900, username: 'OurMemoriesMaxBot', isBot: true },
      api: api({ sendVideoMessage: async () => { sends += 1; return { messageId: 'message-1' } } }),
    })
    const app = createApp({ env, prisma, maxRoutes: module.routes, legacyPasswordAuthForTests: true })
    const ownerRegistration = await app.request('/api/auth/token/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `max-direct-owner-${randomUUID()}@example.test`, password: 'password123' }),
    })
    const otherRegistration = await app.request('/api/auth/token/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `max-direct-other-${randomUUID()}@example.test`, password: 'password123' }),
    })
    expect(ownerRegistration.status).toBe(201)
    expect(otherRegistration.status).toBe(201)
    const ownerBody = await ownerRegistration.json() as { accessToken: string; user: { id: string } }
    const otherBody = await otherRegistration.json() as { accessToken: string; user: { id: string } }
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: {
        ownerUserId: ownerBody.user.id, name: `MAX direct ${randomUUID()}`, timezone: 'Europe/Moscow',
      } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: ownerBody.user.id, role: 'full' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: otherBody.user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Synthetic child' } })

    try {
      const oversizedCaption = await app.request(`/api/v1/families/${family.id}/max-video-uploads/reserve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerBody.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId: child.id, body: '🙂'.repeat(4_001), occurredAt: '2026-09-20T10:00:00.000Z',
          fileName: 'synthetic.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: `route-long-${randomUUID()}` }),
      })
      expect(oversizedCaption.status).toBe(422)

      const reserve = await app.request(`/api/v1/families/${family.id}/max-video-uploads/reserve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerBody.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId: child.id, body: 'Synthetic route boundary', occurredAt: '2026-09-20T10:00:00.000Z',
          fileName: 'synthetic.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: `route-${randomUUID()}` }),
      })
      expect(reserve.status).toBe(201)
      const reserved = await reserve.json() as { sessionId: string; uploadToken: string }
      expect(reserved.uploadToken).toBeTruthy()

      const otherMemberFinalize = await app.request(`/api/v1/families/${family.id}/max-video-uploads/${reserved.sessionId}/finalize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherBody.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadToken: reserved.uploadToken }),
      })
      expect(otherMemberFinalize.status).toBe(403)

      const wrongFamilyFinalize = await app.request(`/api/v1/families/${randomUUID()}/max-video-uploads/${reserved.sessionId}/finalize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerBody.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadToken: reserved.uploadToken }),
      })
      expect(wrongFamilyFinalize.status).toBe(404)

      const wrongSessionFinalize = await app.request(`/api/v1/families/${family.id}/max-video-uploads/${randomUUID()}/finalize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerBody.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadToken: reserved.uploadToken }),
      })
      expect(wrongSessionFinalize.status).toBe(404)
      expect(sends).toBe(0)
      expect(await prisma.memory.count({ where: { familyId: family.id } })).toBe(0)
      expect(await prisma.maxOutboundSource.count({ where: { familyId: family.id } })).toBe(0)
      expect(await prisma.maxVideoReference.count({ where: { familyId: family.id } })).toBe(0)
      expect(await prisma.maxVideoUploadSession.findUniqueOrThrow({ where: { id: reserved.sessionId } })).toMatchObject({ state: 'reserved' })
    } finally {
      await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: family.id } })
      await prisma.child.delete({ where: { id: child.id } })
      await prisma.family.delete({ where: { id: family.id } })
      await prisma.user.deleteMany({ where: { id: { in: [ownerBody.user.id, otherBody.user.id] } } })
    }
  })
})
