import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'
import sharp from 'sharp'

import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { Prisma } from '../../generated/prisma/client'
import { loadEnv } from '../../env'
import { createPrivateStorage } from '../../storage'
import { runBackgroundJob } from '../../jobs'
import { pngFixture } from '../../storage/storage-contract'
import { signAccessToken } from '../auth'
import { createMaxVideoPlayback } from '../max'
import { createMediaTasks } from '.'
import { createFfmpegRunner } from './infrastructure/ffmpeg-runner'
import { videoPosterObjectKey } from './infrastructure/video-poster'

const databaseUrl = process.env.TEST_DATABASE_URL
const maybeDescribe = databaseUrl ? describe : describe.skip

maybeDescribe('Private media API', () => {
  const storageRoot = resolve('.test-media-storage')
  const prisma = createPrisma(databaseUrl!)
  const env = loadEnv({
    DATABASE_URL: databaseUrl!,
    JWT_SECRET: '0123456789abcdef'.repeat(4),
    CORS_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '10000',
    PRIVATE_STORAGE_DRIVER: 'filesystem',
    PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
    PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
    PRIVATE_STORAGE_UPLOAD_MAX_BYTES: '100000000',
    MEDIA_FAMILY_QUOTA_BYTES: '150',
  })
  const privateStorage = createPrivateStorage(env)
  const app = createApp({ env, prisma, privateStorage })

  beforeEach(async () => {
    await clearFixtures()
    await rm(storageRoot, { recursive: true, force: true })
    await mkdir(storageRoot, { recursive: true })
  })

  afterAll(async () => {
    await clearFixtures()
    await prisma.$disconnect()
    await rm(storageRoot, { recursive: true, force: true })
  })

  test('real HTTP photo PUT is physically present before finalize and appears in the feed', async () => {
    const owner = await admittedUser('Владелец', '43010')
    const family = await createFamily(owner.token, 'Семья')
    const jpeg = new Uint8Array(await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#aabbcc' },
    }).jpeg().toBuffer())
    const photoApp = createApp({ env: { ...env, MEDIA_FAMILY_QUOTA_BYTES: 1_000_000 }, prisma, privateStorage })
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => photoApp.fetch(request) })
    const base = `http://127.0.0.1:${server.port}`
    const api = async (path: string, method: string, body?: unknown, key?: string) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${owner.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(key ? { 'Idempotency-Key': key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return { response, body: await response.json() as any }
    }

    try {
      const familyPath = `/api/v1/families/${family.body.family.id}`
      const reserved = await api(`${familyPath}/uploads`, 'POST', {
        purpose: 'memory', kind: 'photo', contentType: 'image/jpeg', byteSize: jpeg.byteLength,
      })
      expect(reserved.response.status).toBe(201)
      const signed = new URL(reserved.body.upload.url)
      const uploaded = await fetch(`${base}${signed.pathname}${signed.search}`, {
        method: reserved.body.upload.method,
        headers: reserved.body.upload.headers,
        body: jpeg as unknown as BodyInit,
        credentials: 'omit',
      })
      expect(uploaded.status).toBe(200)
      const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: reserved.body.assetId } })
      expect(await Bun.file(resolve(storageRoot, 'objects', asset.originalKey)).exists()).toBe(true)
      expect(await privateStorage.storage.headObject(asset.originalKey)).toMatchObject({
        contentLength: jpeg.byteLength, contentType: 'image/jpeg',
      })
      const finalized = await api(`${familyPath}/uploads/${reserved.body.upload.uploadId}/finalize`, 'POST')
      expect(finalized.response.status).toBe(200)
      expect(finalized.body.asset.originalStatus).toBe('stored')
      const memory = await api(`${familyPath}/memories`, 'POST', {
        kind: 'photo', childId: family.body.child.id, body: '',
        occurredAt: new Date(Date.now() - 30_000).toISOString(), mediaIds: [asset.id],
      }, randomUUID())
      expect(memory.response.status).toBe(201)
      const feed = await api(`${familyPath}/memories`, 'GET')
      expect(feed.body.items).toContainEqual(expect.objectContaining({ id: memory.body.id, kind: 'photo' }))
    } finally {
      server.stop(true)
    }
  })

  test('full uploads a photo and published members receive private HEAD and single-range bytes', async () => {
    const owner = await admittedUser('Владелец', '43001')
    const viewer = await admittedUser('Зритель', '43002')
    const outsider = await admittedUser('Чужой', '43003')
    const family = await createFamily(owner.token, 'Семья')
    const foreignFamily = await createFamily(outsider.token, 'Другая семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    const viewerMembership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: viewer.userId } },
    })

    const uploaded = await uploadPhoto(owner.token, family.body.family.id, 'memory', pngFixture)
    expect(uploaded.finalized.response.status).toBe(200)
    expect(uploaded.finalized.body.asset).toMatchObject({
      id: uploaded.reserved.body.assetId,
      purpose: 'memory',
      kind: 'photo',
      originalStatus: 'stored',
      renditionStatus: 'ready',
    })

    const memory = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
        kind: 'photo', childId: family.body.child.id, body: '',
        occurredAt: new Date(Date.now() - 30_000).toISOString(),
        mediaIds: [uploaded.reserved.body.assetId],
      }, randomUUID(),
    )
    expect(memory.response.status).toBe(201)
    expect(memory.body.attachments).toHaveLength(1)
    const feed = await jsonRequest(`/api/v1/families/${family.body.family.id}/memories`, viewer.token, 'GET')
    expect(feed.response.status).toBe(200)
    expect(feed.body.items).toContainEqual(expect.objectContaining({
      id: memory.body.id,
      kind: 'photo',
      attachments: [expect.objectContaining({ id: uploaded.reserved.body.assetId })],
    }))

    const contentPath = `/api/v1/families/${family.body.family.id}/media/${uploaded.reserved.body.assetId}/content?variant=original`
    const head = await app.request(contentPath, {
      method: 'HEAD', headers: { Authorization: `Bearer ${viewer.token}` },
    })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(pngFixture.byteLength))
    expect(head.headers.get('cache-control')).toBe('private, no-store')
    expect(head.headers.get('referrer-policy')).toBe('no-referrer')

    const partial = await app.request(contentPath, {
      headers: { Authorization: `Bearer ${viewer.token}`, Range: 'bytes=8-19' },
    })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 8-19/${pngFixture.byteLength}`)
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(pngFixture.subarray(8, 20))

    const mediaSession = await app.request(`/api/v1/families/${family.body.family.id}/media/playback-session`, {
      method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` },
    })
    expect(mediaSession.status).toBe(204)
    const mediaCookie = mediaSession.headers.get('set-cookie')?.split(';')[0]
    expect(mediaCookie).toMatch(/^our_memories_media_access=/)

    const playbackBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32])
    const playbackKey = `media-playback/${uploaded.reserved.body.assetId}`
    await privateStorage.storage.writeObject({
      key: playbackKey,
      body: new Blob([playbackBytes]).stream(),
      contentLength: playbackBytes.byteLength,
      contentType: 'audio/mp4',
    })
    await prisma.mediaVariant.create({ data: {
      familyId: family.body.family.id,
      mediaId: uploaded.reserved.body.assetId,
      variant: 'playback',
      objectKey: playbackKey,
      sha256: 'a'.repeat(64),
      byteSize: BigInt(playbackBytes.byteLength),
      mime: 'audio/mp4',
      width: null,
      height: null,
      durationMs: 1_000,
      codec: 'mp4a.40.2',
    } })
    const playbackPath = contentPath.replace('variant=original', 'variant=playback')
    const cookieHead = await app.request(playbackPath, { method: 'HEAD', headers: { Cookie: mediaCookie! } })
    expect(cookieHead.status).toBe(200)
    expect(cookieHead.headers.get('content-type')).toBe('audio/mp4')
    const playbackRange = await app.request(playbackPath, {
      headers: { Cookie: mediaCookie!, Range: 'bytes=0-1023' },
    })
    expect(playbackRange.status).toBe(206)
    expect(playbackRange.headers.get('accept-ranges')).toBe('bytes')
    expect(playbackRange.headers.get('content-range')).toBe(`bytes 0-${playbackBytes.byteLength - 1}/${playbackBytes.byteLength}`)
    expect(playbackRange.headers.get('content-type')).toBe('audio/mp4')

    const cookieRange = await app.request(contentPath, {
      headers: { Cookie: mediaCookie!, Range: 'bytes=8-19' },
    })
    expect(cookieRange.status).toBe(206)
    expect(cookieRange.headers.get('accept-ranges')).toBe('bytes')
    expect(cookieRange.headers.get('content-range')).toBe(`bytes 8-19/${pngFixture.byteLength}`)
    expect(cookieRange.headers.get('content-length')).toBe('12')
    expect(cookieRange.headers.get('content-type')).toBe('image/png')
    expect((await app.request(contentPath, { headers: { Range: 'bytes=0-3' } })).status).toBe(401)
    expect((await app.request(`/api/v1/families/${family.body.family.id}`)).status).toBe(401)
    expect((await app.request(playbackPath, {
      headers: { Cookie: await expiredCookie(viewer.userId, viewer.sessionId) },
    })).status).toBe(401)

    expect((await app.request(contentPath, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    })).status).toBe(404)
    expect((await app.request(contentPath.replace(family.body.family.id, foreignFamily.body.family.id), {
      headers: { Cookie: mediaCookie! },
    })).status).toBe(404)
    for (const request of [
      app.request(contentPath.replace('variant=original', 'variant=preview'), { method: 'HEAD', headers: { Authorization: `Bearer ${outsider.token}` } }),
      app.request(contentPath, { headers: { Authorization: `Bearer ${outsider.token}`, Range: 'bytes=0-3' } }),
    ]) expect((await request).status).toBe(404)
    const unsatisfiable = await app.request(contentPath, {
      headers: { Authorization: `Bearer ${viewer.token}`, Range: 'bytes=999-' },
    })
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get('content-range')).toBe(`bytes */${pngFixture.byteLength}`)

    const revoked = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${viewer.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: viewerMembership.version },
    )
    expect(revoked.response.status).toBe(204)
    expect((await app.request(contentPath, { headers: { Cookie: mediaCookie! } })).status).toBe(404)

    const deleted = await app.request(`/api/v1/families/${family.body.family.id}/memories/${memory.body.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${owner.token}`, 'If-Match': String(memory.body.version) },
    })
    expect(deleted.status).toBe(204)
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: `media-delete:${uploaded.reserved.body.assetId}` } })).toBe(1)
    expect((await app.request(contentPath, { headers: { Cookie: mediaCookie! } })).status).toBe(404)
  })

  test('finalized private videos enqueue and publish one authenticated poster without mutating playback state', async () => {
    const owner = await admittedUser('Video poster owner', '43020')
    const outsider = await admittedUser('Video poster outsider', '43021')
    const family = await createFamily(owner.token, 'Video poster family')
    const foreignFamily = await createFamily(outsider.token, 'Other video poster family')
    const videoApp = createApp({ env: { ...env, MEDIA_FAMILY_QUOTA_BYTES: 1_000_000 }, prisma, privateStorage })
    const sourceRoot = await mkdtemp(join(tmpdir(), 'video-poster-upload-'))
    try {
      const sourcePath = join(sourceRoot, 'source.mp4')
      const generated = await createFfmpegRunner({}).run('ffmpeg', [
        '-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1',
        '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', sourcePath,
      ])
      expect(generated.exitCode).toBe(0)
      const videoBytes = new Uint8Array(await Bun.file(sourcePath).arrayBuffer())
      const reservedResponse = await videoApp.request(`/api/v1/families/${family.body.family.id}/uploads`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: 'memory', kind: 'video', contentType: 'video/mp4', byteSize: videoBytes.byteLength }),
      })
      const reserved = await reservedResponse.json() as any
      expect(reservedResponse.status).toBe(201)
      const put = await videoApp.request(reserved.upload.url, {
        method: 'PUT', headers: reserved.upload.headers, body: videoBytes as unknown as BodyInit,
      })
      expect(put.status).toBe(200)
      const finalizedResponse = await videoApp.request(
        `/api/v1/families/${family.body.family.id}/uploads/${reserved.upload.uploadId}/finalize`,
        { method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: '{}' },
      )
      expect(finalizedResponse.status).toBe(200)

      const mediaId = reserved.assetId as string
      const posterTask = await prisma.taskOutbox.findUniqueOrThrow({
        where: { type_dedupeKey: { type: 'media:video-poster', dedupeKey: `media-video-poster:v1:${mediaId}` } },
      })
      expect(posterTask.payload).toEqual({ mediaId })
      expect(await prisma.taskOutbox.count({ where: { type: 'media:video-poster', dedupeKey: `media-video-poster:v1:${mediaId}` } })).toBe(1)
      expect(await prisma.taskOutbox.count({ where: { type: 'media:prepare', dedupeKey: `media-prepare:${mediaId}` } })).toBe(1)

      const memoryResponse = await videoApp.request(`/api/v1/families/${family.body.family.id}/memories`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ kind: 'video', childId: family.body.child.id, body: '', occurredAt: new Date().toISOString(), mediaIds: [mediaId] }),
      })
      expect(memoryResponse.status).toBe(201)
      const createdMemory = await memoryResponse.json() as { id: string }
      const before = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })
      const tasks = createMediaTasks({ prisma, privateStorage, env })
      await Promise.all([
        tasks.createVideoPoster({ mediaId }),
        tasks.createVideoPoster({ mediaId }),
      ])
      const after = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })
      expect(after.updatedAt).toEqual(before.updatedAt)
      expect(after).toMatchObject({ renditionStatus: 'pending', durationMs: before.durationMs, width: before.width, height: before.height })
      expect(await prisma.mediaVariant.count({ where: { mediaId, variant: 'preview' } })).toBe(1)
      const preview = await prisma.mediaVariant.findUniqueOrThrow({ where: { mediaId_variant: { mediaId, variant: 'preview' } } })
      expect(preview).toMatchObject({ objectKey: videoPosterObjectKey(before.originalKey), mime: 'image/jpeg' })
      await prisma.mediaVariant.delete({ where: { mediaId_variant: { mediaId, variant: 'preview' } } })
      await tasks.createVideoPoster({ mediaId })
      const adopted = await prisma.mediaVariant.findUniqueOrThrow({ where: { mediaId_variant: { mediaId, variant: 'preview' } } })
      expect(adopted).toMatchObject({ objectKey: preview.objectKey, sha256: preview.sha256, byteSize: preview.byteSize })
      await expect(createMediaTasks({ prisma, privateStorage, env: { ...env, FFMPEG_PATH: 'video-poster-command-must-not-run' } })
        .createVideoPoster({ mediaId })).resolves.toBeUndefined()

      const path = `/api/v1/families/${family.body.family.id}/media/${mediaId}/content?variant=preview`
      expect((await videoApp.request(path)).status).toBe(401)
      const privateImage = await videoApp.request(path, { headers: { Authorization: `Bearer ${owner.token}` } })
      expect(privateImage.status).toBe(200)
      expect(privateImage.headers.get('content-type')).toContain('image/jpeg')
      expect(Buffer.from(await privateImage.arrayBuffer())).toEqual(Buffer.from(await Bun.file(resolve(storageRoot, 'objects', preview.objectKey)).arrayBuffer()))
      expect((await videoApp.request(path.replace(family.body.family.id, foreignFamily.body.family.id), {
        headers: { Authorization: `Bearer ${outsider.token}` },
      })).status).toBe(404)

      await tasks.prepareAsset({ mediaId })
      const playbackBeforeFailure = await prisma.mediaVariant.findUniqueOrThrow({
        where: { mediaId_variant: { mediaId, variant: 'playback' } },
      })
      const memoryDetailResponse = await videoApp.request(
        `/api/v1/families/${family.body.family.id}/memories/${createdMemory.id}`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      )
      expect(memoryDetailResponse.status).toBe(200)
      const memoryDetail = await memoryDetailResponse.json() as {
        attachments: Array<{
          id: string
          source: string
          previewPath?: string | null
          playbackPath?: string | null
          renditionStatus?: string
        }>
      }
      expect(memoryDetail.attachments).toHaveLength(1)
      expect(memoryDetail.attachments[0]).toMatchObject({
        id: mediaId,
        source: 'private_storage',
        previewPath: path,
        playbackPath: `/api/v1/families/${family.body.family.id}/media/${mediaId}/content?variant=playback`,
        renditionStatus: 'ready',
      })
      await prisma.mediaVariant.delete({ where: { mediaId_variant: { mediaId, variant: 'preview' } } })
      const sourceBeforeFailure = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })
      await expect(createMediaTasks({ prisma, privateStorage, env: { ...env, FFMPEG_PATH: 'video-poster-extractor-does-not-exist' } })
        .createVideoPoster({ mediaId })).rejects.toThrow()
      expect(await prisma.mediaAsset.findUniqueOrThrow({ where: { id: mediaId } })).toEqual(sourceBeforeFailure)
      expect(await prisma.mediaVariant.findUniqueOrThrow({
        where: { mediaId_variant: { mediaId, variant: 'playback' } },
      })).toEqual(playbackBeforeFailure)
      const playbackSession = await videoApp.request(`/api/v1/families/${family.body.family.id}/media/playback-session`, {
        method: 'POST', headers: { Authorization: `Bearer ${owner.token}` },
      })
      const playbackCookie = playbackSession.headers.get('set-cookie')?.split(';', 1)[0]
      expect(playbackSession.status).toBe(204)
      const playbackResponse = await videoApp.request(path.replace('variant=preview', 'variant=playback'), {
        headers: { Cookie: playbackCookie!, Range: 'bytes=0-15' },
      })
      expect(playbackResponse.status).toBe(206)
      expect(playbackResponse.headers.get('content-type')).toContain('video/mp4')
      expect((await playbackResponse.arrayBuffer()).byteLength).toBe(16)

      const failedId = randomUUID()
      const failed = await prisma.mediaAsset.create({ data: {
        id: failedId, familyId: family.body.family.id, uploaderId: owner.userId, sourceKind: 'upload',
        purpose: 'memory', mediaKind: 'video', originalKey: `media-originals/${failedId}.mp4`,
        declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'c'.repeat(64),
        byteSize: BigInt(videoBytes.byteLength), width: 320, height: 240, durationMs: 1_000,
        originalStatus: 'stored', renditionStatus: 'pending',
      } })
      await expect(tasks.createVideoPoster({ mediaId: failed.id })).rejects.toThrow('missing')
      const failedAfter = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: failed.id } })
      expect(failedAfter).toMatchObject({ renditionStatus: 'pending', durationMs: 1_000, width: 320, height: 240 })
      expect(await prisma.mediaVariant.count({ where: { mediaId: failed.id, variant: 'preview' } })).toBe(0)

      const raceId = randomUUID()
      const raceOriginalKey = `media-originals/${raceId}.mp4`
      const racePosterKey = videoPosterObjectKey(raceOriginalKey)
      await privateStorage.storage.writeObject({ key: raceOriginalKey, body: new Blob([videoBytes]).stream(),
        contentLength: videoBytes.byteLength, contentType: 'video/mp4' })
      await prisma.mediaAsset.create({ data: {
        id: raceId, familyId: family.body.family.id, uploaderId: owner.userId, sourceKind: 'upload',
        purpose: 'memory', mediaKind: 'video', originalKey: raceOriginalKey,
        declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'd'.repeat(64),
        byteSize: BigInt(videoBytes.byteLength), width: 320, height: 240, durationMs: 1_000,
        originalStatus: 'stored', renditionStatus: 'pending',
      } })
      await prisma.family.update({ where: { id: family.body.family.id }, data: { storageUsedBytes: { increment: BigInt(videoBytes.byteLength) } } })
      let releaseWrite!: () => void
      let startWrite!: () => void
      const writeStarted = new Promise<void>((resolveStart) => { startWrite = resolveStart })
      const writeBlocked = new Promise<void>((resolveRelease) => { releaseWrite = resolveRelease })
      const raceStorage = new Proxy(privateStorage.storage, {
        get(target, property) {
          if (property === 'writeObject') return async (input: Parameters<typeof target.writeObject>[0]) => {
            if (input.key === racePosterKey) { startWrite(); await writeBlocked }
            return target.writeObject(input)
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const raceTasks = createMediaTasks({ prisma, privateStorage: { ...privateStorage, storage: raceStorage } as never, env })
      const posterInFlight = raceTasks.createVideoPoster({ mediaId: raceId })
      await writeStarted
      let requestDeleteLock!: () => void
      const deleteLockRequested = new Promise<void>((resolveRequest) => { requestDeleteLock = resolveRequest })
      const deletion = prisma.$transaction(async (tx) => {
        requestDeleteLock()
        await tx.$queryRaw(Prisma.sql`SELECT id FROM families WHERE id = ${family.body.family.id}::uuid FOR UPDATE`)
        await tx.mediaAsset.update({ where: { id: raceId }, data: { deletedAt: new Date() } })
      })
      await deleteLockRequested
      releaseWrite()
      await Promise.all([posterInFlight, deletion])
      await tasks.deleteAsset({ mediaId: raceId })
      expect(await privateStorage.storage.headObject(racePosterKey)).toBeNull()
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: raceId } })).storageDeletedAt).not.toBeNull()

      const abortedId = randomUUID()
      const abortedOriginalKey = `media-originals/${abortedId}.mp4`
      const abortedPosterKey = videoPosterObjectKey(abortedOriginalKey)
      await privateStorage.storage.writeObject({ key: abortedOriginalKey, body: new Blob([videoBytes]).stream(),
        contentLength: videoBytes.byteLength, contentType: 'video/mp4' })
      await prisma.mediaAsset.create({ data: {
        id: abortedId, familyId: family.body.family.id, uploaderId: owner.userId, sourceKind: 'upload',
        purpose: 'memory', mediaKind: 'video', originalKey: abortedOriginalKey,
        declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: 'e'.repeat(64),
        byteSize: BigInt(videoBytes.byteLength), width: 320, height: 240, durationMs: 1_000,
        originalStatus: 'stored', renditionStatus: 'pending',
      } })
      await prisma.family.update({ where: { id: family.body.family.id }, data: { storageUsedBytes: { increment: BigInt(videoBytes.byteLength) } } })
      let releaseAbortedWrite!: () => void
      let startAbortedWrite!: () => void
      let finishAbortedWriteCleanup!: () => void
      let hasReleasedAbortedWrite = false
      const abortedWriteStarted = new Promise<void>((resolveStart) => { startAbortedWrite = resolveStart })
      const abortedWriteBlocked = new Promise<void>((resolveRelease) => { releaseAbortedWrite = resolveRelease })
      const abortedWriteCleanup = new Promise<void>((resolveCleanup) => { finishAbortedWriteCleanup = resolveCleanup })
      const abortedStorage = new Proxy(privateStorage.storage, {
        get(target, property) {
          if (property === 'writeObject') return async (input: Parameters<typeof target.writeObject>[0]) => {
            if (input.key === abortedPosterKey) { startAbortedWrite(); await abortedWriteBlocked }
            return target.writeObject(input)
          }
          if (property === 'deleteObject') return async (key: string) => {
            await target.deleteObject(key)
            if (key === abortedPosterKey && hasReleasedAbortedWrite) finishAbortedWriteCleanup()
          }
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const abortController = new AbortController()
      const abortedTasks = createMediaTasks({ prisma, privateStorage: { ...privateStorage, storage: abortedStorage } as never, env })
      const abortedPosterTask = abortedTasks.createVideoPoster({ mediaId: abortedId, signal: abortController.signal })
      await abortedWriteStarted
      abortController.abort()
      await expect(abortedPosterTask).rejects.toThrow()
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM families WHERE id = ${family.body.family.id}::uuid FOR UPDATE`)
        await tx.mediaAsset.update({ where: { id: abortedId }, data: { deletedAt: new Date() } })
      })
      await abortedTasks.deleteAsset({ mediaId: abortedId })
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: abortedId } })).storageDeletedAt).not.toBeNull()
      hasReleasedAbortedWrite = true
      releaseAbortedWrite()
      const cleanupObserved = await new Promise<boolean>((resolveCleanup) => {
        const timer = setTimeout(() => resolveCleanup(false), 5_000)
        void abortedWriteCleanup.then(() => { clearTimeout(timer); resolveCleanup(true) })
      })
      expect(cleanupObserved).toBe(true)
      expect(await privateStorage.storage.headObject(abortedPosterKey)).toBeNull()
      expect(await prisma.mediaVariant.count({ where: { mediaId: abortedId, variant: 'preview' } })).toBe(0)
      expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: abortedId } })).storageDeletedAt).not.toBeNull()
    } finally {
      await rm(sourceRoot, { recursive: true, force: true })
    }
  }, 60_000)

  test('serializes quota reservations and viewers cannot reserve uploads', async () => {
    const owner = await admittedUser('Владелец', '43101')
    const viewer = await admittedUser('Зритель', '43102')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    const input = { purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: 100 }

    const attempts = await Promise.all([
      jsonRequest(`/api/v1/families/${family.body.family.id}/uploads`, owner.token, 'POST', input),
      jsonRequest(`/api/v1/families/${family.body.family.id}/uploads`, owner.token, 'POST', input),
    ])
    expect(attempts.map(({ response }) => response.status).sort()).toEqual([201, 413])
    expect((await prisma.family.findUniqueOrThrow({ where: { id: family.body.family.id } })).storageReservedBytes)
      .toBe(100n)

    const denied = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads`, viewer.token, 'POST', input,
    )
    expect(denied.response.status).toBe(403)
  })

  test('revocation after ticket issuance blocks finalize and durably schedules cleanup', async () => {
    const owner = await admittedUser('Владелец', '43201')
    const member = await admittedUser('Участник', '43202')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, member.token, family.body.family.id, 'full')
    const membership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: member.userId } },
    })
    const upload = await reserveAndPut(member.token, family.body.family.id, 'memory', pngFixture)

    const revoked = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: membership.version },
    )
    expect(revoked.response.status).toBe(204)
    const finalized = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads/${upload.reserved.body.upload.uploadId}/finalize`,
      member.token, 'POST', {},
    )
    expect(finalized.response.status).toBe(403)
    expect(await prisma.taskOutbox.count({ where: { type: 'media:delete' } })).toBe(1)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: upload.reserved.body.assetId } })).deletedAt)
      .not.toBeNull()
  })

  test('revocation cannot turn an already finalized asset into a deletion', async () => {
    const owner = await admittedUser('Владелец', '43211')
    const member = await admittedUser('Участник', '43212')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, member.token, family.body.family.id, 'full')
    const membership = await prisma.familyMember.findUniqueOrThrow({
      where: { familyId_userId: { familyId: family.body.family.id, userId: member.userId } },
    })
    const uploaded = await uploadPhoto(member.token, family.body.family.id, 'memory', pngFixture)
    await jsonRequest(
      `/api/v1/families/${family.body.family.id}/members/${member.userId}`,
      owner.token,
      'DELETE',
      { expectedVersion: membership.version },
    )
    const repeated = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads/${uploaded.reserved.body.upload.uploadId}/finalize`, member.token, 'POST', {},
    )
    expect(repeated.response.status).toBe(403)
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: uploaded.reserved.body.assetId } })).deletedAt).toBeNull()
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: `media-delete:${uploaded.reserved.body.assetId}` } })).toBe(0)
  })

  test('retires finalized media that was never attached after the grace period', async () => {
    const owner = await admittedUser('Владелец', '43221')
    const family = await createFamily(owner.token, 'Семья')
    const uploaded = await uploadPhoto(owner.token, family.body.family.id, 'memory', pngFixture)
    await prisma.mediaAsset.update({ where: { id: uploaded.reserved.body.assetId }, data: { createdAt: new Date('2026-09-01T00:00:00Z') } })
    await runBackgroundJob('media:pending:cleanup', { prisma } as any, new Date('2026-09-10T00:00:00Z'))
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: uploaded.reserved.body.assetId } })).deletedAt).not.toBeNull()
    expect(await prisma.taskOutbox.count({ where: { dedupeKey: `media-delete:${uploaded.reserved.body.assetId}` } })).toBe(1)
  })

  test('rejects spoofed image bytes and keeps the cleanup key durable', async () => {
    const owner = await admittedUser('Владелец', '43301')
    const family = await createFamily(owner.token, 'Семья')
    const fake = Buffer.alloc(80, 0x20)
    fake.write('<!doctype html><script>')
    const upload = await reserveAndPut(owner.token, family.body.family.id, 'memory', fake)

    const finalized = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/uploads/${upload.reserved.body.upload.uploadId}/finalize`,
      owner.token, 'POST', {},
    )
    expect(finalized.response.status).toBe(415)
    expect(await prisma.taskOutbox.count({
      where: { type: 'media:delete', dedupeKey: `media-delete:${upload.reserved.body.assetId}` },
    })).toBe(1)
  })

  test('child avatar assets share the lifecycle but cannot be published as MemoryMedia', async () => {
    const owner = await admittedUser('Владелец', '43401')
    const viewer = await admittedUser('Зритель', '43402')
    const full = await admittedUser('Полный доступ', '43403')
    const family = await createFamily(owner.token, 'Семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    await inviteMember(owner.token, full.token, family.body.family.id, 'full')
    expect((await jsonRequest(`/api/v1/families/${family.body.family.id}/uploads`, full.token, 'POST', {
      purpose: 'child_avatar', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength,
    })).response.status).toBe(403)
    const uploaded = await uploadPhoto(owner.token, family.body.family.id, 'child_avatar', pngFixture)
    expect(uploaded.finalized.response.status).toBe(200)

    const memory = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
        kind: 'photo', childId: family.body.child.id, body: '',
        occurredAt: new Date(Date.now() - 30_000).toISOString(),
        mediaIds: [uploaded.reserved.body.assetId],
      }, randomUUID(),
    )
    expect(memory.response.status).toBe(409)

    const completed = await jsonRequest(
      `/api/v1/families/${family.body.family.id}/child`, owner.token, 'PUT', {
        name: 'Ребёнок', birthDate: '2024-02-29', sex: 'girl',
        avatarMediaId: uploaded.reserved.body.assetId,
        avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
        expectedVersion: (await prisma.child.findUniqueOrThrow({
          where: { id: family.body.child.id },
        })).version,
      },
    )
    expect(completed.response.status).toBe(200)
    const avatar = await app.request(
      `/api/v1/families/${family.body.family.id}/media/${uploaded.reserved.body.assetId}/content?variant=display`,
      { headers: { Authorization: `Bearer ${viewer.token}` } },
    )
    expect(avatar.status).toBe(200)
    expect(avatar.headers.get('content-type')).toBe('image/webp')
  })

  test('member avatar content follows active family membership and the current ready avatar id', async () => {
    const owner = await admittedUser('Владелец', '43501')
    const viewer = await admittedUser('Зритель', '43502')
    const outsider = await admittedUser('Посторонний', '43503')
    const family = await createFamily(owner.token, 'Семья')
    const otherFamily = await createFamily(outsider.token, 'Другая семья')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    const key = `avatars/${randomUUID()}`
    await privateStorage.storage.writeObject({
      key, body: new Blob([pngFixture.slice().buffer as ArrayBuffer]).stream(),
      contentLength: pngFixture.byteLength, contentType: 'image/png',
    })
    const sharedCrop = { x: 0.17, y: 0.08, width: 0.62, height: 0.62 }
    const avatar = await prisma.userAvatar.create({ data: {
      userId: owner.userId, state: 'ready', objectKey: key, contentType: 'image/png',
      byteSize: pngFixture.byteLength, expiresAt: new Date(Date.now() + 60_000), readyAt: new Date(), avatarCrop: sharedCrop,
    } })
    const path = `/api/v1/families/${family.body.family.id}/media/avatars/${owner.userId}/${avatar.id}/content`
    const members = await jsonRequest(`/api/v1/families/${family.body.family.id}/members`, viewer.token, 'GET')
    expect(members.body.items.find((item: { userId: string }) => item.userId === owner.userId).avatarPath).toBe(path)
    expect(members.body.items.find((item: { userId: string }) => item.userId === owner.userId).avatarCrop).toEqual(sharedCrop)
    expect(members.body.items.find((item: { userId: string }) => item.userId === viewer.userId).avatarPath).toBeNull()
    const note = await jsonRequest(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
      kind: 'note', childId: family.body.child.id, body: 'Воспоминание', occurredAt: new Date().toISOString(),
    }, randomUUID())
    expect(note.response.status).toBe(201)
    const feed = await jsonRequest(`/api/v1/families/${family.body.family.id}/memories`, viewer.token, 'GET')
    expect(feed.body.items[0].author.avatarPath).toBe(path)
    expect(feed.body.items[0].author.avatarCrop).toEqual(sharedCrop)
    expect((await app.request(path, { headers: { Authorization: `Bearer ${viewer.token}` } })).status).toBe(200)
    expect((await app.request(path, { method: 'HEAD', headers: { Authorization: `Bearer ${owner.token}` } })).status).toBe(200)
    expect((await app.request(path)).status).toBe(401)
    expect((await app.request(path, { headers: { Authorization: `Bearer ${outsider.token}` } })).status).toBe(404)
    const session = await app.request(`/api/v1/families/${family.body.family.id}/media/playback-session`, {
      method: 'POST', headers: { Authorization: `Bearer ${viewer.token}` },
    })
    const cookie = session.headers.get('set-cookie')?.split(';', 1)[0]
    expect(cookie).toBeTruthy()
    expect((await app.request(path, { headers: { Cookie: cookie! } })).status).toBe(200)
    const wrongFamilyPath = path.replace(family.body.family.id, otherFamily.body.family.id)
    expect((await app.request(wrongFamilyPath, { headers: { Authorization: `Bearer ${outsider.token}` } })).status).toBe(404)
    await prisma.userAvatar.delete({ where: { id: avatar.id } })
    expect((await app.request(path, { headers: { Authorization: `Bearer ${viewer.token}` } })).status).toBe(404)
    const replacement = await prisma.userAvatar.create({ data: {
      userId: owner.userId, state: 'ready', objectKey: `avatars/${randomUUID()}`, contentType: 'image/png',
      byteSize: pngFixture.byteLength, expiresAt: new Date(Date.now() + 60_000), readyAt: new Date(),
    } })
    const replacedMembers = await jsonRequest(`/api/v1/families/${family.body.family.id}/members`, viewer.token, 'GET')
    expect(replacedMembers.body.items.find((item: { userId: string }) => item.userId === owner.userId).avatarPath)
      .toBe(path.replace(avatar.id, replacement.id))
    const viewerAvatar = await prisma.userAvatar.create({ data: {
      userId: viewer.userId, state: 'ready', objectKey: `avatars/${randomUUID()}`, contentType: 'image/png',
      byteSize: pngFixture.byteLength, expiresAt: new Date(Date.now() + 60_000), readyAt: new Date(),
    } })
    const viewerPath = `/api/v1/families/${family.body.family.id}/media/avatars/${viewer.userId}/${viewerAvatar.id}/content`
    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: family.body.family.id, userId: viewer.userId } },
      data: { revokedAt: new Date() },
    })
    expect((await app.request(viewerPath, { headers: { Authorization: `Bearer ${owner.token}` } })).status).toBe(404)
  })

  test('MAX poster readiness is authenticated, private, and follows pending, ready, and deleted state', async () => {
    const owner = await admittedUser('Poster owner', '43510')
    const viewer = await admittedUser('Poster viewer', '43511')
    const outsider = await admittedUser('Poster outsider', '43512')
    const family = await createFamily(owner.token, 'Poster family')
    const foreignFamily = await createFamily(outsider.token, 'Other poster family')
    await inviteMember(owner.token, viewer.token, family.body.family.id, 'viewer')
    const created = await jsonRequest(`/api/v1/families/${family.body.family.id}/memories`, owner.token, 'POST', {
      kind: 'note', childId: family.body.child.id, body: 'Synthetic poster readiness memory', occurredAt: new Date().toISOString(),
    }, randomUUID())
    expect(created.response.status).toBe(201)

    const inbox = await prisma.maxInbox.create({ data: { eventKey: `poster-readiness-${randomUUID()}`, botId: 900n,
      eventKind: 'message_created', encryptedPayload: Buffer.from([1]), encryptionIv: Buffer.from([2]), encryptionAuthTag: Buffer.from([3]) } })
    const source = await prisma.maxSource.create({ data: { inboxId: inbox.id, botId: 900n, senderSubject: '43510', recipientId: 900n,
      messageId: `poster-message-${randomUUID()}`, status: 'published', plannedMemoryId: randomUUID(), memoryId: created.body.id,
      userId: owner.userId, familyId: family.body.family.id, childId: family.body.child.id } })
    const reference = await prisma.maxVideoReference.create({ data: { sourceId: source.id, memoryId: created.body.id,
      familyId: family.body.family.id, attachmentPosition: 0, providerAttachmentId: 'synthetic-provider-video' } })
    await prisma.taskOutbox.create({ data: { type: 'max:video-poster', dedupeKey: `max-video-poster:${reference.id}`, payload: { referenceId: reference.id } } })

    const playback = createMaxVideoPlayback({ runtime: { env, prisma, privateStorage } as never, api: {} as never })
    const posterApp = createApp({ env, prisma, privateStorage, maxVideoPlayback: playback })
    const path = `/api/v1/families/${family.body.family.id}/media/max-videos/${reference.id}/poster-readiness`
    expect((await posterApp.request(path)).status).toBe(401)
    const pending = await posterApp.request(path, { headers: { Authorization: `Bearer ${owner.token}` } })
    expect(pending.status).toBe(200)
    expect(pending.headers.get('cache-control')).toBe('private, no-store')
    expect(await pending.json()).toEqual({ state: 'pending' })
    expect((await posterApp.request(path, { headers: { Authorization: `Bearer ${viewer.token}` } })).status).toBe(200)
    expect((await posterApp.request(path, { headers: { Authorization: `Bearer ${outsider.token}` } })).status).toBe(404)
    expect((await posterApp.request(path.replace(family.body.family.id, foreignFamily.body.family.id), {
      headers: { Authorization: `Bearer ${outsider.token}` },
    })).status).toBe(404)

    const assetId = randomUUID()
    await prisma.mediaAsset.create({ data: { id: assetId, familyId: family.body.family.id, uploaderId: owner.userId,
      sourceKind: 'max', purpose: 'memory', mediaKind: 'photo', originalKey: `media-originals/${assetId}`,
      declaredMime: 'image/png', verifiedMime: 'image/png', sha256: 'a'.repeat(64), byteSize: BigInt(pngFixture.byteLength),
      width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready' } })
    await prisma.mediaVariant.create({ data: { familyId: family.body.family.id, mediaId: assetId, variant: 'display',
      objectKey: `media-display/${assetId}`, sha256: 'b'.repeat(64), byteSize: BigInt(pngFixture.byteLength),
      mime: 'image/webp', width: 1, height: 1 } })
    await prisma.maxVideoReference.update({ where: { id: reference.id }, data: { thumbnailMediaId: assetId } })
    const ready = await posterApp.request(path, { headers: { Authorization: `Bearer ${owner.token}` } })
    expect(ready.status).toBe(200)
    expect(ready.headers.get('cache-control')).toBe('private, no-store')
    expect(await ready.json()).toEqual({ state: 'ready', posterPath: `/api/v1/families/${family.body.family.id}/media/${assetId}/content?variant=display` })

    await prisma.memory.update({ where: { id: created.body.id }, data: { status: 'deleted', deletedAt: new Date() } })
    expect((await posterApp.request(path, { headers: { Authorization: `Bearer ${owner.token}` } })).status).toBe(404)
  })

  async function uploadPhoto(token: string, familyId: string, purpose: 'memory' | 'child_avatar', bytes: Uint8Array) {
    const upload = await reserveAndPut(token, familyId, purpose, bytes)
    const finalized = await jsonRequest(
      `/api/v1/families/${familyId}/uploads/${upload.reserved.body.upload.uploadId}/finalize`,
      token, 'POST', {},
    )
    return { ...upload, finalized }
  }

  async function reserveAndPut(token: string, familyId: string, purpose: 'memory' | 'child_avatar', bytes: Uint8Array) {
    const reserved = await jsonRequest(`/api/v1/families/${familyId}/uploads`, token, 'POST', {
      purpose, kind: 'photo', contentType: 'image/png', byteSize: bytes.byteLength,
    })
    expect(reserved.response.status).toBe(201)
    const stored = await app.request(reserved.body.upload.url, {
      method: 'PUT', headers: reserved.body.upload.headers, body: bytes as unknown as BodyInit,
    })
    expect(stored.status).toBe(200)
    return { reserved, stored }
  }

  async function clearFixtures() {
    await prisma.idempotencyRecord.deleteMany()
    await prisma.maxVideoReference.deleteMany()
    await prisma.maxSource.deleteMany()
    await prisma.maxInbox.deleteMany()
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

  async function admittedUser(displayName: string, subject: string) {
    const user = await prisma.user.create({ data: { email: null, displayName } })
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject } })
    const session = await prisma.authSession.create({
      data: {
        userId: user.id, externalIdentityId: identity.id, refreshTokenHash: `hash-${subject}`,
        refreshTokenFamilyHash: `family-${subject}`, expiresAt: new Date(Date.now() + 60_000),
      },
    })
    return { userId: user.id, sessionId: session.id, token: await signAccessToken({ sub: user.id, sessionId: session.id }, env) }
  }

  async function expiredCookie(userId: string, sessionId: string) {
    const token = await new SignJWT({ sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(0)
      .sign(new TextEncoder().encode(env.JWT_SECRET))
    return `${'our_memories_media_access'}=${token}`
  }

  async function createFamily(token: string, name: string) {
    const created = await jsonRequest('/api/v1/families', token, 'POST', {
      name, timezone: 'Europe/Moscow',
    }, randomUUID())
    if (created.response.status === 201) {
      const avatar = await prisma.mediaAsset.create({
        data: {
          familyId: created.body.family.id, uploaderId: created.body.family.ownerUserId,
          sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
          originalKey: `media-originals/${randomUUID()}`, declaredMime: 'image/png', verifiedMime: 'image/png',
          sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: 1n, width: 1, height: 1,
          originalStatus: 'stored', renditionStatus: 'ready',
        },
      })
      const child = await prisma.child.create({
        data: { familyId: created.body.family.id, displayName: 'Test child', birthDate: new Date('2024-01-01T00:00:00.000Z'), sex: 'girl', avatarMediaId: avatar.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 } },
      })
      created.body.child = { id: child.id }
    }
    return created
  }

  async function inviteMember(ownerToken: string, memberToken: string, familyId: string, role: 'full' | 'viewer') {
    const invite = await jsonRequest(
      `/api/v1/families/${familyId}/invites`, ownerToken, 'POST', { role }, randomUUID(),
    )
    await jsonRequest('/api/v1/invites/accept', memberToken, 'POST', { token: invite.body.rawToken })
  }

  async function jsonRequest(
    path: string, token: string, method: string, body?: unknown, idempotencyKey?: string,
  ) {
    const response = await app.request(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    return { response, body: text ? JSON.parse(text) as any : undefined }
  }
})
