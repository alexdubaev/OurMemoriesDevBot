// Runs only inside the roundtrip integration test's private *_test database.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [root, phase, stateFile, storageRoot] = process.argv.slice(2)
const load = (path) => import(pathToFileURL(resolve(root, 'backend/src', path)).href)
const { createApp } = await load('app.ts')
const { createPrisma } = await load('db.ts')
const { loadEnv } = await load('env.ts')
const { createPrivateStorage } = await load('storage/index.ts')
const { pngFixture } = await load('storage/storage-contract.ts')
const { enqueueTask, drainTaskOutbox } = await load('outbox/index.ts')
const { createSourceMemoryPublisher } = await load('modules/memories/infrastructure/source-memory-publisher.ts')
const { createPrismaFamilyAccess } = await load('modules/families/infrastructure/family-access.ts')
const { createMaxAcceptUpdate } = await load('modules/max/application/accept-update.ts')
const { createMaxPayloadCrypto } = await load('modules/max/infrastructure/payload-crypto.ts')
const { PrismaMaxRepository } = await load('modules/max/infrastructure/prisma-max-repository.ts')
const { createMaxTaskProcessor } = await load('modules/max/infrastructure/process-task.ts')
const { MaxProviderError } = await load('modules/max/infrastructure/max-api.ts')
const databaseUrl = process.env.TEST_DATABASE_URL
const address = new URL(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl)
assert.equal(address.hostname, '127.0.0.1')
assert.match(address.pathname, /^\/memoly_rollback_roundtrip_[0-9_]+_test$/)
const botToken = '987654:rollback-synthetic'
const env = loadEnv({
  DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: '0123456789abcdef'.repeat(4),
  MAX_ENABLED: 'true', MAX_BOT_TOKEN: botToken, MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
  MAX_WEBHOOK_URL: 'https://max.example.test/webhook', MAX_WEBHOOK_SECRET: 'M'.repeat(43),
  MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43), MAX_MINI_APP_URL: 'https://app.example.test',
  CORS_ORIGINS: 'http://localhost:5173', COOKIE_SECURE: 'false',
  MULTI_FAMILY_ACTIVATION: 'on', AUTH_RATE_LIMIT_MAX: '10000',
  PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
  PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
})
const prisma = createPrisma(databaseUrl)
const storage = createPrivateStorage(env)
const app = createApp({ env, prisma, privateStorage: storage })
let checks = 0
const equal = (a, b) => { checks++; assert.deepEqual(a, b) }
async function request(path, token, method = 'GET', body, cookie) {
  const response = await app.request('/api/v1' + path, {
    method, headers: { Origin: 'http://localhost:5173',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { response, status: response.status, body: text ? JSON.parse(text) : null }
}
const signed = (id, startParam) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: randomUUID(), user: JSON.stringify({ id, first_name: 'Synthetic rollback' }) })
  if (startParam) params.set('start_param', startParam)
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return params.toString()
}
async function actor(id, cookie) {
  const initData = signed(id)
  const auth = await request('/auth/max', null, 'POST', { initData }, cookie)
  equal(auth.status, 200)
  await prisma.pilotAdmission.upsert({ where: { provider_subject: { provider: 'max', subject: String(id) } },
    create: { provider: 'max', subject: String(id) }, update: {} })
  return { id: auth.body.user.id, token: auth.body.accessToken, initData,
    cookie: auth.response.headers.get('set-cookie').split(';')[0] }
}
async function sessionFromMaxReplay(actor) {
  const hash = new URLSearchParams(actor.initData).get('hash')
  const fingerprintHash = createHash('sha256').update(hash.toLowerCase()).digest('hex')
  const replay = await prisma.maxAuthReplay.findUniqueOrThrow({ where: { fingerprintHash }, select: { sessionId: true } })
  return replay.sessionId
}
async function captureSyntheticMaxVideo(owner, familyRecord, senderId, caption) {
  const providerAttachmentId = 'synthetic-max-video-' + randomUUID()
  const originalMessageId = 'rollback-original-' + randomUUID()
  const outerMessageId = 'rollback-forward-' + randomUUID()
  const originalTimestamp = Date.parse('2026-10-01T10:00:00.000Z')
  const event = {
    kind: 'message_created', senderId: String(senderId), recipientId: '900', messageId: outerMessageId,
    occurredAt: '2026-10-01T10:01:00.000Z', text: null, attachments: [],
    forwardedFrom: { messageId: originalMessageId, timestamp: originalTimestamp,
      attachments: [{ kind: 'video', providerAttachmentId, durationSeconds: 3, width: 320, height: 240 }] },
  }
  const crypto = createMaxPayloadCrypto(env.MAX_INBOX_ENCRYPTION_KEY)
  const accept = createMaxAcceptUpdate({ botId: '900', repository: new PrismaMaxRepository(prisma), encrypt: crypto.encrypt })
  const accepted = await accept(event)
  const task = await prisma.taskOutbox.findFirstOrThrow({ where: { type: 'max:process', dedupeKey: 'max-process:' + accepted.inboxId } })
  const source = await prisma.maxSource.findUniqueOrThrow({ where: { inboxId: accepted.inboxId } })
  const processor = createMaxTaskProcessor({ runtime: { env, prisma }, crypto, api: {
    getMessage: async (messageId) => {
      if (messageId === originalMessageId) throw new MaxProviderError(undefined, false, 404, 'message_not_found')
      return { messageId: outerMessageId, senderId: event.senderId, recipientId: event.recipientId,
        recipientType: 'dialog', text: null, attachments: [],
        forwardedFrom: { messageId: originalMessageId, timestamp: originalTimestamp },
        forwardedAttachments: [{ kind: 'video', providerAttachmentId, currentToken: 'synthetic-video-token',
          inboundDurationSeconds: 3, width: 320, height: 240 }], forwardedText: caption }
    },
    getVideo: async () => ({ width: 320, height: 240, durationMs: 3000, renditions: [{
      url: 'https://maxvd123.okcdn.ru/synthetic.mp4', width: 320, height: 240, contentLength: 12,
    }] }),
  } })
  equal(await processor(task.payload), 'done')
  const memory = await prisma.memory.findUniqueOrThrow({ where: { id: source.plannedMemoryId } })
  const reference = await prisma.maxVideoReference.findFirstOrThrow({ where: { sourceId: source.id } })
  equal(memory.familyId, familyRecord.id)
  equal(memory.authorId, owner.id)
  equal(memory.body, caption)
  equal(memory.status, 'published')
  equal(reference.providerAttachmentId, providerAttachmentId)
  return { id: memory.id, referenceId: reference.id }
}
async function family(owner) {
  const created = await request('/families', owner.token, 'POST', { name: 'Synthetic family', timezone: 'Europe/Moscow' })
  equal(created.status, 201)
  const id = created.body.family.id
  const avatar = await prisma.mediaAsset.create({ data: { familyId: id, uploaderId: owner.id,
    sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo', originalKey: 'media-originals/' + randomUUID(),
    declaredMime: 'image/png', verifiedMime: 'image/png', sha256: 'a'.repeat(64), byteSize: 1n,
    width: 1, height: 1, originalStatus: 'stored', renditionStatus: 'ready' } })
  const child = await prisma.child.create({ data: { familyId: id, displayName: 'Synthetic child',
    birthDate: new Date('2024-01-01'), sex: 'girl', avatarMediaId: avatar.id,
    avatarCrop: { x: 0, y: 0, width: 1, height: 1 } } })
  return { id, childId: child.id }
}
async function invite(owner, target, fam, role) {
  const invitation = await request('/families/' + fam.id + '/invites', owner.token, 'POST', { role })
  equal(invitation.status, 201)
  equal((await request('/invites/accept', target.token, 'POST', { token: invitation.body.rawToken })).status, 200)
}
const note = (who, fam, text) => request('/families/' + fam.id + '/memories', who.token, 'POST',
  { kind: 'note', childId: fam.childId, body: text, occurredAt: '2026-10-01T10:00:00.000Z' })
