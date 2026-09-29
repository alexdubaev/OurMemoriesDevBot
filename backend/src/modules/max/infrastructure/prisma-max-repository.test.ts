import { describe, expect, test } from 'bun:test'

import { PrismaMaxRepository } from './prisma-max-repository'

describe('Prisma MAX repository channel loop guard', () => {
  test('ignores an already recorded memoLy backup provider message before inbox reservation', async () => {
    let inboxWrites = 0
    let backupLookups = 0
    const tx = {
      maxMemoryBackup: { findFirst: async (input: unknown) => {
        backupLookups += 1
        expect(input).toEqual({ where: { channelChatId: -79560265048692n, providerMessageId: 'memoLy-backup-1' }, select: { id: true } })
        return { id: 'backup' }
      } },
      maxInbox: { createMany: async () => { inboxWrites += 1; return { count: 1 } } },
    }
    const db = { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) }
    const repository = new PrismaMaxRepository(db as never)
    await expect(repository.accept({
      botId: '900',
      event: { kind: 'message_created', isChannel: true, senderId: '77', recipientId: '-79560265048692',
        messageId: 'memoLy-backup-1', occurredAt: '2026-09-30T10:00:00.000Z', text: 'a memory', attachments: [] },
      eventKey: 'max:channel:backup', encrypted: { ciphertext: new Uint8Array(), iv: new Uint8Array(), authTag: new Uint8Array() },
      response: null, now: new Date('2026-09-30T10:00:00.000Z'),
    })).resolves.toEqual({ inboxId: '', duplicate: true })
    expect(backupLookups).toBe(1)
    expect(inboxWrites).toBe(0)
  })
})
