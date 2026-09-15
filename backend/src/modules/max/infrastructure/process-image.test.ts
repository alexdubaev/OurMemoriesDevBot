import { describe, expect, test } from 'bun:test'

import { assertSourcePublicationTransition, createMaxImageProcessor } from './process-image'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'

describe('MAX image processor boundary', () => {
  test('requires the accepted-to-published source transition to win', async () => {
    const tx = { maxSource: { updateMany: async () => ({ count: 0 }) } }
    await expect(assertSourcePublicationTransition(tx as never, 'source')).rejects.toThrow()
  })
  test('does not download an over-limit quick-image message and terminally marks it unsupported', async () => {
    let downloads = 0
    const tx = {
      maxSource: { updateMany: async () => ({ count: 1 }) },
      maxInbox: { updateMany: async () => ({ count: 1 }) },
      maxOutgoingResponse: { upsert: async () => ({ id: 'response' }) },
      taskOutbox: { createMany: async () => ({ count: 1 }) },
    }
    const runtime = { env: { MAX_FILE_MAX_BYTES: 1024 }, prisma: {
      maxSource: { findUnique: async () => ({ id: 'source', status: 'accepted', attachments: [] }) },
      $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    } } as never
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = {
      kind: 'message_created', senderId: '1', recipientId: '2', messageId: 'm', occurredAt: new Date().toISOString(), text: null,
      attachments: Array.from({ length: 11 }, (_, index) => ({ kind: 'image' as const, providerAttachmentId: `p-${index}` })),
    }
    const process = createMaxImageProcessor({ runtime, api: {} as MaxApiPort, media: {} as never,
      download: async () => { downloads += 1; throw new Error('must not download') } })
    await expect(process({ inboxId: 'inbox', sourceId: 'source', event })).resolves.toBe('done')
    expect(downloads).toBe(0)
  })
})