const assertVideoMemory = async (id, familyId, token, caption, referenceId) => {
  const result = await request('/families/' + familyId + '/memories/' + id, token)
  equal(result.status, 200)
  equal(result.body.body, caption)
  equal(result.body.attachments.map(({ id: attachmentId, source, kind }) => ({ id: attachmentId, source, kind })),
    [{ id: referenceId, source: 'max', kind: 'video' }])
}
try {
  if (phase === 'new' || phase === 'candidate-new') {
    const attested = phase === 'candidate-new'
    const baseId = Date.now()
    const owner = await actor(baseId)
    const independent = await actor(baseId)
    const secondOwner = await actor(baseId + 1)
    const viewer = await actor(baseId + 2)
    const outsider = await actor(baseId + 3)
    const first = await family(owner)
    let video, videoCaption
    if (attested) {
      videoCaption = 'Видео MAX: первая строка\n\nПродолжение — ёжик 🦔'
      video = await captureSyntheticMaxVideo(owner, first, baseId, videoCaption)
    }
    const second = await family(secondOwner)
    await invite(secondOwner, owner, second, 'full')
    await invite(owner, viewer, first, 'viewer')
    const initialNote = await note(owner, first, attested ? 'Кандидат: заметка с точной подписью' : 'new version note')
    equal(initialNote.status, 201)
    equal((await note(owner, second, 'new full-role note')).status, 201)
    equal((await note(viewer, first, 'denied')).status, 403)
    equal((await request('/families/' + first.id + '/memories', outsider.token)).status, 404)
    const reserved = await request('/families/' + first.id + '/uploads', owner.token, 'POST', {
      purpose: 'memory', kind: 'photo', contentType: 'image/png', byteSize: pngFixture.byteLength })
    equal(reserved.status, 201)
    equal((await app.request(reserved.body.upload.url, { method: 'PUT',
      headers: reserved.body.upload.headers, body: pngFixture })).status, 200)
    equal((await request('/families/' + first.id + '/uploads/' + reserved.body.upload.uploadId + '/finalize',
      owner.token, 'POST')).status, 200)
    const photo = await request('/families/' + first.id + '/memories', owner.token, 'POST',
      { kind: 'photo', childId: first.childId, body: attested ? 'Фото: подпись ✓' : '', occurredAt: '2026-10-01T10:00:00.000Z',
        mediaIds: [reserved.body.assetId] })
    equal(photo.status, 201)
    const playback = await request('/families/' + first.id + '/media/playback-session', owner.token, 'POST', {})
    equal(playback.status, 204)
    const mediaCookie = playback.response.headers.get('set-cookie').split(';')[0]
    const mediaPath = '/api/v1/families/' + first.id + '/media/' + reserved.body.assetId + '/content?variant=original'
    equal((await app.request(mediaPath, { headers: { Cookie: mediaCookie } })).status, 200)
    await actor(baseId + 3, owner.cookie) // F12 must revoke only the replaced browser session.
    equal((await request('/auth/me', owner.token)).status, 401)
    equal((await request('/auth/me', independent.token)).status, 200)
    const queued = { memoryId: randomUUID(), familyId: first.id, childId: first.childId, authorId: owner.id }
    await enqueueTask(prisma, { type: 'rollback:publish', dedupeKey: queued.memoryId, payload: queued },
      { 'rollback:publish': { run: async () => {} } })
    const state = { owner, independent, viewer, outsider, first, second, queued,
      initialNoteId: initialNote.body.id, photoId: photo.body.id, ...(video && { videoId: video.id, videoCaption,
        videoReferenceId: video.referenceId }), mediaPath, mediaCookie }
    writeFileSync(stateFile, JSON.stringify(state))
  } else {
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    const { owner, independent, viewer, outsider, first, second } = state
    const hub = await request('/me/families', independent.token)
    equal(hub.status, 200)
    equal(hub.body.items.length, 2)
    equal(hub.body.items.every((item) => item.unreadState === 'ready'), true)
    const noteResult = await request('/families/' + first.id + '/memories/' + state.initialNoteId, viewer.token)
    equal(noteResult.status, 200)
    equal(noteResult.body.body, state.videoId ? 'Кандидат: заметка с точной подписью' : 'new version note')
    const photoResult = await request('/families/' + first.id + '/memories/' + state.photoId, independent.token)
    equal(photoResult.status, 200)
    if (state.videoId) {
      equal(photoResult.body.body, 'Фото: подпись ✓')
      await assertVideoMemory(state.videoId, first.id, independent.token, state.videoCaption, state.videoReferenceId)
    }
    equal((await request('/families/' + first.id + '/memories', outsider.token)).status, state.outsiderAdmitted ? 200 : 404)
    equal((await request('/auth/me', owner.token)).status, 401)
    equal((await request('/auth/me', independent.token)).status, 200)
    equal((await app.request(state.mediaPath, { headers: { Cookie: state.mediaCookie } })).status, 401)
    equal((await app.request(state.mediaPath, { headers: { Authorization: 'Bearer ' + independent.token } })).status, 200)
    equal((await note(viewer, first, 'still denied')).status, 403)
    if (phase === 'candidate-old') {
      const maxA = Date.now() + 100
      const maxB = maxA + 1
      const maxC = maxA + 2
      const maxD = maxA + 3
      const aFirst = await actor(maxA)
      const aIndependent = await actor(maxA)
      const replacedSessionId = await sessionFromMaxReplay(aFirst)
      const independentSessionId = await sessionFromMaxReplay(aIndependent)
      equal(replacedSessionId !== independentSessionId, true)
      const b = await actor(maxB, aFirst.cookie)
      equal((await request('/auth/me', aFirst.token)).status, 401)
      equal((await request('/auth/me', aIndependent.token)).status, 200)
      equal((await request('/auth/me', b.token)).status, 200)
      const replacedSession = await prisma.authSession.findUniqueOrThrow({ where: { id: replacedSessionId } })
      equal(replacedSession.revokedAt !== null, true)
      equal((await prisma.authSession.findUniqueOrThrow({ where: { id: independentSessionId } })).revokedAt, null)
      const bSessionId = await sessionFromMaxReplay(b)
      const bSession = await prisma.authSession.findUniqueOrThrow({ where: { id: bSessionId } })
      equal(bSession.id !== replacedSessionId && bSession.id !== independentSessionId, true)

      const revokedCookieAttempt = await request('/auth/max', null, 'POST', { initData: signed(maxC) }, aFirst.cookie)
      equal(revokedCookieAttempt.status, 401)
      equal(revokedCookieAttempt.response.headers.get('set-cookie'), null)
      const recoveredC = await actor(maxC)
      equal((await request('/auth/me', recoveredC.token)).status, 200)
      const protectedSessionIds = [independentSessionId, bSessionId, await sessionFromMaxReplay(recoveredC)]
      const protectedSessions = await prisma.authSession.findMany({ where: { id: { in: protectedSessionIds } } })
      equal(protectedSessions.length, protectedSessionIds.length)
      const sessionsBeforeMalformedCookie = await prisma.authSession.count()
      const maxDInitData = signed(maxD)
      const malformedCookieAttempt = await request('/auth/max', null, 'POST', { initData: maxDInitData }, 'web_app_demo_refresh=malformed')
      equal(malformedCookieAttempt.status, 200)
      equal(/^web_app_demo_refresh=.+/.test(malformedCookieAttempt.response.headers.get('set-cookie') ?? ''), true)
      equal((await prisma.authSession.count()), sessionsBeforeMalformedCookie + 1)
      const recoveredDSessionId = await sessionFromMaxReplay({ initData: maxDInitData })
      equal(recoveredDSessionId !== replacedSessionId && recoveredDSessionId !== independentSessionId && recoveredDSessionId !== bSessionId, true)
      equal((await prisma.authSession.findUniqueOrThrow({ where: { id: recoveredDSessionId } })).revokedAt, null)
      const recoveredDMe = await request('/auth/me', malformedCookieAttempt.body.accessToken)
      equal(recoveredDMe.status, 200)
      const recoveredDIdentity = await prisma.externalIdentity.findUniqueOrThrow({
        where: { provider_subject: { provider: 'max', subject: String(maxD) } }, select: { userId: true },
      })
      equal(recoveredDMe.body.user.id, recoveredDIdentity.userId)
      const sessionsAfterMalformedCookie = await prisma.authSession.findMany({ where: { id: { in: protectedSessionIds } } })
      equal(sessionsAfterMalformedCookie.every(({ revokedAt }) => revokedAt === null), true)

      const countBeforeInvalidData = await prisma.authSession.count()
      const invalidData = signed(maxD + 10).replace(/hash=[^&]+/, 'hash=bad')
      const invalidSignedCookieAttempt = await request('/auth/max', null, 'POST', { initData: invalidData }, 'web_app_demo_refresh=malformed')
      equal(invalidSignedCookieAttempt.status, 401)
      equal(invalidSignedCookieAttempt.response.headers.get('set-cookie'), null)
      equal(await prisma.authSession.count(), countBeforeInvalidData)

      const browserId = Date.now() + 200
      const approverId = browserId + 1
      const browser = await actor(browserId)
      const approver = await actor(approverId)
      const browserSessionId = await sessionFromMaxReplay(browser)
      const approverSessionId = await sessionFromMaxReplay(approver)
      const start = await app.request('/api/v1/auth/browser-link/start', { method: 'POST', headers: { Origin: 'http://localhost:5173' } })
      equal(start.status, 200)
      const challenge = await start.json()
      const verifierCookie = start.headers.get('set-cookie').split(';')[0]
      const approve = await app.request('/api/v1/auth/browser-link/' + challenge.challengeId + '/approve', {
        method: 'POST', headers: { Authorization: 'Bearer ' + approver.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true, initData: signed(approverId, challenge.startParam) }),
      })
      equal(approve.status, 200)
      const redeemed = await app.request('/api/v1/auth/browser-link/' + challenge.challengeId + '/redeem', {
        method: 'POST', headers: { Origin: 'http://localhost:5173', Cookie: verifierCookie + '; ' + browser.cookie },
      })
      equal(redeemed.status, 200)
      const linked = await redeemed.json()
      equal((await request('/auth/me', browser.token)).status, 401)
      equal((await request('/auth/me', approver.token)).status, 200)
      equal((await request('/auth/me', aIndependent.token)).status, 200)
      const linkedMe = await request('/auth/me', linked.accessToken)
      equal(linkedMe.status, 200)
      equal(linkedMe.body.user.id, approver.id)
      equal((await prisma.authSession.findUniqueOrThrow({ where: { id: browserSessionId } })).revokedAt !== null, true)
      equal((await prisma.authSession.findUniqueOrThrow({ where: { id: approverSessionId } })).revokedAt, null)
      const approverSessions = await prisma.authSession.findMany({ where: { userId: approver.id, revokedAt: null } })
      equal(approverSessions.length, 2)
      equal(approverSessions.some(({ id }) => id === approverSessionId), true)
      equal(approverSessions.some(({ id }) => id !== approverSessionId && id !== browserSessionId), true)
      equal(await prisma.authSession.count({ where: { userId: browser.id, revokedAt: null } }), 0)
      const written = await note(independent, second, 'old version full-role write')
      equal(written.status, 201)
      state.oldNoteId = written.body.id
      const publisher = createSourceMemoryPublisher(prisma, createPrismaFamilyAccess(prisma))
      const sessionId = await sessionFromMaxReplay(independent)
      const drained = await drainTaskOutbox({ prisma }, { handlers: { 'rollback:publish': { run: async ({ payload }) => {
        await publisher.publish({ familyId: payload.familyId, principal: { userId: payload.authorId, sessionId } },
          { id: payload.memoryId, childId: payload.childId, kind: 'note', body: 'old worker publication',
            occurredAt: new Date('2026-10-01'), sourcePublishedAt: new Date(), mediaIds: [] })
      } } } })
      equal(drained.done, 1)
      equal((await prisma.memory.findUniqueOrThrow({ where: { id: state.queued.memoryId } })).status, 'published')
      await invite(independent, outsider, first, 'viewer')
      equal((await request('/families/' + first.id + '/memories', outsider.token)).status, 200)
      equal((await note(outsider, first, 'still viewer')).status, 403)
      equal((await request('/families/' + first.id + '/memories/seen', viewer.token, 'POST', {
        memoryIds: [state.initialNoteId, state.photoId, ...(state.videoId ? [state.videoId] : []), state.queued.memoryId], expectedMembershipEpoch: 1 })).status, 204)
      equal((await request('/me/families', viewer.token)).body.items[0].unreadCount, 0)
      state.outsiderAdmitted = true
      writeFileSync(stateFile, JSON.stringify(state))
    } else if (phase === 'old') {
      const written = await note(independent, second, 'old version full-role write')
      equal(written.status, 201)
      state.oldNoteId = written.body.id
      const publisher = createSourceMemoryPublisher(prisma, createPrismaFamilyAccess(prisma))
      const sessionId = (await prisma.authSession.findFirstOrThrow({ where: { userId: independent.id, revokedAt: null } })).id
      const drained = await drainTaskOutbox({ prisma }, { handlers: { 'rollback:publish': { run: async ({ payload }) => {
        await publisher.publish({ familyId: payload.familyId, principal: { userId: payload.authorId, sessionId } },
          { id: payload.memoryId, childId: payload.childId, kind: 'note', body: 'old worker publication',
            occurredAt: new Date('2026-10-01'), sourcePublishedAt: new Date(), mediaIds: [] })
      } } } })
      equal(drained.done, 1)
      equal((await prisma.memory.findUniqueOrThrow({ where: { id: state.queued.memoryId } })).status, 'published')
      await invite(independent, outsider, first, 'viewer')
      equal((await request('/families/' + first.id + '/memories', outsider.token)).status, 200)
      // That participant is now legitimately admitted; retain a separate denied-viewer write check.
      equal((await note(outsider, first, 'still viewer')).status, 403)
      equal((await request('/families/' + first.id + '/memories/seen', viewer.token, 'POST', {
        memoryIds: [state.initialNoteId, state.photoId, ...(state.videoId ? [state.videoId] : []), state.queued.memoryId], expectedMembershipEpoch: 1 })).status, 204)
      const viewerHub = await request('/me/families', viewer.token)
      equal(viewerHub.body.items[0].unreadCount, 0)
      state.outsiderAdmitted = true
      writeFileSync(stateFile, JSON.stringify(state))
    } else {
      equal((await request('/families/' + second.id + '/memories/' + state.oldNoteId, independent.token)).status, 200)
      equal((await prisma.taskOutbox.findFirstOrThrow({ where: { dedupeKey: state.queued.memoryId } })).status, 'done')
      equal(await prisma.memorySeen.count({ where: { userId: viewer.id, familyId: first.id } }), state.videoId ? 4 : 3)
      equal((await request('/me/families', viewer.token)).body.items[0].unreadCount, 0)
      if (state.videoId) await assertVideoMemory(state.videoId, first.id, independent.token, state.videoCaption, state.videoReferenceId)
    }
    const published = await prisma.memory.findMany({ where: { familyId: first.id, firstPublishedOrdinal: { not: null } } })
    equal(new Set(published.map((memory) => String(memory.firstPublishedOrdinal))).size, published.length)
    equal((await prisma.family.findUniqueOrThrow({ where: { id: first.id } })).publicationOrdinal, BigInt(published.length))
  }
  console.log(JSON.stringify({ phase, checks, success: true }))
} finally { await prisma.$disconnect() }
