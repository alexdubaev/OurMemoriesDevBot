import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { signAccessToken } from '../auth'
import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'

const databaseUrl = requireIntegrationDatabaseUrl()
const prisma = createPrisma(databaseUrl)
const jwtSecret = '0123456789abcdef'.repeat(4)
const ownerId = '00000000-0000-4000-8000-000000000001'
const ordinaryId = '00000000-0000-4000-8000-000000000002'
const familyOwnerId = '00000000-0000-4000-8000-000000000003'
const adminId = '00000000-0000-4000-8000-000000000004'
const ids = [ownerId, ordinaryId, familyOwnerId, adminId]

const baseEnv = {
  DATABASE_URL: databaseUrl,
  JWT_SECRET: jwtSecret,
  MAX_ENABLED: 'false',
  CORS_ORIGINS: 'http://localhost:5173',
}

describe('control owner read API authorization', () => {
  beforeEach(async () => {
    await prisma.taskOutbox.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.familyInvite.deleteMany()
    await prisma.family.deleteMany()
    await prisma.user.deleteMany()
    for (const [index, id] of ids.entries()) {
      await prisma.user.create({ data: { id, displayName: `Synthetic ${index}`, role: index === 3 ? 'admin' : 'user' } })
      const identity = await prisma.externalIdentity.create({ data: { userId: id, provider: 'max', subject: `98765${index}` } })
      await prisma.authSession.create({ data: {
        id: `10000000-0000-4000-8000-00000000000${index + 1}`,
        userId: id, externalIdentityId: identity.id, refreshTokenHash: `control-session-${index}`,
        expiresAt: new Date(Date.now() + 60_000),
      } })
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at) VALUES ('20000000-0000-4000-8000-000000000001', ${familyOwnerId}::uuid, '=Synthetic Family', 'UTC', 'active', now(), now())`
      await tx.$executeRaw`INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at) VALUES ('20000000-0000-4000-8000-000000000002', ${ordinaryId}::uuid, 'Second Family', 'UTC', 'active', now(), now())`
      await tx.$executeRaw`INSERT INTO families (id, owner_user_id, name, timezone, status, created_at, updated_at) VALUES ('20000000-0000-4000-8000-000000000003', ${adminId}::uuid, 'Third Family', 'UTC', 'active', now(), now())`
      await tx.$executeRaw`INSERT INTO family_members (family_id, user_id, role) VALUES ('20000000-0000-4000-8000-000000000001', ${familyOwnerId}::uuid, 'full')`
      await tx.$executeRaw`INSERT INTO family_members (family_id, user_id, role) VALUES ('20000000-0000-4000-8000-000000000001', ${ordinaryId}::uuid, 'viewer')`
      await tx.$executeRaw`INSERT INTO family_members (family_id, user_id, role) VALUES ('20000000-0000-4000-8000-000000000002', ${ordinaryId}::uuid, 'full')`
      await tx.$executeRaw`INSERT INTO family_members (family_id, user_id, role) VALUES ('20000000-0000-4000-8000-000000000002', ${familyOwnerId}::uuid, 'viewer')`
      await tx.$executeRaw`INSERT INTO family_members (family_id, user_id, role) VALUES ('20000000-0000-4000-8000-000000000003', ${adminId}::uuid, 'full')`
      await tx.$executeRaw`INSERT INTO family_members (family_id, user_id, role) VALUES ('20000000-0000-4000-8000-000000000003', ${ordinaryId}::uuid, 'viewer')`
      await tx.$executeRaw`UPDATE family_members SET joined_at='2026-10-20T12:00:00Z' WHERE user_id IN (${ordinaryId}::uuid,${familyOwnerId}::uuid)`
    })
    await prisma.familyInvite.createMany({ data: [
      { familyId:'20000000-0000-4000-8000-000000000001',role:'viewer',tokenHash:'a'.repeat(64),expiresAt:new Date(Date.now()+86_400_000),createdBy:ordinaryId },
      { familyId:'20000000-0000-4000-8000-000000000002',role:'viewer',tokenHash:'b'.repeat(64),expiresAt:new Date(Date.now()-86_400_000),createdBy:ordinaryId },
      { familyId:'20000000-0000-4000-8000-000000000003',role:'viewer',tokenHash:'c'.repeat(64),expiresAt:new Date(Date.now()+86_400_000),createdBy:ordinaryId,acceptedBy:ordinaryId,acceptedAt:new Date() },
      { familyId:'20000000-0000-4000-8000-000000000003',role:'viewer',tokenHash:'d'.repeat(64),expiresAt:new Date(Date.now()+86_400_000),createdBy:ordinaryId,revokedAt:new Date() },
    ] })
    await prisma.familyMember.create({ data: { familyId: '20000000-0000-4000-8000-000000000002', userId: adminId, role: 'viewer', revokedAt: new Date() } })
    await prisma.taskOutbox.create({ data: { type: 'control-test', dedupeKey: 'future-pending', payload: {}, scheduledFor: new Date(Date.now() + 60_000) } })
  })

  afterAll(async () => {
    await prisma.taskOutbox.deleteMany()
    await prisma.authSession.deleteMany()
    await prisma.externalIdentity.deleteMany()
    await prisma.family.deleteMany()
    await prisma.user.deleteMany()
    await prisma.$disconnect()
  })

  async function token(id: string) {
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: id } })
    return signAccessToken({ sub: id, sessionId: session.id }, { JWT_SECRET: jwtSecret, ACCESS_TOKEN_TTL_SECONDS: 900 })
  }

  function app(enabled: string, allowlist: string) {
    const env = loadEnv({ ...baseEnv, CONTROL_ENABLED: enabled, CONTROL_OWNER_USER_IDS: allowlist })
    return createApp({ env, prisma })
  }

  test('requires login on every path and exact allowlist membership despite account or family roles', async () => {
    const control = app('true', ownerId)
    const paths = ['/api/v1/control/me', '/api/v1/control/overview', '/api/v1/control/families',
      '/api/v1/control/families/20000000-0000-4000-8000-000000000001', '/api/v1/control/users',
      '/api/v1/control/families/20000000-0000-4000-8000-000000000001/members', '/api/v1/control/families/20000000-0000-4000-8000-000000000001/invites',
      `/api/v1/control/users/${ordinaryId}`, `/api/v1/control/users/${ordinaryId}/memberships`,
      '/api/v1/control/storage', '/api/v1/control/sources', '/api/v1/control/system', '/api/v1/control/events',
      '/api/v1/control/exports/families.csv', '/api/v1/control/exports/users.csv', '/api/v1/control/unknown']
    for (const path of paths) {
      const response = await control.request(path)
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toContain('no-store')
      for (const id of [ordinaryId, familyOwnerId, adminId]) {
        const denied = await control.request(path, { headers: { Authorization: `Bearer ${await token(id)}` } })
        expect(denied.status).toBe(403)
      }
      const allowed = await control.request(path, { headers: { Authorization: `Bearer ${await token(ownerId)}` } })
      expect(allowed.status).toBe(path.endsWith('/unknown') ? 404 : 200)
      expect(allowed.headers.get('cache-control')).toContain('no-store')
    }
  })

  test('is closed when disabled or allowlist is empty', async () => {
    for (const control of [app('false', ownerId), app('true', '')]) {
      const response = await control.request('/api/v1/control/me', { headers: { Authorization: `Bearer ${await token(ownerId)}` } })
      expect(response.status).toBe(403)
    }
  })

  test('bounds owner reads after authorization', async () => {
    const limited = createApp({ env: loadEnv({ ...baseEnv, CONTROL_ENABLED: 'true', CONTROL_OWNER_USER_IDS: ownerId, ADMIN_USERS_READ_RATE_LIMIT_MAX: '2', ADMIN_USERS_READ_RATE_LIMIT_WINDOW_SECONDS: '60' }), prisma })
    const headers = { Authorization: `Bearer ${await token(ownerId)}` }
    // Rejected requests must not consume the owner bucket.
    expect((await limited.request('/api/v1/control/me')).status).toBe(401)
    expect((await limited.request('/api/v1/control/me', { headers })).status).toBe(200)
    expect((await limited.request('/api/v1/control/me', { headers })).status).toBe(200)
    const limitedResponse = await limited.request('/api/v1/control/me', { headers })
    expect(limitedResponse.status).toBe(429)
    expect(limitedResponse.headers.get('cache-control')).toContain('no-store')
  })

  test('returns real aggregate counts and metadata-only family/user rows', async () => {
    const control = app('true', ownerId)
    const headers = { Authorization: `Bearer ${await token(ownerId)}` }
    const overviewResponse = await control.request('/api/v1/control/overview?days=7', { headers })
    expect(overviewResponse.status).toBe(200)
    const overview = await overviewResponse.json()
    expect(overview).toMatchObject({ accountsTotal: 4, accountsWithFamily: 3, familiesActive: 3, activeMemberships: 6, invitePending: 1, accountsWithoutFamily: 1, familyStorageUsedBytes: '0' })
    expect(overview.activeUsers).toMatchObject({ value: null, status: 'not_configured' })

    const familiesResponse = await control.request('/api/v1/control/families?limit=1', { headers })
    expect(familiesResponse.status).toBe(200)
    const families = await familiesResponse.json()
    expect(families.items).toHaveLength(1)
    expect(families.items[0]).toMatchObject({ name: 'Third Family', activeMembers: 2, storageUsedBytes: '0', status: 'active' })
    expect(families.items[0]).not.toHaveProperty('ownerUserId')
    expect(families.nextCursor).toBeTruthy()
    const secondPage = await control.request(`/api/v1/control/families?limit=1&cursor=${encodeURIComponent(families.nextCursor)}`, { headers })
    expect(secondPage.status).toBe(200)
    expect((await secondPage.json()).items[0].id).not.toBe(families.items[0].id)

    const usersResponse = await control.request('/api/v1/control/users?q=Synthetic', { headers })
    expect(usersResponse.status).toBe(200)
    const users = await usersResponse.json()
    expect(users.items).toHaveLength(4)
    expect(users.items.find((item: {id:string}) => item.id === familyOwnerId)).toMatchObject({ activeFamilies: 2, familyNames: ['=Synthetic Family','Second Family'] })
    expect(JSON.stringify(users)).not.toContain('987650')
    const memberPage = await control.request('/api/v1/control/families/20000000-0000-4000-8000-000000000001/members', { headers })
    expect(memberPage.status).toBe(200)
    expect((await memberPage.json()).items).toHaveLength(2)
    const invitePage = await control.request('/api/v1/control/families/20000000-0000-4000-8000-000000000003/invites', { headers })
    expect((await invitePage.json()).items.map((item: {state:string}) => item.state).sort()).toEqual(['accepted','revoked'])

    const csvResponse = await control.request('/api/v1/control/exports/families.csv', { headers })
    expect(csvResponse.status).toBe(200)
    const csvBytes = Buffer.from(await csvResponse.arrayBuffer())
    expect(csvBytes.subarray(0, 3).toString('hex')).toBe('efbbbf')
    const csv = csvBytes.toString('utf8')
    expect(csv).toContain("'=Synthetic Family")
    expect(csv).not.toContain('ownerUserId')
    const userCsvResponse = await control.request('/api/v1/control/exports/users.csv', { headers })
    expect(userCsvResponse.status).toBe(200)
    const thirdExport = await control.request('/api/v1/control/exports/families.csv', { headers })
    expect(thirdExport.status).toBe(429)
    expect(thirdExport.headers.get('cache-control')).toContain('no-store')
    expect((await control.request('/api/v1/control/families?sort=not-allowed', { headers })).status).toBe(400)
    const sqlSpecialSearch = await control.request('/api/v1/control/families?q=%27%20OR%201%3D1%20--', { headers })
    expect(sqlSpecialSearch.status).toBe(200)
    expect((await sqlSpecialSearch.json()).items).toHaveLength(0)
    expect((await control.request('/api/v1/control/users?userId=' + ownerId, { headers })).status).toBe(400)
    expect((await control.request('/api/v1/control/families?cursor=foreign', { headers })).status).toBe(400)
    const familiesByName = await control.request('/api/v1/control/families?sort=name&limit=1', { headers })
    const namedFamilies = await familiesByName.json()
    const namedFamilies2 = await control.request(`/api/v1/control/families?sort=name&limit=1&cursor=${encodeURIComponent(namedFamilies.nextCursor)}`, { headers })
    expect((await namedFamilies2.json()).items[0].name).toBe('Second Family')
    const memberships = await control.request(`/api/v1/control/users/${ordinaryId}/memberships?limit=1`, { headers })
    const membershipsPage = await memberships.json()
    const memberships2 = await control.request(`/api/v1/control/users/${ordinaryId}/memberships?limit=1&cursor=${encodeURIComponent(membershipsPage.nextCursor)}`, { headers })
    expect((await memberships2.json()).items[0].familyId).not.toBe(membershipsPage.items[0].familyId)
    const malformedTimestampCursor = Buffer.from(JSON.stringify({v:1,filter:JSON.stringify({q:'',sort:'createdAt',status:'',maxState:''}),id:'20000000-0000-4000-8000-000000000001',value:'not-a-date'})).toString('base64url')
    const malformedCountCursor = Buffer.from(JSON.stringify({v:1,filter:JSON.stringify({q:'',sort:'activeMembers',status:'',maxState:''}),id:'20000000-0000-4000-8000-000000000001',value:'NaN'})).toString('base64url')
    expect((await control.request(`/api/v1/control/families?cursor=${malformedTimestampCursor}`, { headers })).status).toBe(400)
    expect((await control.request(`/api/v1/control/families?sort=activeMembers&cursor=${malformedCountCursor}`, { headers })).status).toBe(400)
    expect((await control.request(`/api/v1/control/families/20000000-0000-4000-8000-000000000001/members?cursor=${malformedTimestampCursor}`, { headers })).status).toBe(400)
    expect((await control.request(`/api/v1/control/users/${ordinaryId}/memberships?cursor=${malformedTimestampCursor}`, { headers })).status).toBe(400)
    const systemResponse = await control.request('/api/v1/control/system', { headers })
    expect(systemResponse.status).toBe(200)
    expect((await systemResponse.json()).outbox.value).toMatchObject({ pending: 1, oldestDueAgeSeconds: null })
  })

  test('rejects a revoked session and no longer allowlisted owner', async () => {
    const control = app('true', ownerId)
    const ownerToken = await token(ownerId)
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: ownerId } })
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
    expect((await control.request('/api/v1/control/me', { headers: { Authorization: `Bearer ${ownerToken}` } })).status).toBe(401)
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: null } })
    expect((await app('true', ordinaryId).request('/api/v1/control/me', { headers: { Authorization: `Bearer ${ownerToken}` } })).status).toBe(403)
  })
})
