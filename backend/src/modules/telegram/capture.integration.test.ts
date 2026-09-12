import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from 'pg'
import sharp from 'sharp'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { runBackgroundJob } from '../../jobs'
import type { BackendRuntime } from '../../runtime'
import { createPrivateStorage } from '../../storage'
import { signAccessToken } from '../auth'
import { createPrismaFamilyAccess } from '../families'
import { createAcceptTelegramUpdate } from './application/accept-update'
import type { TelegramApiPort } from './application/ports'
import { cleanupTelegramVideoNavigationReply, TelegramVideoDeliveryService } from './application/video-delivery'
import { TelegramMessageAlreadyAbsentError, TelegramReplyTargetMissingError } from './application/ports'
import { createTelegramPayloadCrypto } from './infrastructure/payload-crypto'
import { PrismaTelegramRepository } from './infrastructure/prisma-telegram-repository'
import { createTelegramImmediateVideoStartProcessor, createTelegramTaskProcessor } from './infrastructure/process-task'
import { normalizeTelegramUpdate } from './transport/update-mapping'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const photoFixture = new Uint8Array(await sharp({
  create: { width: 16, height: 16, channels: 3, background: '#f4a4ae' },
}).jpeg().toBuffer())

maybeDescribe('Telegram durable capture', () => {
  const storageRoot = resolve('.test-telegram-media')
  const key = Buffer.alloc(32, 7).toString('base64url')
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000',
    TELEGRAM_BOT_TOKEN: '123456:synthetic-only', TELEGRAM_INBOX_ENCRYPTION_KEY: key,
    TELEGRAM_MINI_APP_URL: 'https://app.example.test',
    PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000', MEDIA_FAMILY_QUOTA_BYTES: '10000000',
  })
  const privateStorage = createPrivateStorage(env)
  const app = createApp({ env, prisma, privateStorage })
  const sent: Array<{ chatId: string; text: string; options: Parameters<TelegramApiPort['sendMessage']>[2] }> = []
  let finalReceiptFailuresRemaining = 0
  let downloadCalls = 0
  const sentVideos: Array<{ chatId: string; fileId: string }> = []
  const deletedMessages: Array<{ chatId: string; messageId: string }> = []
  const api: TelegramApiPort = {
    download: async () => {
      downloadCalls += 1
      return {
      body: new Blob([photoFixture.slice().buffer as ArrayBuffer]).stream(),
      byteSize: photoFixture.byteLength,
      contentType: 'image/jpeg',
      }
    },
    sendMessage: async (chatId, text, options) => {
      if (text.startsWith('Сохранено') && finalReceiptFailuresRemaining > 0) {
        finalReceiptFailuresRemaining -= 1
        throw new Error('synthetic Telegram 429')
      }
      sent.push({ chatId, text, options })
      return { messageId: String(9_000 + sent.length) }
    },
    sendVideo: async (chatId, fileId) => {
      sentVideos.push({ chatId, fileId })
      return { messageId: String(8_000 + sentVideos.length) }
    },
    deleteMessage: async (chatId, messageId) => { deletedMessages.push({ chatId, messageId }) },
    getUpdates: async () => [],
    setCommands: async () => undefined,
    setMenuButton: async () => undefined,
  }
  const runtime = {
    env, prisma, privateStorage,
    backgroundTasks: {} as BackendRuntime['backgroundTasks'],
    emailDelivery: {} as BackendRuntime['emailDelivery'],
    close: async () => undefined,
  } satisfies BackendRuntime
  const crypto = createTelegramPayloadCrypto(key)
  const repository = new PrismaTelegramRepository(prisma)
  const accept = createAcceptTelegramUpdate({
    botId: 777n,
    repository,
    api,
    encrypt: crypto.encrypt,
    onVideoNavigation: createTelegramImmediateVideoStartProcessor({ runtime, api, crypto }),
  })

  beforeEach(async () => {
    await clearFixtures()
    sent.length = 0
    finalReceiptFailuresRemaining = 0
    downloadCalls = 0
    sentVideos.length = 0
    deletedMessages.length = 0
    await rm(storageRoot, { recursive: true, force: true })
    await mkdir(storageRoot, { recursive: true })
  })
  afterAll(async () => {
    await clearFixtures()
    await prisma.$disconnect()
    await rm(storageRoot, { recursive: true, force: true })
  })

  test('creates one note after ten update deliveries and commands never become memories', async () => {
    const owner = await familyOwner('51001')
    const event = note(101, 11, owner.subject, 'Первый самостоятельный рассказ')
    const attempts = await Promise.all(Array.from({ length: 10 }, () => accept(event)))
    expect(attempts.filter(({ duplicate }) => !duplicate)).toHaveLength(1)
    expect(await prisma.telegramInbox.count()).toBe(1)
    expect(await prisma.telegramSource.count()).toBe(1)
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'telegram:process' } })
    const process = createTelegramTaskProcessor({ runtime, api, crypto })
    await process(task.payload)
    await process(task.payload)
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.memory.findFirst()).toMatchObject({ kind: 'note', body: 'Первый самостоятельный рассказ' })
    expect((await prisma.telegramInbox.findFirstOrThrow()).encryptedPayload.byteLength).toBe(0)
    const repeatedSource = await accept(note(111, 11, owner.subject, 'Повтор с новым update_id'))
    expect(repeatedSource.duplicate).toBe(true)
    expect(await prisma.telegramSource.count()).toBe(1)
    expect(await prisma.memory.count()).toBe(1)

    await accept(command(102, 12, owner.subject, '/help'))
    const commandTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: { startsWith: 'telegram-inbox:' } } })
    await process(commandTask.payload)
    expect(await prisma.memory.count()).toBe(1)
    expect(sent.at(-1)?.text).toContain('заметки, фото, видео и голосовые')

    await accept(command(103, 13, owner.subject, `/start invite_${'a'.repeat(43)}`))
    const inviteInbox = await prisma.telegramInbox.findFirstOrThrow({ where: { updateId: 103n } })
    const inviteTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: `telegram-inbox:${inviteInbox.id}` } })
    await process(inviteTask.payload)
    expect(sent.at(-1)).toEqual({
      chatId: owner.subject,
      text: 'Откройте приглашение в Mini App, чтобы присоединиться к семейной ленте.',
      options: { buttons: [{ text: 'Открыть приглашение', webAppUrl: `https://app.example.test/?tgWebAppStartParam=invite_${'a'.repeat(43)}` }] },
    })
  })

  test('stores a captioned photo through private Media before publishing its receipt', async () => {
    const owner = await familyOwner('52001')
    await accept(photo(201, 21, owner.subject, 'На прогулке'))
    const task = await prisma.taskOutbox.findFirstOrThrow()
    await createTelegramTaskProcessor({ runtime, api, crypto })(task.payload)
    const memory = await prisma.memory.findFirstOrThrow({ include: { media: { include: { asset: true } } } })
    expect(memory).toMatchObject({ kind: 'photo', body: 'На прогулке' })
    expect(memory.media[0]?.asset).toMatchObject({ sourceKind: 'telegram', originalStatus: 'stored', purpose: 'memory' })
    expect(sent.at(-1)?.text).toBe('Сохранено в семейную ленту.')
  })

  test('keeps a Telegram video remote while storing only its supplied poster as private media', async () => {
    const owner = await familyOwner('52101')
    await accept(video(211, 22, owner.subject, 'Первый ролик'))
    const task = await prisma.taskOutbox.findFirstOrThrow()

    await createTelegramTaskProcessor({ runtime, api, crypto })(task.payload)

    const memory = await prisma.memory.findFirstOrThrow({ include: { media: true } })
    const reference = await prisma.telegramVideoReference.findFirstOrThrow({ where: { memoryId: memory.id } })
    expect(downloadCalls).toBe(1)
    expect(memory).toMatchObject({ kind: 'video', body: 'Первый ролик' })
    expect(memory.media).toHaveLength(0)
    expect(reference.fileIdCiphertext.byteLength).toBeGreaterThan(0)
    expect(await prisma.telegramVideoDeliveryTarget.findFirstOrThrow()).toMatchObject({
      userId: owner.userId,
      chatId: BigInt(owner.subject),
      messageId: 22n,
      source: 'original',
    })

    const feed = await app.request(`/api/v1/families/${owner.familyId}/memories`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    })
    expect(feed.status).toBe(200)
    const dto = (await feed.json() as { items: Array<{ attachments: Array<Record<string, unknown>> }> }).items[0]!.attachments[0]!
    expect(dto.thumbnailPath).toMatch(new RegExp(`^/api/v1/families/${owner.familyId}/media/[0-9a-f-]+/content\\?variant=display$`))
    expect(JSON.stringify(dto)).not.toContain('video-file-22')
    expect(dto).not.toHaveProperty('messageId')
    expect(dto).not.toHaveProperty('chatId')
    expect(dto).not.toHaveProperty('fileId')
  })

  test('does not retire a Telegram video poster as unattached media', async () => {
    const owner = await familyOwner('52151')
    await accept(video(212, 23, owner.subject, 'Постер остаётся доступен'))
    const task = await prisma.taskOutbox.findFirstOrThrow()

    await createTelegramTaskProcessor({ runtime, api, crypto })(task.payload)

    const reference = await prisma.telegramVideoReference.findFirstOrThrow()
    expect(reference.thumbnailMediaId).toEqual(expect.any(String))

    await runBackgroundJob('media:pending:cleanup', runtime, new Date(Date.now() + 25 * 60 * 60 * 1_000))

    const poster = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: reference.thumbnailMediaId! } })
    expect(poster.deletedAt).toBeNull()
  })

  test('navigates to an original private-chat Telegram video through a temporary reply without resending media', async () => {
    const owner = await familyOwner('52201')
    await accept(video(221, 23, owner.subject, 'Только в Telegram'))
    const sourceTask = await prisma.taskOutbox.findFirstOrThrow()
    const process = createTelegramTaskProcessor({ runtime, api, crypto })
    await process(sourceTask.payload)
    const memory = await prisma.memory.findFirstOrThrow()

    const opened = await app.request(`/api/v1/families/${owner.familyId}/memories/${memory.id}/telegram-video`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
    })
    expect(opened.status).toBe(200)
    const { telegramDeepLink } = await opened.json() as { telegramDeepLink: string }
    expect(telegramDeepLink).toMatch(/^https:\/\/t\.me\/OurMemoriesDevBot\?start=watch_[A-Za-z0-9_-]{32}$/)
    expect(telegramDeepLink).not.toContain('video-file-23')

    const pointer = telegramDeepLink.split('start=')[1]!
    await accept(command(222, 24, owner.subject, `/start ${pointer}`))
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: { startsWith: 'telegram-inbox:' } } })).toBe(0)
    expect(sentVideos).toEqual([])
    expect(sent.at(-1)).toMatchObject({
      chatId: owner.subject,
      text: 'Видео из воспоминания ↑',
      options: { replyToMessageId: '23' },
    })
  })

  test('does not deliver a Telegram video when membership was revoked after the Mini App check', async () => {
    const owner = await familyOwner('52301')
    const viewer = await admittedUser('52302')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    await accept(video(231, 24, owner.subject, 'Проверка отзыва'))
    const process = createTelegramTaskProcessor({ runtime, api, crypto })
    await process((await prisma.taskOutbox.findFirstOrThrow()).payload)
    const memory = await prisma.memory.findFirstOrThrow()
    const opened = await app.request(`/api/v1/families/${owner.familyId}/memories/${memory.id}/telegram-video`, {
      method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` },
    })
    const { telegramDeepLink } = await opened.json() as { telegramDeepLink: string }
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: owner.familyId, userId: viewer.userId } }, data: { revokedAt: new Date() },
    })
    await accept(command(232, 25, viewer.subject, `/start ${telegramDeepLink.split('start=')[1]!}`))
    expect(sentVideos).toHaveLength(0)
    expect(sent.at(-1)?.text).toBe('Видео недоступно или у вас нет доступа.')
  })

  test('schedules cleanup for exactly the navigation reply and deletes it after two minutes', async () => {
    const owner = await familyOwner('52305')
    const pointer = await prepareVideoPointer(owner, 232, 25)
    await accept(command(233, 26, owner.subject, `/start ${pointer}`))
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: { startsWith: 'telegram-inbox:' } } })).toBe(0)

    const navigation = await prisma.telegramVideoNavigationReply.findFirstOrThrow()
    const navigationMessageId = String(9_000 + sent.length)
    const cleanup = await prisma.taskOutbox.findFirstOrThrow({
      where: { type: 'telegram:navigation-reply:cleanup' },
    })
    expect(navigation).toMatchObject({ chatId: BigInt(owner.subject), messageId: BigInt(navigationMessageId), deletedAt: null })
    expect(navigation.cleanupAt.getTime() - navigation.createdAt.getTime()).toBeGreaterThanOrEqual(119_000)
    expect(navigation.cleanupAt.getTime() - navigation.createdAt.getTime()).toBeLessThanOrEqual(121_000)
    expect(cleanup.payload).toEqual({ navigationReplyId: navigation.id })
    expect(JSON.stringify(cleanup.payload)).not.toContain(owner.subject)

    await expect(cleanupTelegramVideoNavigationReply(
      prisma,
      api,
      navigation.id,
      new Date(navigation.cleanupAt.getTime() + 1),
    )).resolves.toBe('done')

    expect(deletedMessages).toEqual([{ chatId: owner.subject, messageId: navigationMessageId }])
    expect((await prisma.telegramVideoNavigationReply.findUniqueOrThrow({ where: { id: navigation.id } })).deletedAt).toEqual(expect.any(Date))
    expect(deletedMessages.map(({ messageId }) => messageId)).not.toContain('25')
  })

  test('treats an already-deleted navigation reply as cleanup completion and leaves provider failures non-blocking', async () => {
    const owner = await familyOwner('52306')
    const pointer = await prepareVideoPointer(owner, 234, 27)
    await accept(command(235, 28, owner.subject, `/start ${pointer}`))
    const navigation = await prisma.telegramVideoNavigationReply.findFirstOrThrow()

    await expect(cleanupTelegramVideoNavigationReply(prisma, {
      ...api,
      deleteMessage: async () => { throw new Error('synthetic provider outage') },
    }, navigation.id)).resolves.toBe('skipped')
    expect((await prisma.telegramVideoNavigationReply.findUniqueOrThrow({ where: { id: navigation.id } })).deletedAt).toBeNull()

    await expect(cleanupTelegramVideoNavigationReply(prisma, {
      ...api,
      deleteMessage: async () => { throw new TelegramMessageAlreadyAbsentError() },
    }, navigation.id)).resolves.toBe('done')
    expect((await prisma.telegramVideoNavigationReply.findUniqueOrThrow({ where: { id: navigation.id } })).deletedAt).toEqual(expect.any(Date))
  })

  test('delivers one private copy to an invited member, then quotes that exact cached target', async () => {
    const owner = await familyOwner('52307')
    const viewer = await admittedUser('52308')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    const pointer = await prepareVideoPointer(owner, 236, 29, viewer)

    expect(await new TelegramVideoDeliveryService(prisma, createPrismaFamilyAccess(prisma), env.TELEGRAM_BOT_EXPECTED_USERNAME)
      .deliverFromStart(viewer.subject, viewer.subject, pointer, api, crypto)).toBe('delivered')
    expect(sentVideos).toEqual([{ chatId: viewer.subject, fileId: 'video-file-29' }])
    expect(await prisma.telegramVideoNavigationReply.count()).toBe(0)
    const target = await prisma.telegramVideoDeliveryTarget.findFirstOrThrow({ where: { userId: viewer.userId } })
    expect(target).toMatchObject({ chatId: BigInt(viewer.subject), messageId: 8001n, source: 'delivered_copy' })

    const memory = await prisma.memory.findFirstOrThrow()
    const laterPointer = await requestVideoPointer(owner, memory.id, viewer)
    expect(await new TelegramVideoDeliveryService(prisma, createPrismaFamilyAccess(prisma), env.TELEGRAM_BOT_EXPECTED_USERNAME)
      .deliverFromStart(viewer.subject, viewer.subject, laterPointer, api, crypto)).toBe('delivered')
    expect(sentVideos).toHaveLength(1)
    expect(sent.at(-1)).toMatchObject({
      chatId: viewer.subject,
      text: 'Видео из воспоминания ↑',
      options: { replyToMessageId: target.messageId.toString() },
    })
    expect(await prisma.telegramVideoNavigationReply.count()).toBe(1)
  })

  test('keeps delivery targets isolated between invited family members', async () => {
    const owner = await familyOwner('523081')
    const viewerA = await admittedUser('523082')
    const viewerB = await admittedUser('523083')
    await prisma.familyMember.createMany({ data: [
      { familyId: owner.familyId, userId: viewerA.userId, role: 'viewer' },
      { familyId: owner.familyId, userId: viewerB.userId, role: 'viewer' },
    ] })
    await prepareVideoPointer(owner, 238, 31)
    const memory = await prisma.memory.findFirstOrThrow()
    const pointerA = await requestVideoPointer(owner, memory.id, viewerA)
    const pointerB = await requestVideoPointer(owner, memory.id, viewerB)
    const delivery = new TelegramVideoDeliveryService(prisma, createPrismaFamilyAccess(prisma), env.TELEGRAM_BOT_EXPECTED_USERNAME)
    await expect(delivery.deliverFromStart(viewerA.subject, viewerA.subject, pointerA, api, crypto)).resolves.toBe('delivered')
    await expect(delivery.deliverFromStart(viewerB.subject, viewerB.subject, pointerB, api, crypto)).resolves.toBe('delivered')
    const targets = await prisma.telegramVideoDeliveryTarget.findMany({
      where: { userId: { in: [viewerA.userId, viewerB.userId] } }, orderBy: { userId: 'asc' },
    })
    expect(targets).toHaveLength(2)
    expect(targets.map(({ chatId }) => chatId.toString()).sort()).toEqual([viewerA.subject, viewerB.subject].sort())
  })

  test('serializes concurrent first views from separate pointers into one private copy', async () => {
    const owner = await familyOwner('523091')
    const viewer = await admittedUser('523092')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    await prepareVideoPointer(owner, 240, 33)
    const memory = await prisma.memory.findFirstOrThrow()
    const [first, second] = await Promise.all([
      requestVideoPointer(owner, memory.id, viewer),
      requestVideoPointer(owner, memory.id, viewer),
    ])
    const delivery = new TelegramVideoDeliveryService(prisma, createPrismaFamilyAccess(prisma), env.TELEGRAM_BOT_EXPECTED_USERNAME)
    await expect(Promise.all([
      delivery.deliverFromStart(viewer.subject, viewer.subject, first, api, crypto),
      delivery.deliverFromStart(viewer.subject, viewer.subject, second, api, crypto),
    ])).resolves.toEqual(['delivered', 'delivered'])
    expect(sentVideos).toHaveLength(1)
    expect(await prisma.telegramVideoDeliveryTarget.count({ where: { userId: viewer.userId } })).toBe(1)
  })

  test('replaces a provider-confirmed stale target with one newly delivered private copy', async () => {
    const owner = await familyOwner('523101')
    const viewer = await admittedUser('523102')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    const first = await prepareVideoPointer(owner, 242, 35, viewer)
    const delivery = new TelegramVideoDeliveryService(prisma, createPrismaFamilyAccess(prisma), env.TELEGRAM_BOT_EXPECTED_USERNAME)
    await delivery.deliverFromStart(viewer.subject, viewer.subject, first, api, crypto)
    const stale = await prisma.telegramVideoDeliveryTarget.findFirstOrThrow({ where: { userId: viewer.userId } })
    const reference = await prisma.telegramVideoReference.findUniqueOrThrow({ where: { id: stale.referenceId } })
    const retry = await requestVideoPointer(owner, reference.memoryId, viewer)
    const staleApi: TelegramApiPort = {
      ...api,
      sendMessage: async (_chatId, text, _options) => {
        if (text === 'Видео из воспоминания ↑') throw new TelegramReplyTargetMissingError()
        return { messageId: '9999' }
      },
    }
    await expect(delivery.deliverFromStart(viewer.subject, viewer.subject, retry, staleApi, crypto)).resolves.toBe('delivered')
    expect(sentVideos).toHaveLength(2)
    const replacement = await prisma.telegramVideoDeliveryTarget.findFirstOrThrow({ where: { userId: viewer.userId } })
    expect(replacement.id).not.toBe(stale.id)
    expect(replacement.source).toBe('delivered_copy')
    expect(await prisma.telegramVideoDeliveryTarget.count({ where: { userId: viewer.userId } })).toBe(1)
  })

  test('atomically claims a pointer so concurrent deliveries send one video', async () => {
    const owner = await familyOwner('52311')
    const pointer = await prepareVideoPointer(owner, 233, 26)
    const delivery = new TelegramVideoDeliveryService(
      prisma,
      createPrismaFamilyAccess(prisma),
      env.TELEGRAM_BOT_EXPECTED_USERNAME,
    )

    const results = await Promise.all([
      delivery.deliverFromStart(owner.subject, owner.subject, pointer, api, crypto),
      delivery.deliverFromStart(owner.subject, owner.subject, pointer, api, crypto),
    ])

    expect(results.sort()).toEqual(['delivered', 'denied'])
    expect(sentVideos).toHaveLength(0)
    expect(sent.filter(({ text, options }) => text === 'Видео из воспоминания ↑' && options?.replyToMessageId === '26')).toHaveLength(1)
  })

  test('denies delivery when revoke commits at the controlled final-authorization boundary', async () => {
    const owner = await familyOwner('52321')
    const viewer = await admittedUser('52322')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    const pointer = await prepareVideoPointer(owner, 234, 27, viewer)
    let releaseAuthorization!: () => void
    let reportClaimed!: () => void
    const claimed = new Promise<void>((resolve) => { reportClaimed = resolve })
    const release = new Promise<void>((resolve) => { releaseAuthorization = resolve })
    const delivery = new TelegramVideoDeliveryService(
      prisma,
      createPrismaFamilyAccess(prisma),
      env.TELEGRAM_BOT_EXPECTED_USERNAME,
      { beforeFinalAuthorization: async () => { reportClaimed(); await release } },
    )

    const result = delivery.deliverFromStart(viewer.subject, viewer.subject, pointer, api, crypto)
    await claimed
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: owner.familyId, userId: viewer.userId } },
      data: { revokedAt: new Date() },
    })
    releaseAuthorization()

    expect(await result).toBe('denied')
    expect(sentVideos).toHaveLength(0)
    expect(await prisma.telegramVideoDelivery.findFirstOrThrow()).toMatchObject({ deniedAt: expect.any(Date) })
  })

  test('serializes a concurrent membership revoke behind the protected Telegram send section', async () => {
    const owner = await familyOwner('52323')
    const viewer = await admittedUser('52324')
    const membership = await prisma.familyMember.create({
      data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' },
    })
    const pointer = await prepareVideoPointer(owner, 236, 29, viewer)
    let releaseSend!: () => void
    let reportSendStarted!: () => void
    const sendStarted = new Promise<void>((resolve) => { reportSendStarted = resolve })
    const sendRelease = new Promise<void>((resolve) => { releaseSend = resolve })
    const protectedApi: TelegramApiPort = {
      ...api,
      sendVideo: async (chatId, fileId) => {
        sentVideos.push({ chatId, fileId })
        reportSendStarted()
        await sendRelease
        return { messageId: String(8_000 + sentVideos.length) }
      },
    }
    const delivery = new TelegramVideoDeliveryService(
      prisma,
      createPrismaFamilyAccess(prisma),
      env.TELEGRAM_BOT_EXPECTED_USERNAME,
    )
    const observer = new Client({ connectionString: databaseUrl! })
    await observer.connect()
    let deliveryResult: ReturnType<typeof delivery.deliverFromStart> | undefined
    let revokeRequest: Promise<Response> | undefined

    try {
      const pendingDelivery = delivery.deliverFromStart(viewer.subject, viewer.subject, pointer, protectedApi, crypto)
      deliveryResult = pendingDelivery
      await sendStarted

      let revokeSettled = false
      const pendingRevoke = Promise.resolve(app.request(`/api/v1/families/${owner.familyId}/members/${viewer.userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: membership.version }),
      })).then((response) => {
        revokeSettled = true
        return response
      })
      revokeRequest = pendingRevoke

      await waitForLockedQuery(observer, 'family_members')
      expect(revokeSettled).toBe(false)

      releaseSend()
      expect(await pendingDelivery).toBe('delivered')
      expect((await pendingRevoke).status).toBe(204)
      expect(await prisma.familyMember.findUniqueOrThrow({
        where: { familyId_userId: { familyId: owner.familyId, userId: viewer.userId } },
      })).toMatchObject({ revokedAt: expect.any(Date), version: membership.version + 1 })
      expect(sentVideos).toEqual([{ chatId: viewer.subject, fileId: 'video-file-29' }])
    } finally {
      releaseSend()
      await Promise.allSettled([deliveryResult, revokeRequest].filter((value) => value !== undefined))
      await observer.end()
    }
  })

  test('parks an ambiguous Bot API result and never retries the video', async () => {
    const owner = await familyOwner('52331')
    const pointer = await prepareVideoPointer(owner, 235, 28)
    const uncertainApi: TelegramApiPort = {
      ...api,
      sendMessage: async (chatId, text, options) => {
        if (text !== 'Видео из воспоминания ↑') return api.sendMessage(chatId, text, options)
        sent.push({ chatId, text, options })
        throw new Error('synthetic response lost after Telegram accepted the video')
      },
    }
    const delivery = new TelegramVideoDeliveryService(
      prisma,
      createPrismaFamilyAccess(prisma),
      env.TELEGRAM_BOT_EXPECTED_USERNAME,
    )

    expect(await delivery.deliverFromStart(owner.subject, owner.subject, pointer, uncertainApi, crypto)).toBe('ambiguous')
    expect(await delivery.deliverFromStart(owner.subject, owner.subject, pointer, uncertainApi, crypto)).toBe('denied')
    expect(sentVideos).toHaveLength(0)
    expect(sent.filter(({ text }) => text === 'Видео из воспоминания ↑')).toHaveLength(1)
    expect(await prisma.telegramVideoDelivery.findFirstOrThrow()).toMatchObject({ ambiguousAt: expect.any(Date) })
  })

  test('rejects invalid, expired, foreign, replayed, revoked and deleted pointers', async () => {
    const owner = await familyOwner('52341')
    const delivery = new TelegramVideoDeliveryService(prisma, createPrismaFamilyAccess(prisma), env.TELEGRAM_BOT_EXPECTED_USERNAME)
    expect(await delivery.deliverFromStart(owner.subject, owner.subject, 'watch_invalid', api, crypto)).toBe('denied')

    const foreign = await admittedUser('52342')
    const foreignPointer = await prepareVideoPointer(owner, 236, 29)
    expect(await delivery.deliverFromStart(foreign.subject, foreign.subject, foreignPointer, api, crypto)).toBe('denied')

    const expiredPointer = await prepareVideoPointer(owner, 237, 30)
    await prisma.telegramVideoDelivery.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } })
    expect(await delivery.deliverFromStart(owner.subject, owner.subject, expiredPointer, api, crypto)).toBe('denied')

    const replayPointer = await prepareVideoPointer(owner, 238, 31)
    expect(await delivery.deliverFromStart(owner.subject, owner.subject, replayPointer, api, crypto)).toBe('delivered')
    expect(await delivery.deliverFromStart(owner.subject, owner.subject, replayPointer, api, crypto)).toBe('denied')

    const revokedViewer = await admittedUser('52343')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: revokedViewer.userId, role: 'viewer' } })
    const revokedPointer = await prepareVideoPointer(owner, 239, 32, revokedViewer)
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: owner.familyId, userId: revokedViewer.userId } },
      data: { revokedAt: new Date() },
    })
    expect(await delivery.deliverFromStart(revokedViewer.subject, revokedViewer.subject, revokedPointer, api, crypto)).toBe('denied')
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: owner.familyId, userId: revokedViewer.userId } },
      data: { revokedAt: null },
    })

    const deletedPointer = await prepareVideoPointer(owner, 240, 33)
    await prisma.memory.updateMany({ data: { status: 'deleted', deletedAt: new Date() } })
    expect(await delivery.deliverFromStart(owner.subject, owner.subject, deletedPointer, api, crypto)).toBe('denied')
  })

  test('deleting a Telegram video blocks new and already-issued handoffs without revoking existing Telegram copies', async () => {
    const owner = await familyOwner('52344')
    const viewer = await admittedUser('52345')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    const firstPointer = await prepareVideoPointer(owner, 243, 34, viewer)
    const delivery = new TelegramVideoDeliveryService(prisma, createPrismaFamilyAccess(prisma), env.TELEGRAM_BOT_EXPECTED_USERNAME)
    expect(await delivery.deliverFromStart(viewer.subject, viewer.subject, firstPointer, api, crypto)).toBe('delivered')
    expect(sentVideos).toEqual([{ chatId: viewer.subject, fileId: 'video-file-34' }])

    const memory = await prisma.memory.findFirstOrThrow({ where: { familyId: owner.familyId } })
    const preDeletePointer = await requestVideoPointer(owner, memory.id, viewer)
    const deleted = await app.request(`/api/v1/families/${owner.familyId}/memories/${memory.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}`, 'If-Match': String(memory.version) },
    })
    expect(deleted.status).toBe(204)
    expect((await app.request(`/api/v1/families/${owner.familyId}/memories/${memory.id}/telegram-video`, {
      method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` },
    })).status).toBe(404)
    expect(await delivery.deliverFromStart(viewer.subject, viewer.subject, preDeletePointer, api, crypto)).toBe('denied')
    expect(sentVideos).toEqual([{ chatId: viewer.subject, fileId: 'video-file-34' }])
    expect(deletedMessages).toEqual([])
    expect(await prisma.telegramVideoDeliveryTarget.count({ where: { userId: viewer.userId } })).toBe(1)
  })

  test('cleans only delivery pointers beyond the retention window', async () => {
    const owner = await familyOwner('52351')
    await prepareVideoPointer(owner, 241, 34)
    const retained = await prisma.telegramVideoDelivery.findFirstOrThrow()
    await prisma.telegramVideoDelivery.create({ data: {
      tokenHash: 'f'.repeat(64), referenceId: retained.referenceId, familyId: retained.familyId,
      userId: retained.userId, expiresAt: new Date('2026-09-09T00:00:00Z'),
    } })

    await runBackgroundJob('telegram:deliveries:cleanup', runtime, new Date('2026-09-11T00:00:00Z'))

    expect(await prisma.telegramVideoDelivery.findMany({ select: { id: true } })).toEqual([{ id: retained.id }])
  })

  test('retries a transient original write without poisoning the accepted Telegram media id', async () => {
    const owner = await familyOwner('52501')
    await accept(photo(251, 25, owner.subject, 'Повтор после сбоя'))
    const task = await prisma.taskOutbox.findFirstOrThrow()
    const process = createTelegramTaskProcessor({ runtime, api, crypto })
    const writeObject = privateStorage.storage.writeObject.bind(privateStorage.storage)
    let failOnce = true
    privateStorage.storage.writeObject = async (input) => {
      if (failOnce && input.key.startsWith('media-originals/')) {
        failOnce = false
        throw new Error('synthetic storage outage')
      }
      return writeObject(input)
    }
    try {
      await expect(process(task.payload)).rejects.toThrow('synthetic storage outage')
      expect((await prisma.uploadReservation.findFirstOrThrow()).releasedAt).toBeNull()
    } finally {
      privateStorage.storage.writeObject = writeObject
    }
    await process(task.payload)
    expect(await prisma.memory.count()).toBe(1)
    expect((await prisma.telegramSource.findFirstOrThrow()).status).toBe('published')
  })

  test('retries a final receipt after publication without creating a second memory', async () => {
    const owner = await familyOwner('52601')
    await accept(note(261, 26, owner.subject, 'Квитанция после 429'))
    const task = await prisma.taskOutbox.findFirstOrThrow()
    const process = createTelegramTaskProcessor({ runtime, api, crypto })
    finalReceiptFailuresRemaining = 1
    await expect(process(task.payload)).rejects.toThrow('synthetic Telegram 429')
    expect(await prisma.memory.count()).toBe(1)
    await process(task.payload)
    expect(await prisma.memory.count()).toBe(1)
    expect(sent.filter(({ text }) => text === 'Сохранено в семейную ленту.')).toHaveLength(1)
  })

  test('persists album timing across processor restart, preserves order, and appends a late photo', async () => {
    const owner = await familyOwner('53001')
    for (const [updateId, messageId] of [[301, 31], [303, 33], [302, 32]] as const) {
      await accept(photo(updateId, messageId, owner.subject, messageId === 31 ? 'Альбом' : '', 'album-a'))
    }
    const album = await prisma.telegramAlbum.findFirstOrThrow()
    expect(album.hardDeadline.getTime() - album.firstSeenAt.getTime()).toBe(8_000)
    await prisma.telegramAlbum.update({ where: { id: album.id }, data: { readyAt: new Date(0) } })
    const albumTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: { contains: ':303' } } })
    await createTelegramTaskProcessor({ runtime, api, crypto })(albumTask.payload)
    const firstMemory = await prisma.memory.findFirstOrThrow({ include: { media: { orderBy: { position: 'asc' } } } })
    expect(firstMemory.media).toHaveLength(3)
    const orderedSources = await prisma.telegramSource.findMany({ orderBy: { messageId: 'asc' } })
    expect(firstMemory.media.map(({ mediaId }) => mediaId)).toEqual(orderedSources.map(({ mediaId }) => mediaId!))

    await accept(photo(304, 34, owner.subject, '', 'album-a'))
    const lateTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: { contains: ':304' } } })
    await createTelegramTaskProcessor({ runtime, api, crypto })(lateTask.payload)
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.memoryMedia.count({ where: { memoryId: firstMemory.id } })).toBe(4)
  })

  test('reconciles a late album photo after a crash between memory commit and Telegram bookkeeping', async () => {
    const owner = await familyOwner('53501')
    for (const [updateId, messageId] of [[351, 51], [352, 52], [353, 53]] as const) {
      await accept(photo(updateId, messageId, owner.subject, messageId === 51 ? 'До сбоя' : '', 'album-crash'))
    }
    const initial = await prisma.telegramSource.findMany({ orderBy: { messageId: 'asc' } })
    for (const source of initial) await createStoredPhoto(source)
    await prisma.memory.create({ data: {
      id: initial[0]!.plannedMemoryId, familyId: owner.familyId, childId: owner.childId,
      authorId: owner.userId, kind: 'photo', body: 'До сбоя', occurredAt: new Date('2026-08-28T00:00:00Z'),
    } })
    await prisma.memoryMedia.createMany({ data: initial.map((source, position) => ({
      familyId: owner.familyId, memoryId: initial[0]!.plannedMemoryId, mediaId: source.plannedMediaId!, position,
    })) })

    await accept(photo(354, 54, owner.subject, '', 'album-crash'))
    const late = await prisma.telegramSource.findFirstOrThrow({ where: { messageId: 54n } })
    await createStoredPhoto(late)
    const album = await prisma.telegramAlbum.findFirstOrThrow()
    await prisma.telegramAlbum.update({ where: { id: album.id }, data: { readyAt: new Date(0) } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: { contains: ':354' } } })
    await createTelegramTaskProcessor({ runtime, api, crypto })(task.payload)

    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.memoryMedia.count({ where: { memoryId: initial[0]!.plannedMemoryId } })).toBe(4)
    expect(await prisma.telegramSource.count({ where: { status: 'published', memoryId: initial[0]!.plannedMemoryId } })).toBe(4)
  })

  test('publishes mixed album items separately and blocks viewers and revoked members', async () => {
    const owner = await familyOwner('54001')
    await accept(photo(401, 41, owner.subject, 'Фото', 'album-mixed'))
    const second = photo(402, 42, owner.subject, 'Видео', 'album-mixed')
    if (second.kind !== 'media') throw new Error('fixture')
    second.mediaKind = 'video'
    second.contentType = 'video/mp4'
    await accept(second)
    const album = await prisma.telegramAlbum.findFirstOrThrow()
    const sources = await prisma.telegramSource.findMany({ orderBy: { messageId: 'asc' } })
    for (const source of sources) {
      if (source.kind === 'video') continue
      await prisma.mediaAsset.create({ data: {
        id: source.plannedMediaId!, familyId: source.familyId, uploaderId: source.userId,
        sourceKind: 'telegram', purpose: 'memory', mediaKind: 'photo',
        originalKey: `media-originals/test/${source.plannedMediaId}`, declaredMime: 'image/jpeg',
        verifiedMime: 'image/jpeg', sha256: '0'.repeat(64), byteSize: 1n,
        originalStatus: 'stored', renditionStatus: 'ready',
      } })
    }
    await prisma.telegramAlbum.update({ where: { id: album.id }, data: { readyAt: new Date(0) } })
    const task = await prisma.taskOutbox.findFirstOrThrow({ orderBy: { scheduledFor: 'desc' } })
    await createTelegramTaskProcessor({ runtime, api, crypto })(task.payload)
    expect(await prisma.memory.count()).toBe(2)
    expect((await prisma.telegramAlbum.findUniqueOrThrow({ where: { id: album.id } })).status).toBe('mixed')

    const viewer = await admittedUser('54002')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    await accept(note(403, 43, viewer.subject, 'Нельзя публиковать'))
    expect(await prisma.telegramSource.count({ where: { senderSubject: viewer.subject } })).toBe(0)
    expect(await prisma.telegramInbox.findFirstOrThrow({ where: { updateId: 403n } })).toMatchObject({ eventKind: 'denied' })

    const revoked = await admittedUser('54003')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: revoked.userId, role: 'full' } })
    await accept(note(404, 44, revoked.subject, 'Доступ скоро отзовут'))
    await prisma.familyMember.update({ where: { familyId_userId: { familyId: owner.familyId, userId: revoked.userId } }, data: { revokedAt: new Date() } })
    const revokedTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: { startsWith: 'telegram-source:' } }, orderBy: { createdAt: 'desc' } })
    await createTelegramTaskProcessor({ runtime, api, crypto })(revokedTask.payload)
    expect(await prisma.memory.count()).toBe(2)
    expect(await prisma.telegramSource.findFirstOrThrow({ where: { messageId: 44n } })).toMatchObject({ status: 'rejected', rejectionCode: 'access_revoked' })
  })

  test('never stores group content', async () => {
    const event = normalizeTelegramUpdate({ update_id: 501, message: {
      message_id: 51, date: 1_788_000_000, chat: { id: -100, type: 'supergroup' },
      from: { id: 55, is_bot: false, first_name: 'Участник' }, text: 'Секрет группы',
    } })
    await accept(event)
    expect(await prisma.telegramInbox.count()).toBe(0)
    expect(await prisma.telegramSource.count()).toBe(0)
  })

  test('changes a caption only through its live ForceReply request, and cancellation is durable', async () => {
    const owner = await familyOwner('55001')
    const memory = await prisma.memory.create({ data: {
      familyId: owner.familyId, childId: owner.childId, authorId: owner.userId, kind: 'voice', body: 'Исходная подпись', occurredAt: new Date(),
    } })
    const expiresAt = new Date(Date.now() + 10 * 60_000)
    await prisma.captionRequest.create({ data: {
      familyId: owner.familyId, userId: owner.userId, memoryId: memory.id, chatId: 55001n,
      promptMessageId: 9901n, expectedVersion: memory.version, expiresAt,
    } })
    const process = createTelegramTaskProcessor({ runtime, api, crypto })

    await accept(reply(601, 61, owner.subject, 9901, 'Подпись из точного ответа'))
    const replyTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: { startsWith: 'telegram-inbox:' } } })
    await process(replyTask.payload)
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toMatchObject({ body: 'Подпись из точного ответа', version: 2 })
    expect(await prisma.captionRequest.findUniqueOrThrow({ where: { chatId_promptMessageId: { chatId: 55001n, promptMessageId: 9901n } } })).toMatchObject({ consumedAt: expect.any(Date) })

    await accept(note(602, 62, owner.subject, 'Обычная следующая заметка'))
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toMatchObject({ body: 'Подпись из точного ответа' })

    await prisma.captionRequest.create({ data: {
      familyId: owner.familyId, userId: owner.userId, memoryId: memory.id, chatId: 55001n,
      promptMessageId: 9902n, expectedVersion: 2, expiresAt,
    } })
    await accept(command(603, 63, owner.subject, '/cancel'))
    const cancelInbox = await prisma.telegramInbox.findFirstOrThrow({ where: { updateId: 603n } })
    const cancelTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: `telegram-inbox:${cancelInbox.id}` } })
    await process(cancelTask.payload)
    expect(await prisma.captionRequest.findUniqueOrThrow({ where: { chatId_promptMessageId: { chatId: 55001n, promptMessageId: 9902n } } })).toMatchObject({ cancelledAt: expect.any(Date) })
    expect(sent.at(-1)?.text).toBe('Добавление подписи отменено.')

    await accept(reply(604, 64, owner.subject, 9902, 'Не должно сохраниться'))
    const cancelledReplyInbox = await prisma.telegramInbox.findFirstOrThrow({ where: { updateId: 604n } })
    const cancelledReplyTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: `telegram-inbox:${cancelledReplyInbox.id}` } })
    await process(cancelledReplyTask.payload)
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toMatchObject({ body: 'Подпись из точного ответа' })

    const viewer = await admittedUser('55002')
    await prisma.familyMember.create({ data: { familyId: owner.familyId, userId: viewer.userId, role: 'viewer' } })
    await prisma.captionRequest.create({ data: {
      familyId: owner.familyId, userId: owner.userId, memoryId: memory.id, chatId: 55001n,
      promptMessageId: 9903n, expectedVersion: 2, expiresAt,
    } })
    await accept(reply(605, 65, viewer.subject, 9903, 'Просмотр не должен менять подпись'))
    const viewerInbox = await prisma.telegramInbox.findFirstOrThrow({ where: { updateId: 605n } })
    const viewerTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: `telegram-inbox:${viewerInbox.id}` } })
    await process(viewerTask.payload)
    expect(await prisma.memory.findUniqueOrThrow({ where: { id: memory.id } })).toMatchObject({ body: 'Подпись из точного ответа' })
  })

  async function clearFixtures() {
    await prisma.telegramVideoDelivery.deleteMany()
    await prisma.telegramVideoReference.deleteMany()
    await prisma.telegramSource.deleteMany()
    await prisma.telegramAlbum.deleteMany()
    await prisma.telegramInbox.deleteMany()
    await prisma.captionRequest.deleteMany()
    await prisma.idempotencyRecord.deleteMany()
    await prisma.memoryLike.deleteMany()
    await prisma.memoryMedia.deleteMany()
    await prisma.memory.deleteMany()
    await prisma.child.updateMany({ data: { avatarMediaId: null } })
    await prisma.mediaVariant.deleteMany()
    await prisma.uploadReservation.deleteMany()
    await prisma.mediaAsset.deleteMany()
    await prisma.taskOutbox.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.pilotAdmission.deleteMany()
    await prisma.user.deleteMany()
  }

  async function admittedUser(subject: string) {
    const user = await prisma.user.create({ data: { displayName: `User ${subject}` } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
    const session = await prisma.authSession.create({ data: {
      userId: user.id, refreshTokenHash: `refresh-${subject}`, refreshTokenFamilyHash: `family-${subject}`,
      expiresAt: new Date(Date.now() + 60_000),
    } })
    return { userId: user.id, subject, token: await signAccessToken({ sub: user.id, sessionId: session.id }, env) }
  }

  async function familyOwner(subject: string) {
    const owner = await admittedUser(subject)
    const response = await app.request('/api/v1/families', { method: 'POST', headers: {
      Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
    }, body: JSON.stringify({ name: 'Семья', timezone: 'Europe/Moscow' }) })
    expect(response.status).toBe(201)
    const body = await response.json() as any
    const child = await prisma.child.create({
      data: { familyId: body.family.id, displayName: 'Legacy child' },
    })
    return { ...owner, familyId: body.family.id, childId: child.id }
  }

  async function prepareVideoPointer(
    owner: Awaited<ReturnType<typeof familyOwner>>,
    updateId: number,
    messageId: number,
    requester: Awaited<ReturnType<typeof admittedUser>> = owner,
  ) {
    await accept(video(updateId, messageId, owner.subject, `Видео ${messageId}`))
    const inbox = await prisma.telegramInbox.findFirstOrThrow({ where: { updateId: BigInt(updateId) } })
    const source = await prisma.telegramSource.findFirstOrThrow({ where: { inboxId: inbox.id } })
    const sourceTask = await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: `telegram-source:${source.id}` } })
    await createTelegramTaskProcessor({ runtime, api, crypto })(sourceTask.payload)
    const memory = await prisma.memory.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
    const opened = await app.request(`/api/v1/families/${owner.familyId}/memories/${memory.id}/telegram-video`, {
      method: 'POST', headers: { Authorization: `Bearer ${requester.token}` },
    })
    expect(opened.status).toBe(200)
    const body = await opened.json() as { telegramDeepLink: string }
    return body.telegramDeepLink.split('start=')[1]!
  }

  async function requestVideoPointer(
    owner: Awaited<ReturnType<typeof familyOwner>>,
    memoryId: string,
    requester: Awaited<ReturnType<typeof admittedUser>> = owner,
  ) {
    const opened = await app.request(`/api/v1/families/${owner.familyId}/memories/${memoryId}/telegram-video`, {
      method: 'POST', headers: { Authorization: `Bearer ${requester.token}` },
    })
    expect(opened.status).toBe(200)
    const body = await opened.json() as { telegramDeepLink: string }
    return body.telegramDeepLink.split('start=')[1]!
  }

  async function waitForLockedQuery(client: Client, queryFragment: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await client.query('SELECT pg_stat_clear_snapshot()')
      const result = await client.query<{ waiting: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock'
              AND query ILIKE $1
         ) AS waiting`,
        [`%${queryFragment}%`],
      )
      if (result.rows[0]?.waiting) return
      await Bun.sleep(50)
    }

    await client.query('SELECT pg_stat_clear_snapshot()')
    const activity = await client.query<{
      state: string
      wait_event_type: string | null
      wait_event: string | null
      query: string
    }>(`
      SELECT state, wait_event_type, wait_event, query
        FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
       ORDER BY pid
    `)
    throw new Error(`Timed out waiting for a blocked PostgreSQL query containing ${queryFragment}: ${JSON.stringify(activity.rows)}`)
  }

  async function createStoredPhoto(source: { plannedMediaId: string | null; familyId: string; userId: string }) {
    await prisma.mediaAsset.create({ data: {
      id: source.plannedMediaId!, familyId: source.familyId, uploaderId: source.userId,
      sourceKind: 'telegram', purpose: 'memory', mediaKind: 'photo',
      originalKey: `media-originals/test/${source.plannedMediaId}`, declaredMime: 'image/jpeg',
      verifiedMime: 'image/jpeg', sha256: '0'.repeat(64), byteSize: 1n,
      originalStatus: 'stored', renditionStatus: 'ready',
    } })
  }
})

