import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { createPrivateStorage } from '../../storage'
import type { BackendRuntime } from '../../runtime'
import { createMediaService } from '../media'
import { createPrismaFamilyAccess } from '../families'
import { createMaxAcceptUpdate } from './application/accept-update'
import type { MaxApiPort, MaxInboundEvent, MaxResolvedMessage } from './application/ports'
import { createMaxPayloadCrypto } from './infrastructure/payload-crypto'
import { createMaxTaskProcessor } from './infrastructure/process-task'
import { PrismaMaxRepository } from './infrastructure/prisma-max-repository'
import { normalizeMaxUpdate } from './transport/update-mapping'
import { pngFixture } from '../../storage/storage-contract'
import { MaxProviderError } from './infrastructure/max-api'
import { chooseMaxTarget } from './infrastructure/source-target'
import { createMaxChannelOnboarding } from './application/channel-onboarding'
import { createMaxResponseDelivery } from './infrastructure/deliver-response'
import { choicePayload } from '../../bot-family-target'
import { MaxChannelProviderError } from './application/channel-protocol'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('MAX forward import integration', () => {
  const prisma = createPrisma(databaseUrl!)
  const encryptionKey = Buffer.alloc(32, 21).toString('base64url')
  const crypto = createMaxPayloadCrypto(encryptionKey)
  const repository = new PrismaMaxRepository(prisma)
  const accept = createMaxAcceptUpdate({ botId: '900', repository, encrypt: crypto.encrypt })
  const roots = new Set<string>()
  const channelId = -79560265048692n

  beforeEach(async () => {
    await prisma.maxOutgoingResponse.deleteMany()
    await prisma.maxSource.deleteMany()
    await prisma.maxInbox.deleteMany()
    await prisma.maxChannelBinding.deleteMany()
    await prisma.taskOutbox.deleteMany()
    await prisma.memoryMedia.deleteMany()
    await prisma.memory.deleteMany()
    await prisma.mediaAsset.deleteMany()
    await prisma.child.deleteMany()
    await prisma.family.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.user.deleteMany()
  })
  afterEach(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true })
    roots.clear()
  })
  afterAll(async () => { await prisma.$disconnect() })

  test('recovers an unbound channel through consent before importing the forwarded video once', async () => {
    const fixture = await familyFixture('7001', 'forward-video')
    await prisma.family.update({ where: { id: fixture.familyId }, data: { maxBackupChatId: null } })
    await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: null, state: 'connected' } })
    const outerDate = Date.parse('2026-10-02T10:00:00.000Z')
    const originalDate = Date.parse('2026-05-16T12:13:14.000Z')
    const original: MaxResolvedMessage = {
      messageId: 'original-mid-synthetic', senderId: '0', recipientId: channelId.toString(), recipientType: 'channel',
      text: 'Synthetic forwarded video caption', timestamp: originalDate,
      attachments: [{ kind: 'video', providerAttachmentId: '456', currentToken: 'original-rotating-token', inboundDurationSeconds: 29, width: 640, height: 360 }],
    }
    const update = forwardedUpdate(outerDate)
    const event = normalizeMaxUpdate(update)
    if (event.kind !== 'message_created') throw new Error('Expected synthetic forwarded video event')
    const accepted = await accept(event)
    const sourceBefore = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId }, include: { attachments: true } })
    expect(sourceBefore.attachments).toHaveLength(0)
    expect(sourceBefore.senderSubject).toBe('7001')
    expect(sourceBefore.messageId).toBe('outer-mid-synthetic')
    expect((await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: accepted.inboxId } })).text).toBe('Получено. Импортируем публикацию…')

    const messageLookups: string[] = []
    const videoTokens: string[] = []
    const api = apiFor(async (messageId) => {
      messageLookups.push(messageId)
      return original
    }, { getVideo: async (token) => {
      videoTokens.push(token)
      return { width: 640, height: 360, durationMs: 29_000, renditions: [
        { url: 'https://maxvd123.okcdn.ru/synthetic.mp4', width: 640, height: 360, contentLength: 4 },
      ] }
    } })
    const onboarding = createMaxChannelOnboarding({ prisma, verifyChannel: async () => ({ title: 'Synthetic channel' }), verifyActorAdmin: async () => true })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api, offerActorChannelConnection: onboarding.offerActorChannelConnection,
      processChannelCallback: onboarding.processCallback })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')

    expect(await prisma.maxSource.findUniqueOrThrow({ where: { id: sourceBefore.id } })).toMatchObject({ status: 'denied' })
    const decision = await prisma.maxChannelDecision.findFirstOrThrow({ where: { originInboxId: accepted.inboxId } })
    expect(decision.actorSubject).toBe('7001')
    const sent: unknown[] = []
    const deliverResponse = createMaxResponseDelivery({ prisma, api: apiFor(async () => original, { sendMessage: async (input) => { sent.push(input) } }) })
    const response = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: accepted.inboxId, channelDecisionId: decision.id } })
    await expect(deliverResponse({ responseId: response.id })).resolves.toBe('done')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ buttons: [
      { type: 'callback', payload: `max_channel:${decision.id}:connect:0` },
      { type: 'callback', payload: `max_channel:${decision.id}:cancel:0` },
    ] })
    const callbackInbox = await prisma.maxInbox.create({ data: { eventKey: `recovery-callback-${decision.id}`, botId: 900n,
      eventKind: 'family_choice', encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } })
    expect(await onboarding.processCallback(callbackInbox.id, { userId: '7001', callbackId: 'callback', payload: `max_channel:${decision.id}:connect:0` })).toBe(true)

    const retry = await accept(forwardEvent('7001', 'outer-mid-retry', 'original-mid-synthetic'))
    await expect(processor({ inboxId: retry.inboxId })).resolves.toBe('done')
    const duplicate = await accept(forwardEvent('7001', 'outer-mid-duplicate-retry', 'original-mid-synthetic'))
    await expect(processor({ inboxId: duplicate.inboxId })).resolves.toBe('done')

    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: retry.inboxId } })
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId } })
    const reference = await prisma.maxVideoReference.findUniqueOrThrow({ where: { sourceId: source.id } })
    expect(messageLookups).toEqual(['original-mid-synthetic', 'outer-mid-synthetic', 'original-mid-synthetic', 'original-mid-synthetic'])
    expect(videoTokens).toEqual(['original-rotating-token'])
    expect(source).toMatchObject({ status: 'published', senderSubject: '7001', messageId: 'outer-mid-retry',
      originalMessageId: 'original-mid-synthetic', originalChannelId: channelId, familyId: fixture.familyId })
    expect(memory).toMatchObject({ authorId: fixture.userId, familyId: fixture.familyId, childId: fixture.childId,
      body: 'Synthetic forwarded video caption', kind: 'video', occurredAt: new Date(originalDate), sourcePublishedAt: new Date(originalDate) })
    expect(reference).toMatchObject({ sourceId: source.id, providerAttachmentId: '456', attachmentPosition: 0 })
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:backup-media' } })).toBe(0)
    expect(await prisma.maxSourceAttachment.count()).toBe(0)
    expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: retry.inboxId, kind: 'saved' } })).toBe(1)
  })

  test('serializes concurrent different actors importing one original to one Memory', async () => {
    const fixture = await familyFixture('7002', 'forward-race')
    const secondActor = await prisma.user.create({ data: { displayName: 'Synthetic second importer' } })
    await prisma.externalIdentity.create({ data: { userId: secondActor.id, provider: 'max', subject: '7003' } })
    await prisma.familyMember.create({ data: { familyId: fixture.familyId, userId: secondActor.id, role: 'full' } })
    const first = await accept(forwardEvent('7002', 'outer-forward-a', 'shared-original'))
    const second = await accept(forwardEvent('7003', 'outer-forward-b', 'shared-original'))
    let enterDownload!: () => void
    let releaseDownload!: () => void
    const downloadStarted = new Promise<void>((resolve) => { enterDownload = resolve })
    const downloadGate = new Promise<void>((resolve) => { releaseDownload = resolve })
    const original = { ...originalText('shared-original', channelId, Date.parse('2024-02-01T01:02:03.000Z'), 'One canonical copy'),
      attachments: [{ kind: 'image' as const, providerAttachmentId: 'race-photo-1', url: 'https://i.oneme.ru/race-photo' }] }
    const process = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async () => original), media: fixture.media,
      download: async () => {
        enterDownload()
        await downloadGate
        return { bytes: pngFixture, contentType: 'image/png', contentLength: pngFixture.byteLength }
      } })
    const firstAttempt = process({ inboxId: first.inboxId })
    await downloadStarted
    await expect(process({ inboxId: second.inboxId })).rejects.toMatchObject({ name: 'MaxProviderError', retryable: true, code: 'forward_claim_pending' })
    releaseDownload()
    await expect(firstAttempt).resolves.toBe('done')
    await expect(process({ inboxId: second.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.mediaAsset.count({ where: { sourceKind: 'max', deletedAt: null } })).toBe(1)
    expect(await prisma.memoryMedia.count()).toBe(1)
    expect(await prisma.maxSource.count({ where: { status: 'published' } })).toBe(1)
    expect(await prisma.maxOutgoingResponse.count({ where: { kind: 'saved' } })).toBe(2)
    expect(await prisma.maxSource.count({ where: { rejectionCode: 'duplicate' } })).toBe(1)
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
  })

  test('routes photo albums, mixed media, and native voice through the existing processors', async () => {
    const fixture = await familyFixture('7005', 'forward-media')
    const originalTime = Date.parse('2025-06-07T08:09:10.000Z')
    const audio = await oggVoiceFixture()
    const video = await mp4VideoFixture()
    try {
      const cases: Array<{ messageId: string; text: string; attachments: MaxResolvedMessage['attachments'] }> = [
        { messageId: 'forward-album-original', text: 'Original album caption', attachments: [
          { kind: 'image', providerAttachmentId: '701', url: 'https://i.oneme.ru/photo-701' },
          { kind: 'image', providerAttachmentId: '702', url: 'https://i.oneme.ru/photo-702' },
        ] },
        { messageId: 'forward-voice-original', text: 'Original voice caption', attachments: [
          { kind: 'voice', providerAttachmentId: 'voice-703', url: 'https://i.oneme.ru/voice-703' },
        ] },
        { messageId: 'forward-mixed-original', text: 'Original mixed caption', attachments: [
          { kind: 'image', providerAttachmentId: '704', url: 'https://i.oneme.ru/photo-704' },
          { kind: 'video', providerAttachmentId: '705', currentToken: 'mixed-rotating-token', inboundDurationSeconds: 1, width: 320, height: 240 },
        ] },
      ]
      for (const [index, item] of cases.entries()) {
        const accepted = await accept(forwardEvent('7005', `outer-media-${index}`, item.messageId))
        const resolved: MaxResolvedMessage = { messageId: item.messageId, senderId: '0', recipientId: channelId.toString(),
          recipientType: 'channel', text: item.text, timestamp: originalTime + index, attachments: item.attachments }
        const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, media: fixture.media,
          api: apiFor(async () => resolved, { getVideo: async () => ({ width: 320, height: 240, durationMs: 1_000,
            renditions: [{ url: 'https://maxvd123.okcdn.ru/forward-mixed.mp4', width: 320, height: 240, contentLength: video.bytes.byteLength }] }) }),
          download: async (url) => url.includes('voice-703')
            ? { bytes: audio.bytes, contentType: 'audio/ogg', contentLength: audio.bytes.byteLength }
            : { bytes: pngFixture, contentType: 'image/png', contentLength: pngFixture.byteLength },
          videoDownload: async () => videoStream(video.bytes),
        })
        await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
        const memory = await prisma.memory.findFirstOrThrow({ where: { familyId: fixture.familyId, body: item.text },
          include: { media: { orderBy: { position: 'asc' }, include: { asset: true } } } })
        expect(memory.occurredAt).toEqual(new Date(originalTime + index))
        expect(memory.media.map((entry) => entry.asset.mediaKind)).toEqual(index === 0 ? ['photo', 'photo'] : index === 1 ? ['voice'] : ['photo', 'video'])
        expect(memory.media.map(({ position }) => position)).toEqual(memory.media.map((_, position) => position))
        if (index === 0) {
          const canonicalSource = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId }, include: { attachments: { orderBy: { position: 'asc' } } } })
          expect(canonicalSource.attachments.map((row) => row.providerAttachmentId)).toEqual(['701', '702'])
          expect(memory.media.map((entry) => entry.asset.id)).toEqual(canonicalSource.attachments.map((row) => row.plannedMediaId))
          expect(memory.media.map((entry) => entry.asset.sourceKind)).toEqual(['max', 'max'])

          const beforeDuplicate = {
            memories: await prisma.memory.count({ where: { familyId: fixture.familyId } }),
            assets: await prisma.mediaAsset.count({ where: { familyId: fixture.familyId, deletedAt: null } }),
            links: await prisma.memoryMedia.count(),
          }
          const duplicate = await accept(forwardEvent('7005', 'outer-media-album-duplicate', item.messageId))
          await expect(processor({ inboxId: duplicate.inboxId })).resolves.toBe('done')
          expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: duplicate.inboxId } })).toMatchObject({ status: 'denied', rejectionCode: 'duplicate' })
          expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: duplicate.inboxId, kind: 'saved' } })).toBe(1)
          expect(await prisma.memory.count({ where: { familyId: fixture.familyId } })).toBe(beforeDuplicate.memories)
          expect(await prisma.mediaAsset.count({ where: { familyId: fixture.familyId, deletedAt: null } })).toBe(beforeDuplicate.assets)
          expect(await prisma.memoryMedia.count()).toBe(beforeDuplicate.links)
        }
      }
      expect(await prisma.memory.count({ where: { familyId: fixture.familyId } })).toBe(3)
      expect(await prisma.maxMemoryBackup.count()).toBe(0)
      expect(await prisma.taskOutbox.count({ where: { type: 'max:backup-media' } })).toBe(0)
    } finally {
      await audio.cleanup()
      await video.cleanup()
      await fixture.cleanup()
    }
  })

  test('reuses the canonical staged media identity after a transient download failure', async () => {
    const fixture = await familyFixture('7006', 'forward-media-retry')
    const accepted = await accept(forwardEvent('7006', 'outer-media-retry', 'original-photo-retry'))
    const original: MaxResolvedMessage = { messageId: 'original-photo-retry', senderId: '0', recipientId: channelId.toString(), recipientType: 'channel',
      text: 'Retry caption', timestamp: Date.parse('2024-01-01T00:00:00.000Z'),
      attachments: [{ kind: 'image', providerAttachmentId: '706', url: 'https://i.oneme.ru/photo-706' }] }
    const api = apiFor(async () => original)
    const first = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api, media: fixture.media,
      download: async () => { throw new Error('synthetic temporary storage outage') } })
    await expect(first({ inboxId: accepted.inboxId })).rejects.toThrow('synthetic temporary storage outage')
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId }, include: { attachments: true } })
    expect(source).toMatchObject({ status: 'accepted', originalMessageId: 'original-photo-retry', originalChannelId: channelId })
    const plannedId = source.attachments[0]!.plannedMediaId
    const retry = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api, media: fixture.media,
      download: async () => ({ bytes: pngFixture, contentType: 'image/png', contentLength: pngFixture.byteLength }) })
    await expect(retry({ inboxId: accepted.inboxId })).resolves.toBe('done')
    const completed = await prisma.maxSource.findUniqueOrThrow({ where: { id: source.id }, include: { attachments: true } })
    expect(completed.attachments).toHaveLength(1)
    expect(completed.attachments[0]!.plannedMediaId).toBe(plannedId)
    expect(completed.status).toBe('published')
    expect(await prisma.memory.count()).toBe(1)
  })

  test('keeps a terminal prior owner claim until staged attachment cleanup can run', async () => {
    const fixture = await familyFixture('7016', 'forward-terminal-owner')
    const prior = await accept(forwardEvent('7016', 'outer-prior-owner', 'shared-terminal-original'))
    const photo: MaxResolvedMessage = { messageId: 'shared-terminal-original', senderId: '0', recipientId: channelId.toString(), recipientType: 'channel',
      text: null, timestamp: Date.parse('2024-01-04T00:00:00.000Z'),
      attachments: [{ kind: 'image', providerAttachmentId: 'terminal-photo', url: 'https://i.oneme.ru/terminal-photo' }] }
    const first = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async () => photo), media: fixture.media,
      download: async () => { throw new Error('synthetic temporary storage outage') } })
    await expect(first({ inboxId: prior.inboxId })).rejects.toThrow('synthetic temporary storage outage')
    const priorSource = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: prior.inboxId } })
    expect(priorSource.originalChannelId).toBe(channelId)
    await prisma.maxSource.update({ where: { id: priorSource.id }, data: { status: 'denied', rejectionCode: 'denied' } })

    const retry = await accept(forwardEvent('7016', 'outer-new-owner', 'shared-terminal-original'))
    const text = originalText('shared-terminal-original', channelId, Date.parse('2024-01-04T00:00:00.000Z'), 'New owner after cleanup')
    const withoutMedia = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async () => text) })
    await expect(withoutMedia({ inboxId: retry.inboxId })).rejects.toMatchObject({ name: 'MaxProviderError', retryable: true, code: 'forward_cleanup_pending' })
    expect((await prisma.maxSource.findUniqueOrThrow({ where: { id: priorSource.id } })).originalChannelId).toBe(channelId)
    const withMedia = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async () => text), media: fixture.media })
    await expect(withMedia({ inboxId: retry.inboxId })).resolves.toBe('done')
    expect((await prisma.maxSource.findUniqueOrThrow({ where: { id: priorSource.id } })).originalChannelId).toBeNull()
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: retry.inboxId } })).toMatchObject({ status: 'published', originalMessageId: 'shared-terminal-original' })
  })

  test('allows legacy null source identities and rejects a duplicate canonical Family/channel/message tuple', async () => {
    const fixture = await familyFixture('7017', 'forward-index')
    const first = await accept(forwardEvent('7017', 'outer-index-a', 'same-index-original'))
    const second = await accept(forwardEvent('7017', 'outer-index-b', 'same-index-original'))
    const legacy = await accept({ kind: 'message_created', senderId: '7017', recipientId: '7017',
      messageId: 'legacy-index-source', occurredAt: new Date().toISOString(), text: 'Legacy identity remains null', attachments: [] })
    const a = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: first.inboxId } })
    const b = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: second.inboxId } })
    const old = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: legacy.inboxId } })
    expect(old).toMatchObject({ originalMessageId: null, originalChannelId: null })
    await prisma.maxSource.update({ where: { id: a.id }, data: { familyId: fixture.familyId, originalChannelId: channelId, originalMessageId: 'same-index-original' } })
    await expect((async () => await prisma.maxSource.update({ where: { id: b.id }, data: { familyId: fixture.familyId, originalChannelId: channelId, originalMessageId: 'same-index-original' } }))())
      .rejects.toMatchObject({ code: 'P2002' })
    expect(await prisma.maxSource.count({ where: { originalMessageId: null, originalChannelId: null } })).toBeGreaterThanOrEqual(1)
  })

  test('rolls back publication when the trusted channel binding changes after the original lookup', async () => {
    const fixture = await familyFixture('7007', 'forward-binding-race')
    const accepted = await accept(forwardEvent('7007', 'outer-binding-race', 'original-binding-race'))
    const original: MaxResolvedMessage = { messageId: 'original-binding-race', senderId: '0', recipientId: channelId.toString(), recipientType: 'channel',
      text: 'Caption must roll back', timestamp: Date.parse('2024-01-02T00:00:00.000Z'),
      attachments: [{ kind: 'image', providerAttachmentId: '707', url: 'https://i.oneme.ru/photo-707' }] }
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async () => original), media: fixture.media,
      download: async () => {
        await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: null, state: 'disconnected' } })
        return { bytes: pngFixture, contentType: 'image/png', contentLength: pngFixture.byteLength }
      } })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    const abandoned = await prisma.mediaAsset.findMany({ where: { sourceKind: 'max' }, select: { deletedAt: true } })
    expect(abandoned.length).toBeGreaterThan(0)
    expect(abandoned.every((asset) => asset.deletedAt !== null)).toBe(true)
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBeGreaterThan(0)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })).toMatchObject({ status: 'denied' })
  })

  test('requires full Family access and gives a safe unavailable-original response', async () => {
    const fixture = await familyFixture('7008', 'forward-acl')
    const viewer = await prisma.user.create({ data: { displayName: 'Synthetic viewer' } })
    await prisma.externalIdentity.create({ data: { userId: viewer.id, provider: 'max', subject: '7009' } })
    await prisma.familyMember.create({ data: { familyId: fixture.familyId, userId: viewer.id, role: 'viewer' } })
    const viewOnlyEvent = forwardEvent('7009', 'outer-viewer-forward', 'original-viewer-forward')
    viewOnlyEvent.forwardedFrom = { messageId: 'original-viewer-forward', attachments: [{ kind: 'video', providerAttachmentId: 'synthetic-envelope-video',
      durationSeconds: null, width: null, height: null }] }
    const viewOnly = await accept(viewOnlyEvent)
    let lookups = 0
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async () => {
      lookups += 1
      throw new MaxProviderError(undefined, false, 404, 'message_not_found')
    }) })
    await expect(processor({ inboxId: viewOnly.inboxId })).resolves.toBe('done')
    expect(lookups).toBe(0)
    const denied = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: viewOnly.inboxId, kind: 'denied' } })
    expect(denied.text).toBe('Не удалось сохранить это сообщение в memoLy.')
    const revoked = await prisma.user.create({ data: { displayName: 'Synthetic revoked member' } })
    await prisma.externalIdentity.create({ data: { userId: revoked.id, provider: 'max', subject: '7012' } })
    await prisma.familyMember.create({ data: { familyId: fixture.familyId, userId: revoked.id, role: 'full', revokedAt: new Date() } })
    const revokedEvent = forwardEvent('7012', 'outer-revoked-forward', 'original-revoked-forward')
    revokedEvent.forwardedFrom = { messageId: 'original-revoked-forward', attachments: [{ kind: 'video', providerAttachmentId: 'synthetic-envelope-video',
      durationSeconds: null, width: null, height: null }] }
    const revokedForward = await accept(revokedEvent)
    await expect(processor({ inboxId: revokedForward.inboxId })).resolves.toBe('done')
    expect(lookups).toBe(0)
  })

  test('reports an unavailable original without exposing provider details', async () => {
    const fixture = await familyFixture('7010', 'forward-unavailable')
    const accepted = await accept(forwardEvent('7010', 'outer-unavailable', 'original-unavailable'))
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async () => {
      throw new MaxProviderError(undefined, false, 404, 'message_not_found')
    }) })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    const response = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: accepted.inboxId, kind: 'denied' } })
    expect(response.text).toBe('Не удалось сохранить это сообщение в memoLy.')
    expect(response.text).not.toContain('message_not_found')
    expect(response.text).not.toContain('original-unavailable')
    expect(await prisma.memory.count()).toBe(0)
  })

  test('imports video from a provider-confirmed outer forward envelope when the private original is unavailable', async () => {
    const fixture = await familyFixture('7018', 'forward-envelope-video')
    const accepted = await accept(forwardEvent('7018', 'outer-envelope-video', 'private-original-404'))
    const sourceTime = Date.parse('2025-06-07T08:09:10.000Z')
    const media = { kind: 'video' as const, providerAttachmentId: 'envelope-video-id', currentToken: 'confirmed-envelope-token',
      inboundDurationSeconds: 2, width: 320, height: 240 }
    const calls: string[] = []
    const api = apiFor(async (messageId) => {
      calls.push(messageId)
      if (messageId === 'private-original-404') throw new MaxProviderError(undefined, false, 404, 'message_not_found')
      return { messageId, senderId: '7018', recipientId: '900', recipientType: 'dialog', timestamp: Date.now(),
        forwardedFrom: { messageId: 'private-original-404', timestamp: sourceTime }, attachments: [], forwardedAttachments: [media] }
    }, { getVideo: async (token) => {
      expect(token).toBe('confirmed-envelope-token')
      return { width: 320, height: 240, durationMs: 2_000,
        renditions: [{ url: 'https://maxvd123.okcdn.ru/envelope-video.mp4', width: 320, height: 240, contentLength: 4 }] }
    } })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId } })
    expect(source).toMatchObject({ status: 'published', senderSubject: '7018', userId: fixture.userId, familyId: fixture.familyId,
      originalMessageId: 'private-original-404', originalChannelId: null })
    expect(memory).toMatchObject({ authorId: fixture.userId, familyId: fixture.familyId, kind: 'video',
      occurredAt: new Date(sourceTime), sourcePublishedAt: new Date(sourceTime) })
    expect(calls).toEqual(['private-original-404', 'outer-envelope-video'])
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:backup-media' } })).toBe(0)
    expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: accepted.inboxId, kind: 'saved' } })).toBe(1)
    const repeated = await accept(forwardEvent('7018', 'outer-envelope-video-again', 'private-original-404'))
    await expect(processor({ inboxId: repeated.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: repeated.inboxId } })).toMatchObject({ status: 'denied', rejectionCode: 'duplicate' })
  })

  test('imports outer-envelope images as the authenticated sender and deduplicates repeated forwards', async () => {
    const fixture = await familyFixture('7019', 'forward-envelope-image')
    const photo = { kind: 'image' as const, providerAttachmentId: 'envelope-photo-id', url: 'https://i.oneme.ru/envelope-photo' }
    const api = apiFor(async (messageId) => {
      if (messageId === 'private-image-original') throw new MaxProviderError(undefined, false, 404, 'message_not_found')
      return { messageId, senderId: '7019', recipientId: '900', recipientType: 'dialog',
        forwardedFrom: { messageId: 'private-image-original', timestamp: Date.now() + 10 * 60_000 }, attachments: [], forwardedAttachments: [photo] }
    })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api, media: fixture.media,
      download: async () => ({ bytes: pngFixture, contentType: 'image/png', contentLength: pngFixture.byteLength }) })
    const first = await accept(forwardEvent('7019', 'outer-envelope-image', 'private-image-original'))
    await expect(processor({ inboxId: first.inboxId })).resolves.toBe('done')
    const duplicate = await accept(forwardEvent('7019', 'outer-envelope-image-again', 'private-image-original'))
    await expect(processor({ inboxId: duplicate.inboxId })).resolves.toBe('done')
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: first.inboxId } })
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId } })
    const inbox = await prisma.maxInbox.findUniqueOrThrow({ where: { id: first.inboxId } })
    expect(memory).toMatchObject({ authorId: fixture.userId, familyId: fixture.familyId, kind: 'photo' })
    expect(memory.occurredAt).toEqual(inbox.receivedAt)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: duplicate.inboxId } })).toMatchObject({ status: 'denied', rejectionCode: 'duplicate' })
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:backup-media' } })).toBe(0)
  })

  test('rejects envelope media when provider re-fetch does not confirm the authenticated forward identity', async () => {
    const fixture = await familyFixture('7020', 'forward-envelope-forged')
    const accepted = await accept(forwardEvent('7020', 'outer-envelope-forged', 'private-original-expected'))
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async (messageId) => {
      if (messageId === 'private-original-expected') throw new MaxProviderError(undefined, false, 404, 'message_not_found')
      return { messageId, senderId: '9999', recipientId: '900', recipientType: 'dialog',
        forwardedFrom: { messageId: 'some-other-original' }, attachments: [],
        forwardedAttachments: [{ kind: 'video', providerAttachmentId: 'forged-id', currentToken: 'forged-token', inboundDurationSeconds: null, width: null, height: null }] }
    }, { getVideo: async () => { throw new Error('unconfirmed envelope must not fetch media') } }) })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })).toMatchObject({ status: 'denied' })
    expect((await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: accepted.inboxId, kind: 'denied' } })).text)
      .toBe('Не удалось сохранить это сообщение в memoLy.')
  })

  test('fails safely when the confirmed outer video token cannot resolve to validated media', async () => {
    const fixture = await familyFixture('7021', 'forward-envelope-unusable-video')
    const accepted = await accept(forwardEvent('7021', 'outer-envelope-unusable-video', 'private-video-unusable'))
    const video = { kind: 'video' as const, providerAttachmentId: 'unusable-video-id', currentToken: 'unusable-token',
      inboundDurationSeconds: null, width: null, height: null }
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async (messageId) => {
      if (messageId === 'private-video-unusable') throw new MaxProviderError(undefined, false, 404, 'message_not_found')
      return { messageId, senderId: '7021', recipientId: '900', recipientType: 'dialog',
        forwardedFrom: { messageId: 'private-video-unusable' }, attachments: [], forwardedAttachments: [video] }
    }, { getVideo: async () => { throw new MaxProviderError(undefined, false, 404, 'video_not_found') } }) })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })).toMatchObject({ status: 'unsupported_media' })
    expect(await prisma.maxMemoryBackup.count()).toBe(0)

    const invalidRendition = await accept(forwardEvent('7021', 'outer-envelope-invalid-rendition', 'private-video-invalid-rendition'))
    const invalidApi = apiFor(async (messageId) => messageId === 'private-video-invalid-rendition'
      ? Promise.reject(new MaxProviderError(undefined, false, 404, 'message_not_found'))
      : { messageId, senderId: '7021', recipientId: '900', recipientType: 'dialog',
        forwardedFrom: { messageId: 'private-video-invalid-rendition' }, attachments: [], forwardedAttachments: [video] },
    { getVideo: async () => ({ width: 320, height: 240, durationMs: 1_000,
      renditions: [{ url: 'https://evil.example.invalid/video.mp4', width: 320, height: 240, contentLength: 4 }] }) })
    await expect(createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: invalidApi })({ inboxId: invalidRendition.inboxId })).resolves.toBe('done')
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: invalidRendition.inboxId } })).toMatchObject({ status: 'unsupported_media' })
    expect(await prisma.memory.count()).toBe(0)
  })

  test('uses envelope media when an accessible original belongs to an unbound foreign channel', async () => {
    const fixture = await familyFixture('7022', 'forward-envelope-foreign-channel')
    const accepted = await accept(forwardEvent('7022', 'outer-envelope-foreign', 'foreign-channel-original'))
    const outerVideo = { kind: 'video' as const, providerAttachmentId: 'foreign-envelope-video', currentToken: 'foreign-envelope-token',
      inboundDurationSeconds: 1, width: 320, height: 240 }
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async (messageId) => messageId === 'foreign-channel-original'
      ? { messageId, senderId: '0', recipientId: '-123987', recipientType: 'channel', timestamp: Date.now(), attachments: [] }
      : { messageId, senderId: '7022', recipientId: '900', recipientType: 'dialog', forwardedFrom: { messageId: 'foreign-channel-original' },
        attachments: [], forwardedAttachments: [outerVideo] }, { getVideo: async () => ({ width: 320, height: 240, durationMs: 1_000,
      renditions: [{ url: 'https://maxvd123.okcdn.ru/foreign-envelope.mp4', width: 320, height: 240, contentLength: 4 }] }) }) })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
    const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId } })
    expect(source).toMatchObject({ status: 'published', originalMessageId: 'foreign-channel-original', originalChannelId: null })
    expect(memory).toMatchObject({ authorId: fixture.userId, familyId: fixture.familyId, kind: 'video' })
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
  })

  test('serializes concurrent repeated envelope forwards into one Memory', async () => {
    const fixture = await familyFixture('7023', 'forward-envelope-race')
    const media = { kind: 'image' as const, providerAttachmentId: 'race-envelope-photo', url: 'https://i.oneme.ru/race-envelope-photo' }
    const api = apiFor(async (messageId) => {
      if (messageId === 'race-private-original') throw new MaxProviderError(undefined, false, 404, 'message_not_found')
      return { messageId, senderId: '7023', recipientId: '900', recipientType: 'dialog',
        forwardedFrom: { messageId: 'race-private-original' }, attachments: [], forwardedAttachments: [media] }
    })
    const first = await accept(forwardEvent('7023', 'race-outer-one', 'race-private-original'))
    const second = await accept(forwardEvent('7023', 'race-outer-two', 'race-private-original'))
    let downloadStarted!: () => void
    let releaseDownload!: () => void
    const started = new Promise<void>((resolve) => { downloadStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseDownload = resolve })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api, media: fixture.media, download: async () => {
      downloadStarted()
      await gate
      return { bytes: pngFixture, contentType: 'image/png', contentLength: pngFixture.byteLength }
    } })
    const running = processor({ inboxId: first.inboxId })
    const firstStatus = running.then(() => 'completed' as const, () => 'failed' as const)
    let concurrent: Promise<'done' | 'skipped'> | undefined
    let startStatus: 'download-started' | 'completed' | 'failed' | 'timed-out' = 'timed-out'
    let concurrentResult: unknown = 'not-started'
    try {
      startStatus = await Promise.race([started.then(() => 'download-started' as const), firstStatus,
        Bun.sleep(5_000).then(() => 'timed-out' as const)])
      if (startStatus === 'download-started') {
        concurrent = processor({ inboxId: second.inboxId })
        concurrentResult = await Promise.race([concurrent.then(() => 'completed' as const, (error) => error),
          Bun.sleep(5_000).then(() => 'timed-out' as const)])
      }
    } finally {
      releaseDownload()
      await Promise.allSettled([running, ...(concurrent ? [concurrent] : [])])
    }
    expect(startStatus).toBe('download-started')
    expect(concurrentResult).toMatchObject({ retryable: true, code: 'envelope_claim_pending' })
    await expect(running).resolves.toBe('done')
    await expect(processor({ inboxId: second.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: second.inboxId } })).toMatchObject({ status: 'denied', rejectionCode: 'duplicate' })
  })

  test('keeps distinct original message IDs independent within the same Family and channel', async () => {
    const fixture = await familyFixture('7013', 'forward-distinct')
    const first = await accept(forwardEvent('7013', 'outer-distinct-a', 'original-distinct-a'))
    const second = await accept(forwardEvent('7013', 'outer-distinct-b', 'original-distinct-b'))
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async (messageId) =>
      originalText(messageId, channelId, Date.parse('2024-01-01T00:00:00.000Z'), `Caption ${messageId}`)) })
    await expect(processor({ inboxId: first.inboxId })).resolves.toBe('done')
    await expect(processor({ inboxId: second.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(2)
    expect(await prisma.maxSource.count({ where: { status: 'published' } })).toBe(2)
  })

  test('prevents reimport after a matching live channel source even if its Memory was deleted', async () => {
    const fixture = await familyFixture('7014', 'forward-live-dedupe')
    await prisma.family.update({ where: { id: fixture.familyId }, data: { maxBackupChatId: channelId } })
    const live = await accept({ kind: 'message_created', isChannel: true, senderId: '0', recipientId: channelId.toString(),
      messageId: 'original-live-published', occurredAt: '2024-03-01T00:00:00.000Z', text: 'Live channel caption', attachments: [] })
    const api = apiFor(async (messageId) => originalText(messageId, channelId, Date.parse('2024-03-01T00:00:00.000Z'), 'Live channel caption'))
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api })
    await expect(processor({ inboxId: live.inboxId })).resolves.toBe('done')
    const liveSource = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: live.inboxId } })
    await prisma.memory.delete({ where: { id: liveSource.memoryId! } })
    const forwarded = await accept(forwardEvent('7014', 'outer-live-forward', 'original-live-published'))
    await expect(processor({ inboxId: forwarded.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: forwarded.inboxId } })).toMatchObject({ rejectionCode: 'duplicate' })
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:backup-media' } })).toBe(0)
  })

  test('publishes into the explicitly selected matching Family without leaking into another Family', async () => {
    const fixture = await familyFixture('7015', 'forward-choice-a')
    const secondOwner = await prisma.user.create({ data: { displayName: 'Synthetic second family owner' } })
    const secondFamily = await prisma.$transaction(async (tx) => {
      const family = await tx.family.create({ data: { ownerUserId: secondOwner.id, name: 'Synthetic second family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: family.id, userId: secondOwner.id, role: 'full' } })
      await tx.familyMember.create({ data: { familyId: family.id, userId: fixture.userId, role: 'full' } })
      await tx.child.create({ data: { familyId: family.id, displayName: 'Second child' } })
      return family
    })
    await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: secondFamily.id, state: 'connected' } })
    const accepted = await accept(forwardEvent('7015', 'outer-family-choice', 'original-family-choice'))
    const occurredAt = new Date('2024-03-02T00:00:00.000Z')
    let lookups = 0
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async (messageId) => {
      lookups += 1
      return originalText(messageId, channelId, occurredAt.getTime(), 'Chosen family caption')
    }) })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(lookups).toBe(0)
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
    const candidates = source.choiceCandidates as Array<{ familyId: string }>
    const selectedFamilyIndex = candidates.findIndex((candidate) => candidate.familyId === secondFamily.id)
    expect(selectedFamilyIndex).not.toBe(-1)
    await expect(chooseMaxTarget(prisma, source.id, selectedFamilyIndex, '7015')).resolves.toBe('chosen')
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(lookups).toBe(1)
    const memory = await prisma.memory.findFirstOrThrow({ where: { familyId: secondFamily.id, body: 'Chosen family caption' } })
    expect(memory).toMatchObject({ familyId: secondFamily.id, authorId: fixture.userId, kind: 'note', body: 'Chosen family caption',
      occurredAt, sourcePublishedAt: occurredAt })
    expect(await prisma.memory.count({ where: { familyId: fixture.familyId } })).toBe(0)
    expect(await prisma.memory.count({ where: { familyId: secondFamily.id } })).toBe(1)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { id: source.id } })).toMatchObject({ status: 'published', familyId: secondFamily.id, userId: fixture.userId })
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:backup-media' } })).toBe(0)

    await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: fixture.familyId, state: 'connected' } })
    const wrongFamilyForward = await accept(forwardEvent('7015', 'outer-family-choice-wrong', 'original-family-choice'))
    await expect(processor({ inboxId: wrongFamilyForward.inboxId })).resolves.toBe('done')
    const wrongSource = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: wrongFamilyForward.inboxId } })
    const wrongCandidates = wrongSource.choiceCandidates as Array<{ familyId: string }>
    const wrongFamilyIndex = wrongCandidates.findIndex((candidate) => candidate.familyId === secondFamily.id)
    expect(wrongFamilyIndex).not.toBe(-1)
    await expect(chooseMaxTarget(prisma, wrongSource.id, wrongFamilyIndex, '7015')).resolves.toBe('chosen')
    await expect(processor({ inboxId: wrongFamilyForward.inboxId })).resolves.toBe('done')
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { id: wrongSource.id } })).toMatchObject({ status: 'denied', familyId: secondFamily.id })
    expect(await prisma.memory.count()).toBe(1)
    expect(await prisma.memory.count({ where: { familyId: secondFamily.id } })).toBe(1)
    expect(await prisma.memory.count({ where: { familyId: fixture.familyId } })).toBe(0)
  })

  test('denies a forwarded original whose authenticated recipient does not match the Family channel binding', async () => {
    const fixture = await familyFixture('7004', 'forward-wrong-family')
    const accepted = await accept(forwardEvent('7004', 'outer-forward-foreign', 'foreign-original'))
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async (messageId) => ({
      ...originalText(messageId, channelId, Date.now(), 'Synthetic foreign content'), recipientId: '-900000000000001',
    })) })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })).toMatchObject({ status: 'denied' })
  })

  test('keeps the already-bound forwarded video import path working', async () => {
    const fixture = await familyFixture('7005', 'forward-bound-video')
    const originalDate = Date.parse('2026-05-16T12:13:14.000Z')
    const original: MaxResolvedMessage = { messageId: 'bound-video-original', senderId: '0', recipientId: channelId.toString(),
      recipientType: 'channel', text: 'Bound video caption', timestamp: originalDate,
      attachments: [{ kind: 'video', providerAttachmentId: 'bound-456', currentToken: 'bound-token', inboundDurationSeconds: 12, width: 640, height: 360 }] }
    const accepted = await accept(forwardEvent('7005', 'bound-video-forward', 'bound-video-original'))
    const api = apiFor(async () => original, { getVideo: async () => ({ width: 640, height: 360, durationMs: 12_000, renditions: [
      { url: 'https://maxvd123.okcdn.ru/bound.mp4', width: 640, height: 360, contentLength: 4 },
    ] }) })
    await expect(createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api })({ inboxId: accepted.inboxId })).resolves.toBe('done')
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
    expect(source).toMatchObject({ status: 'published', originalMessageId: 'bound-video-original', originalChannelId: channelId })
    expect(await prisma.memory.count({ where: { familyId: fixture.familyId, kind: 'video', occurredAt: new Date(originalDate) } })).toBe(1)
  })

  test('offers recovery only after a multi-family sender chooses a family and preserves the source choice', async () => {
    const fixture = await familyFixture('7020', 'forward-multi-family')
    const secondFamily = await prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({ data: { displayName: 'Synthetic second family owner' } })
      const family = await tx.family.create({ data: { ownerUserId: owner.id, name: 'Synthetic selected family', timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: family.id, userId: owner.id, role: 'full' } })
      await tx.familyMember.create({ data: { familyId: family.id, userId: fixture.userId, role: 'full' } })
      await tx.child.create({ data: { familyId: family.id, displayName: 'Selected child' } })
      return family
    })
    await prisma.family.update({ where: { id: fixture.familyId }, data: { maxBackupChatId: null } })
    await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: null, state: 'connected' } })
    const accepted = await accept(forwardEvent('7020', 'outer-multi-family-forward', 'multi-family-original'))
    const onboarding = createMaxChannelOnboarding({ prisma, verifyChannel: async () => ({ title: 'Synthetic channel' }), verifyActorAdmin: async () => true })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto,
      api: apiFor(async (messageId) => originalText(messageId, channelId, Date.parse('2026-05-16T12:13:14.000Z'), 'Multi-family original')),
      offerActorChannelConnection: onboarding.offerActorChannelConnection, processChannelCallback: onboarding.processCallback })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    let source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
    expect(source.familyId).toBeNull()
    expect(await prisma.maxChannelDecision.count()).toBe(0)
    const candidates = source.choiceCandidates as Array<{ familyId: string }>
    const selectedIndex = candidates.findIndex((candidate) => candidate.familyId === secondFamily.id)
    expect(selectedIndex).toBeGreaterThanOrEqual(0)
    const postChoice = async (userId: string, callbackId: string) => {
      const callback = await accept({ kind: 'family_choice', callbackId, payload: choicePayload(source.id, selectedIndex), userId, occurredAt: new Date().toISOString() })
      await expect(processor({ inboxId: callback.inboxId })).resolves.toBe('done')
    }
    await postChoice('7999', 'wrong-family-choice-actor')
    source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
    expect(source.familyId).toBeNull()
    expect(await prisma.maxChannelDecision.count()).toBe(0)
    await postChoice('7020', 'authorized-family-choice-actor')
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
    const sourceChoice = await prisma.maxOutgoingResponse.findUniqueOrThrow({ where: { inboxId_kind: { inboxId: accepted.inboxId, kind: 'family_choice' } } })
    const decision = await prisma.maxChannelDecision.findFirstOrThrow({ where: { originInboxId: accepted.inboxId } })
    const recovery = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: accepted.inboxId, channelDecisionId: decision.id } })
    expect(source).toMatchObject({ familyId: secondFamily.id, childId: expect.any(String) })
    expect(decision).toMatchObject({ phase: 'confirm_actor_connection', selectedFamilyId: secondFamily.id, actorSubject: '7020' })
    expect(recovery.kind).toBe('welcome')
    expect(sourceChoice.kind).toBe('family_choice')
    expect(sourceChoice.id).not.toBe(recovery.id)
    expect(await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).toMatchObject({ maxBackupChatId: null })
    const sent: unknown[] = []
    await expect(createMaxResponseDelivery({ prisma, api: apiFor(async () => originalText('unused', channelId, Date.now(), ''), {
      sendMessage: async (input) => { sent.push(input) },
    }) })({ responseId: recovery.id })).resolves.toBe('done')
    expect(sent[0]).toMatchObject({ buttons: [
      { type: 'callback', payload: `max_channel:${decision.id}:connect:0` },
      { type: 'callback', payload: `max_channel:${decision.id}:cancel:0` },
    ] })
    const recoveryCallback = await accept({ kind: 'family_choice', callbackId: 'selected-family-connect', userId: '7020',
      payload: `max_channel:${decision.id}:connect:0`, occurredAt: new Date().toISOString() })
    await expect(processor({ inboxId: recoveryCallback.inboxId })).resolves.toBe('done')
    expect(await prisma.family.findUniqueOrThrow({ where: { id: secondFamily.id } })).toMatchObject({ maxBackupChatId: channelId })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).toMatchObject({ maxBackupChatId: null })
  })

  test('fails closed when the verified actor is not an administrator of the forwarded channel', async () => {
    const fixture = await familyFixture('7025', 'forward-not-admin')
    await prisma.family.update({ where: { id: fixture.familyId }, data: { maxBackupChatId: null } })
    await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: null, state: 'connected' } })
    const accepted = await accept(forwardEvent('7025', 'outer-not-admin-forward', 'not-admin-original'))
    const onboarding = createMaxChannelOnboarding({ prisma, verifyChannel: async () => ({ title: 'Synthetic channel' }), verifyActorAdmin: async () => false })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto,
      api: apiFor(async (messageId) => originalText(messageId, channelId, Date.parse('2026-05-16T12:13:14.000Z'), 'No authorization')),
      offerActorChannelConnection: onboarding.offerActorChannelConnection })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })).toMatchObject({ status: 'denied' })
    expect(await prisma.maxChannelDecision.count()).toBe(0)
    expect(await prisma.memory.count()).toBe(0)

    const viewer = await prisma.user.create({ data: { displayName: 'Synthetic ordinary channel member' } })
    await prisma.externalIdentity.create({ data: { userId: viewer.id, provider: 'max', subject: '7026' } })
    await prisma.familyMember.create({ data: { familyId: fixture.familyId, userId: viewer.id, role: 'viewer' } })
    const viewerForward = await accept(forwardEvent('7026', 'outer-viewer-forward', 'viewer-original'))
    let adminChecks = 0
    const viewerOnboarding = createMaxChannelOnboarding({ prisma, verifyChannel: async () => ({ title: 'Synthetic channel' }),
      verifyActorAdmin: async () => { adminChecks += 1; return false } })
    const viewerProcessor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto,
      api: apiFor(async (messageId) => originalText(messageId, channelId, Date.parse('2026-05-16T12:13:14.000Z'), 'Viewer cannot connect')),
      offerActorChannelConnection: viewerOnboarding.offerActorChannelConnection })
    await expect(viewerProcessor({ inboxId: viewerForward.inboxId })).resolves.toBe('done')
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: viewerForward.inboxId } })).toMatchObject({ status: 'denied' })
    expect(adminChecks).toBe(0)
    expect(await prisma.maxChannelDecision.count()).toBe(0)
    expect(await prisma.memory.count()).toBe(0)
  })

  test('binds from trusted bot-added provenance after permissions change before importing a forwarded video', async () => {
    const fixture = await familyFixture('7030', 'forward-lifecycle-recovery')
    await prisma.family.update({ where: { id: fixture.familyId }, data: { maxBackupChatId: null } })
    await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: null } })
    const originalDate = Date.parse('2026-05-16T12:13:14.000Z')
    const original: MaxResolvedMessage = { messageId: 'lifecycle-video-original', senderId: '0', recipientId: channelId.toString(),
      recipientType: 'channel', text: 'Lifecycle recovered video', timestamp: originalDate,
      attachments: [{ kind: 'video', providerAttachmentId: 'lifecycle-video-file', currentToken: 'lifecycle-video-token', inboundDurationSeconds: 12, width: 640, height: 360 }] }
    let writable = false
    const onboarding = createMaxChannelOnboarding({ prisma, verifyChannel: async () => {
      if (!writable) throw new MaxChannelProviderError(403)
      return { title: 'Synthetic channel' }
    } })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto,
      api: apiFor(async () => original, { getVideo: async () => ({ width: 640, height: 360, durationMs: 12_000, renditions: [
        { url: 'https://maxvd123.okcdn.ru/lifecycle.mp4', width: 640, height: 360, contentLength: 4 },
      ] }) }), processChannelLifecycle: onboarding.processLifecycle })
    const baseTimestamp = Date.now()
    const botAdded = await accept({ kind: 'bot_added', rawPayload: `{"chat_id":${channelId},"timestamp":${baseTimestamp},"user":{"user_id":7030}}` })
    await expect(processor({ inboxId: botAdded.inboxId })).resolves.toBe('done')
    const provenance = await prisma.maxChannelDecision.findUniqueOrThrow({ where: { originInboxId: botAdded.inboxId } })
    expect(provenance).toMatchObject({ actorSubject: '7030', actorUserId: fixture.userId,
      candidateFamilyIds: [fixture.familyId], phase: 'await_permissions', status: 'pending' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).toMatchObject({ maxBackupChatId: null })

    writable = true
    const permissions = await accept({ kind: 'bot_admin_permissions_changed', rawPayload: `{"chat_id":${channelId},"timestamp":${baseTimestamp + 1}}` })
    await expect(processor({ inboxId: permissions.inboxId })).resolves.toBe('done')
    expect(await prisma.maxChannelDecision.findUniqueOrThrow({ where: { id: provenance.id } })).toMatchObject({ status: 'completed' })
    expect(await prisma.maxChannelBinding.findUniqueOrThrow({ where: { chatId: channelId } })).toMatchObject({ familyId: fixture.familyId, state: 'connected' })
    expect(await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).toMatchObject({ maxBackupChatId: channelId })
    const connectedResponse = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: permissions.inboxId } })
    expect(connectedResponse.text).toContain('подключён')

    const forward = await accept(forwardEvent('7030', 'outer-lifecycle-video-forward', 'lifecycle-video-original'))
    await expect(processor({ inboxId: forward.inboxId })).resolves.toBe('done')
    const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: forward.inboxId } })
    expect(source).toMatchObject({ status: 'published', originalMessageId: 'lifecycle-video-original', originalChannelId: channelId, familyId: fixture.familyId })
    expect(await prisma.memory.count({ where: { familyId: fixture.familyId, kind: 'video', occurredAt: new Date(originalDate), body: 'Lifecycle recovered video' } })).toBe(1)
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
    expect(await prisma.taskOutbox.count({ where: { type: 'max:backup-media' } })).toBe(0)
  })

  test('offers explicit channel recovery for a verified original whose channel is not bound', async () => {
    const fixture = await familyFixture('7014', 'forward-recovery')
    await prisma.family.update({ where: { id: fixture.familyId }, data: { maxBackupChatId: null } })
    await prisma.maxChannelBinding.update({ where: { chatId: channelId }, data: { familyId: null, state: 'connected' } })
    const accepted = await accept(forwardEvent('7014', 'outer-forward-recovery', 'unbound-original'))
    const onboarding = createMaxChannelOnboarding({ prisma, verifyChannel: async () => ({ title: 'Synthetic channel' }), verifyActorAdmin: async () => true })
    const processor = createMaxTaskProcessor({ runtime: fixture.runtime, crypto, api: apiFor(async (messageId) =>
      originalText(messageId, channelId, Date.parse('2025-05-06T07:08:09.000Z'), 'Synthetic original')),
      offerActorChannelConnection: onboarding.offerActorChannelConnection })
    await expect(processor({ inboxId: accepted.inboxId })).resolves.toBe('done')
    expect(await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })).toMatchObject({ status: 'denied' })
    expect(await prisma.maxOutgoingResponse.count({ where: { inboxId: accepted.inboxId, kind: 'denied' } })).toBe(0)
    const decision = await prisma.maxChannelDecision.findFirstOrThrow({ where: { originInboxId: accepted.inboxId } })
    expect(decision).toMatchObject({ phase: 'confirm_actor_connection', actorSubject: '7014', selectedFamilyId: fixture.familyId, status: 'pending' })
    expect(await prisma.memory.count()).toBe(0)
    expect(await prisma.maxMemoryBackup.count()).toBe(0)
    const response = await prisma.maxOutgoingResponse.findFirstOrThrow({ where: { inboxId: accepted.inboxId, channelDecisionId: decision.id } })
    expect(response.buttons).toEqual([
      { text: 'Подключить', payload: `max_channel:${decision.id}:connect:0` },
      { text: 'Отмена', payload: `max_channel:${decision.id}:cancel:0` },
    ])
    const callbackInbox = await prisma.maxInbox.create({ data: { eventKey: `recovery-callback-${decision.id}`, botId: 900n,
      eventKind: 'family_choice', encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } })
    expect(await onboarding.processCallback(callbackInbox.id, { userId: '7014', callbackId: 'callback', payload: `max_channel:${decision.id}:connect:0` })).toBe(true)
    expect(await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } })).toMatchObject({ maxBackupChatId: channelId })
    expect(await prisma.maxChannelDecision.findUniqueOrThrow({ where: { id: decision.id } })).toMatchObject({ status: 'completed' })
  })

  async function familyFixture(subject: string, label: string) {
    const user = await prisma.user.create({ data: { displayName: `Synthetic ${label}` } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } })
    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { ownerUserId: user.id, name: `Synthetic ${label}`, timezone: 'Europe/Moscow' } })
      await tx.familyMember.create({ data: { familyId: created.id, userId: user.id, role: 'full' } })
      return created
    })
    const child = await prisma.child.create({ data: { familyId: family.id, displayName: `${label} child` } })
    await prisma.maxChannelBinding.create({ data: { chatId: channelId, familyId: family.id, state: 'disconnected', title: 'Synthetic channel' } })
    const storageRoot = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? '.', 'max-forward-'))
    roots.add(storageRoot)
    const env = loadEnv({ DATABASE_URL: databaseUrl!, JWT_SECRET: '0123456789abcdef'.repeat(4),
      MAX_ENABLED: 'true', MAX_BOT_TOKEN: 'synthetic-token-only', MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
      MAX_INBOX_ENCRYPTION_KEY: encryptionKey, MAX_WEBHOOK_URL: 'https://api.example.test/webhooks/max',
      MAX_WEBHOOK_SECRET: 'M'.repeat(43), MAX_MINI_APP_URL: 'https://app.example.test', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot })
    const storage = createPrivateStorage(env)
    const media = createMediaService({ db: prisma, env, familyAccess: createPrismaFamilyAccess(prisma), storage: storage.storage })
    return { familyId: family.id, userId: user.id, childId: child.id,
      runtime: { prisma, env, privateStorage: storage } as unknown as BackendRuntime, media,
      cleanup: async () => { await rm(storageRoot, { recursive: true, force: true }); roots.delete(storageRoot) } }
  }
})

