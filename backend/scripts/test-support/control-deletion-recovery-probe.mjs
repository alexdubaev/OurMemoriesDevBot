import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

const [root, phase, statePath, storageRoot, currentRoot] = process.argv.slice(2)
const load = (path) => import(pathToFileURL(resolve(root, 'backend/src', path)).href)
const [{ createApp }, { createPrisma }, { loadEnv }, { createPrivateStorage }] = await Promise.all([
  load('app.ts'), load('db.ts'), load('env.ts'), load('storage/index.ts'),
])
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl)
const database = new URL(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl)
assert.equal(database.hostname, '127.0.0.1')
assert.match(database.pathname, /^\/control_delete_recovery_[0-9]+_[a-f0-9]+_test$/)
const maxBotToken = '987654:control-delete-recovery-synthetic'
const origin = 'http://localhost:5173'
const envFor = (controlOwnerId = '') => loadEnv({
  DATABASE_URL: databaseUrl, NODE_ENV: 'test', JWT_SECRET: 'control-deletion-recovery-synthetic-secret-0123456789',
  MAX_ENABLED: 'true', MAX_BOT_TOKEN: maxBotToken, MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
  MAX_WEBHOOK_URL: 'https://max.example.test/webhook', MAX_WEBHOOK_SECRET: 'M'.repeat(43), MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
  MAX_MINI_APP_URL: 'https://app.example.test', CORS_ORIGINS: origin, COOKIE_SECURE: 'false', MULTI_FAMILY_ACTIVATION: 'on',
  AUTH_RATE_LIMIT_MAX: '10000', CONTROL_ENABLED: 'true', CONTROL_OWNER_USER_IDS: controlOwnerId,
  PRIVATE_STORAGE_DRIVER: 'filesystem', PRIVATE_STORAGE_LOCAL_ROOT: storageRoot,
  PRIVATE_STORAGE_LOCAL_PUBLIC_URL: 'http://localhost:4000',
})
const prisma = createPrisma(databaseUrl)
const storage = createPrivateStorage(envFor()).storage
let app = createApp({ env: envFor(), prisma })
const request = async (path, token, method = 'GET', body, key = randomUUID(), cookie) => {
  const response = await app.request(`/api/v1${path}`, {
    method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'POST' ? { 'Idempotency-Key': key } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { response, status: response.status, body: text ? JSON.parse(text) : null }
}
const signed = (subject, startParam) => {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: randomUUID(),
    user: JSON.stringify({ id: Number(subject), first_name: 'Deletion recovery synthetic' }) })
  if (startParam) params.set('start_param', startParam)
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return params.toString()
}
const actor = async (subject, firstName) => {
  const result = await request('/auth/max', null, 'POST', { initData: signed(subject) })
  assert.equal(result.status, 200)
  await prisma.pilotAdmission.upsert({ where: { provider_subject: { provider: 'max', subject: String(subject) } },
    create: { provider: 'max', subject: String(subject) }, update: {} })
  const identity = await prisma.externalIdentity.findUniqueOrThrow({ where: { provider_subject: { provider: 'max', subject: String(subject) } } })
  return { id: identity.userId, subject: String(subject), token: result.body.accessToken, cookie: result.response.headers.get('set-cookie')?.split(';', 1)[0], firstName }
}

