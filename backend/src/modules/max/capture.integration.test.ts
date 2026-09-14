import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import type { BackendRuntime } from '../../runtime'
import { createMaxAcceptUpdate } from './application/accept-update'
import { createMaxModule } from './index'
import type { MaxApiPort, MaxInboundEvent } from './application/ports'
import { createMaxPayloadCrypto } from './infrastructure/payload-crypto'
import { PrismaMaxRepository } from './infrastructure/prisma-max-repository'
import { normalizeMaxUpdate } from './transport/update-mapping'
import { createMaxWebhook } from './transport/webhook'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('MAX durable capture', () => {
  const prisma = createPrisma(databaseUrl!)
  const key = Buffer.alloc(32, 17).toString('base64url')
  const crypto = createMaxPayloadCrypto(key)
  const repository = new PrismaMaxRepository(prisma)
  const accept = createMaxAcceptUpdate({ botId: '900', repository, encrypt: crypto.encrypt, now: () => new Date('2026-09-14T10:00:00.000Z') })
  const webhookSecret = 'M'.repeat(43)
  const webhook = createMaxWebhook({
    secret: webhookSecret, bodyLimitBytes: 64 * 1024, acceptUpdate: accept,
  })
  const headers = { 'X-Max-Bot-Api-Secret': webhookSecret, 'Content-Type': 'application/json' }
  const textUpdate = {
    update_type: 'message_created', timestamp: 1_757_844_000_000, message: {
      sender: { user_id: 77 }, recipient: { chat_id: null, chat_type: 'dialog', user_id: 900 },
      body: { mid: 'max-message-1', text: 'Текстовая заметка', attachments: [] },
    },
  }
  const botStarted = {
    update_type: 'bot_started', timestamp: 1_757_844_000_001, chat_id: 88, user: { user_id: 77 }, payload: null,
  }

  beforeEach(async () => {
    await prisma.maxOutgoingResponse.deleteMany()
    await prisma.maxSource.deleteMany()
    await prisma.maxInbox.deleteMany()
    await prisma.taskOutbox.deleteMany()
  })
  afterAll(async () => { await prisma.$disconnect() })

  test('atomically persists a text event, logical response, and UUID-only tasks', async () => {
    const response = await webhook.request('/webhooks/max', { method: 'POST', headers, body: JSON.stringify(textUpdate) })
    expect(response.status).toBe(200)
    const inbox = await prisma.maxInbox.findFirstOrThrow({ include: { source: true, responses: true } })
    const processTask = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${inbox.id}` } } })
    const responseRow = inbox.responses[0]
    expect(inbox.source).toMatchObject({ senderSubject: '77', recipientId: 900n, messageId: 'max-message-1', plannedMemoryId: expect.any(String) })
    expect(processTask.payload).toEqual({ inboxId: inbox.id })
    expect(responseRow).toMatchObject({ kind: 'accepted', destinationUserId: 77n, text: 'Получено. Сохраняем…' })
    const deliveryTask = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:deliver-response', dedupeKey: `max-response:${responseRow.id}` } } })
    expect(deliveryTask.payload).toEqual({ responseId: responseRow.id })
    expect(crypto.decrypt({ ciphertext: inbox.encryptedPayload, iv: inbox.encryptionIv, authTag: inbox.encryptionAuthTag })).toEqual(expect.objectContaining({ kind: 'message_created', text: 'Текстовая заметка' }))
    expect(JSON.stringify([processTask.payload, deliveryTask.payload])).not.toContain('Текстовая заметка')
  })

  test('reuses one committed boundary for sequential and concurrent duplicate deliveries', async () => {
    const body = JSON.stringify(textUpdate)
    const first = await webhook.request('/webhooks/max', { method: 'POST', headers, body })
    expect(first.status).toBe(200)
    const repeats = await Promise.all(Array.from({ length: 10 }, () => webhook.request('/webhooks/max', { method: 'POST', headers, body })))
    expect(repeats.every((item) => item.status === 200)).toBe(true)
    expect(await prisma.maxInbox.count()).toBe(1)
    expect(await prisma.maxSource.count()).toBe(1)
    expect(await prisma.maxOutgoingResponse.count()).toBe(1)
    expect(await prisma.taskOutbox.count({ where: { type: { startsWith: 'max:' } } })).toBe(2)
  })

  test('bot_started has only a welcome response and no source', async () => {
    const response = await webhook.request('/webhooks/max', { method: 'POST', headers, body: JSON.stringify(botStarted) })
    expect(response.status).toBe(200)
    const inbox = await prisma.maxInbox.findFirstOrThrow({ include: { responses: true } })
    expect(await prisma.maxSource.count()).toBe(0)
    expect(inbox.responses).toHaveLength(1)
    expect(inbox.responses[0]).toMatchObject({ kind: 'welcome', destinationUserId: 77n })
  })

  test('propagates a transaction failure as retryable webhook failure without persistence', async () => {
    const normalized = normalizeMaxUpdate(textUpdate)
    if (normalized.kind !== 'message_created') throw new Error('fixture did not normalize to a message')
    const badEvent = { ...normalized, recipientId: 'not-a-number' } as MaxInboundEvent
    await expect(accept(badEvent)).rejects.toThrow()
    expect(await prisma.maxInbox.count()).toBe(0)
    expect(await prisma.maxSource.count()).toBe(0)
    expect(await prisma.maxOutgoingResponse.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: { startsWith: 'max:' } } })).toBe(0)
  })

  test('real module composition persists through its verified route and uses the verified bot identity', async () => {
    const env = loadEnv({
      DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4),
      MAX_ENABLED: 'true', MAX_BOT_TOKEN: 'max:test-only-token', MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
      MAX_INBOX_ENCRYPTION_KEY: key, MAX_WEBHOOK_URL: 'https://api.example.test/webhooks/max',
      MAX_WEBHOOK_SECRET: headers['X-Max-Bot-Api-Secret'], MAX_MINI_APP_URL: 'https://app.example.test',
    })
    const runtime = { env, prisma } as unknown as BackendRuntime
    const module = createMaxModule({
      runtime,
      identity: { userId: 900, username: 'OurMemoriesMaxBot', isBot: true },
      api: {
        getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }),
        getSubscriptions: async () => [], createSubscription: async () => ({ success: true }),
        deleteSubscription: async () => ({ success: true }),
      } satisfies MaxApiPort,
    })
    const response = await module.routes.request('/webhooks/max', { method: 'POST', headers, body: JSON.stringify({ ...textUpdate, message: { ...textUpdate.message, body: { ...textUpdate.message.body, mid: 'module-message-1' } } }) })
    expect(response.status).toBe(200)
    const inbox = await prisma.maxInbox.findFirstOrThrow({ include: { responses: true } })
    expect(inbox.botId).toBe(900n)
    expect(crypto.decrypt({ ciphertext: inbox.encryptedPayload, iv: inbox.encryptionIv, authTag: inbox.encryptionAuthTag })).toEqual(expect.objectContaining({ messageId: 'module-message-1', text: 'Текстовая заметка' }))
    expect(inbox.responses).toHaveLength(1)
    expect(await prisma.taskOutbox.count({ where: { type: { startsWith: 'max:' } } })).toBe(2)
  })

  test('passes no plaintext in outbox payloads for attachment responses', async () => {
    const attachmentEvent: MaxInboundEvent = { kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'max-message-attachment', occurredAt: '2025-09-14T10:00:00.000Z', text: 'caption', hasAttachments: true }
    await accept(attachmentEvent)
    const tasks = await prisma.taskOutbox.findMany({ where: { type: { startsWith: 'max:' } } })
    expect(tasks).toHaveLength(2)
    expect(tasks.every((task) => Object.keys(task.payload as object).length === 1)).toBe(true)
    expect(JSON.stringify(tasks.map((task) => task.payload))).not.toContain('caption')
  })
})
