import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [root, mode, statePath, seedPath] = process.argv.slice(2)
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl, 'TEST_DATABASE_URL is required')
assert.equal(process.env.DATABASE_URL, databaseUrl)
const address = new URL(databaseUrl)
assert.equal(address.hostname, '127.0.0.1')
assert.match(address.pathname, /^\/comments_compat_[0-9_]+_test$/)
const { createPrisma } = await import(pathToFileURL(resolve(root, 'backend/src/db.ts')).href)
const { createApp } = await import(pathToFileURL(resolve(root, 'backend/src/app.ts')).href)
const { loadEnv } = await import(pathToFileURL(resolve(root, 'backend/src/env.ts')).href)
const { signAccessToken } = await import(pathToFileURL(resolve(root, 'backend/src/modules/auth/index.ts')).href)
const env = loadEnv({
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  JWT_SECRET: '0123456789abcdef'.repeat(4),
  CORS_ORIGINS: 'http://localhost:5173',
  MAX_ENABLED: 'true',
  MAX_BOT_TOKEN: '987654:comments-compat-synthetic-token',
  MAX_BOT_EXPECTED_USERNAME: 'OurMemoriesMaxBot',
  MAX_WEBHOOK_URL: 'https://api.example.test/webhooks/max',
  MAX_WEBHOOK_SECRET: 'M'.repeat(43),
  MAX_INBOX_ENCRYPTION_KEY: 'B'.repeat(43),
  MAX_MINI_APP_URL: 'https://app.example.test',
  MULTI_FAMILY_ACTIVATION: 'on',
  AUTH_RATE_LIMIT_MAX: '10000',
})
const prisma = createPrisma(databaseUrl)
const app = createApp({ env, prisma })
const request = async (path, token, method = 'GET', body, idempotencyKey) => {
  const response = await app.request('/api/v1' + path, {
    method,
    headers: {
      Origin: 'http://localhost:5173',
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(method === 'DELETE' ? { 'If-Match': '1' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { response, body: text ? JSON.parse(text) : null }
}
try {
  if (mode === 'candidate-before') {
    const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
    // MAX subjects are numeric in the production schema and fixture conventions.
    const subject = `${Date.now()}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
    const identity = await prisma.externalIdentity.create({ data: { userId: seed.userId, provider: 'max', subject } })
    await prisma.pilotAdmission.create({ data: { provider: 'max', subject } })
    const session = await prisma.authSession.create({ data: {
      userId: seed.userId,
      externalIdentityId: identity.id,
      refreshTokenHash: crypto.randomUUID(),
      refreshTokenFamilyHash: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    } })
    const token = await signAccessToken({ sub: seed.userId, sessionId: session.id }, env)
    const path = `/families/${seed.familyId}/memories/${seed.memoryId}/comments`
    const memory = await request(`/families/${seed.familyId}/memories/${seed.memoryId}`, token)
    assert.equal(memory.response.status, 200)
    assert.equal(memory.body.id, seed.memoryId)

    const requestId = crypto.randomUUID()
    const first = await request(path, token, 'POST', { body: 'COM-4 API-created retained comment' }, requestId)
    assert.equal(first.response.status, 201)
    const replay = await request(path, token, 'POST', { body: 'COM-4 API-created retained comment' }, requestId)
    assert.equal(replay.response.status, 200)
    assert.equal(replay.body.comment.id, first.body.comment.id)

    const deletionKey = crypto.randomUUID()
    const doomed = await request(path, token, 'POST', { body: 'COM-4 API-created tombstone' }, deletionKey)
    assert.equal(doomed.response.status, 201)
    const deleted = await request(`${path}/${doomed.body.comment.id}`, token, 'DELETE', undefined, undefined)
    assert.equal(deleted.response.status, 200)
    const listed = await request(path, token)
    assert.equal(listed.response.status, 200)
    assert.ok(listed.body.items.some((item) => item.id === first.body.comment.id && item.body === 'COM-4 API-created retained comment'))
    assert.ok(!listed.body.items.some((item) => item.id === doomed.body.comment.id))
    const stored = await prisma.memoryComment.findUniqueOrThrow({ where: { id: doomed.body.comment.id } })
    assert.ok(stored.deletedAt)

    writeFileSync(statePath, JSON.stringify({ ...seed, token, requestId, requestBody: 'COM-4 API-created retained comment', commentId: first.body.comment.id, tombstoneId: doomed.body.comment.id, tombstoneRequestId: deletionKey }))
    process.stdout.write(JSON.stringify({ success: true, phase: mode, commentId: first.body.comment.id, tombstoneId: doomed.body.comment.id }) + '\n')
  } else {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    const memoryPath = `/families/${state.familyId}/memories/${state.memoryId}`
    const memory = await request(memoryPath, state.token)
    assert.equal(memory.response.status, 200)
    assert.equal(memory.body.id, state.memoryId)
    if (mode.startsWith('old-')) {
      const created = await request(`/families/${state.familyId}/memories`, state.token, 'POST', {
        kind: 'note', childId: state.childId, body: `${mode} runtime memory`, occurredAt: new Date().toISOString(),
      }, crypto.randomUUID())
      assert.equal(created.response.status, 201)
      state.rollbackMemoryIds = [...(state.rollbackMemoryIds ?? []), { id: created.body.id, mode }]
      writeFileSync(statePath, JSON.stringify(state))
      process.stdout.write(JSON.stringify({ success: true, phase: mode, memoryId: created.body.id }) + '\n')
    } else if (mode === 'candidate-after') {
      const commentsPath = `${memoryPath}/comments`
      const listed = await request(commentsPath, state.token)
      assert.equal(listed.response.status, 200)
      assert.ok(listed.body.items.some((item) => item.id === state.commentId && item.body === state.requestBody))
      assert.ok(!listed.body.items.some((item) => item.id === state.tombstoneId))
      const replay = await request(commentsPath, state.token, 'POST', { body: state.requestBody }, state.requestId)
      assert.equal(replay.response.status, 200)
      assert.equal(replay.body.comment.id, state.commentId)
      const deletedReplay = await request(commentsPath, state.token, 'POST', { body: 'COM-4 API-created tombstone' }, state.tombstoneRequestId)
      assert.equal(deletedReplay.response.status, 409)
      assert.equal(deletedReplay.body.error.code, 'CONFLICT')
      for (const rollbackWrite of state.rollbackMemoryIds ?? []) {
        const oldWrite = await request(`/families/${state.familyId}/memories/${rollbackWrite.id}`, state.token)
        assert.equal(oldWrite.response.status, 200)
        assert.equal(oldWrite.body.body, `${rollbackWrite.mode} runtime memory`)
      }
      const tombstone = await prisma.memoryComment.findUniqueOrThrow({ where: { id: state.tombstoneId } })
      assert.ok(tombstone.deletedAt)
      assert.equal(tombstone.body, '')
      process.stdout.write(JSON.stringify({ success: true, phase: mode, commentId: replay.body.comment.id, tombstoneId: tombstone.id }) + '\n')
    } else {
      throw new Error(`Unknown runtime probe mode: ${mode}`)
    }
  }
} finally {
  await prisma.$disconnect()
}
