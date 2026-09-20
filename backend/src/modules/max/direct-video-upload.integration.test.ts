import { describe, expect, test } from 'bun:test'

import type { FamilyAccess, FamilyScope } from '../families'
import type { MaxApiPort, MaxDirectUploadRepository, MaxVideoUploadSession } from './application/ports'
import { createMaxDirectVideoUploadService } from './application/direct-video-upload'

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
  const repository: MaxDirectUploadRepository = {
    reserve: async (input) => {
      reservations += 1
      return { session: current, created: reservations === 1 }
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
    const service = createMaxDirectVideoUploadService({ access: access(), api: api(), repository: state.repository,
      publisher: { publish: async () => state.getSession().plannedMemoryId } as never, now: () => new Date('2026-09-20T10:00:00.000Z') })

    const first = await service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'request-1' })
    const second = await service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'request-1' })

    expect(first.sessionId).toBe(second.sessionId)
    expect(state.getReservations()).toBe(2)
    await expect(service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.exe', fileSize: 128, mimeType: 'application/octet-stream', idempotencyKey: 'bad' })).rejects.toMatchObject({ kind: 'invalid_input' })
    await expect(service.reserve(scope, { childId, body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
      fileName: 'clip.mp4', fileSize: 250 * 1024 * 1024 + 1, mimeType: 'video/mp4', idempotencyKey: 'large' })).rejects.toMatchObject({ kind: 'invalid_input' })
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
})