function forwardedUpdate(timestamp: number) {
  return { update_type: 'message_created', timestamp, message: {
    sender: { user_id: 7001 }, recipient: { chat_type: 'dialog', chat_id: 900, user_id: 900 },
    body: { mid: 'outer-mid-synthetic', seq: 21, text: 'Outer comment must not publish', attachments: [] },
    link: { type: 'forward', chat_id: -123456, message: { mid: 'original-mid-synthetic', seq: 7, sender: { user_id: 9999 },
      text: 'Nested untrusted caption', attachments: [{ type: 'video', payload: { id: 456, token: 'nested-token', url: 'https://video.example.invalid/nested' }, duration: 29 }] } },
  } }
}

function forwardEvent(senderId: string, messageId: string, originalMessageId: string): Extract<MaxInboundEvent, { kind: 'message_created' }> {
  return { kind: 'message_created', senderId, recipientId: '900', messageId, occurredAt: '2026-10-02T10:00:00.000Z',
    text: null, attachments: [], forwardedFrom: { messageId: originalMessageId } }
}

function originalText(messageId: string, channelId: bigint, timestamp: number, text: string): MaxResolvedMessage {
  return { messageId, senderId: '0', recipientId: channelId.toString(), recipientType: 'channel', timestamp, text, attachments: [] }
}

