import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { memoryDtoSchema, memoryPageSchema } from '@web-app-demo/contracts'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import type { PrivateStorage } from '../../storage'
import { signAccessToken } from '../auth'
import type { MaxSendMediaMessageInput } from './application/ports'
import { createMaxAcceptUpdate } from './application/accept-update'
import { createMaxMemoryBackupProcessor, createPrismaMaxMemoryBackupRepository } from './infrastructure/backup-media'
import { createMaxPayloadCrypto } from './infrastructure/payload-crypto'
import { PrismaMaxRepository } from './infrastructure/prisma-max-repository'
import { createMaxWebhook } from './transport/webhook'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const png = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=',
  'base64',
))

maybeDescribe('app media to MAX backup and Feed', () => {
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173', AUTH_RATE_LIMIT_MAX: '10000',
  })
  const app = createApp({ env, prisma })
  const fixtures = new Set<{ userId: string; familyId?: string }>()

  afterAll(async () => { await prisma.$disconnect() })
  afterEach(async () => {
    for (const fixture of fixtures) {
      if (fixture.familyId) {
        const memories = await prisma.memory.findMany({ where: { familyId: fixture.familyId }, select: { id: true } })
        await prisma.taskOutbox.deleteMany({ where: {
          type: 'max:backup-media', dedupeKey: { in: memories.map(({ id }) => `max-backup-media:${id}`) },
        } })
        await prisma.maxMemoryBackup.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.maxVideoReference.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.memoryMedia.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.memory.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.maxOutboundSource.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.mediaAsset.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.child.deleteMany({ where: { familyId: fixture.familyId } })
        await prisma.family.deleteMany({ where: { id: fixture.familyId } })
      }
      await prisma.authSession.deleteMany({ where: { userId: fixture.userId } })
      await prisma.externalIdentity.deleteMany({ where: { userId: fixture.userId } })
      await prisma.user.deleteMany({ where: { id: fixture.userId } })
      fixtures.delete(fixture)
    }
  })

  for (const scenario of [
    { label: 'five photos', order: ['photo', 'photo', 'photo', 'photo', 'photo'] as const },
    { label: 'alternating photo and video', order: ['photo', 'video', 'photo', 'video'] as const },
  ]) {
    test(`keeps ${scenario.label} as one ordered Memory through provider send, replay, and bot event`, async () => {
      const channelChatId = scenario.order.length === 5 ? -88_501n : -88_502n
      const user = await prisma.user.create({ data: { displayName: `Synthetic ${scenario.label}` } })
      const fixture: { userId: string; familyId?: string } = { userId: user.id }
      fixtures.add(fixture)
      const identity = await prisma.externalIdentity.create({ data: {
        userId: user.id, provider: 'telegram', subject: scenario.order.length === 5 ? '88501' : '88502',
      } })
      const session = await prisma.authSession.create({ data: {
        userId: user.id, externalIdentityId: identity.id,
        refreshTokenHash: randomUUID(), refreshTokenFamilyHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      } })
      const family = await prisma.$transaction(async (tx) => {
        const created = await tx.family.create({ data: {
          ownerUserId: user.id, name: `Synthetic ${scenario.label}`, timezone: 'UTC', maxBackupChatId: channelChatId,
        } })
        await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
        await tx.maxChannelBinding.create({ data: { chatId: channelChatId, familyId: created.id, state: 'connected' } })
        return created
      })
      fixture.familyId = family.id
      const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Synthetic child' } })
      const token = await signAccessToken({ sub: user.id, sessionId: session.id }, env)
      const sourceKeys = new Set<string>()
      const ordered = [] as Array<{ kind: 'photo'; id: string } | { kind: 'video'; id: string; providerToken: string }>
      for (const [position, kind] of scenario.order.entries()) {
        if (kind === 'photo') {
          const originalKey = `synthetic/int1/${randomUUID()}.png`
          const asset = await prisma.mediaAsset.create({ data: {
            familyId: family.id, uploaderId: user.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
            originalKey, declaredMime: 'image/png', verifiedMime: 'image/png',
            sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: BigInt(png.byteLength),
            originalStatus: 'stored', renditionStatus: 'ready',
          } })
          sourceKeys.add(originalKey)
          ordered.push({ kind, id: asset.id })
        } else {
          const id = randomUUID()
          const providerToken = `synthetic-video-token-${position}`
          await prisma.maxVideoUploadSession.create({ data: {
            id, familyId: family.id, authorId: user.id, childId: child.id, plannedMemoryId: randomUUID(),
            body: '', mode: 'attachment', occurredAt: new Date('2026-09-01T12:00:00.000Z'),
            idempotencyFingerprint: randomUUID(), idempotencyKey: randomUUID(),
            expiresAt: new Date(Date.now() + 60_000), state: 'finalized', providerUploadToken: providerToken,
          } })
          await prisma.maxOutboundSource.create({ data: {
            uploadSessionId: id, familyId: family.id, recipientId: 900n,
            messageId: `synthetic-video-message-${position}`, providerAttachmentId: `synthetic-video-${position}`,
            width: 320, height: 240, durationMs: 1000,
          } })
          ordered.push({ kind, id, providerToken })
        }
      }

      const input = scenario.order.every((kind) => kind === 'photo')
        ? { kind: 'photo', childId: child.id, body: scenario.label, occurredAt: '2026-09-01T12:00:00.000Z',
          mediaIds: ordered.map(({ id }) => id) }
        : { kind: 'media', childId: child.id, body: scenario.label, occurredAt: '2026-09-01T12:00:00.000Z',
          attachments: ordered.map((item) => item.kind === 'photo'
            ? { source: 'private_storage', mediaId: item.id } : { source: 'max', sessionId: item.id }) }
      const createPath = `/api/v1/families/${family.id}/memories`
      const idempotencyKey = randomUUID()
      const create = async () => {
        const response = await app.request(createPath, { method: 'POST', headers: {
          Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey,
        }, body: JSON.stringify(input) })
        return { status: response.status, body: memoryDtoSchema.parse(await response.json()) }
      }
      const first = await create()
      expect(first.status).toBe(201)
      expect(first.body.attachments.map(({ kind, source }) => ({ kind, source }))).toEqual(
        ordered.map((item) => ({ kind: item.kind, source: item.kind === 'photo' ? 'private_storage' : 'max' })),
      )
      const replay = await create()
      expect(replay.status).toBe(200)
      expect(replay.body).toEqual(first.body)
      expect(await prisma.memory.count({ where: { familyId: family.id } })).toBe(1)

      const backupBefore = await prisma.maxMemoryBackup.findUniqueOrThrow({
        where: { memoryId: first.body.id }, include: { attachments: { orderBy: { position: 'asc' } } },
      })
      expect(backupBefore.attachments.map(({ position, kind, mediaId, uploadSessionId }) =>
        ({ position, kind, mediaId, uploadSessionId }))).toEqual(ordered.map((item, position) => ({
        position, kind: item.kind === 'photo' ? 'image' : 'video',
        mediaId: item.kind === 'photo' ? item.id : null,
        uploadSessionId: item.kind === 'video' ? item.id : null,
      })))
      expect(await prisma.taskOutbox.count({ where: {
        type: 'max:backup-media', dedupeKey: `max-backup-media:${first.body.id}`,
      } })).toBe(1)

      const uploads: string[] = []
      const sends: MaxSendMediaMessageInput[] = []
      const storage = { async readObject({ key }: { key: string }) {
        expect(sourceKeys.has(key)).toBe(true)
        return { key, contentLength: png.byteLength, contentType: 'image/png',
          body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(png); controller.close() } }),
        }
      } } as unknown as PrivateStorage
      const process = createMaxMemoryBackupProcessor({
        repository: createPrismaMaxMemoryBackupRepository(prisma), storage,
        api: {
          async uploadImage(upload) {
            uploads.push(upload.fileName)
            expect(upload.bytes).toEqual(png)
            return { token: `synthetic-${upload.fileName}` }
          },
          async sendMediaMessage(message) {
            sends.push(message)
            return { messageId: `synthetic-backup-${first.body.id}` }
          },
        },
      })
      await process({ memoryId: first.body.id })
      await process({ memoryId: first.body.id })
      expect(uploads).toEqual(ordered.flatMap((item, position) => item.kind === 'photo' ? [`backup_${position + 1}.png`] : []))
      expect(sends).toEqual([{
        chatId: channelChatId.toString(), text: scenario.label,
        attachments: ordered.map((item, position) => ({
          kind: item.kind === 'photo' ? 'image' : 'video',
          token: item.kind === 'photo' ? `synthetic-backup_${position + 1}.png` : item.providerToken,
        })),
      }])
      const backupAfter = await prisma.maxMemoryBackup.findUniqueOrThrow({
        where: { memoryId: first.body.id }, include: { attachments: { orderBy: { position: 'asc' } } },
      })
      expect(backupAfter).toMatchObject({ state: 'sent', providerMessageId: `synthetic-backup-${first.body.id}` })
      expect(backupAfter.attachments.map(({ uploadToken }) => uploadToken)).toEqual(sends[0]!.attachments.map(({ token }) => token))

      const crypto = createMaxPayloadCrypto(Buffer.alloc(32, 17).toString('base64url'))
      const secret = 'M'.repeat(43)
      const webhook = createMaxWebhook({ secret, bodyLimitBytes: 64 * 1024,
        acceptUpdate: createMaxAcceptUpdate({ botId: '900', repository: new PrismaMaxRepository(prisma), encrypt: crypto.encrypt }),
      })
      const inboxCountBefore = await prisma.maxInbox.count()
      const processTaskCountBefore = await prisma.taskOutbox.count({ where: { type: 'max:process' } })
      const selfPost = JSON.stringify({ update_type: 'message_created', timestamp: Date.now(), message: {
        sender: { user_id: 900 }, recipient: { chat_id: Number(channelChatId), chat_type: 'chat', user_id: 900 },
        body: { mid: backupAfter.providerMessageId, text: scenario.label,
          attachments: sends[0]!.attachments.map((item, index) => item.kind === 'image'
            ? { type: 'image', payload: { photo_id: index + 1, token: item.token } }
            : { type: 'video', payload: { id: index + 1, token: item.token, duration: 1 } }),
        },
      } })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await webhook.request('/webhooks/max', { method: 'POST',
          headers: { 'X-Max-Bot-Api-Secret': secret, 'Content-Type': 'application/json' }, body: selfPost })
        expect(response.status).toBe(200)
      }
      expect(await prisma.maxInbox.count()).toBe(inboxCountBefore)
      expect(await prisma.maxSource.count({ where: { messageId: backupAfter.providerMessageId! } })).toBe(0)
      expect(await prisma.taskOutbox.count({ where: { type: 'max:process' } })).toBe(processTaskCountBefore)
      expect(await prisma.memory.count({ where: { familyId: family.id } })).toBe(1)

      const feedResponse = await app.request(createPath, { headers: { Authorization: `Bearer ${token}` } })
      expect(feedResponse.status).toBe(200)
      const feed = memoryPageSchema.parse(await feedResponse.json())
      expect(feed.items).toHaveLength(1)
      expect(feed.items[0]!.id).toBe(first.body.id)
      expect(feed.items[0]!.attachments.map(({ id, kind, source }) => ({ id, kind, source }))).toEqual(
        first.body.attachments.map(({ id, kind, source }) => ({ id, kind, source })),
      )
    })
  }
})