try {
  if (phase === 'seed-current') {
    const now = new Date()
    const suffix = String(Date.now())
    const operator = await actor(`${suffix}01`, 'Operator')
    const target = await actor(`${suffix}02`, 'Target')
    const purgeOwner = await actor(`${suffix}03`, 'Purge owner')
    const activeOwner = await actor(`${suffix}04`, 'Active owner')
    const activeGuest = await actor(`${suffix}05`, 'Active guest')
    const revokedMember = await actor(`${suffix}06`, 'Previously revoked member')
    const browser = await actor(`${suffix}07`, 'Browser')
    const createOwner = await actor(`${suffix}08`, 'Archived runtime create owner')
    app = createApp({ env: envFor(operator.id), prisma })
    const targetFamily = await request('/families', target.token, 'POST', { name: 'Synthetic grace archive', timezone: 'UTC' })
    assert.equal(targetFamily.status, 201)
    const purgeFamily = await request('/families', purgeOwner.token, 'POST', { name: 'Synthetic permanently purged archive', timezone: 'UTC' })
    assert.equal(purgeFamily.status, 201)
    const activeFamily = await request('/families', activeOwner.token, 'POST', { name: 'Synthetic active archive', timezone: 'UTC' })
    assert.equal(activeFamily.status, 201)
    const targetFamilyId = targetFamily.body.family.id
    const purgeFamilyId = purgeFamily.body.family.id
    const activeFamilyId = activeFamily.body.family.id
    const targetMedia = await seedRetainedVideo({ familyId: targetFamilyId, ownerId: target.id, subject: target.subject, label: 'grace' })
    const purgeMedia = await seedRetainedVideo({ familyId: purgeFamilyId, ownerId: purgeOwner.id, subject: purgeOwner.subject, label: 'purge' })
    const activeMedia = await seedRetainedVideo({ familyId: activeFamilyId, ownerId: activeOwner.id, subject: activeOwner.subject, label: 'active' })
    await completeFirstFamilyChild(activeFamilyId, activeOwner.id)
    await prisma.familyMember.createMany({ data: [
      { familyId: targetFamilyId, userId: activeGuest.id, role: 'viewer' },
      { familyId: targetFamilyId, userId: revokedMember.id, role: 'viewer', revokedAt: new Date('2026-01-01T00:00:00Z') },
    ] })

    const start = await app.request('/api/v1/auth/browser-link/start', { method: 'POST', headers: { Origin: origin } })
    assert.equal(start.status, 200)
    const { challengeId, startParam } = await start.json()
    const verifierCookie = start.headers.get('set-cookie')?.split(';', 1)[0]
    assert.match(verifierCookie, /^web_app_demo_browser_link=/)
    const approve = await app.request(`/api/v1/auth/browser-link/${challengeId}/approve`, {
      method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, initData: signed(target.subject, startParam) }),
    })
    assert.equal(approve.status, 200)

    const lifecycle = await load('modules/control/infrastructure/control-lifecycle.ts')
    const preview = await lifecycle.previewUserDeletion(prisma, target.id, [operator.id, target.id])
    const trashed = await lifecycle.trashControlUser(prisma, {
      actorId: operator.id, targetId: target.id, protectedIds: [operator.id], key: randomUUID(),
      fingerprint: preview.fingerprint, confirmation: target.id,
    }, now)

    const familyPreview = await lifecycle.previewFamilyDeletion(prisma, purgeFamilyId)
    await lifecycle.purgeControlFamily(prisma, {
      actorId: operator.id, targetId: purgeFamilyId, protectedIds: [operator.id], key: randomUUID(),
      fingerprint: familyPreview.fingerprint, confirmation: purgeFamilyId,
    }, now)
    const deletion = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { familyId: purgeFamilyId } })
    await prisma.controlFamilyDeletion.update({ where: { id: deletion.id }, data: { notBefore: new Date(now.getTime() - 60_000) } })

    const failPreview = true
    const failingStorage = new Proxy(storage, { get(targetObject, property) {
      if (property === 'retireObject') return async (key) => {
        if (failPreview && key === purgeMedia.previewKey) throw new Error('synthetic partial purge storage failure')
        return targetObject.retireObject(key)
      }
      const value = Reflect.get(targetObject, property, targetObject)
      return typeof value === 'function' ? value.bind(targetObject) : value
    } })
    const maintenance = await load('modules/control/infrastructure/control-purge.ts')
    await maintenance.runControlDeletionMaintenance({ db: prisma, storage: failingStorage }, new Date(now.getTime() + 17 * 60 * 1000), 10)
    await maintenance.runControlDeletionMaintenance({ db: prisma, storage: failingStorage }, new Date(now.getTime() + 35 * 60 * 1000), 10)
    await maintenance.runControlDeletionMaintenance({ db: prisma, storage: failingStorage }, new Date(now.getTime() + 52 * 60 * 1000), 10)
    const partial = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { id: deletion.id } })
    assert.equal(partial.purgedAt, null)
    assert.equal(await storage.headObject(purgeMedia.originalKey), null)
    assert.notEqual(await storage.headObject(purgeMedia.previewKey), null)
    assert.notEqual(await storage.headObject(targetMedia.originalKey), null)
    assert.notEqual(await storage.headObject(activeMedia.originalKey), null)

    writeFileSync(statePath, JSON.stringify({ operator, target, purgeOwner, activeOwner, activeGuest, revokedMember, browser, createOwner, targetFamilyId, purgeFamilyId, activeFamilyId,
      targetMedia, purgeMedia, activeMedia, browserChallenge: challengeId, verifierCookie,
      browserRefreshCookie: browser.cookie, trashDeletionId: trashed.deletionId, familyPurgeId: deletion.id,
      migrationLedger: await ledgerSnapshot(), }, null, 2))
  } else {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    if (phase === 'd299-runtime') {
      const ledgerBefore = await ledgerSnapshot()
      const oldStorageModule = await load('storage/index.ts')
      const oldStorage = oldStorageModule.createPrivateStorage(envFor()).storage
      const currentStorageModule = await import(pathToFileURL(resolve(currentRoot, 'backend/src/storage/index.ts')).href)
      const currentStorage = currentStorageModule.createPrivateStorage(envFor()).storage
      for (const [label, token] of [['trashed JWT', state.target.token]]) {
        const response = await request('/auth/me', token)
        assert.equal(response.status, 401, `${label} stayed live on archived runtime`)
      }
      assert.equal((await request(`/families/${state.targetFamilyId}`, state.target.token)).status, 401)
      assert.notEqual((await request('/families', state.target.token, 'POST', { name: 'Must stay denied', timezone: 'UTC' })).status, 201)
      const newMaxSession = await request('/auth/max', null, 'POST', { initData: signed(state.target.subject) })
      assert.notEqual(newMaxSession.status, 200, 'archived MAX login created a new session for a trashed account')
      const redeemed = await app.request(`/api/v1/auth/browser-link/${state.browserChallenge}/redeem`, {
        method: 'POST', headers: { Origin: origin, Cookie: `${state.verifierCookie}; ${state.browserRefreshCookie}` },
      })
      assert.notEqual(redeemed.status, 200, 'archived browser redemption created a trashed account session')
      assert.equal(redeemed.headers.get('set-cookie'), null)

      assert.equal((await request(`/families/${state.activeFamilyId}`, state.activeOwner.token)).status, 200)
      const created = await request('/families', state.createOwner.token, 'POST', { name: 'Archived runtime creation', timezone: 'UTC' })
      assert.equal(created.status, 201)
      const invite = await request(`/families/${state.activeFamilyId}/invites`, state.activeOwner.token, 'POST', { role: 'full' })
      assert.equal(invite.status, 201)
      assert.notEqual((await request('/invites/accept', state.target.token, 'POST', { token: invite.body.rawToken })).status, 200)
      const joined = await request('/invites/accept', state.activeGuest.token, 'POST', { token: invite.body.rawToken })
      assert.equal(joined.status, 200)

      const jobs = await load('jobs.ts')
      const tasks = await load('modules/media/index.ts')
      await jobs.runBackgroundJob('media:pending:cleanup', { prisma }, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
      await jobs.runBackgroundJob('media:orphans:reconcile', { prisma, privateStorage: { storage } }, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
      await tasks.createMediaTasks({ prisma, privateStorage: { storage }, env: {} }).deleteAsset({ mediaId: state.targetMedia.mediaId })
      let resumeStream
      let signalStreamReady
      const streamReady = new Promise((resolve) => { signalStreamReady = resolve })
      const streamGate = new Promise((resolve) => { resumeStream = resolve })
      const pausedBody = new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array([91, 92, 93, 94])); signalStreamReady() },
        pull(controller) { return streamGate.then(() => controller.close()) },
      })
      const pausedWrite = oldStorage.writeObject({ key: state.purgeMedia.playbackKey, body: pausedBody, contentLength: 4, contentType: 'video/mp4' })
      await streamReady
      await waitForTemporaryPart(oldStorage.objectPath(state.purgeMedia.playbackKey))
      await currentStorage.retireObject(state.purgeMedia.playbackKey)
      resumeStream()
      await assert.rejects(pausedWrite)
      assert.equal(await storage.headObject(state.purgeMedia.playbackKey), null)
      assert.equal(await oldStorage.headObject(state.purgeMedia.playbackKey), null)
      assert.equal((await stat(oldStorage.objectPath(state.purgeMedia.playbackKey))).isDirectory(), true)
      assert.equal((await oldStorage.listObjects('media-playback/control-delete-recovery/purge')).some(({ key }) => key === state.purgeMedia.playbackKey), false)
      await assert.rejects(oldStorage.deleteObject(state.purgeMedia.playbackKey))
      assert.equal((await stat(oldStorage.objectPath(state.purgeMedia.playbackKey))).isDirectory(), true)
      await prisma.mediaAsset.update({ where: { id: state.purgeMedia.mediaId }, data: { renditionStatus: 'failed' } })
      const oldMedia = await load('modules/media/index.ts')
      await oldMedia.createMediaTasks({ prisma, privateStorage: { storage }, env: { FFMPEG_PATH: 'control-recovery-ffmpeg-must-not-run' } }).prepareAsset({ mediaId: state.purgeMedia.mediaId })
      assert.equal(await storage.headObject(state.purgeMedia.playbackKey), null, 'archived prepareAsset recreated a playback object after the irreversible media fence')
      await assertObjectDigest(state.targetMedia.originalKey, state.targetMedia.originalSha)
      assert.equal(await storage.headObject(state.purgeMedia.originalKey), null, 'archived cleanup reconstructed an irreversibly purged original')
      const graceLedger = await prisma.maxVideoLegacyRetention.findUniqueOrThrow({ where: { mediaId: state.targetMedia.mediaId } })
      assert.equal(graceLedger.recoveredAt instanceof Date, true)
      assert.deepEqual(await ledgerSnapshot(), ledgerBefore)
    } else if (phase === 'current-after') {
      assert.deepEqual(await ledgerSnapshot(), state.migrationLedger)
      const operation = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { id: state.familyPurgeId } })
      const maintenance = await load('modules/control/infrastructure/control-purge.ts')
      const transactionDiagnostics = { failures: [] }
      const diagnosticDb = new Proxy(prisma, { get(target, property) {
        if (property === '$transaction') return (...args) => target.$transaction(...args).catch((error) => {
          transactionDiagnostics.failures.push({ code: error?.code ?? null, message: String(error?.message ?? error) })
          throw error
        })
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
      let at = new Date(Date.now() + 2 * 60 * 60 * 1000)
      for (let pass = 0; pass < 40 && !operation.purgedAt; pass++) {
        await maintenance.runControlDeletionMaintenance({ db: diagnosticDb, storage }, at, 10)
        const latest = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { id: operation.id } })
        if (latest.purgedAt) break
        at = new Date(at.getTime() + 10 * 60 * 1000)
      }
      const completed = await prisma.controlFamilyDeletion.findUniqueOrThrow({ where: { id: operation.id } })
      const pendingObjects = await prisma.controlStorageDelete.findMany({ where: { operationId: operation.id, completedAt: null },
        select: { objectKey: true, notBefore: true, nextAttemptAt: true, lastErrorCode: true } })
      assert.ok(completed.purgedAt, `current cleanup did not resume from stage ${completed.purgeStage}; error=${completed.lastErrorCode}; notBefore=${completed.notBefore.toISOString()}; pending=${JSON.stringify(pendingObjects)}; transaction=${JSON.stringify(transactionDiagnostics.failures)}`)
      assert.equal(await prisma.mediaAsset.findUnique({ where: { id: state.purgeMedia.mediaId } }), null)
      assert.equal(await prisma.maxVideoReference.findUnique({ where: { id: state.purgeMedia.mediaId } }), null)
      assert.equal(await storage.headObject(state.purgeMedia.originalKey), null)
      await assertObjectDigest(state.activeMedia.originalKey, state.activeMedia.originalSha)
      const targetAfter = await prisma.maxVideoLegacyRetention.findUnique({ where: { mediaId: state.targetMedia.mediaId } })
      assert.equal(targetAfter?.recoveredAt instanceof Date, true)
      const lifecycle = await load('modules/control/infrastructure/control-lifecycle.ts')
      await lifecycle.restoreControlUser(prisma, { actorId: state.operator.id, targetId: state.target.id,
        protectedIds: [state.operator.id], key: randomUUID(), deletionId: state.trashDeletionId })
      assert.equal((await prisma.family.findUniqueOrThrow({ where: { id: state.targetFamilyId } })).status, 'active')
      assert.equal((await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: state.targetFamilyId, userId: state.activeGuest.id } } })).revokedAt, null)
      assert.notEqual((await prisma.familyMember.findUniqueOrThrow({ where: { familyId_userId: { familyId: state.targetFamilyId, userId: state.revokedMember.id } } })).revokedAt, null)
    } else throw new Error(`Unknown recovery probe phase: ${phase}`)
  }
  process.stdout.write(JSON.stringify({ phase, success: true }) + '\n')
} finally { await prisma.$disconnect() }