function note(updateId: number, messageId: number, subject: string, text: string) {
  return normalizeTelegramUpdate({ update_id: updateId, message: {
    message_id: messageId, date: 1_788_000_000, chat: { id: Number(subject), type: 'private' },
    from: { id: Number(subject), is_bot: false, first_name: 'Тест' }, text,
  } })
}

function command(updateId: number, messageId: number, subject: string, text: string) {
  return note(updateId, messageId, subject, text)
}

function photo(updateId: number, messageId: number, subject: string, caption: string, mediaGroupId?: string) {
  return normalizeTelegramUpdate({ update_id: updateId, message: {
    message_id: messageId, date: 1_788_000_000, ...(mediaGroupId ? { media_group_id: mediaGroupId } : {}),
    chat: { id: Number(subject), type: 'private' }, from: { id: Number(subject), is_bot: false, first_name: 'Тест' },
    caption, photo: [{ file_id: `file-${messageId}`, file_unique_id: `unique-${messageId}`, width: 32, height: 32, file_size: photoFixture.byteLength }],
  } })
}

function video(updateId: number, messageId: number, subject: string, caption: string) {
  return normalizeTelegramUpdate({ update_id: updateId, message: {
    message_id: messageId, date: 1_788_000_000, chat: { id: Number(subject), type: 'private' },
    from: { id: Number(subject), is_bot: false, first_name: 'Тест' }, caption,
    video: { file_id: `video-file-${messageId}`, file_unique_id: `video-unique-${messageId}`, width: 640, height: 360, duration: 24, file_size: 2_000_000, mime_type: 'video/mp4',
      thumbnail: { file_id: `video-thumbnail-${messageId}`, file_unique_id: `video-thumbnail-unique-${messageId}`, width: 320, height: 180, file_size: photoFixture.byteLength } },
  } })
}

function reply(updateId: number, messageId: number, subject: string, replyToMessageId: number, text: string) {
  return normalizeTelegramUpdate({ update_id: updateId, message: {
    message_id: messageId, date: 1_788_000_000, chat: { id: Number(subject), type: 'private' },
    from: { id: Number(subject), is_bot: false, first_name: 'Тест' }, text,
    reply_to_message: { message_id: replyToMessageId },
  } })
}
