import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import sharp from 'sharp'

import { createApp } from '../../../app'
import { createBackendRuntime } from '../../../runtime'
import { requireIntegrationDatabaseUrl } from '../../../test-support/integration-database'
import { pngFixture } from '../../../storage/storage-contract'
import { startTelegramIfEnabled } from '../../../telegram-startup'
import { createMaxVideoPlayback, type MaxApiPort } from '../../max'

export const telegramFixtureToken = '123456:telegram-auth-only-synthetic'
export const telegramFixtureSubject = 776431901

export function signedTelegramFixtureData(subject = telegramFixtureSubject, authDate = Math.floor(Date.now() / 1000)) {
  const fields = new URLSearchParams({ auth_date: String(authDate), query_id: randomUUID(),
    user: JSON.stringify({ id: subject, first_name: 'Telegram fixture viewer' }) })
  const check = [...fields].sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
    .map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(telegramFixtureToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}

/** Only external provider responses are synthetic; sessions, persistence and ACL remain real. */
export async function createTelegramAuthOnlyFixture(origin: string, videoBytes: Uint8Array) {
  const databaseUrl = requireIntegrationDatabaseUrl()
  if (process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== databaseUrl) {
    throw new Error('Telegram fixture requires NODE_ENV=test and matching isolated database URLs')
  }
  const scratchRoot = resolve('.scratch')
  await mkdir(scratchRoot, { recursive: true })
  const storageRoot = await mkdtemp(join(scratchRoot, 'memoly-telegram-auth-only-'))
  const runtime = createBackendRuntime({ NODE_ENV: 'test', DATABASE_URL: databaseUrl,
    JWT_SECRET: '0123456789abcdef'.repeat(4), TELEGRAM_ENABLED: 'false',
    TELEGRAM_AUTH_BOT_TOKEN: telegramFixtureToken, MAX_ENABLED: 'false',
    CORS_ORIGINS: origin, MULTI_FAMILY_ACTIVATION: 'on', AUTH_RATE_LIMIT_MAX: '10000',
    PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot })
  const db = runtime.prisma
  if (await startTelegramIfEnabled({ runtime }) !== null) throw new Error('Message bot must remain disabled')
  const { owner, viewer, familyId, photos, photoMemory, videoMemory, inbox, source, video } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
    const owner = await tx.user.create({ data: { displayName: 'MAX fixture owner', welcomeShownAt: new Date(),
      externalIdentities: { create: { provider: 'max', subject: String(telegramFixtureSubject) } } } })
    const viewer = await tx.user.create({ data: { displayName: 'Telegram fixture viewer', welcomeShownAt: new Date(),
      externalIdentities: { create: { provider: 'telegram', subject: String(telegramFixtureSubject) } } } })
    const familyId = randomUUID()
    await tx.family.create({ data: { id: familyId, ownerUserId: owner.id, name: 'Telegram fixture family', timezone: 'Europe/Moscow' } })
    await tx.familyMember.createMany({ data: [
      { familyId, userId: owner.id, role: 'full' }, { familyId, userId: viewer.id, role: 'viewer' },
    ] })
    const child = await tx.child.create({ data: { familyId, displayName: 'Fixture child',
      birthDate: new Date('2024-01-01'), sex: 'girl' } })
    const photos: string[] = []
    const webp = new Uint8Array(await sharp(pngFixture).resize(240, 240).webp().toBuffer())
    for (let position = 0; position < 2; position += 1) {
      const key = `telegram-fixture/${randomUUID()}`
      await runtime.privateStorage.storage.writeObject({ key, body: new Response(webp).body!,
        contentLength: webp.byteLength, contentType: 'image/webp' })
      const photo = await tx.mediaAsset.create({ data: { familyId, uploaderId: owner.id,
        sourceKind: 'max', purpose: 'memory', mediaKind: 'photo', originalKey: key,
        declaredMime: 'image/webp', verifiedMime: 'image/webp',
        sha256: createHash('sha256').update(webp).digest('hex'), byteSize: BigInt(webp.byteLength), width: 240, height: 240,
        originalStatus: 'stored', renditionStatus: 'ready', variants: { create: {
          variant: 'display', objectKey: key, mime: 'image/webp', byteSize: BigInt(webp.byteLength),
          sha256: createHash('sha256').update(webp).digest('hex'), width: 240, height: 240,
        } } } })
      photos.push(photo.id)
    }
    await tx.child.update({ where: { id: child.id }, data: { avatarMediaId: photos[0], avatarCrop: { x: 0, y: 0, width: 1, height: 1 } } })
    const photoMemory = await tx.memory.create({ data: { familyId, childId: child.id, authorId: owner.id,
      firstPublishedAt: new Date(), kind: 'photo', body: 'Telegram fixture photos', occurredAt: new Date(),
      media: { create: photos.map((mediaId, position) => ({ mediaId, position })) } } })
    const videoMemory = await tx.memory.create({ data: { familyId, childId: child.id, authorId: owner.id,
      firstPublishedAt: new Date(), kind: 'video', body: 'Telegram fixture MAX video', occurredAt: new Date(Date.now() - 1000) } })
    const inbox = await tx.maxInbox.create({ data: { eventKey: `telegram-fixture-${randomUUID()}`, botId: 900n,
      eventKind: 'message_created', encryptedPayload: Buffer.from([1]), encryptionIv: Buffer.from([2]), encryptionAuthTag: Buffer.from([3]) } })
    const source = await tx.maxSource.create({ data: { inboxId: inbox.id, botId: 900n, senderSubject: String(telegramFixtureSubject),
      recipientId: 900n, messageId: randomUUID(), status: 'published', plannedMemoryId: videoMemory.id,
      memoryId: videoMemory.id, userId: owner.id, familyId, childId: child.id } })
    const video = await tx.maxVideoReference.create({ data: { sourceId: source.id, memoryId: videoMemory.id,
      familyId, attachmentPosition: 0, providerAttachmentId: 'synthetic-video', width: 240, height: 320, durationMs: 5000,
      thumbnailMediaId: photos[0] } })
    return { owner, viewer, familyId, photos, photoMemory, videoMemory, inbox, source, video }
  }).catch(async (error: unknown) => {
    await runtime.close()
    await rm(storageRoot, { recursive: true, force: true })
    throw error
  })
  const cdnUrl = `https://maxvd123.okcdn.ru/telegram-fixture-${video.id}.mp4`
  const unexpectedProviderCall = async (): Promise<never> => { throw new Error('Unexpected provider operation in Telegram fixture') }
  const api: MaxApiPort = {
    getMe: unexpectedProviderCall, getSubscriptions: unexpectedProviderCall,
    createSubscription: unexpectedProviderCall, deleteSubscription: unexpectedProviderCall,
    sendMessage: unexpectedProviderCall, createVideoUpload: unexpectedProviderCall, sendVideoMessage: unexpectedProviderCall,
    getMessage: async () => ({ messageId: source.messageId, senderId: source.senderSubject, recipientId: '900',
      attachments: [{ kind: 'video', providerAttachmentId: 'synthetic-video', currentToken: 'synthetic-rendition',
        inboundDurationSeconds: 5, width: 240, height: 320 }] }),
    getVideo: async () => ({ width: 240, height: 320, durationMs: 5000,
      renditions: [{ url: cdnUrl, width: 240, height: 320, contentLength: videoBytes.byteLength }] }),
  }
  const app = createApp({ env: runtime.env, prisma: db, privateStorage: runtime.privateStorage,
    maxVideoPlayback: createMaxVideoPlayback({ runtime, api }) })
  const originalFetch = globalThis.fetch
  globalThis.fetch = Object.assign(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url !== cdnUrl) return originalFetch(input, init)
    const range = new Headers(init?.headers).get('range')
    let start = 0
    let end = videoBytes.byteLength - 1
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range)
      if (!match || Number(match[1]) >= videoBytes.byteLength) return new Response(null, {
        status: 416, headers: { 'Content-Range': `bytes */${videoBytes.byteLength}` },
      })
      start = Number(match[1])
      if (match[2]) end = Math.min(Number(match[2]), end)
    }
    const body = videoBytes.slice(start, end + 1)
    return new Response(init?.method === 'HEAD' ? null : body, { status: range ? 206 : 200,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(body.byteLength), 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${videoBytes.byteLength}` } : {}) } })
  }, { preconnect: originalFetch.preconnect })
  let closed = false
  return { app, runtime, familyId, viewerId: viewer.id, maxUserId: owner.id, photos,
    photoMemoryId: photoMemory.id, videoMemoryId: videoMemory.id, videoId: video.id,
    photoPath: `/api/v1/families/${familyId}/media/${photos[0]}/content?variant=display`,
    videoPath: `/api/v1/families/${familyId}/media/max-videos/${video.id}/content`,
    async close() {
      if (closed) return
      closed = true
      globalThis.fetch = originalFetch
      await runtime.backgroundTasks.drain(5000)
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`
        await tx.maxVideoReference.deleteMany({ where: { familyId } })
        await tx.maxSource.deleteMany({ where: { familyId } })
        await tx.maxInbox.delete({ where: { id: inbox.id } })
        await tx.memory.deleteMany({ where: { familyId } })
        await tx.child.deleteMany({ where: { familyId } })
        await tx.mediaVariant.deleteMany({ where: { familyId } })
        await tx.mediaAsset.deleteMany({ where: { familyId } })
        await tx.family.delete({ where: { id: familyId } })
        await tx.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } })
      })
      await runtime.close()
      await rm(storageRoot, { recursive: true, force: true })
    } }
}
