import { describe, expect, test } from 'bun:test'

import { PrismaMaxDirectUploadRepository } from './prisma-max-direct-upload-repository'

const familyId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const childId = '33333333-3333-4333-8333-333333333333'
const plannedMemoryId = '44444444-4444-4444-8444-444444444444'

function fakeDb() {
  const sessions = new Map<string, Record<string, unknown>>()
  const outboundSources: Record<string, unknown>[] = []
  const db = {
    $transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
    maxVideoUploadSession: {
      findUnique: async ({ where }: { where: { familyId_idempotencyKey?: { familyId: string; idempotencyKey: string } } }) => {
        const key = where.familyId_idempotencyKey
        return key ? sessions.get(`${key.familyId}:${key.idempotencyKey}`) ?? null : null
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data }
        sessions.set(`${data.familyId}:${data.idempotencyKey}`, row)
        return row
      },
    },
    maxOutboundSource: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data }
        outboundSources.push(row)
        return row
      },
    },
  }
  return { db, sessions, outboundSources }
}

describe('MAX direct upload repository', () => {
  test('reserves one session for a family/idempotency key and returns it on duplicate reservation', async () => {
    const { db } = fakeDb()
    const repository = new PrismaMaxDirectUploadRepository(db as never)
    const input = {
      familyId, authorId, childId, plannedMemoryId,
      body: '  First video  ', occurredAt: new Date('2026-09-20T10:00:00.000Z'),
      idempotencyKey: 'request-1', idempotencyFingerprint: 'fingerprint-1',
      expiresAt: new Date('2026-09-20T10:15:00.000Z'), now: new Date('2026-09-20T10:00:00.000Z'),
    }

    const first = await repository.reserve(input)
    const second = await repository.reserve({ ...input, plannedMemoryId: '55555555-5555-4555-8555-555555555555' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.session.id).toBe(first.session.id)
    expect(second.session.plannedMemoryId).toBe(plannedMemoryId)
    expect(first.session.body).toBe('First video')
  })

  test('creates an outbound source independently of an inbound MAX source', async () => {
    const { db, outboundSources } = fakeDb()
    const repository = new PrismaMaxDirectUploadRepository(db as never)
    const source = await repository.createOutboundSource({
      familyId, sessionId: '66666666-6666-4666-8666-666666666666',
      recipientId: '77', messageId: 'message-1', providerAttachmentId: 'attachment-1',
    })
    expect(source.familyId).toBe(familyId)
    expect(source.messageId).toBe('message-1')
    expect(source.providerAttachmentId).toBe('attachment-1')
    expect(outboundSources).toHaveLength(1)
  })
})
