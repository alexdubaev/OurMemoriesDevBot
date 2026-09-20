import { afterAll, describe, expect, test } from 'bun:test'

import { randomUUID } from 'node:crypto'

import { createPrisma } from '../../db'

import type { FamilyAccess, FamilyScope } from '../families'
import type { MaxApiPort, MaxDirectUploadRepository, MaxVideoUploadSession } from './application/ports'
import { createMaxDirectVideoUploadService } from './application/direct-video-upload'
import { PrismaMaxDirectUploadRepository } from './infrastructure/prisma-max-direct-upload-repository'

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
    providerUploadToken: 'provider-token', providerMessageId: null, retryCount: 0,
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
      current = { ...current, state: 'processing', retryCount: current.retryCount + 1, lastRetryAt: new Date() }
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
    claim: async () => ({ session: current, claimed: true }),
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
})
