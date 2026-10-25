import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { childrenFixtures } from '../../test-support/children-fixtures'
import { createMaxVideoLegacyMigration } from './infrastructure/legacy-video-migration'
import { createAlbumMemorySourceCatalog } from '../memories'
import { FilesystemPrivateStorage } from '../../storage/filesystem-storage'
import { runBackgroundJob } from '../../jobs'
import { createMediaTasks } from '../media'
import type { MaxApiPort } from './application/ports'
import { MaxProviderError } from './infrastructure/max-api'
import { PrismaMemoryRepository } from '../memories'
import { createPrismaIdempotencyExecutor } from '../../idempotency'

describe('MAX legacy video retention and recovery', () => {
  const fx = childrenFixtures()
  const created: Array<{ mediaId: string; memoryId: string; inboxId: string }> = []
  const storageRoots: string[] = []

  afterEach(async () => {
    const items = created.splice(0)
    for (const item of items) {
      await fx.db.maxVideoLegacyRetention.deleteMany({ where: { mediaId: item.mediaId } })
      await fx.db.maxVideoReference.deleteMany({ where: { id: item.mediaId } })
      await fx.db.memory.deleteMany({ where: { id: item.memoryId } })
      await fx.db.maxInbox.deleteMany({ where: { id: item.inboxId } })
    }
    const ownedMediaIds = [...new Set(items.map(({ mediaId }) => mediaId))]
    if (ownedMediaIds.length) {
      await fx.db.$executeRawUnsafe('ALTER TABLE media_assets DISABLE TRIGGER media_assets_protect_retained_max_video')
      try {
        await fx.db.mediaAsset.updateMany({ where: { id: { in: ownedMediaIds } }, data: { legacyVideoRetainedAt: null } })
      } finally {
        await fx.db.$executeRawUnsafe('ALTER TABLE media_assets ENABLE TRIGGER media_assets_protect_retained_max_video')
      }
      await fx.db.mediaAsset.deleteMany({ where: { id: { in: ownedMediaIds } } })
    }
    for (const root of storageRoots.splice(0)) await rm(root, { recursive: true, force: true })
    await fx.cleanup()
  })
  afterAll(async () => { await fx.disconnect() })

  test('retains legacy bytes through tombstone, cleanup and explicit DB-only reference recovery', async () => {
    const family = await fx.family()
    const memory = await fx.memory(family, { kind: 'video' })
    const mediaId = randomUUID()
    const storageRoot = await mkdtemp(join(tmpdir(), 'max-video-legacy-migration-'))
    storageRoots.push(storageRoot)
    const storage = new FilesystemPrivateStorage({ driver: 'filesystem', root: storageRoot, publicBaseUrl: 'http://127.0.0.1',
      signingKey: randomBytes(32), uploadMaxBytes: 10_000, uploadUrlTtlSeconds: 60, downloadUrlTtlSeconds: 60 })
    const inbox = await fx.db.maxInbox.create({ data: {
      eventKey: `legacy-retention-${randomUUID()}`, botId: 1n, eventKind: 'message_created',
      encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]), encryptionAuthTag: new Uint8Array([3]), status: 'processed',
    } })
    created.push({ mediaId, memoryId: memory.id, inboxId: inbox.id })
    const source = await fx.db.maxSource.create({ data: {
      inboxId: inbox.id, botId: 1n, senderSubject: family.owner.subject, recipientId: 1n,
      messageId: `synthetic-${randomUUID()}`, status: 'published', plannedMemoryId: memory.id,
      memoryId: memory.id, familyId: family.id, userId: family.owner.id, childId: family.children[0]!.id,
    } })
    const originalKey = `media-originals/${randomUUID()}`
    const previewKey = `media-preview/${randomUUID()}`
    const playbackKey = `media-playback/${randomUUID()}`
    const asset = await fx.db.mediaAsset.create({ data: {
      id: mediaId, familyId: family.id, uploaderId: family.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'video',
      originalKey, declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'a'.repeat(64),
      byteSize: 3n, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    await storage.writeObject({ key: originalKey, body: new Response(new Uint8Array([0, 1, 2])).body!, contentLength: 3, contentType: 'video/mp4' })
    await storage.writeObject({ key: previewKey, body: new Response(new Uint8Array([3, 4])).body!, contentLength: 2, contentType: 'image/webp' })
    await storage.writeObject({ key: playbackKey, body: new Response(new Uint8Array([5, 6, 7])).body!, contentLength: 3, contentType: 'video/mp4' })
    await fx.db.mediaVariant.createMany({ data: [
      { familyId: family.id, mediaId, variant: 'playback', objectKey: playbackKey, sha256: 'c'.repeat(64), byteSize: 3n, mime: 'video/mp4', width: 640, height: 360 },
      { familyId: family.id, mediaId, variant: 'preview', objectKey: previewKey, sha256: 'b'.repeat(64), byteSize: 2n, mime: 'image/webp', width: 640, height: 360 },
    ] })
    const photoIds = [randomUUID(), randomUUID()]
    for (const [index, photoId] of photoIds.entries()) {
      created.push({ mediaId: photoId, memoryId: memory.id, inboxId: inbox.id })
      await fx.db.mediaAsset.create({ data: {
        id: photoId, familyId: family.id, uploaderId: family.owner.id, sourceKind: 'upload', purpose: 'memory', mediaKind: 'photo',
        originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/webp', verifiedMime: 'image/webp', sha256: `${String(index + 1).repeat(64)}`,
        byteSize: 2n, originalStatus: 'stored', renditionStatus: 'ready',
      } })
      await fx.db.memoryMedia.create({ data: { familyId: family.id, memoryId: memory.id, mediaId: photoId, position: index === 0 ? 0 : 2 } })
    }
    await fx.db.memoryMedia.create({ data: { familyId: family.id, memoryId: memory.id, mediaId, position: 1 } })
    await fx.db.maxSourceAttachment.create({ data: { sourceId: source.id, position: 1, providerKind: 'video', providerAttachmentId: 'video-attachment-1',
      plannedMediaId: mediaId, mediaId, status: 'stored' } })
    const taggedChild = await fx.child(family.id, { name: 'Migration tagged child' })
    await fx.db.memoryChildTag.createMany({ data: [
      { familyId: family.id, memoryId: memory.id, childId: family.children[0]!.id, attachmentId: null, createdBy: family.owner.id },
      { familyId: family.id, memoryId: memory.id, childId: taggedChild.id, attachmentId: mediaId, createdBy: family.owner.id },
    ] })
    await fx.db.memoryComment.create({ data: { familyId: family.id, memoryId: memory.id, authorId: family.owner.id, body: 'migration comment', createRequestId: randomUUID(), initialPayloadHash: 'comment-hash' } })
    await fx.db.memoryLike.create({ data: { familyId: family.id, memoryId: memory.id, userId: family.owner.id, reaction: 'heart' } })
    const ownerMembership = await fx.db.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: family.id, userId: family.owner.id } } })
    await fx.db.memorySeen.create({ data: { familyId: family.id, memoryId: memory.id, userId: family.owner.id, membershipEpoch: ownerMembership.membershipEpoch } })
    const album = await fx.db.album.create({ data: { familyId: family.id, childId: null, kind: 'free', title: 'Migration album', createActorId: family.owner.id, createOperation: 'test:create', createRequestId: randomUUID(), initialPayloadHash: 'album-hash' } })
    const albumEntry = await fx.db.albumEntry.create({ data: { familyId: family.id, albumId: album.id, kind: 'work', orderKey: 1, title: 'Video source' } })
    const albumSource = await fx.db.albumEntrySource.create({ data: { familyId: family.id, albumId: album.id, entryId: albumEntry.id, memoryId: memory.id, sourceKind: 'private_storage', kind: 'video', sourceId: mediaId, position: 0 } })
    await fx.db.album.update({ where: { id: album.id }, data: { coverSourceId: albumSource.id } })
    const skippedMediaId = randomUUID()
    const skippedInbox = await fx.db.maxInbox.create({ data: {
      eventKey: `legacy-retention-skip-${randomUUID()}`, botId: 1n, eventKind: 'message_created',
      encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]), encryptionAuthTag: new Uint8Array([3]), status: 'processed',
    } })
    created.push({ mediaId: skippedMediaId, memoryId: memory.id, inboxId: skippedInbox.id })
    const skippedSource = await fx.db.maxSource.create({ data: {
      inboxId: skippedInbox.id, botId: 1n, senderSubject: family.owner.subject, recipientId: 1n,
      messageId: `synthetic-skip-${randomUUID()}`, status: 'published', plannedMemoryId: memory.id,
      memoryId: memory.id, familyId: family.id, userId: family.owner.id, childId: family.children[0]!.id,
    } })
    await fx.db.mediaAsset.create({ data: {
      id: skippedMediaId, familyId: family.id, uploaderId: family.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'video',
      originalKey: `media-originals/${randomUUID()}`, declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'd'.repeat(64),
      byteSize: 321n, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    await fx.db.memoryMedia.create({ data: { familyId: family.id, memoryId: memory.id, mediaId: skippedMediaId, position: 3 } })
    await fx.db.maxSourceAttachment.create({ data: { sourceId: skippedSource.id, position: 3, providerKind: 'video', providerAttachmentId: 'expected-second-id',
      plannedMediaId: skippedMediaId, mediaId: skippedMediaId, status: 'stored' } })
    const foreignFamily = await fx.family()
    async function addCandidate(position: number, options: { sourceFamilyId?: string; senderSubject?: string; messageId: string }) {
      const mediaId = randomUUID()
      const inbox = await fx.db.maxInbox.create({ data: {
        eventKey: `legacy-retention-extra-${randomUUID()}`, botId: 1n, eventKind: 'message_created',
        encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]), encryptionAuthTag: new Uint8Array([3]), status: 'processed',
      } })
      created.push({ mediaId, memoryId: memory.id, inboxId: inbox.id })
      const candidateSource = await fx.db.maxSource.create({ data: {
        inboxId: inbox.id, botId: 1n, senderSubject: options.senderSubject ?? family.owner.subject, recipientId: 1n,
        messageId: options.messageId, status: 'published', plannedMemoryId: memory.id,
        memoryId: memory.id, familyId: options.sourceFamilyId ?? family.id, userId: family.owner.id, childId: family.children[0]!.id,
      } })
      await fx.db.mediaAsset.create({ data: {
        id: mediaId, familyId: family.id, uploaderId: family.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'video',
        originalKey: `media-originals/${randomUUID()}`, declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'e'.repeat(64),
        byteSize: 3n, originalStatus: 'stored', renditionStatus: 'ready',
      } })
      await fx.db.memoryMedia.create({ data: { familyId: family.id, memoryId: memory.id, mediaId, position } })
      await fx.db.maxSourceAttachment.create({ data: { sourceId: candidateSource.id, position, providerKind: 'video', providerAttachmentId: `extra-attachment-${position}`,
        plannedMediaId: mediaId, mediaId, status: 'stored' } })
      return mediaId
    }
    const wrongFamilyMediaId = await addCandidate(4, { sourceFamilyId: foreignFamily.id, senderSubject: foreignFamily.owner.subject, messageId: `wrong-family-${randomUUID()}` })
    const unavailableMediaId = await addCandidate(5, { messageId: `provider-unavailable-${randomUUID()}` })
    const unauthorized401Id = await addCandidate(6, { messageId: `provider-401-${randomUUID()}` })
    const unauthorized403Id = await addCandidate(7, { messageId: `provider-403-${randomUUID()}` })
    const missingMessageId = await addCandidate(8, { messageId: `provider-404-${randomUUID()}` })
    const retryableId = await addCandidate(9, { messageId: `provider-503-${randomUUID()}` })
    const secondFamily = await fx.family()
    const secondMemory = await fx.memory(secondFamily, { kind: 'video' })
    const secondMediaId = randomUUID()
    const secondInbox = await fx.db.maxInbox.create({ data: {
      eventKey: `legacy-retention-second-family-${randomUUID()}`, botId: 1n, eventKind: 'message_created',
      encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]), encryptionAuthTag: new Uint8Array([3]), status: 'processed',
    } })
    created.push({ mediaId: secondMediaId, memoryId: secondMemory.id, inboxId: secondInbox.id })
    const secondMessageId = `second-family-${randomUUID()}`
    const secondSource = await fx.db.maxSource.create({ data: {
      inboxId: secondInbox.id, botId: 1n, senderSubject: secondFamily.owner.subject, recipientId: 1n, messageId: secondMessageId,
      status: 'published', plannedMemoryId: secondMemory.id, memoryId: secondMemory.id, familyId: secondFamily.id,
      userId: secondFamily.owner.id, childId: secondFamily.children[0]!.id,
    } })
    const secondOriginalKey = `media-originals/${randomUUID()}`
    await fx.db.mediaAsset.create({ data: {
      id: secondMediaId, familyId: secondFamily.id, uploaderId: secondFamily.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'video',
      originalKey: secondOriginalKey, declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'f'.repeat(64),
      byteSize: 3n, originalStatus: 'stored', renditionStatus: 'ready',
    } })
    await storage.writeObject({ key: secondOriginalKey, body: new Response(new Uint8Array([8, 9, 10])).body!, contentLength: 3, contentType: 'video/mp4' })
    await fx.db.memoryMedia.create({ data: { familyId: secondFamily.id, memoryId: secondMemory.id, mediaId: secondMediaId, position: 0 } })
    await fx.db.maxSourceAttachment.create({ data: { sourceId: secondSource.id, position: 0, providerKind: 'video', providerAttachmentId: 'second-family-attachment', plannedMediaId: secondMediaId, mediaId: secondMediaId, status: 'stored' } })
    const snapshots = await fx.db.$queryRaw<Array<{ snapshot: unknown }>>`
      SELECT jsonb_build_object(
        'memory', (SELECT to_jsonb(m) FROM memories m WHERE m.id=${memory.id}::uuid AND m.family_id=${family.id}::uuid),
        'memoryMedia', (SELECT to_jsonb(mm) FROM memory_media mm WHERE mm.memory_id=${memory.id}::uuid AND mm.family_id=${family.id}::uuid AND mm.media_id=${mediaId}::uuid AND mm.position=1),
        'mediaAsset', (SELECT to_jsonb(a) FROM media_assets a WHERE a.id=${mediaId}::uuid AND a.family_id=${family.id}::uuid),
        'mediaVariants', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.variant) FROM media_variants v WHERE v.media_id=${mediaId}::uuid), '[]'::jsonb),
        'source', (SELECT to_jsonb(s) FROM max_sources s WHERE s.id=${source.id}::uuid),
        'sourceAttachments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.position) FROM max_source_attachments a WHERE a.source_id=${source.id}::uuid), '[]'::jsonb)
      ) AS snapshot
    `
    const expectedSnapshot = snapshots[0]!.snapshot
    let providerWrites = 0
    const api: MaxApiPort = {
      getMe: async () => ({ userId: 1, username: 'synthetic', isBot: true }), getSubscriptions: async () => [],
      createSubscription: async () => ({ success: true }), deleteSubscription: async () => ({ success: true }), sendMessage: async () => { providerWrites++ },
      createVideoUpload: async () => { providerWrites++; return { url: 'https://upload.max.example/video', token: 'never-used' } },
      sendVideoMessage: async () => { providerWrites++; return { messageId: 'never-used' } },
      getMessage: async (messageId) => {
        if (messageId.startsWith('provider-unavailable-')) throw new Error('synthetic provider outage')
        if (messageId.startsWith('provider-401-')) throw new MaxProviderError(undefined, false, 401, 'not_authorized')
        if (messageId.startsWith('provider-403-')) throw new MaxProviderError(undefined, false, 403, 'not_authorized')
        if (messageId.startsWith('provider-404-')) throw new MaxProviderError(undefined, false, 404, 'message_not_found')
        if (messageId.startsWith('provider-503-')) throw new MaxProviderError(undefined, true, 503, 'temporary_provider_error')
        if (messageId === secondMessageId) return ({ messageId, senderId: secondFamily.owner.subject, recipientId: '1', attachments: [
          { kind: 'video', providerAttachmentId: 'second-family-attachment', currentToken: 'opaque-provider-token-second', inboundDurationSeconds: 1, width: 640, height: 360 },
        ] })
        return ({ messageId, senderId: family.owner.subject, recipientId: '1', attachments: [
        { kind: 'video', providerAttachmentId: 'video-attachment-1', currentToken: 'opaque-provider-token', inboundDurationSeconds: 1, width: 640, height: 360 },
        { kind: 'video', providerAttachmentId: 'video-attachment-1', currentToken: 'opaque-provider-token-2', inboundDurationSeconds: 1, width: 640, height: 360 },
        { kind: 'video', providerAttachmentId: `extra-attachment-2`, currentToken: 'opaque-provider-token-3', inboundDurationSeconds: 1, width: 640, height: 360 },
        { kind: 'video', providerAttachmentId: `extra-attachment-3`, currentToken: 'opaque-provider-token-4', inboundDurationSeconds: 1, width: 640, height: 360 },
      ] })
      },
      getVideo: async () => ({ width: 640, height: 360, durationMs: 1_000, renditions: [{ url: 'https://maxvd1.okcdn.ru/synthetic-video', width: 640, height: 360, contentLength: 3 }] }),
    }
    const originalFetch = globalThis.fetch
    const requests: RequestInit[] = []
    globalThis.fetch = Object.assign(async (_input: URL | RequestInfo, init?: RequestInit) => {
      requests.push(init ?? {})
      const range = new Headers(init?.headers).get('range')
      if (range) return new Response(new Uint8Array([0, 1]), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '2', 'Content-Range': 'bytes 0-1/3' } })
      return new Response(null, { status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '3' } })
    }, { preconnect: originalFetch.preconnect })
    try {
    const migration = createMaxVideoLegacyMigration({ prisma: fx.db, storage, api })
    const originalMemory = await fx.db.memory.findUniqueOrThrow({ where: { id: memory.id } })
    const originalFamily = await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })
    const originalRelations = {
      tags: await fx.db.memoryChildTag.findMany({ where: { memoryId: memory.id }, orderBy: { childId: 'asc' } }),
      comments: await fx.db.memoryComment.findMany({ where: { memoryId: memory.id }, select: { id: true, body: true, version: true } }),
      likes: await fx.db.memoryLike.findMany({ where: { memoryId: memory.id } }),
      seen: await fx.db.memorySeen.findMany({ where: { memoryId: memory.id } }),
      albumSources: await fx.db.albumEntrySource.findMany({ where: { memoryId: memory.id } }),
      cover: await fx.db.album.findUniqueOrThrow({ where: { id: album.id }, select: { coverSourceId: true } }),
    }
    const scope = { familyId: family.id, principal: { userId: family.owner.id, sessionId: 'synthetic' } }
    const memoryRepository = new PrismaMemoryRepository(fx.db, createPrismaIdempotencyExecutor(fx.db))
    const pages = []
    let scanOffset = 0
    while (true) {
      const page = await migration.inventory({ batchSize: 2, offset: scanOffset })
      pages.push(page)
      scanOffset += page.scanned
      if (!page.hasMore) break
    }
    let plan = { ...pages.at(-1)!, offset: 0, scanned: scanOffset,
      candidates: pages.flatMap((page) => page.candidates), skipped: pages.flatMap((page) => page.skipped) }
    expect(plan).toMatchObject({ totalRows: 9, scanned: 9, hasMore: false, skipped: [
      { mediaId: skippedMediaId, reason: 'provider_attachment_mismatch' },
      { mediaId: wrongFamilyMediaId, reason: 'source_mapping_mismatch' },
      { mediaId: unavailableMediaId, reason: 'verification_unavailable' },
      { mediaId: unauthorized401Id, reason: 'provider_unauthorized' },
      { mediaId: unauthorized403Id, reason: 'provider_unauthorized' },
      { mediaId: missingMessageId, reason: 'provider_message_not_found' },
      { mediaId: retryableId, reason: 'provider_retryable' },
    ] })
    expect(plan.candidates.map(({ mediaId }) => mediaId).sort()).toEqual([mediaId, secondMediaId].sort())
    expect(plan.candidates.find(({ mediaId: id }) => id === mediaId)).toMatchObject({ mediaId, snapshot: expectedSnapshot })
    const cliPlanPath = join(storageRoot, 'plan.json')
    const cliReportPath = join(storageRoot, 'apply-report.json')
    const collisionReportPath = join(storageRoot, 'existing-report.json')
    await writeFile(cliPlanPath, JSON.stringify(plan), { mode: 0o600 })
    const cliEnv = { ...Bun.env, DATABASE_URL: Bun.env.TEST_DATABASE_URL!, JWT_SECRET: 'synthetic-test-secret-at-least-32-bytes', PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot, NODE_ENV: 'test', TEST_SKIP_DOCKER: '1' }
    const collisionContents = 'existing protected report'
    await writeFile(collisionReportPath, collisionContents, { mode: 0o600 })
    const collision = Bun.spawnSync(['bun', 'scripts/migrate-max-legacy-videos.ts', '--apply', '--plan', cliPlanPath, '--offset', '1', '--batch-size', '1', '--report', collisionReportPath], { cwd: process.cwd(), env: cliEnv })
    expect(collision.exitCode).not.toBe(0)
    expect(await readFile(collisionReportPath, 'utf8')).toBe(collisionContents)
    expect(await fx.db.maxVideoReference.findUnique({ where: { id: secondMediaId } })).toBeNull()
    const partialReportPath = join(storageRoot, 'partial-report.json')
    const mainCandidateOffset = plan.candidates.findIndex(({ mediaId: candidateId }) => candidateId === mediaId)
    await fx.db.maxSourceAttachment.updateMany({ where: { mediaId }, data: { providerAttachmentId: 'changed-before-cli-apply' } })
    const partialApply = Bun.spawnSync(['bun', 'scripts/migrate-max-legacy-videos.ts', '--apply', '--plan', cliPlanPath, '--offset', String(mainCandidateOffset), '--batch-size', '1', '--report', partialReportPath], { cwd: process.cwd(), env: cliEnv })
    expect(partialApply.exitCode).toBe(2)
    expect(JSON.parse(await readFile(partialReportPath, 'utf8'))).toMatchObject({ outcomes: [{ mediaId, status: 'skipped', reason: 'source_mapping_changed' }] })
    await fx.db.maxSourceAttachment.updateMany({ where: { mediaId }, data: { providerAttachmentId: 'video-attachment-1' } })
    const refreshedPlan = await migration.inventory({ batchSize: 10 })
    plan = { ...refreshedPlan, offset: 0 }
    await writeFile(cliPlanPath, JSON.stringify(plan), { mode: 0o600 })
    const concurrent = await Promise.all([migration.apply(plan, { offset: 0, batchSize: 1 }), migration.apply(plan, { offset: 0, batchSize: 1 })])
    const laterBatch = await migration.apply(plan, { offset: 1, batchSize: 1 })
    expect(concurrent.reduce((count, outcome) => count + outcome.migrated, 0) + laterBatch.migrated).toBe(2)
    expect(concurrent.reduce((count, outcome) => count + outcome.alreadyMigrated, 0)).toBe(1)
    expect(await fx.db.maxVideoReference.count()).toBe(2)
    expect(concurrent.flatMap(({ outcomes }) => outcomes).map(({ status }) => status).sort()).toEqual(['already_migrated', 'migrated'])
    expect(laterBatch.outcomes).toEqual([{ mediaId: plan.candidates[1]!.mediaId, status: 'migrated' }])
    expect(await fx.db.maxSourceAttachment.count({ where: { source: { familyId: { in: [family.id, foreignFamily.id, secondFamily.id] } } } })).toBe(9)
    expect(await fx.db.maxVideoReference.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({ id: mediaId, sourceId: source.id, attachmentPosition: 1, providerAttachmentId: 'video-attachment-1' })
    expect(await fx.db.taskOutbox.findUnique({ where: { type_dedupeKey: { type: 'max:video-poster', dedupeKey: `max-video-poster:${mediaId}` } } })).toBeNull()
    expect(await fx.db.taskOutbox.findUnique({ where: { type_dedupeKey: { type: 'max:video-poster', dedupeKey: `max-video-poster:${secondMediaId}` } } })).not.toBeNull()
    expect(await fx.db.memory.findUniqueOrThrow({ where: { id: memory.id } })).toEqual(originalMemory)
    expect({
      tags: await fx.db.memoryChildTag.findMany({ where: { memoryId: memory.id }, orderBy: { childId: 'asc' } }),
      comments: await fx.db.memoryComment.findMany({ where: { memoryId: memory.id }, select: { id: true, body: true, version: true } }),
      likes: await fx.db.memoryLike.findMany({ where: { memoryId: memory.id } }),
      seen: await fx.db.memorySeen.findMany({ where: { memoryId: memory.id } }),
      albumSources: await fx.db.albumEntrySource.findMany({ where: { memoryId: memory.id } }),
      cover: await fx.db.album.findUniqueOrThrow({ where: { id: album.id }, select: { coverSourceId: true } }),
    }).toEqual(originalRelations)
    expect(await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })).toEqual(originalFamily)
    const memoryDto = await memoryRepository.get(scope, memory.id)
    expect(memoryDto.attachments.map(({ id, source }) => [id, source])).toEqual([
      [photoIds[0], 'private_storage'], [mediaId, 'max'], [photoIds[1], 'private_storage'],
      [skippedMediaId, 'private_storage'], [wrongFamilyMediaId, 'private_storage'], [unavailableMediaId, 'private_storage'],
      [unauthorized401Id, 'private_storage'], [unauthorized403Id, 'private_storage'], [missingMessageId, 'private_storage'], [retryableId, 'private_storage'],
    ])
    const picker = await createAlbumMemorySourceCatalog().list(fx.db, scope, { kind: 'video' }, 10)
    expect(picker.items[0]?.sources.map(({ sourceId }) => sourceId)).toEqual([mediaId, skippedMediaId, wrongFamilyMediaId, unavailableMediaId, unauthorized401Id, unauthorized403Id, missingMessageId, retryableId])
    expect(requests.filter((request) => new Headers(request.headers).has('range')).length).toBeGreaterThanOrEqual(2)
    expect(requests.filter((request) => new Headers(request.headers).has('range')).every((request) => request.method === 'GET')).toBe(true)
    expect(requests.filter((request) => new Headers(request.headers).has('range')).every((request) => new Headers(request.headers).get('range') === 'bytes=0-1')).toBe(true)
    expect(providerWrites).toBe(0)

    const cliApply = Bun.spawnSync(['bun', 'scripts/migrate-max-legacy-videos.ts', '--apply', '--plan', cliPlanPath, '--report', cliReportPath], { cwd: process.cwd(), env: cliEnv })
    expect(cliApply.exitCode, `${cliApply.stdout.toString()}\n${cliApply.stderr.toString()}`).toBe(0)
    expect(JSON.parse(await readFile(cliReportPath, 'utf8')).outcomes.map(({ status }: { status: string }) => status)).toEqual(['already_migrated', 'already_migrated'])
    if (process.platform !== 'win32') expect((await stat(cliReportPath)).mode & 0o777).toBe(0o600)

    const projected = await createAlbumMemorySourceCatalog().project(fx.db, { familyId: family.id, principal: { userId: family.owner.id, sessionId: 'synthetic' } }, [
      { memoryId: memory.id, sourceKind: 'private_storage', sourceId: mediaId, kind: 'video' },
    ])
    expect(projected[0]).toMatchObject({ sourceKind: 'private_storage', sourceId: mediaId, available: true,
      attachment: { id: mediaId, source: 'max', kind: 'video', posterPath: `/api/v1/families/${family.id}/media/${mediaId}/content?variant=preview` },
    })
    const edited = await memoryRepository.update(scope, memory.id, { expectedVersion: originalMemory.version, body: 'still editable after migration', occurredAt: originalMemory.occurredAt.toISOString() })
    expect(edited.body).toBe('still editable after migration')
    expect(await fx.db.memoryChildTag.findMany({ where: { memoryId: memory.id }, orderBy: { childId: 'asc' } })).toEqual(originalRelations.tags)
    expect(await fx.db.album.findUniqueOrThrow({ where: { id: album.id }, select: { coverSourceId: true } })).toEqual(originalRelations.cover)

    const marked = await fx.db.mediaAsset.updateMany({ where: { id: mediaId }, data: { deletedAt: new Date(), storageDeletedAt: new Date() } })
    expect(marked.count).toBe(0)
    expect(await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({ deletedAt: null, storageDeletedAt: null })

    await runBackgroundJob('media:pending:cleanup', { prisma: fx.db } as never, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
    expect(await storage.headObject(originalKey)).not.toBeNull()
    expect(await storage.headObject(previewKey)).not.toBeNull()
    expect(await storage.headObject(playbackKey)).not.toBeNull()

    await memoryRepository.delete(scope, memory.id, edited.version, new Date())
    await expect(memoryRepository.get(scope, memory.id)).rejects.toThrow()
    expect(await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })).toEqual(originalFamily)
    expect(await migration.recoveryReadiness()).toMatchObject({ total: 2, inspected: 2, ready: 2, missingObjects: 0, invalid: [] })
    const cliReadiness = Bun.spawnSync(['bun', 'scripts/migrate-max-legacy-videos.ts', '--recover-all'], { cwd: process.cwd(), env: cliEnv })
    expect(cliReadiness.exitCode).toBe(0)
    expect(JSON.parse(cliReadiness.stdout.toString())).toMatchObject({ total: 2, inspected: 2, ready: 2, missingObjects: 0, invalid: 0 })
    expect(await migration.recoverAll({ apply: false })).toMatchObject({ inspected: 2, recovered: 0, refused: 0 })
    expect(await fx.db.maxVideoReference.findUnique({ where: { id: mediaId } })).not.toBeNull()
    const providerRequestCountBeforeRecovery = requests.length
    await fx.db.maxSourceAttachment.updateMany({ where: { mediaId }, data: { providerAttachmentId: 'temporarily-changed-provider-id' } })
    const refusedRecovery = Bun.spawnSync(['bun', 'scripts/migrate-max-legacy-videos.ts', '--recover-all', '--apply', '--batch-size', '1'], { cwd: process.cwd(), env: cliEnv })
    expect(refusedRecovery.exitCode).toBe(2)
    expect(JSON.parse(refusedRecovery.stdout.toString())).toMatchObject({ refused: 1, remaining: 1 })
    expect(await fx.db.maxVideoReference.findUnique({ where: { id: mediaId } })).not.toBeNull()
    await fx.db.maxSourceAttachment.updateMany({ where: { mediaId }, data: { providerAttachmentId: 'video-attachment-1' } })
    const cliRecovery = Bun.spawnSync(['bun', 'scripts/migrate-max-legacy-videos.ts', '--recover-all', '--apply', '--batch-size', '1'], { cwd: process.cwd(), env: cliEnv })
    expect(cliRecovery.exitCode).toBe(0)
    expect(JSON.parse(cliRecovery.stdout.toString())).toMatchObject({ inspected: 1, recovered: 1, refused: 0, remaining: 0 })
    expect(requests).toHaveLength(providerRequestCountBeforeRecovery)
    expect(await fx.db.maxVideoReference.findUnique({ where: { id: mediaId } })).toBeNull()
    expect(await fx.db.memoryMedia.findUnique({ where: { memoryId_position: { memoryId: memory.id, position: 1 } } })).toMatchObject({ mediaId })
    expect(await fx.db.maxVideoLegacyRetention.findUniqueOrThrow({ where: { mediaId } })).toMatchObject({ recoveredAt: expect.any(Date) })

    await createMediaTasks({ prisma: fx.db, privateStorage: { storage }, env: {} }).deleteAsset({ mediaId })
    expect(await storage.headObject(originalKey)).not.toBeNull()
    expect(await storage.headObject(previewKey)).not.toBeNull()
    expect(await storage.headObject(playbackKey)).not.toBeNull()
    expect(await fx.db.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({ deletedAt: null, storageDeletedAt: null })
    expect((await fx.db.mediaAsset.deleteMany({ where: { id: mediaId } })).count).toBe(0)
    expect(await fx.db.mediaAsset.findUnique({ where: { id: mediaId } })).not.toBeNull()

    const purgeIntent = await fx.db.controlFamilyDeletion.create({ data: {
      familyId: family.id, actorUserId: family.owner.id, requestedAt: new Date(),
    } })
    await fx.db.family.update({ where: { id: family.id }, data: { status: 'deleting' } })
    await fx.db.maxVideoLegacyRetention.update({ where: { mediaId }, data: { recoveredAt: null } })
    await fx.db.maxVideoReference.create({ data: {
      id: mediaId, sourceId: source.id, memoryId: memory.id, familyId: family.id,
      attachmentPosition: 1, providerAttachmentId: 'video-attachment-1',
    } })
    await storage.deleteObject(originalKey)
    try {
      expect(await migration.recoveryReadiness()).toMatchObject({ total: 0, excluded: 1, inspected: 0, ready: 0, missingObjects: 0, invalid: [] })
      expect(await migration.recoverAll({ apply: true })).toMatchObject({ inspected: 0, excluded: 1, recovered: 0, refused: 0, remaining: 0 })
      expect(await fx.db.maxVideoReference.findUnique({ where: { id: mediaId } })).not.toBeNull()
      expect(await storage.headObject(secondOriginalKey)).not.toBeNull()
    } finally {
      await storage.writeObject({ key: originalKey, body: new Response(new Uint8Array([0, 1, 2])).body!, contentLength: 3, contentType: 'video/mp4' })
      await fx.db.controlFamilyDeletion.delete({ where: { id: purgeIntent.id } })
    }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('holds an unlinked MAX video inserted after the retention DDL through cleanup and delete work', async () => {
    const family = await fx.family()
    const storageRoot = await mkdtemp(join(tmpdir(), 'max-video-unlinked-hold-'))
    storageRoots.push(storageRoot)
    const storage = new FilesystemPrivateStorage({ driver: 'filesystem', root: storageRoot, publicBaseUrl: 'http://127.0.0.1',
      signingKey: randomBytes(32), uploadMaxBytes: 10_000, uploadUrlTtlSeconds: 60, downloadUrlTtlSeconds: 60 })
    const mediaId = randomUUID()
    const originalKey = `media-originals/${randomUUID()}`
    const quotaBefore = await fx.db.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })
    const rollback = new Error('rollback synthetic retained-video transaction')
    await expect(fx.db.$transaction(async (tx) => {
      const prisma = new Proxy(tx as object, { get(target, property, receiver) {
        if (property === '$transaction') return (callback: (client: typeof tx) => unknown) => callback(tx)
        return Reflect.get(target, property, receiver)
      } }) as typeof tx
      await tx.mediaAsset.create({ data: {
        id: mediaId, familyId: family.id, uploaderId: family.owner.id, sourceKind: 'max', purpose: 'memory', mediaKind: 'video', originalKey,
        declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: '9'.repeat(64), byteSize: 3n, originalStatus: 'stored',
        renditionStatus: 'ready', deletedAt: new Date('2020-01-01T00:00:00.000Z'), createdAt: new Date('2020-01-01T00:00:00.000Z'),
      } })
      await storage.writeObject({ key: originalKey, body: new Response(new Uint8Array([7, 8, 9])).body!, contentLength: 3, contentType: 'video/mp4' })
      const held = await tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })
      expect(held.legacyVideoRetainedAt).toBeInstanceOf(Date)
      expect(await tx.maxVideoReference.findUnique({ where: { id: mediaId } })).toBeNull()
      await runBackgroundJob('media:pending:cleanup', { prisma } as never, new Date('2026-10-25T00:00:00.000Z'))
      await runBackgroundJob('media:orphans:reconcile', { prisma, privateStorage: { storage } } as never, new Date('2026-10-25T00:00:00.000Z'))
      await createMediaTasks({ prisma: prisma as never, privateStorage: { storage }, env: {} }).deleteAsset({ mediaId })
      expect(await tx.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).toMatchObject({ storageDeletedAt: null, legacyVideoRetainedAt: expect.any(Date) })
      expect(await tx.taskOutbox.count({ where: { payload: { path: ['mediaId'], equals: mediaId } } })).toBe(0)
      expect(await tx.family.findUniqueOrThrow({ where: { id: family.id }, select: { storageUsedBytes: true } })).toEqual(quotaBefore)
      expect(await storage.headObject(originalKey)).not.toBeNull()
      throw rollback
    })).rejects.toThrow(rollback.message)
    expect(await fx.db.mediaAsset.findUnique({ where: { id: mediaId } })).toBeNull()
    expect(await storage.headObject(originalKey)).not.toBeNull()
  })
})
