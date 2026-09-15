import { createHash, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { createPrivateStorage } from '../../storage'
import { createMediaService, createMediaTasks } from '../media'
import { pngFixture } from '../../storage/storage-contract'
import { createPrismaFamilyAccess } from '../families'
import type { BackendRuntime } from '../../runtime'
import { createMaxAcceptUpdate } from './application/accept-update'
import { createMaxModule } from './index'
import type { MaxApiPort, MaxInboundEvent } from './application/ports'
import { createMaxPayloadCrypto } from './infrastructure/payload-crypto'
import { createMaxTaskProcessor } from './infrastructure/process-task'
import { createMaxResponseDelivery } from './infrastructure/deliver-response'
import { MaxMediaDownloadError } from './infrastructure/media-download'
import { MaxProviderError } from './infrastructure/max-api'
import { PrismaMaxRepository } from './infrastructure/prisma-max-repository'
import { normalizeMaxUpdate } from './transport/update-mapping'
import { createMaxWebhook } from './transport/webhook'
import { createSourceMemoryPublisher } from '../memories'

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
  const activeStorageRoots = new Set<string>()
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
    await prisma.memoryMedia.deleteMany()
    await prisma.memory.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.user.deleteMany()
  })
  afterEach(async () => {
    for (const root of activeStorageRoots) await rm(root, { recursive: true, force: true })
    activeStorageRoots.clear()
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

  test('bot_started queues processing before creating one welcome response and no source', async () => {
    const response = await webhook.request('/webhooks/max', { method: 'POST', headers, body: JSON.stringify(botStarted) })
    expect(response.status).toBe(200)
    const inbox = await prisma.maxInbox.findFirstOrThrow({ include: { responses: true } })
    expect(await prisma.maxSource.count()).toBe(0)
    expect(inbox.responses).toHaveLength(0)
    const processTask = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${inbox.id}` } } })
    await createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })(processTask.payload)
    const completed = await prisma.maxInbox.findUniqueOrThrow({ where: { id: inbox.id }, include: { responses: true } })
    expect(completed.responses).toHaveLength(1)
    expect(completed.responses[0]).toMatchObject({ kind: 'welcome', destinationUserId: 77n })
    expect(completed.encryptedPayload.byteLength).toBe(0)
  })

  test('routes valid and invalid invite starts without accepting or creating Core data', async () => {
    const active = await maxFamily('23001', 'full')
    const inactive = await maxFamily('23002', 'full')
    const activeToken = token('active')
    const expiredToken = token('expired')
    const revokedToken = token('revoked')
    const usedToken = token('used')
    const inactiveToken = token('inactive')
    await prisma.familyInvite.createMany({ data: [
      invite(active.familyId, active.userId, activeToken),
      invite(active.familyId, active.userId, expiredToken, { expiresAt: new Date('2026-09-14T10:00:00.000Z') }),
      invite(active.familyId, active.userId, revokedToken, { revokedAt: new Date('2026-09-14T10:00:00.000Z') }),
      invite(active.familyId, active.userId, usedToken, { acceptedAt: new Date('2026-09-14T10:00:00.000Z'), acceptedBy: active.userId }),
      invite(inactive.familyId, inactive.userId, inactiveToken),
    ] })
    await prisma.family.update({ where: { id: inactive.familyId }, data: { status: 'deleting' } })
    const before = await Promise.all([
      prisma.familyInvite.count(), prisma.familyMember.count(), prisma.user.count(), prisma.externalIdentity.count(),
    ])
    const cases = [
      { payload: `invite_${activeToken}`, expected: 'Приглашение получено. Откройте приложение memoLy, чтобы присоединиться.' },
      { payload: `invite_${expiredToken}`, expected: 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.' },
      { payload: `invite_${revokedToken}`, expected: 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.' },
      { payload: `invite_${usedToken}`, expected: 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.' },
      { payload: `invite_${inactiveToken}`, expected: 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.' },
      { payload: 'invite_short', expected: 'Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.' },
      { payload: 'campaign_abc', expected: 'Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.' },
      { payload: null, expected: 'Добро пожаловать в memoLy. Откройте приложение, чтобы продолжить.' },
    ] as const
    for (const [index, fixture] of cases.entries()) {
      const accepted = await accept({ kind: 'bot_started', chatId: '88', userId: '77', occurredAt: `2026-09-15T10:0${index}:00.000Z`, payload: fixture.payload })
      const task = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${accepted.inboxId}` } } })
      await createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })(task.payload)
      const processed = await prisma.maxInbox.findUniqueOrThrow({ where: { id: accepted.inboxId }, include: { responses: true } })
      expect(processed.responses[0]?.text).toBe(fixture.expected)
      expect(processed.responses[0]?.text).not.toContain(activeToken)
      expect(processed.encryptedPayload.byteLength).toBe(0)
    }
    expect(await Promise.all([
      prisma.familyInvite.count(), prisma.familyMember.count(), prisma.user.count(), prisma.externalIdentity.count(),
    ])).toEqual(before)
  })

  test('concurrent processing creates one welcome response and clears the inbox once', async () => {
    const family = await maxFamily('23010', 'full')
    const rawToken = token('concurrent')
    await prisma.familyInvite.create({ data: invite(family.familyId, family.userId, rawToken) })
    const accepted = await accept({ kind: 'bot_started', chatId: '89', userId: '77', occurredAt: '2026-09-15T11:00:00.000Z', payload: `invite_${rawToken}` })
    const task = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${accepted.inboxId}` } } })
    let resolverCalls = 0
    const process = createMaxTaskProcessor({
      runtime: { prisma } as unknown as BackendRuntime,
      crypto,
      resolveInviteStart: async (value) => { resolverCalls += 1; expect(value).toBe(rawToken); return 'active' },
    })
    await Promise.all(Array.from({ length: 10 }, () => process(task.payload)))
    expect(resolverCalls).toBe(10)
    expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: accepted.inboxId, kind: 'welcome' } })).toBe(1)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:process', dedupeKey: `max-process:${accepted.inboxId}` } })).toBe(1)
    expect((await prisma.maxInbox.findUniqueOrThrow({ where: { id: accepted.inboxId } })).encryptedPayload.byteLength).toBe(0)
  })

  test('leaves the encrypted inbox retryable when invite resolution fails', async () => {
    const rawToken = token('failure')
    const accepted = await accept({ kind: 'bot_started', chatId: '90', userId: '77', occurredAt: '2026-09-15T12:00:00.000Z', payload: `invite_${rawToken}` })
    const task = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${accepted.inboxId}` } } })
    const process = createMaxTaskProcessor({
      runtime: { prisma } as unknown as BackendRuntime,
      crypto,
      resolveInviteStart: async () => { throw new Error('synthetic resolver outage') },
    })
    await expect(process(task.payload)).rejects.toThrow('synthetic resolver outage')
    const inbox = await prisma.maxInbox.findUniqueOrThrow({ where: { id: accepted.inboxId } })
    expect(inbox.status).toBe('accepted')
    expect(inbox.encryptedPayload.byteLength).toBeGreaterThan(0)
    expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: accepted.inboxId } })).toBe(0)
  })

  test('delivery retries do not rerun invite classification', async () => {
    const family = await maxFamily('23011', 'full')
    const rawToken = token('delivery')
    await prisma.familyInvite.create({ data: invite(family.familyId, family.userId, rawToken) })
    const accepted = await accept({ kind: 'bot_started', chatId: '91', userId: '77', occurredAt: '2026-09-15T13:00:00.000Z', payload: `invite_${rawToken}` })
    const task = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${accepted.inboxId}` } } })
    let resolverCalls = 0
    await createMaxTaskProcessor({
      runtime: { prisma } as unknown as BackendRuntime,
      crypto,
      resolveInviteStart: async () => { resolverCalls += 1; return 'active' },
    })(task.payload)
    const response = await prisma.maxOutgoingResponse.findUniqueOrThrow({ where: { inboxId_kind: { inboxId: accepted.inboxId, kind: 'welcome' } } })
    let attempts = 0
    const delivery = createMaxResponseDelivery({
      prisma,
      api: {
        getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }),
        getSubscriptions: async () => [], createSubscription: async () => ({ success: true }),
        deleteSubscription: async () => ({ success: true }),
        sendMessage: async () => { attempts += 1; if (attempts === 1) throw new Error('synthetic provider outage') },
        getMessage: async () => ({ messageId: 'unused', senderId: '77', recipientId: '900', attachments: [] }),
      },
    })
    await expect(delivery({ responseId: response.id })).rejects.toThrow('synthetic provider outage')
    await expect(delivery({ responseId: response.id })).resolves.toBe('done')
    await expect(delivery({ responseId: response.id })).resolves.toBe('skipped')
    expect(attempts).toBe(2)
    expect(resolverCalls).toBe(1)
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
         deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
         getMessage: async () => ({ messageId: 'unused', senderId: '77', recipientId: '900', attachments: [] }),
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

  test('publishes one fixed-id note for an authorized MAX owner', async () => {
    const user = await prisma.user.create({ data: { displayName: 'MAX owner' } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject: '77' } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: {
        ownerUserId: user.id, name: 'MAX family', timezone: 'Europe/Moscow',
      } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'MAX child' } })

    const event: MaxInboundEvent = {
      kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'max-message-publish',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Original MAX note', hasAttachments: false,
    }
    await accept(event)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const process = createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })
    await Promise.all(Array.from({ length: 10 }, () => process(task.payload)))

    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.memory.findFirstOrThrow()).toMatchObject({
      id: expect.any(String), familyId: family.id, childId: child.id, body: 'Original MAX note',
      kind: 'note', occurredAt: new Date('2026-09-14T10:00:00.000Z'),
    })
    expect(await prisma.maxSource.count({ where: { status: 'published', memoryId: { not: null } } })).toBe(1)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'saved' } })).toBe(1)
    expect(await prisma.maxInbox.findFirstOrThrow()).toMatchObject({ status: 'processed', processedAt: expect.any(Date) })
    expect((await prisma.maxInbox.findFirstOrThrow()).encryptedPayload.byteLength).toBe(0)
  })

  test('retries a failed response without rerunning publication or changing its source state', async () => {
    const user = await prisma.user.create({ data: { displayName: 'MAX delivery owner' } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject: '22010' } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: 'MAX delivery family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    await prisma.child.create({ data: { familyId: family.id, displayName: 'Delivery child' } })
    await accept({ kind: 'message_created', senderId: '22010', recipientId: '900', messageId: 'max-message-reply-retry', occurredAt: '2026-09-14T10:00:00.000Z', text: 'Reply retry note', hasAttachments: false })
    const processTask = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    await createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })(processTask.payload)
    const saved = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { kind: 'saved' } })
    const sourceBefore = await prisma.maxSource.findFirstOrThrow()
    let attempts = 0
    const delivery = createMaxResponseDelivery({
      prisma,
      api: {
        getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }),
        getSubscriptions: async () => [], createSubscription: async () => ({ success: true }),
        deleteSubscription: async () => ({ success: true }),
        sendMessage: async () => { attempts += 1; if (attempts === 1) throw new Error('synthetic provider outage') },
        getMessage: async () => ({ messageId: 'unused', senderId: '77', recipientId: '900', attachments: [] }),
      },
    })
    await expect(delivery({ responseId: saved.id })).rejects.toThrow('synthetic provider outage')
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { id: sourceBefore.id } })).toMatchObject({ status: 'published', memoryId: sourceBefore.memoryId })
    expect(await prisma.maxOutgoingResponse.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ deliveredAt: null })
    await expect(delivery({ responseId: saved.id })).resolves.toBe('done')
    await expect(delivery({ responseId: saved.id })).resolves.toBe('skipped')
    expect(attempts).toBe(2)
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.maxOutgoingResponse.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ deliveredAt: expect.any(Date) })
  })

  test('terminally denies an unauthorized text without creating a Memory', async () => {
    const event: MaxInboundEvent = {
      kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'max-message-denied',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Private text', hasAttachments: false,
    }
    await accept(event)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    await createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })(task.payload)

    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxSource.findFirstOrThrow()).toMatchObject({ status: 'denied', rejectionCode: 'denied' })
    expect(await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { kind: 'denied' } })).toMatchObject({
      text: 'Не удалось сохранить это сообщение в memoLy.', destinationUserId: 77n,
    })
    expect((await prisma.maxInbox.findFirstOrThrow()).encryptedPayload.byteLength).toBe(0)
  })

  test('terminally ignores attachment and bot-started events without core records', async () => {
    const attachment: MaxInboundEvent = {
      kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'max-message-media',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Caption', hasAttachments: true,
    }
    await accept(attachment)
    const attachmentTask = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    await createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })(attachmentTask.payload)
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.mediaAsset.count()).toBe(0)
    expect(await prisma.maxSource.findFirstOrThrow()).toMatchObject({ status: 'unsupported_media' })

    await prisma.taskOutbox.deleteMany()
    const started: MaxInboundEvent = { kind: 'bot_started', chatId: '88', userId: '77', occurredAt: '2026-09-14T10:00:00.000Z', payload: null }
    await accept(started)
    const startedTask = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    await createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })(startedTask.payload)
    expect(await prisma.user.count()).toBe(0)
    expect(await prisma.externalIdentity.count()).toBe(0)
    expect(await prisma.family.count()).toBe(0)
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxInbox.count({ where: { status: 'processed' } })).toBe(2)
  })

  test('does not create a denial response when a stale processor loses the source transition', async () => {
    const event: MaxInboundEvent = {
      kind: 'message_created', senderId: '77', recipientId: '900', messageId: 'max-message-stale-denial',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Private text', hasAttachments: false,
    }
    await accept(event)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    let reportResolver!: () => void
    let releaseResolver!: () => void
    const resolverReported = new Promise<void>((resolve) => { reportResolver = resolve })
    const resolverRelease = new Promise<void>((resolve) => { releaseResolver = resolve })
    const gatedPrisma = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== 'externalIdentity') return Reflect.get(target, property, receiver)
        return new Proxy(target.externalIdentity, {
          get(identityTarget, identityProperty, identityReceiver) {
            if (identityProperty !== 'findUnique') return Reflect.get(identityTarget, identityProperty, identityReceiver)
            return async () => {
              reportResolver()
              await resolverRelease
              return null
            }
          },
        })
      },
    }) as typeof prisma

    const process = createMaxTaskProcessor({ runtime: { prisma: gatedPrisma } as unknown as BackendRuntime, crypto })
    const running = process(task.payload)
    await resolverReported
    const source = await prisma.maxSource.findFirstOrThrow()
    await prisma.maxSource.update({ where: { id: source.id }, data: { status: 'published', memoryId: randomUUID() } })
    releaseResolver()

    expect(await running).toBe('skipped')
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'denied' } })).toBe(0)
    expect(await prisma.maxInbox.findFirstOrThrow()).toMatchObject({ status: 'accepted' })
    expect((await prisma.maxInbox.findFirstOrThrow()).encryptedPayload.byteLength).toBeGreaterThan(0)
  })

  test('admits invited full members and denies viewer, revoked, inactive, and childless contexts', async () => {
    const owner = await maxFamily('22001', 'full')
    const invited = await maxMember('22002', 'full')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: invited.userId, role: 'full' } })
    const invitedResult = await processEvent({
      kind: 'message_created', senderId: invited.subject, recipientId: '900', messageId: 'max-message-invited',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Invited full note', hasAttachments: false,
    })
    expect(invitedResult).toBe('done')
    expect(await prisma.memory.findFirstOrThrow()).toMatchObject({ familyId: owner.familyId, authorId: invited.userId, body: 'Invited full note' })

    const viewer = await maxFamily('22003', 'viewer')
    await processEvent({
      kind: 'message_created', senderId: viewer.subject, recipientId: '900', messageId: 'max-message-viewer',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Viewer note', hasAttachments: false,
    })
    const revoked = await maxFamilyWithMember('22004', 'full')
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: revoked.familyId, userId: revoked.userId } }, data: { revokedAt: new Date() } })
    await processEvent({
      kind: 'message_created', senderId: revoked.subject, recipientId: '900', messageId: 'max-message-revoked',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Revoked note', hasAttachments: false,
    })
    const inactive = await maxFamily('22005', 'full')
    await prisma.family.update({ where: { id: inactive.familyId }, data: { status: 'deleting' } })
    await processEvent({
      kind: 'message_created', senderId: inactive.subject, recipientId: '900', messageId: 'max-message-inactive',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Inactive note', hasAttachments: false,
    })
    const childless = await maxFamily('22006', 'full', false)
    await processEvent({
      kind: 'message_created', senderId: childless.subject, recipientId: '900', messageId: 'max-message-childless',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Childless note', hasAttachments: false,
    })
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.maxSource.count({ where: { status: 'denied' } })).toBe(4)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'denied' } })).toBe(4)
  })

  test('uses Unicode code points for the 8000/8001 text boundary', async () => {
    const owner = await maxFamily('22008', 'full')
    await processEvent({
      kind: 'message_created', senderId: owner.subject, recipientId: '900', messageId: 'max-message-8000',
      occurredAt: '2026-09-14T10:00:00.000Z', text: '💛'.repeat(8_000), hasAttachments: false,
    })
    await processEvent({
      kind: 'message_created', senderId: owner.subject, recipientId: '900', messageId: 'max-message-8001',
      occurredAt: '2026-09-14T10:01:00.000Z', text: '💛'.repeat(8_001), hasAttachments: false,
    })

    expect(await prisma.memory.count()).toBe(1)
    expect([...((await prisma.memory.findFirstOrThrow()).body)].length).toBe(8_000)
    expect(await prisma.maxSource.count({ where: { status: 'denied' } })).toBe(1)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'denied' } })).toBe(1)
  })

  test('denies when revocation commits before the publisher membership lock', async () => {
    const owner = await maxFamilyWithMember('22009', 'full')
    await accept({
      kind: 'message_created', senderId: owner.subject, recipientId: '900', messageId: 'max-message-revocation-race',
      occurredAt: '2026-09-14T10:00:00.000Z', text: 'Race note', hasAttachments: false,
    })
    const source = await prisma.maxSource.findFirstOrThrow()
    const task = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${source.inboxId}` } } })
    let lockReported!: () => void
    let releaseLock!: () => void
    const lockEntered = new Promise<void>((resolve) => { lockReported = resolve })
    const lockRelease = new Promise<void>((resolve) => { releaseLock = resolve })
    const gatedPrisma = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver)
        return async <T>(callback: (tx: typeof prisma) => Promise<T>) => target.$transaction(async (tx) => callback(new Proxy(tx, {
          get(transactionTarget, transactionProperty, transactionReceiver) {
            if (transactionProperty !== '$queryRaw') return Reflect.get(transactionTarget, transactionProperty, transactionReceiver)
            return async (...args: Parameters<typeof tx.$queryRaw>) => {
              lockReported()
              await lockRelease
              return tx.$queryRaw(...args)
            }
          },
        }) as typeof prisma))
      },
    }) as typeof prisma
    const running = createMaxTaskProcessor({ runtime: { prisma: gatedPrisma } as unknown as BackendRuntime, crypto })(task.payload)
    await lockEntered
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: owner.familyId, userId: owner.userId } }, data: { revokedAt: new Date() } })
    releaseLock()

    expect(await running).toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'denied' } })).toBe(1)
  })

  test('publishes one synthetic quick image with exact bytes and caption through private media', async () => {
    const user = await prisma.user.create({ data: { displayName: 'MAX image owner' } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject: '77123' } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: 'Image family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Image child' } })
    const storageRoot = `.max-image-${randomUUID()}`
    activeStorageRoots.add(storageRoot)
    const env = loadEnv({ DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4), MAX_ENABLED: 'true', MAX_BOT_TOKEN: 'max:test-only-token',
      MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot', MAX_INBOX_ENCRYPTION_KEY: key, MAX_WEBHOOK_URL: 'https://api.example.test/webhooks/max', MAX_WEBHOOK_SECRET: webhookSecret,
      MAX_MINI_APP_URL: 'https://app.example.test', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot })
    const privateStorage = createPrivateStorage(env)
    const runtime = { env, prisma, privateStorage } as unknown as BackendRuntime
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77123', recipientId: '900', messageId: 'max-image-one',
      occurredAt: '2026-09-15T10:00:00.000Z', text: 'image caption', attachments: [{ kind: 'image', providerAttachmentId: '1' }] }
    await accept(event)
    const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const process = createMaxTaskProcessor({ runtime, crypto, api: {
      getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }), getSubscriptions: async () => [], createSubscription: async () => ({ success: true }), deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
      getMessage: async () => ({ messageId: event.messageId, senderId: event.senderId, recipientId: event.recipientId, attachments: [{ kind: 'image', providerAttachmentId: '1', url: 'https://i.oneme.ru/synthetic' }] }),
    }, media: createMediaService({ db: prisma, env, familyAccess: createPrismaFamilyAccess(prisma), storage: privateStorage.storage }), download: async () => ({ bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength }) })
    await expect(process(task.payload)).resolves.toBe('done')
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId }, include: { media: { include: { asset: true } } } })
    expect(memory).toMatchObject({ familyId: family.id, childId: child.id, kind: 'photo', body: 'image caption' })
    expect(memory.media).toHaveLength(1)
    expect(memory.media[0]!.asset).toMatchObject({ sourceKind: 'max', originalStatus: 'stored', sha256: createHash('sha256').update(pngFixture).digest('hex') })
    await prisma.mediaAsset.updateMany({ where: { sourceKind: 'max' }, data: { deletedAt: new Date() } })
    await rm(storageRoot, { recursive: true, force: true })
  })

  test('publishes three quick images as one ordered photo Memory', async () => {
    const fixture = await imageFixture('77124', 'three-images')
    const attachments = ['1', '2', '3'].map((providerAttachmentId) => ({ kind: 'image' as const, providerAttachmentId }))
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77124', recipientId: '900', messageId: 'max-image-three', occurredAt: '2026-09-15T10:00:00.000Z', text: 'three images', attachments }
    await accept(event)
    const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId }, include: { attachments: { orderBy: { position: 'asc' } } } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const process = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download: async () => ({ bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength }) })
    await expect(process(task.payload)).resolves.toBe('done')
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId }, include: { media: { orderBy: { position: 'asc' }, include: { asset: true } } } })
    expect(memory.kind).toBe('photo')
    expect(memory.media.map(({ mediaId }) => mediaId)).toEqual(source.attachments.map(({ plannedMediaId }) => plannedMediaId))
    expect(memory.media.every(({ asset }) => asset.sha256 === createHash('sha256').update(pngFixture).digest('hex'))).toBe(true)
    await fixture.cleanup()
  })

  test('resumes a ready deterministic asset after an attachment claim crash without downloading again', async () => {
    const fixture = await imageFixture('771241', 'resume-ready')
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '771241', recipientId: '900', messageId: 'max-image-resume', occurredAt: '2026-09-15T10:00:00.000Z', text: 'resume', attachments: [{ kind: 'image', providerAttachmentId: '1' }] }
    await accept(event)
    const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId }, include: { attachments: true } })
    await fixture.media.ingestTrustedPhoto({ familyId: fixture.familyId, principal: { userId: fixture.userId, sessionId: `max:${source.id}` } }, { assetId: source.attachments[0]!.plannedMediaId, sourceKind: 'max', bytes: pngFixture })
    await prisma.maxSourceAttachment.update({ where: { id: source.attachments[0]!.id }, data: { status: 'processing', claimToken: randomUUID(), claimUntil: new Date(Date.now() - 1_000) } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    let downloads = 0
    const process = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download: async () => { downloads += 1; return { bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength } } })
    await expect(process(task.payload)).resolves.toBe('done')
    expect(downloads).toBe(0)
    expect(await prisma.memory.count()).toBe(1)
    await fixture.cleanup()
  })

  test('publishes one file attachment from octet-stream bytes with the exact SHA', async () => {
    const fixture = await imageFixture('77125', 'file-image')
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77125', recipientId: '900', messageId: 'max-image-file', occurredAt: '2026-09-15T10:00:00.000Z', text: 'file caption', attachments: [{ kind: 'file', providerAttachmentId: 'payload-file-1', filename: 'photo.png', declaredSize: pngFixture.byteLength }] }
    await accept(event)
    const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const process = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download: async () => ({ bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength }) })
    await expect(process(task.payload)).resolves.toBe('done')
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId }, include: { media: { include: { asset: true } } } })
    expect(memory).toMatchObject({ kind: 'photo', body: 'file caption' })
    expect(memory.media[0]!.asset).toMatchObject({ sha256: createHash('sha256').update(pngFixture).digest('hex'), byteSize: BigInt(pngFixture.byteLength) })
    await fixture.cleanup()
  })

  test('keeps two separate file messages as separate Memories', async () => {
    const fixture = await imageFixture('77126', 'two-files')
    for (const [index, body] of ['first file', 'second file'].entries()) {
      const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77126', recipientId: '900', messageId: `max-image-file-${index}`, occurredAt: `2026-09-15T10:0${index}:00.000Z`, text: body, attachments: [{ kind: 'file', providerAttachmentId: `payload-file-${index}`, filename: 'photo.png', declaredSize: pngFixture.byteLength }] }
      await accept(event)
      const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
      await createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download: async () => ({ bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength }) })(task.payload)
      await prisma.taskOutbox.deleteMany({ where: { type: 'max:process' } })
    }
    expect(await prisma.memory.count()).toBe(2)
    expect(await prisma.mediaAsset.count({ where: { sourceKind: 'max', originalStatus: 'stored' } })).toBe(2)
    await fixture.cleanup()
  })

  test('retains an encrypted retryable inbox after a transient third-image failure and reuses first assets', async () => {
    const fixture = await imageFixture('77127', 'transient-third')
    const attachments = ['1', '2', '3'].map((providerAttachmentId) => ({ kind: 'image' as const, providerAttachmentId }))
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77127', recipientId: '900', messageId: 'max-image-transient', occurredAt: '2026-09-15T10:00:00.000Z', text: 'retry me', attachments }
    await accept(event)
    const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const calls = new Map<string, number>()
    const download = async (url: string) => { calls.set(url, (calls.get(url) ?? 0) + 1); if (url.endsWith('/3')) throw new MaxProviderError(); return { bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength } }
    const first = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download })
    await expect(first(task.payload)).rejects.toBeInstanceOf(MaxProviderError)
    expect(await prisma.memory.count()).toBe(0)
    expect((await prisma.maxInbox.findUniqueOrThrow({ where: { id: source.inboxId } })).encryptedPayload.byteLength).toBeGreaterThan(0)
    const retryDownload = async (url: string) => { calls.set(url, (calls.get(url) ?? 0) + 1); return { bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength } }
    const retry = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download: retryDownload })
    await expect(retry(task.payload)).resolves.toBe('done')
    expect(calls).toEqual(new Map([['https://i.oneme.ru/1', 1], ['https://i.oneme.ru/2', 1], ['https://i.oneme.ru/3', 2]]))
    expect(await prisma.memory.count()).toBe(1)
    await fixture.cleanup()
  })

  test('permanent validation failure on a later image leaves no Memory and cleans partial media', async () => {
    const fixture = await imageFixture('77128', 'permanent-third')
    const attachments = ['1', '2', '3'].map((providerAttachmentId) => ({ kind: 'image' as const, providerAttachmentId }))
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77128', recipientId: '900', messageId: 'max-image-invalid', occurredAt: '2026-09-15T10:00:00.000Z', text: 'invalid later', attachments }
    await accept(event)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const process = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download: async (url) => { if (url.endsWith('/3')) throw new MaxMediaDownloadError(); return { bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength } } })
    await expect(process(task.payload)).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.mediaAsset.count({ where: { sourceKind: 'max', deletedAt: { not: null } } })).toBe(2)
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(2)
    await fixture.cleanup()
  })

  test('ten separate processor instances download each attachment once and publish once', async () => {
    const fixture = await imageFixture('77129', 'concurrent-processors')
    const attachments = ['1', '2'].map((providerAttachmentId) => ({ kind: 'image' as const, providerAttachmentId }))
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77129', recipientId: '900', messageId: 'max-image-concurrent', occurredAt: '2026-09-15T10:00:00.000Z', text: 'concurrent', attachments }
    await accept(event)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const calls = new Map<string, number>()
    const download = async (url: string) => { calls.set(url, (calls.get(url) ?? 0) + 1); await new Promise((resolve) => setTimeout(resolve, 30)); return { bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength } }
    const processors = Array.from({ length: 10 }, () => createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download }))
    await Promise.all(processors.map((process) => process(task.payload)))
    expect(calls).toEqual(new Map([['https://i.oneme.ru/1', 1], ['https://i.oneme.ru/2', 1]]))
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.mediaAsset.count({ where: { sourceKind: 'max' } })).toBe(2)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'saved' } })).toBe(1)
    await fixture.cleanup()
  })

  test('cleanup-first row locking makes publication fail without a Memory', async () => {
    const fixture = await imageFixture('77130', 'cleanup-first')
    const asset = await prisma.mediaAsset.create({ data: { familyId: fixture.familyId, uploaderId: fixture.userId, sourceKind: 'max', purpose: 'memory', mediaKind: 'photo', originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', byteSize: BigInt(pngFixture.byteLength), originalStatus: 'stored', verifiedMime: 'image/png', sha256: createHash('sha256').update(pngFixture).digest('hex') } })
    const cleanupGate = transactionQueryGate(prisma)
    const cleanupMedia = createMediaService({ db: cleanupGate.db, env: fixture.env, familyAccess: createPrismaFamilyAccess(prisma), storage: fixture.storage })
    const cleanup = cleanupMedia.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: [asset.id], now: new Date() })
    await cleanupGate.locked
    const publisher = createSourceMemoryPublisher(prisma, createPrismaFamilyAccess(prisma))
    const publication = publisher.publish({ familyId: fixture.familyId, principal: { userId: fixture.userId, sessionId: 'max:lock' } }, { id: randomUUID(), childId: fixture.childId, kind: 'photo', body: '', occurredAt: new Date(), mediaIds: [asset.id] })
    cleanupGate.release()
    await cleanup
    await expect(publication).rejects.toThrow()
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(1)
    await fixture.cleanup()
  })

  test('publication-first row locking makes cleanup skip the attached asset', async () => {
    const fixture = await imageFixture('77131', 'publication-first')
    const asset = await prisma.mediaAsset.create({ data: { familyId: fixture.familyId, uploaderId: fixture.userId, sourceKind: 'max', purpose: 'memory', mediaKind: 'photo', originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', byteSize: BigInt(pngFixture.byteLength), originalStatus: 'stored', verifiedMime: 'image/png', sha256: createHash('sha256').update(pngFixture).digest('hex') } })
    const memoryId = randomUUID()
    const publicationGate = transactionQueryGate(prisma, 2)
    const publisher = createSourceMemoryPublisher(publicationGate.db, createPrismaFamilyAccess(prisma))
    const publication = publisher.publish({ familyId: fixture.familyId, principal: { userId: fixture.userId, sessionId: 'max:lock' } }, { id: memoryId, childId: fixture.childId, kind: 'photo', body: '', occurredAt: new Date(), mediaIds: [asset.id] })
    await publicationGate.locked
    const cleanup = fixture.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: [asset.id], now: new Date() })
    publicationGate.release()
    await publication
    await cleanup
    expect(await prisma.memory.count({ where: { id: memoryId } })).toBe(1)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(0)
    await fixture.cleanup()
  })

  test('lost publication cleans staged source media after a competing terminal transition', async () => {
    const fixture = await imageFixture('77140', 'lost-publication-cleanup')
    try {
      const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = {
        kind: 'message_created', senderId: '77140', recipientId: '900', messageId: 'max-image-lost-publication',
        occurredAt: '2026-09-15T10:00:00.000Z', text: 'lost race', attachments: [{ kind: 'image', providerAttachmentId: '1' }],
      }
      await accept(event)
      const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId } })
      const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
      const gate = transactionQueryGate(prisma, 1, false)
      const process = createMaxTaskProcessor({
        runtime: { ...fixture.runtime, prisma: gate.db } as unknown as BackendRuntime,
        crypto, api: fixture.api(event), media: fixture.media,
        download: async () => ({ bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength }),
      })
      const running = process(task.payload)
      await gate.locked
      await prisma.maxSource.update({ where: { id: source.id }, data: { status: 'denied', rejectionCode: 'denied' } })
      gate.release()
      await expect(running).resolves.toBe('skipped')
      expect(await prisma.memory.count()).toBe(0)
      expect(await prisma.mediaAsset.count({ where: { sourceKind: 'max', deletedAt: { not: null } } })).toBe(1)
      expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(1)
      expect((await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).storageReservedBytes).toBe(0n)
    } finally {
      await fixture.cleanup()
    }
  })

  test('pending cleanup and finalization overlap with Family then MediaAsset lock order', async () => {
    const fixture = await imageFixture('77141', 'pending-lock-order')
    try {
      const assetId = randomUUID()
      const uploadId = randomUUID()
      const objectKey = `media-originals/${assetId}`
      const bytes = BigInt(pngFixture.byteLength)
      await prisma.mediaAsset.create({ data: {
        id: assetId, familyId: fixture.familyId, uploaderId: fixture.userId, sourceKind: 'max', purpose: 'memory', mediaKind: 'photo',
        originalKey: objectKey, declaredMime: 'image/png', byteSize: bytes,
      } })
      await prisma.uploadReservation.create({ data: {
        id: uploadId, familyId: fixture.familyId, userId: fixture.userId, mediaId: assetId, bytes,
        expiresAt: new Date(Date.now() + 60_000),
      } })
      await prisma.family.update({ where: { id: fixture.familyId }, data: { storageReservedBytes: bytes } })
      await fixture.storage.writeObject({ key: objectKey, body: new Blob([pngFixture]).stream(), contentLength: pngFixture.byteLength, contentType: 'image/png' })
      const scope = { familyId: fixture.familyId, principal: { userId: fixture.userId, sessionId: 'max:pending-lock' } }
      const finalizeGate = transactionQueryGate(prisma, 1, true)
      const finalizingMedia = createMediaService({ db: finalizeGate.db, env: fixture.env, familyAccess: createPrismaFamilyAccess(prisma), storage: fixture.storage })
      const finalizing = finalizingMedia.finalize(scope, uploadId)
      await finalizeGate.locked
      const cleaning = fixture.media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: [assetId], now: new Date() })
      await new Promise((resolve) => setTimeout(resolve, 50))
      finalizeGate.release()
      const overlap = await Promise.race([
        Promise.allSettled([finalizing, cleaning]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('pending cleanup/finalization deadlock')), 5_000)),
      ])
      expect(overlap).toBeDefined()
      expect(overlap[1]!.status).toBe('fulfilled')
      if (overlap[0]!.status === 'rejected') expect(overlap[0]!.reason).toMatchObject({ kind: 'upload_expired' })
      const reservation = await prisma.uploadReservation.findUniqueOrThrow({ where: { id: uploadId } })
      const completed = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })
      expect(reservation.releasedAt).not.toBeNull()
      expect(completed.deletedAt).not.toBeNull()
      expect(['failed', 'stored']).toContain(completed.originalStatus)
      expect((await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).storageReservedBytes).toBe(0n)
      if (completed.originalStatus === 'stored') await createMediaTasks({ prisma, privateStorage: fixture.runtime.privateStorage, env: fixture.env }).deleteAsset({ mediaId: assetId })
      expect((await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).storageUsedBytes).toBe(0n)
    } finally {
      await fixture.cleanup()
    }
  })

  test('image response delivery failure leaves publication durable and does not rerun processing', async () => {
    const fixture = await imageFixture('77132', 'delivery-independent')
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: '77132', recipientId: '900', messageId: 'max-image-delivery', occurredAt: '2026-09-15T10:00:00.000Z', text: 'delivery later', attachments: [{ kind: 'image', providerAttachmentId: '1' }] }
    await accept(event)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    let downloads = 0
    const process = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: fixture.api(event), media: fixture.media, download: async () => { downloads += 1; return { bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength } } })
    await expect(process(task.payload)).resolves.toBe('done')
    const response = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { kind: 'saved' } })
    const delivery = createMaxResponseDelivery({ prisma, api: { ...fixture.api(event), sendMessage: async () => { throw new Error('synthetic response outage') } } })
    await expect(delivery({ responseId: response.id })).rejects.toThrow('synthetic response outage')
    await expect(process(task.payload)).resolves.toBe('skipped')
    expect(downloads).toBe(1)
    expect(await prisma.memory.count()).toBe(1)
    expect((await prisma.maxSource.findFirstOrThrow()).status).toBe('published')
    await fixture.cleanup()
  })

  test('image path denies viewer, revoked, inactive, and childless members before downloading', async () => {
    const viewer = await maxFamily('77133', 'viewer')
    const revoked = await maxFamilyWithMember('77134', 'full')
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: revoked.familyId, userId: revoked.userId } }, data: { revokedAt: new Date() } })
    const inactive = await maxFamily('77135', 'full')
    await prisma.family.update({ where: { id: inactive.familyId }, data: { status: 'deleting' } })
    const childless = await maxFamily('77136', 'full', false)
    const ambiguous = await maxFamily('77139', 'full')
    const ambiguousDb = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property !== 'externalIdentity') return Reflect.get(target, property, receiver)
        return new Proxy(target.externalIdentity, {
          get(identityTarget, identityProperty, identityReceiver) {
            if (identityProperty !== 'findUnique') return Reflect.get(identityTarget, identityProperty, identityReceiver)
            return async () => ({ user: { id: ambiguous.userId, familyMemberships: [{ familyId: ambiguous.familyId, role: 'full', family: { children: [{ id: ambiguous.childId }] } }, { familyId: randomUUID(), role: 'full', family: { children: [{ id: randomUUID() }] } }] } })
          },
        })
      },
    }) as typeof prisma
    let downloads = 0
    for (const [index, senderId] of [viewer.subject, revoked.subject, inactive.subject, childless.subject, ambiguous.subject].entries()) {
      const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId, recipientId: '900', messageId: `max-image-auth-${index}`, occurredAt: '2026-09-15T10:00:00.000Z', text: 'not allowed', attachments: [{ kind: 'image', providerAttachmentId: '1' }] }
      await accept(event)
      const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId } })
      const task = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${source.inboxId}` } } })
      await createMaxTaskProcessor({ runtime: { prisma: senderId === ambiguous.subject ? ambiguousDb : prisma } as unknown as BackendRuntime, crypto, api: {
        getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }), getSubscriptions: async () => [], createSubscription: async () => ({ success: true }), deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
        getMessage: async () => ({ messageId: event.messageId, senderId, recipientId: event.recipientId, attachments: [{ kind: 'image' as const, providerAttachmentId: '1', url: 'https://i.oneme.ru/1' }] }),
      }, media: {} as never, download: async () => { downloads += 1; return { bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength } } })(task.payload)
    }
    expect(downloads).toBe(0)
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxSource.count({ where: { status: 'denied' } })).toBe(5)
  })

  test('final membership revocation during image publication prevents Memory and cleans stored media', async () => {
    const fixture = await imageFixture('77137', 'revocation-image')
    const member = await maxMember('77138', 'full')
    await prisma.familyMember.create({ data: { familyId: fixture.familyId, userId: member.userId, role: 'full' } })
    const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = { kind: 'message_created', senderId: member.subject, recipientId: '900', messageId: 'max-image-revocation', occurredAt: '2026-09-15T10:00:00.000Z', text: 'race image', attachments: [{ kind: 'image', providerAttachmentId: '1' }] }
    await accept(event)
    const source = await prisma.maxSource.findFirstOrThrow({ where: { messageId: event.messageId } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process' } })
    const gate = transactionQueryGate(prisma, 1, false)
    const process = createMaxTaskProcessor({ runtime: { ...fixture.runtime, prisma: gate.db } as unknown as BackendRuntime, crypto, api: fixture.api(event), media: fixture.media, download: async () => ({ bytes: pngFixture, contentType: 'application/octet-stream', contentLength: pngFixture.byteLength }) })
    const running = process(task.payload)
    await gate.locked
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: fixture.familyId, userId: member.userId } }, data: { revokedAt: new Date() } })
    gate.release()
    await expect(running).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    expect((await prisma.maxSource.findUniqueOrThrow({ where: { id: source.id } })).status).toBe('denied')
    expect(await prisma.mediaAsset.count({ where: { sourceKind: 'max', deletedAt: { not: null } } })).toBe(1)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'denied' } })).toBe(1)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'unsupported_media' } })).toBe(0)
    await fixture.cleanup()
  })

  async function imageFixture(subject: string, label: string) {
    const user = await prisma.user.create({ data: { displayName: `MAX ${label}` } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: `MAX ${label} family`, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: `${label} child` } })
    const storageRoot = `.max-image-${randomUUID()}`
    activeStorageRoots.add(storageRoot)
    const env = loadEnv({ DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4), MAX_ENABLED: 'true', MAX_BOT_TOKEN: 'max:test-only-token', MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot', MAX_INBOX_ENCRYPTION_KEY: key, MAX_WEBHOOK_URL: 'https://api.example.test/webhooks/max', MAX_WEBHOOK_SECRET: webhookSecret, MAX_MINI_APP_URL: 'https://app.example.test', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot })
    const privateStorage = createPrivateStorage(env)
    const media = createMediaService({ db: prisma, env, familyAccess: createPrismaFamilyAccess(prisma), storage: privateStorage.storage })
    const runtime = { env, prisma, privateStorage, child } as unknown as BackendRuntime
    return {
      runtime,
      media,
      env,
      storage: privateStorage.storage,
      familyId: family.id,
      userId: user.id,
      childId: child.id,
      api: (event: Extract<MaxInboundEvent, { kind: 'message_created' }>): MaxApiPort => ({
        getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }), getSubscriptions: async () => [], createSubscription: async () => ({ success: true }), deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
        getMessage: async () => ({ messageId: event.messageId, senderId: event.senderId, recipientId: event.recipientId, attachments: (event.attachments ?? []).map((attachment, index) => attachment.kind === 'image' ? { kind: 'image' as const, providerAttachmentId: attachment.providerAttachmentId, url: `https://i.oneme.ru/${index + 1}` } : { kind: 'file' as const, providerAttachmentId: attachment.providerAttachmentId, filename: attachment.filename, declaredSize: attachment.declaredSize, url: `https://fd.oneme.ru/${index + 1}` }) }),
      }),
      cleanup: async () => { await rm(storageRoot, { recursive: true, force: true }); activeStorageRoots.delete(storageRoot) },
    }
  }

  function transactionQueryGate(db: typeof prisma, gateQuery = 1, afterQuery = true) {
    let reportLock!: () => void
    let releaseLock!: () => void
    const locked = new Promise<void>((resolve) => { reportLock = resolve })
    const release = new Promise<void>((resolve) => { releaseLock = resolve })
    let queryCount = 0
    const gated = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== '$transaction') return Reflect.get(target, property, receiver)
        return async <T>(callback: (tx: typeof prisma) => Promise<T>) => target.$transaction(async (tx) => callback(new Proxy(tx, {
          get(transactionTarget, transactionProperty, transactionReceiver) {
            if (transactionProperty !== '$queryRaw') return Reflect.get(transactionTarget, transactionProperty, transactionReceiver)
            return async (...args: Parameters<typeof tx.$queryRaw>) => {
              queryCount += 1
              if (queryCount === gateQuery && !afterQuery) { reportLock(); await release }
              const result = await tx.$queryRaw(...args)
              if (queryCount === gateQuery && afterQuery) { reportLock(); await release }
              return result
            }
          },
        }) as typeof prisma))
      },
    }) as typeof prisma
    return { db: gated, locked, release: releaseLock }
  }

  async function processEvent(event: Extract<MaxInboundEvent, { kind: 'message_created' }>) {
    await accept(event)
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { botId_recipientId_messageId: { botId: 900n, recipientId: BigInt(event.recipientId), messageId: event.messageId } } })
    const task = await prisma.taskOutbox.findUniqueOrThrow({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: `max-process:${source.inboxId}` } } })
    return createMaxTaskProcessor({ runtime: { prisma } as unknown as BackendRuntime, crypto })(task.payload)
  }

  async function maxMember(subject: string, role: 'full' | 'viewer') {
    const user = await prisma.user.create({ data: { displayName: subject } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } })
    return { userId: user.id, subject, role }
  }

  async function maxFamily(subject: string, role: 'full' | 'viewer', withChild = true) {
    if (role === 'full') {
      const member = await maxMember(subject, role)
      return maxFamilyForUser(member.userId, `Family ${subject}`, member.subject, role, withChild)
    }
    const owner = await maxMember(`${subject}9`, 'full')
    const family = await maxFamilyForUser(owner.userId, `Family ${subject}`, owner.subject, 'full', withChild)
    const member = await maxMember(subject, role)
    await prisma.familyMember.create({ data: { familyId: family.familyId, userId: member.userId, role } })
    return { ...family, userId: member.userId, subject: member.subject }
  }

  async function maxFamilyWithMember(subject: string, role: 'full' | 'viewer') {
    const owner = await maxFamily(`${subject}9`, 'full')
    const member = await maxMember(subject, role)
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: member.userId, role } })
    return { ...owner, userId: member.userId, subject: member.subject }
  }

  async function maxFamilyForUser(userId: string, name: string, subject?: string, role: 'full' | 'viewer' = 'full', withChild = true) {
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: userId, name, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId, role } })
      return created
    })
    const child = withChild ? await prisma.child.create({ data: { familyId: family.id, displayName: 'Matrix child' } }) : null
    return { userId, subject: subject ?? '', familyId: family.id, childId: child?.id ?? null }
  }
})

function token(label: string) {
  return `${label}_${randomUUID().replaceAll('-', '')}`.padEnd(32, 'x')
}

function hash(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex')
}

function invite(
  familyId: string,
  createdBy: string,
  rawToken: string,
  overrides: Partial<{ expiresAt: Date; acceptedAt: Date; acceptedBy: string; revokedAt: Date }> = {},
) {
  return {
    familyId, role: 'viewer' as const, tokenHash: hash(rawToken), createdBy,
    expiresAt: new Date('2026-09-16T10:00:00.000Z'), ...overrides,
  }
}
