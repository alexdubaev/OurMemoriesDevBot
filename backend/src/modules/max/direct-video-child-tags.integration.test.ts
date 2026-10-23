import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import { childrenFixtures, type FixtureFamily } from '../../test-support/children-fixtures'
import { createPrismaFamilyAccess, type FamilyScope } from '../families'
import { createSourceMemoryPublisher, PrismaMemoryRepository } from '../memories'
import { createPrismaIdempotencyExecutor } from '../../idempotency'
import type { MaxApiPort } from './application/ports'
import { createMaxDirectVideoUploadService } from './application/direct-video-upload'
import { PrismaMaxDirectUploadRepository } from './infrastructure/prisma-max-direct-upload-repository'

describe('Mini App MAX video and child tags', () => {
  const fx = childrenFixtures()
  const families: string[] = []
  let sends = 0

  afterEach(async () => {
    sends = 0
    await fx.db.memory.deleteMany({ where: { familyId: { in: families } } })
    await fx.db.maxVideoUploadSession.deleteMany({ where: { familyId: { in: families.splice(0) } } })
    await fx.cleanup()
  })
  afterAll(async () => { await fx.disconnect() })

  async function family(children: Parameters<typeof fx.family>[1]) {
    const created = await fx.family(undefined, children)
    families.push(created.id)
    return created
  }

  function service() {
    const messageId = `synthetic-message-${randomUUID()}`
    const api: MaxApiPort = {
      getMe: async () => ({ userId: 1, username: 'SyntheticBot', isBot: true }),
      getSubscriptions: async () => [], createSubscription: async () => ({ success: true }),
      deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
      createVideoUpload: async () => ({ url: 'https://upload.max.example/video', token: 'provider-token' }),
      sendVideoMessage: async () => { sends += 1; return { messageId } },
      getMessage: async () => ({ messageId, senderId: '1', recipientId: '1', attachments: [{
        kind: 'video', providerAttachmentId: `attachment-${randomUUID()}`, currentToken: 'opaque', inboundDurationSeconds: 1, width: 640, height: 360,
      }] }),
    }
    const access = createPrismaFamilyAccess(fx.db)
    return createMaxDirectVideoUploadService({
      access, api, repository: new PrismaMaxDirectUploadRepository(fx.db),
      publisher: createSourceMemoryPublisher(fx.db, access),
      memoryReader: new PrismaMemoryRepository(fx.db, createPrismaIdempotencyExecutor(fx.db)),
      now: () => new Date('2026-09-20T10:00:00.000Z'),
    })
  }

  const scopeOf = (target: FixtureFamily): FamilyScope => ({ familyId: target.id, principal: { userId: target.owner.id, sessionId: 'synthetic' } })
  const reserveInput = (extra: Record<string, unknown> = {}) => ({
    body: 'Синтетическое видео', occurredAt: '2026-09-20T10:00:00.000Z', fileName: 'clip.mp4', fileSize: 128,
    mimeType: 'video/mp4', idempotencyKey: `child-tags-${randomUUID()}`, ...extra,
  })

  test('a standalone video reserved without a child is published with the children chosen at finalize', async () => {
    const target = await family(['Старшая', 'Младший'])
    const videos = service()
    const reserved = await videos.reserve(scopeOf(target), reserveInput())
    expect((await fx.db.maxVideoUploadSession.findUniqueOrThrow({ where: { id: reserved.sessionId } })).childId).toBe(target.children[0]!.id)

    const finalized = await videos.finalize(scopeOf(target), reserved.sessionId, reserved.uploadToken,
      { childIds: [target.children[1]!.id], includeChildTags: true })
    expect(finalized.state).toBe('finalized')
    expect(await fx.tags(finalized.memoryId!)).toEqual([{ childId: target.children[1]!.id, attachmentId: null }])
    expect((await fx.db.memory.findUniqueOrThrow({ where: { id: finalized.memoryId! } })).childId).toBe(target.children[1]!.id)
    expect(finalized.memory?.childTags).toEqual([{ childId: target.children[1]!.id, attachmentId: null }])
  })

  test('without children at finalize the default rule applies: none for two children, the only child for one', async () => {
    const two = await family(['Старшая', 'Младший'])
    const videos = service()
    const first = await videos.reserve(scopeOf(two), reserveInput({ childId: two.children[1]!.id }))
    const published = await videos.finalize(scopeOf(two), first.sessionId, first.uploadToken)
    expect(published.state).toBe('finalized')
    expect(await fx.tags(published.memoryId!)).toEqual([])
    expect(published.memory && 'childTags' in published.memory).toBe(false)

    const one = await family(['Лиля'])
    const second = await videos.reserve(scopeOf(one), reserveInput())
    const only = await videos.finalize(scopeOf(one), second.sessionId, second.uploadToken)
    expect(await fx.tags(only.memoryId!)).toEqual([{ childId: one.children[0]!.id, attachmentId: null }])
  })

  test('a foreign or deleted child at finalize is not found before anything is sent; a corrected retry publishes', async () => {
    const target = await family(['Старшая', { name: 'Удалённый', deleted: true }])
    const stranger = await family(['Чужой'])
    const videos = service()
    const reserved = await videos.reserve(scopeOf(target), reserveInput())
    for (const childId of [stranger.children[0]!.id, target.children[1]!.id]) {
      await expect(videos.finalize(scopeOf(target), reserved.sessionId, reserved.uploadToken, { childIds: [childId] }))
        .rejects.toMatchObject({ kind: 'not_found', code: 'finalize_not_found_child' })
    }
    expect(sends).toBe(0)
    expect(await fx.db.memory.count({ where: { familyId: target.id } })).toBe(0)

    const retried = await videos.finalize(scopeOf(target), reserved.sessionId, reserved.uploadToken, { childIds: [target.children[0]!.id] })
    expect(retried.state).toBe('finalized')
    expect(await fx.tags(retried.memoryId!)).toEqual([{ childId: target.children[0]!.id, attachmentId: null }])
  })

  test('reserving with a foreign legacy child is still rejected', async () => {
    const target = await family(['Старшая', 'Младший'])
    const stranger = await family(['Чужой'])
    await expect(service().reserve(scopeOf(target), reserveInput({ childId: stranger.children[0]!.id })))
      .rejects.toMatchObject({ kind: 'not_found', code: 'reserve_not_found_child' })
  })

  test('an attachment video uploaded for one child can join a memory tagged for another', async () => {
    const target = await family(['Старшая', 'Младший'])
    const videos = service()
    const reserved = await videos.reserve(scopeOf(target), reserveInput({ mode: 'attachment', body: '', childId: target.children[0]!.id }))
    expect((await videos.finalize(scopeOf(target), reserved.sessionId, reserved.uploadToken)).state).toBe('finalized')

    const created = await fx.request(`/api/v1/families/${target.id}/memories`, target.owner.token, 'POST', {
      kind: 'media', body: 'Видео в публикации', occurredAt: '2026-09-20T10:00:00.000Z',
      attachments: [{ source: 'max', sessionId: reserved.sessionId }], childIds: [target.children[1]!.id],
    }, randomUUID())
    expect(created.response.status, JSON.stringify(created.body)).toBe(201)
    expect(await fx.tags(created.body.id)).toEqual([{ childId: target.children[1]!.id, attachmentId: null }])
  })
})