async function waitForTemporaryPart(objectPath) {
  const parent = dirname(objectPath)
  const basename = objectPath.slice(parent.length + 1)
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await readdir(parent)).some((name) => name.startsWith(`${basename}.`) && name.endsWith('.part'))) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('archived_writer_did_not_reach_paused_temporary_file')
}

async function seedRetainedVideo({ familyId, ownerId, subject, label }) {
  const child = await prisma.child.create({ data: { familyId, displayName: `Synthetic ${label} child` } })
  const memory = await prisma.$transaction(async (tx) => {
    const [allocated] = await tx.$queryRaw`
      UPDATE families SET publication_ordinal = publication_ordinal + 1
       WHERE id = ${familyId}::uuid AND unread_tracking_activated_at IS NOT NULL
       RETURNING publication_ordinal AS ordinal
    `
    return tx.memory.create({ data: { familyId, childId: child.id, authorId: ownerId, kind: 'video',
      body: `Synthetic ${label} retained MAX archive`, occurredAt: new Date(), firstPublishedAt: new Date(),
      ...(allocated ? { firstPublishedOrdinal: allocated.ordinal } : {}) } })
  })
  const mediaId = randomUUID()
  const inbox = await prisma.maxInbox.create({ data: { eventKey: `control-delete-recovery-${label}-${randomUUID()}`,
    botId: 1n, eventKind: 'message_created', encryptedPayload: new Uint8Array([1]), encryptionIv: new Uint8Array([2]),
    encryptionAuthTag: new Uint8Array([3]), status: 'processed' } })
  const source = await prisma.maxSource.create({ data: { inboxId: inbox.id, botId: 1n, senderSubject: subject, recipientId: 1n,
    messageId: `synthetic-${label}-${randomUUID()}`, status: 'published', plannedMemoryId: memory.id, memoryId: memory.id,
    userId: ownerId, familyId, childId: child.id } })
  const originalKey = `media-originals/control-delete-recovery/${label}/${randomUUID()}`
  const previewKey = `media-preview/control-delete-recovery/${label}/${randomUUID()}`
  const playbackKey = `media-playback/control-delete-recovery/${label}/${randomUUID()}`
  const originalBytes = new Uint8Array([1, 2, 3, 4])
  const previewBytes = new Uint8Array([5, 6])
  const playbackBytes = new Uint8Array([7, 8, 9])
  const originalSha = createHash('sha256').update(originalBytes).digest('hex')
  const previewSha = createHash('sha256').update(previewBytes).digest('hex')
  const playbackSha = createHash('sha256').update(playbackBytes).digest('hex')
  await storage.writeObject({ key: originalKey, body: new Response(originalBytes).body, contentLength: originalBytes.length, contentType: 'video/mp4' })
  await storage.writeObject({ key: previewKey, body: new Response(previewBytes).body, contentLength: previewBytes.length, contentType: 'image/webp' })
  await storage.writeObject({ key: playbackKey, body: new Response(playbackBytes).body, contentLength: playbackBytes.length, contentType: 'video/mp4' })
  await prisma.mediaAsset.create({ data: { id: mediaId, familyId, uploaderId: ownerId, sourceKind: 'max', purpose: 'memory',
    mediaKind: 'video', originalKey, declaredMime: 'video/mp4', verifiedMime: 'video/mp4', sha256: originalSha,
    byteSize: BigInt(originalBytes.length), originalStatus: 'stored', renditionStatus: 'ready', variants: { create: [
      { variant: 'preview', objectKey: previewKey, sha256: previewSha, byteSize: BigInt(previewBytes.length), mime: 'image/webp', width: 640, height: 360 },
      { variant: 'playback', objectKey: playbackKey, sha256: playbackSha, byteSize: BigInt(playbackBytes.length), mime: 'video/mp4', width: 640, height: 360 },
    ] } } })
  await prisma.memoryMedia.create({ data: { familyId, memoryId: memory.id, mediaId, position: 0 } })
  const attachmentId = `attachment-${label}`
  await prisma.maxSourceAttachment.create({ data: { sourceId: source.id, position: 0, providerKind: 'video',
    providerAttachmentId: attachmentId, plannedMediaId: mediaId, mediaId, status: 'stored' } })
  await prisma.maxVideoReference.create({ data: { id: mediaId, sourceId: source.id, memoryId: memory.id, familyId,
    attachmentPosition: 0, providerAttachmentId: attachmentId } })
  const snapshot = await prisma.$queryRaw`
    SELECT jsonb_build_object(
      'memory', (SELECT to_jsonb(m) FROM memories m WHERE m.id=${memory.id}::uuid AND m.family_id=${familyId}::uuid),
      'memoryMedia', (SELECT to_jsonb(mm) FROM memory_media mm WHERE mm.memory_id=${memory.id}::uuid AND mm.family_id=${familyId}::uuid AND mm.media_id=${mediaId}::uuid AND mm.position=0),
      'mediaAsset', (SELECT to_jsonb(a) FROM media_assets a WHERE a.id=${mediaId}::uuid AND a.family_id=${familyId}::uuid),
      'mediaVariants', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.variant) FROM media_variants v WHERE v.media_id=${mediaId}::uuid), '[]'::jsonb),
      'source', (SELECT to_jsonb(s) FROM max_sources s WHERE s.id=${source.id}::uuid),
      'sourceAttachments', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.position) FROM max_source_attachments a WHERE a.source_id=${source.id}::uuid), '[]'::jsonb)
    ) AS snapshot
  `
  await prisma.maxVideoLegacyRetention.create({ data: { mediaId, familyId, memoryId: memory.id, referenceId: mediaId, sourceId: source.id,
    position: 0, providerMessageId: source.messageId, providerAttachmentId: attachmentId, providerRecipientId: 1n,
    providerChannelId: null, snapshot: snapshot[0].snapshot } })
  return { mediaId, familyId, memoryId: memory.id, originalKey, previewKey, playbackKey, originalSha }
}

