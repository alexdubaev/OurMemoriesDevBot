import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { childrenFixtures, type FixtureFamily, type FixtureUser } from '../../test-support/children-fixtures'
import { createPrismaFamilyAccess } from '../families'
import { createSourceMemoryPublisher } from './infrastructure/source-memory-publisher'

const childrenHeader = { 'X-Memoly-Children': '1' }

describe('replacing memory child tags', () => {
  const fx = childrenFixtures()
  const families: string[] = []
  const telegramInboxes: string[] = []

  afterEach(async () => {
    await fx.db.telegramInbox.deleteMany({ where: { id: { in: telegramInboxes.splice(0) } } })
    await fx.db.maxVideoUploadSession.deleteMany({ where: { familyId: { in: families.splice(0) } } })
    await fx.cleanup()
  })
  afterAll(async () => { await fx.disconnect() })

  async function family(children: Parameters<typeof fx.family>[1]) {
    const created = await fx.family(undefined, children)
    families.push(created.id)
    return created
  }

  async function photoAsset(target: FixtureFamily, uploader: FixtureUser = target.owner) {
    const asset = await fx.db.mediaAsset.create({ data: {
      familyId: target.id, uploaderId: uploader.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
      originalKey: `synthetic/${target.id}/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
      sha256: 'a'.repeat(64), byteSize: 10n, width: 64, height: 48, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    return asset.id
  }

  /** A published `media` memory with photos (own storage) and, optionally, one MAX video at the end. */
  async function mediaMemory(target: FixtureFamily, photos: number, withMaxVideo = false) {
    const memory = await fx.memory(target, { kind: withMaxVideo || photos > 1 ? 'media' : 'photo', body: 'Синтетические фото' })
    const photoIds: string[] = []
    for (let index = 0; index < photos; index += 1) photoIds.push(await photoAsset(target))
    await fx.db.memoryMedia.createMany({ data: photoIds.map((mediaId, position) => ({
      familyId: target.id, memoryId: memory.id, mediaId, position,
    })) })
    let maxVideoId: string | undefined
    if (withMaxVideo) {
      const sessionId = randomUUID()
      await fx.db.maxVideoUploadSession.create({ data: {
        id: sessionId, familyId: target.id, authorId: target.owner.id, childId: target.children[0]!.id,
        plannedMemoryId: randomUUID(), body: '', mode: 'attachment', occurredAt: new Date(),
        idempotencyFingerprint: randomUUID(), idempotencyKey: `tags-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000), state: 'finalized',
      } })
      const outbound = await fx.db.maxOutboundSource.create({ data: {
        uploadSessionId: sessionId, familyId: target.id, recipientId: 123n, messageId: randomUUID(),
        providerAttachmentId: `synthetic-${randomUUID()}`,
      } })
      maxVideoId = (await fx.db.maxVideoReference.create({ data: {
        familyId: target.id, memoryId: memory.id, outboundSourceId: outbound.id, attachmentPosition: photos,
        providerAttachmentId: outbound.providerAttachmentId,
      } })).id
    }
    return { memory, photoIds, maxVideoId }
  }

  async function telegramVideoMemory(target: FixtureFamily) {
    const memory = await fx.memory(target, { kind: 'video', body: 'Историческое видео' })
    const inbox = await fx.db.telegramInbox.create({ data: {
      botId: 1n, updateId: BigInt(Date.now()) * 1000n + BigInt(telegramInboxes.length), eventKind: 'content',
      encryptedPayload: Buffer.from('synthetic'), encryptionIv: Buffer.alloc(12), encryptionAuthTag: Buffer.alloc(16),
    } })
    telegramInboxes.push(inbox.id)
    const source = await fx.db.telegramSource.create({ data: {
      inboxId: inbox.id, botId: 1n, chatId: 1n, messageId: BigInt(Date.now()) + BigInt(telegramInboxes.length),
      senderSubject: 'synthetic', userId: target.owner.id, familyId: target.id, childId: target.children[0]!.id, kind: 'video', status: 'published',
      plannedMemoryId: memory.id, memoryId: memory.id,
    } })
    const reference = await fx.db.telegramVideoReference.create({ data: {
      sourceId: source.id, memoryId: memory.id, familyId: target.id, fileIdCiphertext: Buffer.from('x'),
      encryptionIv: Buffer.alloc(12), encryptionAuthTag: Buffer.alloc(16), fileUniqueId: `synthetic-${randomUUID()}`,
    } })
    return { memory, referenceId: reference.id }
  }

  const put = (target: FixtureFamily, memoryId: string, body: unknown, token = target.owner.token, familyId = target.id) =>
    fx.request(`/api/v1/families/${familyId}/memories/${memoryId}/child-tags`, token, 'PUT', body)
  const sorted = (tags: Array<{ childId: string; attachmentId: string | null }>) =>
    [...tags].sort((a, b) => `${a.childId}:${a.attachmentId ?? ''}`.localeCompare(`${b.childId}:${b.attachmentId ?? ''}`))

  async function waitForFamilyLockWait() {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const waiting = await fx.db.$queryRaw<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query ILIKE '%FROM families%'
           AND query ILIKE '%FOR UPDATE%'
      `
      if (waiting.length > 0) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('No PostgreSQL family row-lock waiter appeared for FOR UPDATE')
  }

  test('a full member who is not the author tags photos and a MAX video; version, text, date and unread order stay', async () => {
    const target = await family(['Старшая', 'Младший'])
    const [elder, younger] = target.children
    const relative = await fx.member(target.id, 'full')
    const { memory, photoIds, maxVideoId } = await mediaMemory(target, 3, true)
    await fx.db.memoryChildTag.create({ data: {
      familyId: target.id, memoryId: memory.id, childId: elder!.id, attachmentId: null, createdBy: target.owner.id,
    } })
    const before = await fx.db.memory.findUniqueOrThrow({ where: { id: memory.id } })
    const familyBefore = await fx.db.family.findUniqueOrThrow({ where: { id: target.id } })

    const saved = await put(target, memory.id, { expectedChildTagsVersion: 1, tags: [
      { childId: elder!.id, attachmentId: null },
      { childId: elder!.id, attachmentId: photoIds[1]! },
      { childId: younger!.id, attachmentId: maxVideoId! },
    ] }, relative.token)

    expect(saved.response.status, JSON.stringify(saved.body)).toBe(200)
    const expected = sorted([
      { childId: elder!.id, attachmentId: photoIds[1]! },
      { childId: younger!.id, attachmentId: maxVideoId! },
    ])
    expect(saved.body.childTagsVersion).toBe(2)
    expect(sorted(saved.body.childTags)).toEqual(expected)
    expect(await fx.tags(memory.id)).toEqual(expected)
    const after = await fx.db.memory.findUniqueOrThrow({ where: { id: memory.id } })
    expect(after).toMatchObject({ version: before.version, body: before.body, occurredAt: before.occurredAt, childTagsVersion: 2 })
    expect((await fx.db.family.findUniqueOrThrow({ where: { id: target.id } })).unreadOrderVersion)
      .toBe(familyBefore.unreadOrderVersion)
    expect((await fx.db.memoryChildTag.findFirstOrThrow({ where: { memoryId: memory.id, childId: younger!.id } })).createdBy)
      .toBe(relative.id)
  })

  test('the memory DTO carries tags and their version only with the children header', async () => {
    const target = await family(['Старшая', 'Младший'])
    const { memory, photoIds } = await mediaMemory(target, 2)
    await put(target, memory.id, { expectedChildTagsVersion: 1, tags: [{ childId: target.children[1]!.id, attachmentId: photoIds[0]! }] })

    const withHeader = await fx.request(`/api/v1/families/${target.id}/memories/${memory.id}`, target.owner.token, 'GET', undefined, undefined, childrenHeader)
    expect(withHeader.response.status).toBe(200)
    expect(withHeader.body.childTags).toEqual([{ childId: target.children[1]!.id, attachmentId: photoIds[0]! }])
    expect(withHeader.body.childTagsVersion).toBe(2)

    const legacy = await fx.request(`/api/v1/families/${target.id}/memories/${memory.id}`, target.owner.token)
    expect(legacy.response.status).toBe(200)
    expect('childTags' in legacy.body).toBe(false)
    expect('childTagsVersion' in legacy.body).toBe(false)
  })

  test('a historical Telegram video can be tagged on its attachment', async () => {
    const target = await family(['Старшая', 'Младший'])
    const { memory, referenceId } = await telegramVideoMemory(target)
    const saved = await put(target, memory.id, { expectedChildTagsVersion: 1, tags: [
      { childId: target.children[0]!.id, attachmentId: referenceId },
    ] })
    expect(saved.response.status, JSON.stringify(saved.body)).toBe(200)
    expect(await fx.tags(memory.id)).toEqual([{ childId: target.children[0]!.id, attachmentId: referenceId }])
  })

  test('a note is tagged on the whole publication; an attachment tag on it is rejected', async () => {
    const target = await family(['Старшая', 'Младший'])
    const note = await fx.memory(target, { kind: 'note' })
    const other = await mediaMemory(target, 1)
    const rejected = await put(target, note.id, { expectedChildTagsVersion: 1, tags: [
      { childId: target.children[0]!.id, attachmentId: other.photoIds[0]! },
    ] })
    expect(rejected.response.status).toBe(422)
    expect(rejected.body.error.code).toBe('INVALID_INPUT')

    const saved = await put(target, note.id, { expectedChildTagsVersion: 1, tags: target.children.map(({ id }) => ({ childId: id, attachmentId: null })) })
    expect(saved.response.status).toBe(200)
    expect(await fx.tags(note.id)).toEqual(sorted(target.children.map(({ id }) => ({ childId: id, attachmentId: null }))))

    const cleared = await put(target, note.id, { expectedChildTagsVersion: 2, tags: [] })
    expect(cleared.response.status).toBe(200)
    expect(cleared.body).toEqual({ childTags: [], childTagsVersion: 3 })
    expect(await fx.tags(note.id)).toEqual([])
  })

  test('a stale tag version is a conflict that keeps the newer tags', async () => {
    const target = await family(['Старшая', 'Младший'])
    const note = await fx.memory(target, { kind: 'note' })
    const first = await put(target, note.id, { expectedChildTagsVersion: 1, tags: [{ childId: target.children[0]!.id, attachmentId: null }] })
    expect(first.response.status).toBe(200)
    const second = await put(target, note.id, { expectedChildTagsVersion: 1, tags: [{ childId: target.children[1]!.id, attachmentId: null }] })
    expect(second.response.status).toBe(409)
    expect(second.body.error).toMatchObject({ code: 'VERSION_CONFLICT', message: 'Отметки уже изменили, обновите' })
    expect(await fx.tags(note.id)).toEqual([{ childId: target.children[0]!.id, attachmentId: null }])
  })

  test('resending the same set does not count as a change', async () => {
    const target = await family(['Старшая', 'Младший'])
    const note = await fx.memory(target, { kind: 'note', tags: [{ childId: target.children[0]!.id }] })
    const same = await put(target, note.id, { expectedChildTagsVersion: 1, tags: [{ childId: target.children[0]!.id, attachmentId: null }] })
    expect(same.response.status).toBe(200)
    expect(same.body).toEqual({ childTags: [{ childId: target.children[0]!.id, attachmentId: null }], childTagsVersion: 1 })
  })

  test('a viewer cannot change tags', async () => {
    const target = await family(['Старшая', 'Младший'])
    const viewer = await fx.member(target.id, 'viewer')
    const note = await fx.memory(target, { kind: 'note' })
    const rejected = await put(target, note.id, { expectedChildTagsVersion: 1, tags: [{ childId: target.children[0]!.id, attachmentId: null }] }, viewer.token)
    expect(rejected.response.status).toBe(403)
    expect(await fx.tags(note.id)).toEqual([])
  })

  test('another family, a foreign, deleted or unknown child and a deleted memory are not found', async () => {
    const target = await family(['Старшая', { name: 'Удалённый', deleted: true }])
    const stranger = await family(['Чужой'])
    const note = await fx.memory(target, { kind: 'note' })
    const body = { expectedChildTagsVersion: 1, tags: [{ childId: target.children[0]!.id, attachmentId: null }] }

    expect((await put(target, note.id, body, stranger.owner.token)).response.status).toBe(404)
    expect((await put(stranger, note.id, body, stranger.owner.token)).response.status).toBe(404)
    for (const childId of [stranger.children[0]!.id, target.children[1]!.id, randomUUID()]) {
      const rejected = await put(target, note.id, { expectedChildTagsVersion: 1, tags: [{ childId, attachmentId: null }] })
      expect(rejected.response.status).toBe(404)
      expect(rejected.body.error.message).toBe('Профиль ребёнка не найден')
    }
    await fx.db.memory.update({ where: { id: note.id }, data: { status: 'deleted', deletedAt: new Date() } })
    const deleted = await put(target, note.id, body)
    expect(deleted.response.status).toBe(404)
    expect(deleted.body.error.message).toBe('Воспоминание не найдено')
    expect(await fx.tags(note.id)).toEqual([])
  })

  test('an attachment of another publication is not found and duplicates are invalid', async () => {
    const target = await family(['Старшая', 'Младший'])
    const own = await mediaMemory(target, 1)
    const other = await mediaMemory(target, 1)
    const foreign = await put(target, own.memory.id, { expectedChildTagsVersion: 1, tags: [
      { childId: target.children[0]!.id, attachmentId: other.photoIds[0]! },
    ] })
    expect(foreign.response.status).toBe(404)
    expect(foreign.body.error.message).toBe('Вложение не найдено')

    const duplicate = await put(target, own.memory.id, { expectedChildTagsVersion: 1, tags: [
      { childId: target.children[0]!.id, attachmentId: own.photoIds[0]! },
      { childId: target.children[0]!.id, attachmentId: own.photoIds[0]! },
    ] })
    expect(duplicate.response.status).toBe(422)
    expect(await fx.tags(own.memory.id)).toEqual([])
    expect(await fx.tags(other.memory.id)).toEqual([])
  })

  test('tagging another family\'s photo neither stores a tag nor opens that photo\'s content', async () => {
    const target = await family(['Старшая', 'Младший'])
    const stranger = await family(['Чужой'])
    const own = await mediaMemory(target, 1)
    const theirs = await mediaMemory(stranger, 1)
    const theirPhoto = theirs.photoIds[0]!

    const attempt = await put(target, own.memory.id, { expectedChildTagsVersion: 1, tags: [
      { childId: target.children[0]!.id, attachmentId: theirPhoto },
    ] })
    expect(attempt.response.status).toBe(404)
    expect(await fx.db.memoryChildTag.count({ where: { attachmentId: theirPhoto } })).toBe(0)

    const viaOwnFamily = await fx.request(`/api/v1/families/${target.id}/media/${theirPhoto}/content?variant=original`, target.owner.token)
    expect(viaOwnFamily.response.status).toBe(404)
    const viaTheirFamily = await fx.request(`/api/v1/families/${stranger.id}/media/${theirPhoto}/content?variant=original`, target.owner.token)
    expect(viaTheirFamily.response.status).toBe(404)
  })

  test('a trusted MAX republication without a photo drops the tags of that photo and keeps the rest', async () => {
    const target = await family(['Старшая', 'Младший'])
    const [elder, younger] = target.children
    const photoIds = [await photoAsset(target), await photoAsset(target), await photoAsset(target)]
    const publisher = createSourceMemoryPublisher(fx.db, createPrismaFamilyAccess(fx.db))
    const scope = { familyId: target.id, principal: { userId: target.owner.id, sessionId: 'synthetic-max' } }
    const source = { id: randomUUID(), kind: 'photo' as const, body: 'Из MAX', occurredAt: new Date(), mediaIds: photoIds }
    await publisher.publish(scope, source)
    const tagged = await put(target, source.id, { expectedChildTagsVersion: 1, tags: [
      { childId: elder!.id, attachmentId: photoIds[0]! }, { childId: younger!.id, attachmentId: photoIds[1]! },
    ] })
    expect(tagged.response.status, JSON.stringify(tagged.body)).toBe(200)

    await publisher.publish(scope, { ...source, mediaIds: [photoIds[0]!, photoIds[2]!] })
    expect(await fx.tags(source.id)).toEqual([{ childId: elder!.id, attachmentId: photoIds[0]! }])
    expect((await fx.db.memory.findUniqueOrThrow({ where: { id: source.id } })).childTagsVersion).toBe(3)
  })

  test.each(['replaceOrderedMedia', 'publish replay'] as const)('%s serializes attachment removal with child-tag edits', async (path) => {
    const target = await family(['Старшая', 'Младший'])
    const [kept, removed, replacement] = await Promise.all([
      photoAsset(target), photoAsset(target), photoAsset(target),
    ])
    const publisher = createSourceMemoryPublisher(fx.db, createPrismaFamilyAccess(fx.db))
    const scope = { familyId: target.id, principal: { userId: target.owner.id, sessionId: 'synthetic-source' } }
    const input = { id: randomUUID(), kind: 'photo' as const, body: 'Из источника', occurredAt: new Date(), mediaIds: [kept, removed] }
    await publisher.publish(scope, input)
    const taggerLocked = Promise.withResolvers<void>()
    const releaseTagger = Promise.withResolvers<void>()
    const tagEdit = fx.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM families WHERE id = ${target.id}::uuid FOR SHARE`
      await tx.$queryRaw`SELECT id FROM memories WHERE id = ${input.id}::uuid FOR NO KEY UPDATE`
      const attachments = await tx.memoryMedia.findMany({ where: { memoryId: input.id }, select: { mediaId: true } })
      expect(attachments.map(({ mediaId }) => mediaId)).toContain(removed)
      taggerLocked.resolve()
      await releaseTagger.promise
      await tx.memoryChildTag.create({ data: {
        familyId: target.id, memoryId: input.id, childId: target.children[1]!.id,
        attachmentId: removed, createdBy: target.owner.id,
      } })
    })
    await taggerLocked.promise
    const publish = path === 'publish replay'
      ? publisher.publish(scope, { ...input, mediaIds: [kept, replacement] })
      : publisher.replaceOrderedMedia(scope, input.id, [kept, replacement])
    try {
      await waitForFamilyLockWait()
    } finally {
      releaseTagger.resolve()
    }
    await Promise.all([tagEdit, publish])
    expect(await fx.tags(input.id)).toEqual([])
  })
})
