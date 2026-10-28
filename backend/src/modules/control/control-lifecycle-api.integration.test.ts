import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { signAccessToken } from '../auth'
import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { createPrivateStorage } from '../../storage'

const databaseUrl = requireIntegrationDatabaseUrl()
const prisma = createPrisma(databaseUrl)
const jwtSecret = '0123456789abcdef'.repeat(4)
const ownerId = '90000000-0000-4000-8000-000000000001'
const targetId = '90000000-0000-4000-8000-000000000002'
const familyOwnerId = '90000000-0000-4000-8000-000000000003'
const legacyAdminId = '90000000-0000-4000-8000-000000000004'
const familyId = '91000000-0000-4000-8000-000000000001'
const baseEnv = { DATABASE_URL: databaseUrl, JWT_SECRET: jwtSecret, MAX_ENABLED: 'false', CORS_ORIGINS: 'http://localhost:5173' }

describe('Control lifecycle API', () => {
  beforeEach(async () => {
    await prisma.controlLifecycleCommand.deleteMany({ where: { actorUserId: ownerId } })
    await prisma.controlAccessSnapshot.deleteMany({ where: { OR: [{ familyId }, { userId: targetId }] } })
    await prisma.controlUserDeletionFamily.deleteMany({ where: { familyId } })
    await prisma.controlFamilyDeletion.deleteMany({ where: { familyId } })
    await prisma.controlStorageDelete.deleteMany({ where: { OR: [{ familyId }, { userId: targetId }] } })
    await prisma.controlUserDeletion.deleteMany({ where: { targetUserId: targetId } })
    await prisma.taskOutbox.deleteMany()
    await prisma.authSession.deleteMany({ where: { userId: { in: [ownerId, targetId, familyOwnerId, legacyAdminId] } } })
    await prisma.externalIdentity.deleteMany({ where: { userId: { in: [ownerId, targetId, familyOwnerId, legacyAdminId] } } })
    await prisma.family.deleteMany({ where: { id: familyId } })
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, targetId, familyOwnerId, legacyAdminId] } } })
    for (const [index, id] of [ownerId, targetId, familyOwnerId, legacyAdminId].entries()) {
      await prisma.user.create({ data: { id, displayName: `Synthetic lifecycle ${index}`, ...(id === legacyAdminId ? { role: 'admin' } : {}) } })
      const identity = await prisma.externalIdentity.create({ data: { userId: id, provider: 'max', subject: `9876500${index}` } })
      await prisma.authSession.create({ data: { userId: id, externalIdentityId: identity.id, refreshTokenHash: `lifecycle-api-${index}`, expiresAt: new Date(Date.now() + 60_000) } })
    }
    await prisma.family.create({ data: { id: familyId, ownerUserId: familyOwnerId, name: 'Synthetic lifecycle family', timezone: 'UTC', members: { create: [{ userId: targetId, role: 'full' }, { userId: familyOwnerId, role: 'full' }] } } })
  })

  afterAll(async () => {
    await prisma.controlLifecycleCommand.deleteMany({ where: { actorUserId: ownerId } })
    await prisma.controlAccessSnapshot.deleteMany({ where: { OR: [{ familyId }, { userId: targetId }] } })
    await prisma.controlUserDeletionFamily.deleteMany({ where: { familyId } })
    await prisma.controlFamilyDeletion.deleteMany({ where: { familyId } })
    await prisma.controlStorageDelete.deleteMany({ where: { OR: [{ familyId }, { userId: targetId }] } })
    await prisma.controlUserDeletion.deleteMany({ where: { targetUserId: targetId } })
    await prisma.authSession.deleteMany({ where: { userId: { in: [ownerId, targetId, familyOwnerId, legacyAdminId] } } })
    await prisma.externalIdentity.deleteMany({ where: { userId: { in: [ownerId, targetId, familyOwnerId, legacyAdminId] } } })
    await prisma.family.deleteMany({ where: { id: familyId } })
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, targetId, familyOwnerId, legacyAdminId] } } })
    await prisma.$disconnect()
  })

  async function token(id: string) {
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: id } })
    return signAccessToken({ sub: id, sessionId: session.id }, { JWT_SECRET: jwtSecret, ACCESS_TOKEN_TTL_SECONDS: 900 })
  }

  function app(storageDriver: 'filesystem' | 's3' = 'filesystem', retirementSupported = true) {
    const s3 = storageDriver === 's3' ? {
      PRIVATE_STORAGE_DRIVER: 's3', PRIVATE_STORAGE_REGION: 'test-region', PRIVATE_STORAGE_BUCKET: 'control-test',
      PRIVATE_STORAGE_ENDPOINT: 'https://s3.example.test', PRIVATE_STORAGE_ACCESS_KEY_ID: 'synthetic-control-key',
      PRIVATE_STORAGE_SECRET_ACCESS_KEY: 'synthetic-control-secret', PRIVATE_STORAGE_ALLOW_REMOTE_ENDPOINT: 'true',
    } : {}
    const env = loadEnv({ ...baseEnv, ...s3, CONTROL_ENABLED: 'true', CONTROL_OWNER_USER_IDS: ownerId })
    const privateStorage = createPrivateStorage(env)
    if (!retirementSupported) Object.defineProperty(privateStorage.storage, 'retireObject', { value: undefined })
    return createApp({ env, prisma, privateStorage })
  }

  test('exposes deletion previews only through the existing exact MAX owner gate', async () => {
    const control = app()
    const path = `/api/v1/control/users/${targetId}/deletion-preview`
    const anonymous = await control.request(path)
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('cache-control')).toContain('no-store')
    const familyOwner = await control.request(path, { headers: { Authorization: `Bearer ${await token(familyOwnerId)}` } })
    expect(familyOwner.status).toBe(403)
    const legacyAdmin = await control.request(path, { headers: { Authorization: `Bearer ${await token(legacyAdminId)}` } })
    expect(legacyAdmin.status).toBe(403)
    const owner = await control.request(path, { headers: { Authorization: `Bearer ${await token(ownerId)}` } })
    expect(owner.status).toBe(200)
    expect(owner.headers.get('cache-control')).toContain('no-store')
    const preview = await owner.json() as { targetId: string; state: string; members: number; protectedAccount: boolean; retirementSupported: boolean; canTrash: boolean; fingerprint: string }
    expect(preview.targetId).toBe(targetId)
    expect(preview.state).toBe('active')
    expect(preview.members).toBe(1)
    expect(preview.protectedAccount).toBe(false)
    expect(preview.canTrash).toBe(true)
    expect(preview.retirementSupported).toBe(true)
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{64}$/)

    const protectedPreview = await control.request(`/api/v1/control/users/${ownerId}/deletion-preview`, { headers: { Authorization: `Bearer ${await token(ownerId)}` } })
    expect(protectedPreview.status).toBe(200)
    const protectedUser = await protectedPreview.json() as { protectedAccount: boolean; canTrash: boolean }
    expect(protectedUser.protectedAccount).toBe(true)
    expect(protectedUser.canTrash).toBe(false)

    const malformed = await control.request(`/api/v1/control/users/${targetId}/trash`, {
      method: 'POST', headers: { Authorization: `Bearer ${await token(ownerId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: randomUUID(), fingerprint: preview.fingerprint, confirmation: targetId, actorId: ownerId }),
    })
    expect(malformed.status).toBe(400)

    const oversized = await control.request(`/api/v1/control/users/${targetId}/trash`, {
      method: 'POST', headers: { Authorization: `Bearer ${await token(ownerId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ oversized: 'x'.repeat(1_100_000) }),
    })
    expect(oversized.status).toBe(413)

    const ownerHeaders = { Authorization: `Bearer ${await token(ownerId)}` }
    expect((await control.request('/api/v1/control/users/90000000-0000-4000-8000-000000000099/deletion-preview', { headers: ownerHeaders })).status).toBe(404)
    expect((await control.request('/api/v1/control/families/91000000-0000-4000-8000-000000000099/deletion-preview', { headers: ownerHeaders })).status).toBe(404)
    const familyPreviewResponse = await control.request(`/api/v1/control/families/${familyId}/deletion-preview`, { headers: ownerHeaders })
    expect(familyPreviewResponse.status).toBe(200)
    await prisma.family.update({ where: { id: familyId }, data: { status: 'deleting' } })
    const legacyFamily = await control.request(`/api/v1/control/families/${familyId}`, { headers: ownerHeaders })
    expect(legacyFamily.status).toBe(200)
    expect(await legacyFamily.json()).toMatchObject({ status: 'deleting', lifecycleState: 'inactive', deletionId: null, purgeAfter: null })
  })

  test('storage without durable retirement refuses lifecycle mutations and preserves database state', async () => {
    const control = app('s3', false)
    const headers = { Authorization: `Bearer ${await token(ownerId)}`, 'Content-Type': 'application/json' }
    const userPreview = await control.request(`/api/v1/control/users/${targetId}/deletion-preview`, { headers })
    expect(userPreview.status).toBe(200)
    expect(await userPreview.json()).toMatchObject({ retirementSupported: false, canTrash: false })
    const familyPreview = await control.request(`/api/v1/control/families/${familyId}/deletion-preview`, { headers })
    expect(familyPreview.status).toBe(200)
    expect(await familyPreview.json()).toMatchObject({ retirementSupported: false })

    const trash = await control.request(`/api/v1/control/users/${targetId}/trash`, { method: 'POST', headers, body: '{}' })
    const purge = await control.request(`/api/v1/control/families/${familyId}/purge`, { method: 'POST', headers, body: '{}' })
    expect(trash.status).toBe(503)
    expect(purge.status).toBe(503)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { controlState: true } })).toEqual({ controlState: 'active' })
    expect(await prisma.controlFamilyDeletion.count({ where: { familyId } })).toBe(0)
  })

  test('S3 durable retirement preserves the Control trash flow and persists its lifecycle state', async () => {
    const control = app('s3')
    const headers = { Authorization: `Bearer ${await token(ownerId)}`, 'Content-Type': 'application/json' }
    const response = await control.request(`/api/v1/control/users/${targetId}/deletion-preview`, { headers })
    expect(response.status).toBe(200)
    const preview = await response.json() as { retirementSupported: boolean; canTrash: boolean; fingerprint: string }
    expect(preview).toMatchObject({ retirementSupported: true, canTrash: true })
    const trash = await control.request(`/api/v1/control/users/${targetId}/trash`, {
      method: 'POST', headers,
      body: JSON.stringify({ key: randomUUID(), fingerprint: preview.fingerprint, confirmation: targetId }),
    })
    expect(trash.status).toBe(200)
    expect(await prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { controlState: true } })).toEqual({ controlState: 'trashed' })
    expect(await prisma.controlUserDeletion.count({ where: { targetUserId: targetId } })).toBe(1)
  })
})
