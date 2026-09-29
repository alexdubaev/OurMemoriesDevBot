import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import type { PrivateStorage } from '../../storage'
import type { MaxApiPort, MaxSendMediaMessageInput } from './application/ports'
import { createMaxMemoryBackupProcessor, createPrismaMaxMemoryBackupRepository } from './infrastructure/backup-media'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip
const png = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p8sAAAAASUVORK5CYII=',
  'base64',
))

maybeDescribe('MAX durable photo backup', () => {
  const prisma = createPrisma(databaseUrl!)
  const fixtures = new Set<{ familyId: string; userId: string }>()

  afterEach(async () => {
    for (const fixture of fixtures) {
      await prisma.family.deleteMany({ where: { id: fixture.familyId } })
      await prisma.user.deleteMany({ where: { id: fixture.userId } })
      fixtures.delete(fixture)
    }
  })

  afterAll(async () => { await prisma.$disconnect() })

  test('reserves twelve distinct send slots for one channel across repository instances', async () => {
    const user = await prisma.user.create({ data: { displayName: 'Synthetic MAX pacing test' } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: {
        ownerUserId: user.id, name: 'Synthetic MAX pacing test', timezone: 'UTC', maxBackupChatId: -88_002n,
      } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    fixtures.add({ familyId: family.id, userId: user.id })
    const first = createPrismaMaxMemoryBackupRepository(prisma)
    const second = createPrismaMaxMemoryBackupRepository(prisma)
    const backup = { familyId: family.id, channelChatId: family.maxBackupChatId } as Parameters<typeof first.reserveChannelSendDelay>[0]
    const delays = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      (index % 2 === 0 ? first : second).reserveChannelSendDelay(backup)))
    expect(delays.every((value) => value !== null)).toBe(true)
    const ordered = (delays as number[]).sort((left, right) => left - right)
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]! - ordered[index - 1]!).toBeGreaterThanOrEqual(400)
    }
  })

  test('reserves one ordered photo album, persists the provider identity, and retains private originals on reprocess', async () => {
    const user = await prisma.user.create({ data: { displayName: 'Synthetic MAX backup test' } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({
        data: { ownerUserId: user.id, name: 'Synthetic MAX backup test', timezone: 'UTC', maxBackupChatId: -88_001n },
      })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    fixtures.add({ familyId: family.id, userId: user.id })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: 'Synthetic child' } })
    const assets = await Promise.all([0, 1].map((position) => prisma.mediaAsset.create({
      data: {
        familyId: family.id,
        uploaderId: user.id,
        sourceKind: 'upload',
        purpose: 'memory',
        mediaKind: 'photo',
        originalKey: `synthetic/max-backup/${randomUUID()}.png`,
        declaredMime: 'image/png',
        verifiedMime: 'image/png',
        sha256: randomUUID().replaceAll('-', '').repeat(2),
        byteSize: BigInt(png.byteLength),
        originalStatus: 'stored',
      },
    })))
    const memory = await prisma.memory.create({
      data: {
        familyId: family.id,
        childId: child.id,
        authorId: user.id,
        kind: 'photo',
        body: 'Synthetic photo album',
        occurredAt: new Date('2026-01-02T03:04:05.000Z'),
        status: 'published',
        firstPublishedAt: new Date('2026-01-02T03:04:05.000Z'),
        media: { create: assets.map((asset, position) => ({ position, asset: { connect: { id: asset.id } } })) },
      },
    })
    const backup = await prisma.maxMemoryBackup.create({
      data: {
        familyId: family.id,
        memoryId: memory.id,
        body: memory.body,
        state: 'pending',
        channelChatId: family.maxBackupChatId,
        attachments: { create: assets.map((asset, position) => ({
          position, kind: 'image',
          family: { connect: { id: family.id } },
          media: { connect: { id_familyId: { id: asset.id, familyId: family.id } } },
        })) },
      },
    })
    const sends: MaxSendMediaMessageInput[] = []
    const api: Pick<MaxApiPort, 'uploadImage' | 'sendMediaMessage'> = {
      async uploadImage(input) {
        expect(input.contentType).toBe('image/png')
        expect(input.bytes).toEqual(png)
        return { token: `synthetic-image-${input.fileName}` }
      },
      async sendMediaMessage(input) {
        sends.push(input)
        return { messageId: 'synthetic-max-message-1001' }
      },
    }
    const storage = {
      async readObject({ key }: { key: string }) {
        expect(assets.some((asset) => asset.originalKey === key)).toBe(true)
        return {
          key,
          contentLength: png.byteLength,
          contentType: 'image/png',
          body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(png); controller.close() } }),
        }
      },
    } as unknown as PrivateStorage
    const process = createMaxMemoryBackupProcessor({
      repository: createPrismaMaxMemoryBackupRepository(prisma), storage, api,
      now: () => new Date('2026-01-02T03:05:00.000Z'),
    })

    await process({ memoryId: memory.id })
    await process({ memoryId: memory.id })

    const persisted = await prisma.maxMemoryBackup.findUniqueOrThrow({
      where: { memoryId: memory.id },
      include: { attachments: { orderBy: { position: 'asc' } } },
    })
    expect(persisted).toMatchObject({
      id: backup.id,
      familyId: family.id,
      memoryId: memory.id,
      state: 'sent',
      channelChatId: -88_001n,
      providerMessageId: 'synthetic-max-message-1001',
      sendIntentAt: expect.any(Date),
    })
    expect(persisted.attachments.map(({ position, kind, mediaId, uploadToken }) => ({ position, kind, mediaId, uploadToken }))).toEqual(
      assets.map((asset, position) => ({
        position,
        kind: 'image',
        mediaId: asset.id,
        uploadToken: `synthetic-image-backup_${position + 1}.png`,
      })),
    )
    expect(sends).toEqual([{
      chatId: '-88001',
      text: memory.body,
      attachments: assets.map((_, position) => ({ kind: 'image', token: `synthetic-image-backup_${position + 1}.png` })),
    }])
    expect(await prisma.memoryMedia.count({ where: { memoryId: memory.id } })).toBe(2)
    expect(await prisma.mediaAsset.count({ where: { id: { in: assets.map(({ id }) => id) }, originalStatus: 'stored', deletedAt: null, storageDeletedAt: null } })).toBe(2)
  })
})
