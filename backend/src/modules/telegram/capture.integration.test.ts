import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import sharp from 'sharp'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import type { BackendRuntime } from '../../runtime'
import { createPrivateStorage } from '../../storage'
import { signAccessToken } from '../auth'
import { createAcceptTelegramUpdate } from './application/accept-update'
import type { TelegramApiPort } from './application/ports'
import { createTelegramPayloadCrypto } from './infrastructure/payload-crypto'
import { PrismaTelegramRepository } from './infrastructure/prisma-telegram-repository'
import { createTelegramTaskProcessor } from './infrastructure/process-task'
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
    PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000', MEDIA_FAMILY_QUOTA_BYTES: '10000000',
  })
  const privateStorage = createPrivateStorage(env)
  const app = createApp({ env, prisma, privateStorage })
  const sent: Array<{ chatId: string; text: string; options: Parameters<TelegramApiPort['sendMessage']>[2] }> = []
  let finalReceiptFailuresRemaining = 0
  const api: TelegramApiPort = {
    download: async () => ({
      body: new Blob([photoFixture.slice().buffer as ArrayBuffer]).stream(),
      byteSize: photoFixture.byteLength,
      contentType: 'image/jpeg',
    }),
    sendMessage: async (chatId, text, options) => {
      if (text.startsWith('Сохранено') && finalReceiptFailuresRemaining > 0) {
        finalReceiptFailuresRemaining -= 1
        throw new Error('synthetic Telegram 429')
      }
      sent.push({ chatId, text, options })
    },
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
  const accept = createAcceptTelegramUpdate({ botId: 777n, repository, api, encrypt: crypto.encrypt })

  beforeEach(async () => {
    await clearFixtures()
    sent.length = 0
    finalReceiptFailuresRemaining = 0
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
      await prisma.mediaAsset.create({ data: {
        id: source.plannedMediaId!, familyId: source.familyId, uploaderId: source.userId,
        sourceKind: 'telegram', purpose: 'memory', mediaKind: source.kind === 'video' ? 'video' : 'photo',
        originalKey: `media-originals/test/${source.plannedMediaId}`, declaredMime: source.kind === 'video' ? 'video/mp4' : 'image/jpeg',
        verifiedMime: source.kind === 'video' ? 'video/mp4' : 'image/jpeg', sha256: '0'.repeat(64), byteSize: 1n,
        originalStatus: 'stored', renditionStatus: source.kind === 'photo' ? 'ready' : 'pending',
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

  async function clearFixtures() {
    await prisma.telegramSource.deleteMany()
    await prisma.telegramAlbum.deleteMany()
    await prisma.telegramInbox.deleteMany()
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
    }, body: JSON.stringify({ name: 'Семья', timezone: 'Europe/Moscow', child: { displayName: 'Ребёнок' } }) })
    expect(response.status).toBe(201)
    const body = await response.json() as any
    return { ...owner, familyId: body.family.id, childId: body.child.id }
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
