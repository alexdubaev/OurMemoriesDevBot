import { expect, test } from 'bun:test'

import type { FamilyAccess, FamilyScope } from '../../families'
import type { MaxApiPort, MaxDirectUploadRepository } from './ports'
import { createMaxDirectVideoUploadService } from './direct-video-upload'

const scope: FamilyScope = {
  familyId: '11111111-1111-4111-8111-111111111111',
  principal: { userId: '22222222-2222-4222-8222-222222222222', sessionId: 'session-1' },
}

const input = {
  childId: '33333333-3333-4333-8333-333333333333', body: 'caption', occurredAt: '2026-09-20T10:00:00.000Z',
  fileName: 'clip.mp4', fileSize: 128, mimeType: 'video/mp4', idempotencyKey: 'request-1',
}

const access = (requireFull: FamilyAccess['requireFull']): FamilyAccess => ({
  requireMember: async () => ({ role: 'full', isOwner: true }), requireFull, requireOwner: async () => undefined,
})

const api: MaxApiPort = {
  getMe: async () => ({ userId: 1, username: 'OurMemoriesDevBot', isBot: true }), getSubscriptions: async () => [],
  createSubscription: async () => ({ success: true }), deleteSubscription: async () => ({ success: true }),
  sendMessage: async () => undefined, createVideoUpload: async () => ({ url: 'https://upload.example', token: 'token' }),
  sendVideoMessage: async () => ({ messageId: 'message-1' }), getMessage: async () => ({
    messageId: 'message-1', senderId: '1', recipientId: '2', attachments: [],
  }),
}

function service(overrides: Partial<MaxDirectUploadRepository> = {}, requireFull: FamilyAccess['requireFull'] = async () => undefined) {
  const repository: MaxDirectUploadRepository = {
    reserve: async () => { throw new Error('reserve should not run') },
    claimUploadCapability: async () => { throw new Error('claim should not run') },
    persistUploadCapability: async () => { throw new Error('persist should not run') },
    releaseUploadCapability: async () => { throw new Error('release should not run') },
    createOutboundSource: async () => { throw new Error('create outbound source should not run') },
    find: async () => null,
    claim: async () => null,
    update: async (session) => session,
    assertChild: async () => true,
    ...overrides,
  }
  return createMaxDirectVideoUploadService({ access: access(requireFull), api, repository,
    publisher: { publish: async () => 'memory-id' }, now: () => new Date('2026-09-20T10:00:00.000Z') })
}

test('marks membership and child Reserve not-found branches for transport logging', async () => {
  await expect(service({}, async () => { throw Object.assign(new Error('missing'), { kind: 'not_found' }) }).reserve(scope, input))
    .rejects.toMatchObject({ kind: 'not_found', code: 'reserve_not_found_membership' })

  await expect(service({ assertChild: async () => false }).reserve(scope, input))
    .rejects.toMatchObject({ kind: 'not_found', code: 'reserve_not_found_child' })
})