function apiFor(getMessage: MaxApiPort['getMessage'], rest: Partial<MaxApiPort> = {}): MaxApiPort {
  return {
    getMe: async () => ({ userId: 900, username: 'OurMemoriesMaxBot', isBot: true }), getSubscriptions: async () => [],
    createSubscription: async () => ({ success: true }), deleteSubscription: async () => ({ success: true }), sendMessage: async () => undefined,
    createVideoUpload: async () => ({ url: 'https://upload.example.test/video', token: 'synthetic-upload-token' }),
    sendVideoMessage: async () => ({ messageId: 'synthetic-outbound-message' }), getMessage,
    ...rest,
  }
}

async function mp4VideoFixture() {
  const root = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? '.', 'max-forward-video-'))
  const output = join(root, 'video.mp4')
  const ffmpeg = Bun.spawn([process.env.FFMPEG_PATH ?? 'ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
    'color=c=blue:s=320x240:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', output], { stdout: 'ignore', stderr: 'ignore' })
  if (await ffmpeg.exited !== 0) throw new Error('Could not create the synthetic forward video')
  return { bytes: new Uint8Array(await Bun.file(output).arrayBuffer()), cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function oggVoiceFixture() {
  const root = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? '.', 'max-forward-voice-'))
  const output = join(root, 'voice.ogg')
  const ffmpeg = Bun.spawn([process.env.FFMPEG_PATH ?? 'ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=440:duration=1', '-c:a', 'libopus', '-y', output], { stdout: 'ignore', stderr: 'ignore' })
  if (await ffmpeg.exited !== 0) throw new Error('Could not create the synthetic forward voice')
  return { bytes: new Uint8Array(await Bun.file(output).arrayBuffer()), cleanup: () => rm(root, { recursive: true, force: true }) }
}

function videoStream(bytes: Uint8Array) {
  return { body: new Blob([bytes.slice().buffer as ArrayBuffer]).stream(), contentType: 'video/mp4' as const,
    contentLength: bytes.byteLength, failure: () => null }
}
