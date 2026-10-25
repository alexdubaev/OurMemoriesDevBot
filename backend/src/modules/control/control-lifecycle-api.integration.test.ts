import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { signAccessToken } from '../auth'
import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'

const databaseUrl = requireIntegrationDatabaseUrl()
const prisma = createPrisma(databaseUrl)
const jwtSecret = '0123456789abcdef'.repeat(4)
const ownerId = '90000000-0000-4000-8000-000000000001'
const targetId = '90000000-0000-4000-8000-000000000002'
const ordinaryId = '90000000-0000-4000-8000-000000000003'
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
    await prisma.authSession.deleteMany({ where: { userId: { in: [ownerId, targetId, ordinaryId] } } })
    await prisma.externalIdentity.deleteMany({ where: { userId: { in: [ownerId, targetId, ordinaryId] } } })
    await prisma.family.deleteMany({ where: { id: familyId } })
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, targetId, ordinaryId] } } })
    for (const [index, id] of [ownerId, targetId, ordinaryId].entries()) {
      await prisma.user.create({ data: { id, displayName: `Synthetic lifecycle ${index}` } })
      const identity = await prisma.externalIdentity.create({ data: { userId: id, provider: 'max', subject: `control-lifecycle-api-${index}` } })
      await prisma.authSession.create({ data: { userId: id, externalIdentityId: identity.id, refreshTokenHash: `lifecycle-api-${index}`, expiresAt: new Date(Date.now() + 60_000) } })
    }
    await prisma.family.create({ data: { id: familyId, ownerUserId: targetId, name: 'Synthetic lifecycle family', timezone: 'UTC', members: { create: [{ userId: targetId, role: 'full' }, { userId: ordinaryId, role: 'viewer' }] } } })
  })

  afterAll(async () => {
    await prisma.controlLifecycleCommand.deleteMany({ where: { actorUserId: ownerId } })
    await prisma.controlAccessSnapshot.deleteMany({ where: { OR: [{ familyId }, { userId: targetId }] } })
    await prisma.controlUserDeletionFamily.deleteMany({ where: { familyId } })
    await prisma.controlFamilyDeletion.deleteMany({ where: { familyId } })
    await prisma.controlStorageDelete.deleteMany({ where: { OR: [{ familyId }, { userId: targetId }] } })
    await prisma.controlUserDeletion.deleteMany({ where: { targetUserId: targetId } })
    await prisma.authSession.deleteMany({ where: { userId: { in: [ownerId, targetId, ordinaryId] } } })
    await prisma.externalIdentity.deleteMany({ where: { userId: { in: [ownerId, targetId, ordinaryId] } } })
    await prisma.family.deleteMany({ where: { id: familyId } })
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, targetId, ordinaryId] } } })
    await prisma.$disconnect()
  })

  async function token(id: string) {
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: id } })
    return signAccessToken({ sub: id, sessionId: session.id }, { JWT_SECRET: jwtSecret, ACCESS_TOKEN_TTL_SECONDS: 900 })
  }

  function app() {
    return createApp({ env: loadEnv({ ...baseEnv, CONTROL_ENABLED: 'true', CONTROL_OWNER_USER_IDS: ownerId }), prisma })
  }

  test('exposes deletion previews only through the existing exact MAX owner gate', async () => {
    const control = app()
    const path = `/api/v1/control/users/${targetId}/deletion-preview`
    const anonymous = await control.request(path)
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('cache-control')).toContain('no-store')
    const ordinary = await control.request(path, { headers: { Authorization: `Bearer ${await token(ordinaryId)}` } })
    expect(ordinary.status).toBe(403)
    const owner = await control.request(path, { headers: { Authorization: `Bearer ${await token(ownerId)}` } })
    expect(owner.status).toBe(200)
    expect(owner.headers.get('cache-control')).toContain('no-store')
    const preview = await owner.json() as { targetId: string; state: string; members: number; protectedAccount: boolean; canTrash: boolean; fingerprint: string }
    expect(preview.targetId).toBe(targetId)
    expect(preview.state).toBe('active')
    expect(preview.members).toBe(2)
    expect(preview.protectedAccount).toBe(false)
    expect(preview.canTrash).toBe(true)
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
  })
})
