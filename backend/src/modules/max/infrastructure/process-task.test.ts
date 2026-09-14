import { describe, expect, test } from 'bun:test'

import type { BackendRuntime } from '../../../runtime'
import { TerminalTaskError } from '../../../outbox'
import { createMaxTaskProcessor } from './process-task'

const inboxId = '019c0000-0000-7000-8000-000000000001'

describe('MAX task processor payload boundary', () => {
  test('rejects a payload unless it contains exactly one usable inbox UUID', async () => {
    const process = createMaxTaskProcessor({
      runtime: {} as BackendRuntime,
      crypto: {} as never,
    })

    for (const payload of [null, {}, { inboxId: 'not-a-uuid' }, { inboxId, sourceId: inboxId }, { inboxId: 12 }]) {
      await expect(process(payload)).rejects.toBeInstanceOf(TerminalTaskError)
    }
  })

  test('skips an inbox that already reached its terminal state', async () => {
    const process = createMaxTaskProcessor({
      runtime: {
        prisma: { maxInbox: { findUnique: async () => ({ status: 'processed' }) } },
      } as unknown as BackendRuntime,
      crypto: {} as never,
    })

    expect(await process({ inboxId })).toBe('skipped')
  })

  test('denies an ambiguous two-family admission without invoking publication', async () => {
    let sourceTransitionCount = 0
    let responseKind: string | undefined
    const source = { id: inboxId, inboxId, senderSubject: '77', status: 'accepted', plannedMemoryId: inboxId }
    const runtime = {
      prisma: {
        maxInbox: { findUnique: async () => ({
          id: inboxId, status: 'accepted', processedAt: null,
          encryptedPayload: new Uint8Array(), encryptionIv: new Uint8Array(), encryptionAuthTag: new Uint8Array(), source,
        }) },
        externalIdentity: { findUnique: async () => ({ user: { id: '019c0000-0000-7000-8000-000000000002', familyMemberships: [
          { familyId: '019c0000-0000-7000-8000-000000000003', family: { children: [{ id: '019c0000-0000-7000-8000-000000000004' }] } },
          { familyId: '019c0000-0000-7000-8000-000000000005', family: { children: [{ id: '019c0000-0000-7000-8000-000000000006' }] } },
        ] } }) },
        $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
          maxSource: { updateMany: async () => { sourceTransitionCount += 1; return { count: 1 } } },
          maxInbox: { updateMany: async () => ({ count: 1 }) },
          maxOutgoingResponse: { upsert: async ({ create }: { create: { kind: string } }) => { responseKind = create.kind; return { id: inboxId } } },
          taskOutbox: { createMany: async () => ({ count: 1 }) },
        }),
      },
    } as unknown as BackendRuntime
    const process = createMaxTaskProcessor({
      runtime,
      crypto: { decrypt: () => ({ kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'message', occurredAt: '2026-09-14T10:00:00.000Z', text: 'Ambiguous', hasAttachments: false }) } as never,
    })

    expect(await process({ inboxId })).toBe('done')
    expect(sourceTransitionCount).toBe(1)
    expect(responseKind).toBe('denied')
  })
})
