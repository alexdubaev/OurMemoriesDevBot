import { describe, expect, test } from 'bun:test'

import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import { MaxProviderError } from './max-api'
import { createMaxVoiceProcessor, resolveMaxVoiceSource } from './process-voice'

const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = {
  kind: 'message_created', senderId: '42', recipientId: '99', messageId: 'audio/1',
  occurredAt: '2026-09-22T10:00:00.000Z', text: null,
  attachments: [{ kind: 'voice', providerAttachmentId: '987', url: 'https://i.oneme.ru/audio-987' }],
}

describe('MAX native voice source resolution', () => {
  test('uses the fresh matching lookup when MAX returns native audio', async () => {
    const api = { getMessage: async () => ({ messageId: 'audio/1', senderId: '42', recipientId: '99', attachments: [
      { kind: 'voice' as const, providerAttachmentId: '987', url: 'https://i.oneme.ru/fresh-audio-987' },
    ] }) } as unknown as MaxApiPort
    await expect(resolveMaxVoiceSource(api, event)).resolves.toEqual({ kind: 'voice', providerAttachmentId: '987', url: 'https://i.oneme.ru/fresh-audio-987' })
  })

  test('uses the validated encrypted-inbox URL only when lookup is explicitly missing', async () => {
    const api = { getMessage: async () => { throw new MaxProviderError(undefined, false, 404, 'message_not_found') } } as unknown as MaxApiPort
    await expect(resolveMaxVoiceSource(api, event)).resolves.toEqual({ kind: 'voice', providerAttachmentId: '987', url: 'https://i.oneme.ru/audio-987' })
  })

  test('rejects a fresh lookup that does not match webhook identity', async () => {
    const api = { getMessage: async () => ({ messageId: 'audio/1', senderId: 'different', recipientId: '99', attachments: [
      { kind: 'voice' as const, providerAttachmentId: '987', url: 'https://i.oneme.ru/audio-987' },
    ] }) } as unknown as MaxApiPort
    await expect(resolveMaxVoiceSource(api, event)).rejects.toMatchObject({ name: 'MaxProviderError', code: 'message_identity_mismatch' })
  })

  test('terminally denies an oversized audio caption before provider lookup or download', async () => {
    let lookups = 0
    let downloads = 0
    let memoryWrites = 0
    const source = {
      id: 'source-1', inboxId: 'inbox-1', status: 'accepted', plannedMemoryId: 'memory-1',
      attachments: [{ id: 'attachment-1', position: 0, plannedMediaId: 'media-1', mediaId: null, status: 'planned', claimUntil: null }],
    }
    const transaction = {
      maxSource: { updateMany: async () => ({ count: 1 }) },
      maxInbox: { updateMany: async () => ({ count: 1 }) },
      maxOutgoingResponse: { upsert: async () => ({ id: 'response-1' }) },
      taskOutbox: { createMany: async () => ({ count: 1 }) },
      memory: { create: async () => { memoryWrites += 1 } },
    }
    const prisma = {
      maxSource: { findUnique: async () => source },
      $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
    }
    const processor = createMaxVoiceProcessor({
      runtime: { prisma, env: { MAX_FILE_MAX_BYTES: 1_024 } } as never,
      api: { getMessage: async () => { lookups += 1; throw new Error('lookup must not run') } } as unknown as MaxApiPort,
      media: {} as never,
      download: async () => { downloads += 1; throw new Error('download must not run') },
    })

    const result = await processor({
      inboxId: 'inbox-1', sourceId: 'source-1',
      event: { ...event, text: '💛'.repeat(8_001) },
    })

    expect(result).toBe('done')
    expect(lookups).toBe(0)
    expect(downloads).toBe(0)
    expect(memoryWrites).toBe(0)
  })
})