async function completeFirstFamilyChild(familyId, ownerId) {
  let child = await prisma.child.findFirst({ where: { familyId, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  if (!child) child = await prisma.child.create({ data: { familyId, displayName: 'Synthetic active child' } })
  const avatar = await prisma.mediaAsset.create({ data: {
    familyId, uploaderId: ownerId, sourceKind: 'upload', purpose: 'child_avatar', mediaKind: 'photo',
    originalKey: `media-originals/control-delete-recovery/avatar/${randomUUID()}`, declaredMime: 'image/png',
    verifiedMime: 'image/png', sha256: createHash('sha256').update('synthetic avatar').digest('hex'),
    byteSize: 14n, width: 64, height: 64, originalStatus: 'stored', renditionStatus: 'ready',
  } })
  await prisma.child.update({ where: { id: child.id }, data: {
    displayName: 'Synthetic active child', birthDate: new Date('2024-03-04T00:00:00.000Z'), sex: 'boy',
    avatarMediaId: avatar.id, avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
  } })
}

async function ledgerSnapshot() {
  return prisma.$queryRaw`SELECT migration_name, checksum, finished_at::text, rolled_back_at::text FROM _prisma_migrations ORDER BY migration_name, started_at, id`
}

async function assertObjectDigest(key, expected) {
  const object = await storage.readObject({ key })
  assert.ok(object)
  const chunks = []
  for await (const chunk of object.body) chunks.push(Buffer.from(chunk))
  assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), expected)
}
