import { describe, expect, test } from 'bun:test'

import { assertSourcePublicationTransition, claimMaxSourceAttachment, createMaxImageProcessor, waitForMaxAttachmentPoll } from './process-image'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'

describe('MAX image processor boundary', () => {
  test('requires the accepted-to-published source transition to win', async () => {
    const tx = { maxSource: { updateMany: async () => ({ count: 0 }) } }
    await expect(assertSourcePublicationTransition(tx as never, 'source')).rejects.toThrow()
  })
  test('claims one planned attachment with a durable lease before downloading', async () => {
    let seen: unknown
    const claimed = await claimMaxSourceAttachment({ maxSourceAttachment: {
      updateMany: async (input: unknown) => { seen = input; return { count: 1 } },
    } } as never, 'attachment', new Date('2026-09-15T10:00:00.000Z'))
    expect(claimed).toMatchObject({ attachmentId: 'attachment', token: expect.any(String) })
    expect(seen).toMatchObject({ where: { id: 'attachment', status: 'planned' }, data: { status: 'processing', claimToken: expect.any(String), claimUntil: expect.any(Date) } })
  })
  test('recovers an expired attachment lease without claiming a live contender', async () => {
    let calls = 0
    const claim = await claimMaxSourceAttachment({ maxSourceAttachment: {
      updateMany: async () => { calls += 1; return { count: calls === 2 ? 1 : 0 } },
    } } as never, 'attachment', new Date('2026-09-15T10:00:00.000Z'))
    expect(claim).toMatchObject({ attachmentId: 'attachment', token: expect.any(String) })
    expect(calls).toBe(2)
  })
  test('aborts a contender poll instead of spinning behind a live lease', async () => {
    const controller = new AbortController()
    const waiting = waitForMaxAttachmentPoll(controller.signal)
    controller.abort()
    await expect(waiting).rejects.toBeInstanceOf(Error)
  })
  test('does not download an over-limit quick-image message and terminally marks it unsupported', async () => {
    let downloads = 0
    let cleanups = 0
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
    const process = createMaxImageProcessor({ runtime, api: {} as MaxApiPort,
      media: { discardTrustedSourceAssets: async () => { cleanups += 1 } } as never,
      download: async () => { downloads += 1; throw new Error('must not download') } })
    await expect(process({ inboxId: 'inbox', sourceId: 'source', event })).resolves.toBe('done')
    expect(downloads).toBe(0)
    expect(cleanups).toBe(1)
  })
})
