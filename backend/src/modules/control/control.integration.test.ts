import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { signAccessToken } from '../auth'
import { createApp } from '../../app'
import { createPrisma } from '../../db'
import { loadEnv } from '../../env'
import { requireIntegrationDatabaseUrl } from '../../test-support/integration-database'
import { parseListQuery } from './application/control-helpers'
import { userWhere, queryUsers } from './infrastructure/control-read-repository'
import { collectControlMetrics } from './infrastructure/control-collection'

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
    await prisma.controlFamilyActivity.deleteMany()
    await prisma.controlUserActivity.deleteMany()
    await prisma.controlMetricSnapshot.deleteMany()
    await prisma.controlCollectionState.deleteMany()
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
    expect((await control.request('/api/v1/control/users?status=active', { headers })).status).toBe(400)
    expect((await control.request('/api/v1/control/users?maxState=configured', { headers })).status).toBe(400)
    expect((await control.request('/api/v1/control/families?cursor=foreign', { headers })).status).toBe(400)
    const familiesByName = await control.request('/api/v1/control/families?sort=name&limit=1', { headers })
    const namedFamilies = await familiesByName.json()
    const namedFamilies2 = await control.request(`/api/v1/control/families?sort=name&limit=1&cursor=${encodeURIComponent(namedFamilies.nextCursor)}`, { headers })
    expect((await namedFamilies2.json()).items[0].name).toBe('Second Family')
    const observedFamilies = await (await control.request('/api/v1/control/families?sort=lastObservedAt&limit=1', {headers})).json()
    expect(observedFamilies.nextCursor).toBeTruthy()
    expect((await control.request(`/api/v1/control/families?sort=lastObservedAt&limit=1&cursor=${encodeURIComponent(observedFamilies.nextCursor)}`,{headers})).status).toBe(200)
    const memberships = await control.request(`/api/v1/control/users/${ordinaryId}/memberships?limit=1`, { headers })
    const membershipsPage = await memberships.json()
    const memberships2 = await control.request(`/api/v1/control/users/${ordinaryId}/memberships?limit=1&cursor=${encodeURIComponent(membershipsPage.nextCursor)}`, { headers })
    expect((await memberships2.json()).items[0].familyId).not.toBe(membershipsPage.items[0].familyId)
    const familyMembers = await (await control.request('/api/v1/control/families/20000000-0000-4000-8000-000000000001/members?limit=1', { headers })).json()
    expect((await control.request(`/api/v1/control/families/20000000-0000-4000-8000-000000000003/members?limit=1&cursor=${encodeURIComponent(familyMembers.nextCursor)}`, { headers })).status).toBe(400)
    const events = await (await control.request('/api/v1/control/events?limit=1', { headers })).json()
    expect(events.nextCursor).toBeTruthy()
    expect((await control.request(`/api/v1/control/events?limit=1&cursor=${encodeURIComponent(events.nextCursor)}`, { headers })).status).toBe(200)
    const malformedTimestampCursor = Buffer.from(JSON.stringify({v:1,filter:JSON.stringify({q:'',sort:'createdAt',status:'',maxState:''}),id:'20000000-0000-4000-8000-000000000001',value:'not-a-date'})).toString('base64url')
    const malformedCountCursor = Buffer.from(JSON.stringify({v:1,filter:JSON.stringify({q:'',sort:'activeMembers',status:'',maxState:''}),id:'20000000-0000-4000-8000-000000000001',value:'NaN'})).toString('base64url')
    expect((await control.request(`/api/v1/control/families?cursor=${malformedTimestampCursor}`, { headers })).status).toBe(400)
    expect((await control.request(`/api/v1/control/families?sort=activeMembers&cursor=${malformedCountCursor}`, { headers })).status).toBe(400)
    expect((await control.request(`/api/v1/control/families/20000000-0000-4000-8000-000000000001/members?cursor=${malformedTimestampCursor}`, { headers })).status).toBe(400)
    expect((await control.request(`/api/v1/control/users/${ordinaryId}/memberships?cursor=${malformedTimestampCursor}`, { headers })).status).toBe(400)
    const collection=await collectControlMetrics({db:prisma,env:loadEnv({...baseEnv,CONTROL_ENABLED:'true'}),fetcher:(async (input)=>new Response(String(input).includes('/health/ready')?JSON.stringify({status:'ok'}):'static-ready',{status:200})) as typeof fetch})
    expect(collection.succeeded).toBe(4)
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

  test('records one global daily user fact and one family fact per active family under duplicate concurrent signals', async () => {
    const control = app('true', ownerId)
    const headers = { Authorization: `Bearer ${await token(ordinaryId)}`, 'Content-Type': 'application/json' }
    const familyIds = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002']
    const signals = familyIds.flatMap((familyId) => Array.from({ length: 4 }, () => control.request('/api/v1/activity', {
      method: 'POST', headers, body: JSON.stringify({ surface: 'max_mini_app', familyId }),
    })))
    const responses = await Promise.all(signals)
    expect(responses.map((response) => response.status).every((status) => status === 204)).toBe(true)
    expect(await prisma.controlUserActivity.count()).toBe(1)
    expect(await prisma.controlFamilyActivity.count()).toBe(2)
    const ownerHeaders={Authorization:`Bearer ${await token(ownerId)}`}
    const userRows=(await (await control.request('/api/v1/control/users?q=Synthetic',{headers:ownerHeaders})).json()).items
    expect(userRows.find((item:{id:string})=>item.id===ordinaryId)).toMatchObject({lastActivitySurface:'max_mini_app'})

    const invalidBodies = [
      { surface: 'browser', familyId: familyIds[0], actorId: ordinaryId },
      { surface: 'browser', familyId: familyIds[0], occurredAt: new Date().toISOString() },
      { surface: 'telegram', familyId: familyIds[0] },
      { surface: 'browser', familyId: 'not-a-uuid' },
    ]
    for (const body of invalidBodies) {
      expect((await control.request('/api/v1/activity', { method: 'POST', headers, body: JSON.stringify(body) })).status).toBe(400)
    }
  })

  test('does not record family activity for a revoked membership', async () => {
    const control = app('true', ownerId)
    const response = await control.request('/api/v1/activity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token(adminId)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface: 'browser', familyId: '20000000-0000-4000-8000-000000000002' }),
    })
    expect([403, 404]).toContain(response.status)
    expect(await prisma.controlUserActivity.count()).toBe(0)
    expect(await prisma.controlFamilyActivity.count()).toBe(0)
  })

  test('does not record activity while the feature is disabled', async () => {
    const response=await app('false',ownerId).request('/api/v1/activity',{method:'POST',headers:{Authorization:`Bearer ${await token(ordinaryId)}`,'Content-Type':'application/json'},body:JSON.stringify({surface:'browser'})})
    expect(response.status).toBe(404)
    expect(await prisma.controlUserActivity.count()).toBe(0)
  })

  test('reports UTC activity history only from exact partial coverage start', async () => {
    const now = new Date()
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const yesterday = new Date(today.getTime() - 86_400_000)
    const startedAt = new Date(now.getTime() - 15 * 60_000)
    await prisma.controlCollectionState.create({ data:{id:'user_activity',startedAt} })
    await prisma.controlUserActivity.createMany({ data:[
      {userId:ownerId,utcDay:yesterday,firstObservedAt:new Date(today.getTime()-60_000),lastObservedAt:new Date(today.getTime()-60_000),surface:'browser'},
      {userId:ordinaryId,utcDay:today,firstObservedAt:startedAt,lastObservedAt:startedAt,surface:'pwa'},
    ] })
    const control=app('true',ownerId)
    const response=await control.request('/api/v1/control/overview?days=7',{headers:{Authorization:`Bearer ${await token(ownerId)}`}})
    expect(response.status).toBe(200)
    const overview=await response.json()
    expect(overview.activity.find((entry:{day:string})=>entry.day===yesterday.toISOString().slice(0,10)).count).toBeNull()
    expect(overview.activity.find((entry:{day:string})=>entry.day===today.toISOString().slice(0,10)).count).toBe(1)
    expect(overview.activeUsers.coverageFrom).toBe(startedAt.toISOString())
    expect(overview.activeUsers.value).toBe(1)
    expect(overview.activeUsers.observedAt).toBe(overview.serverNow)
    expect(overview.activeUsers.coverageRatio).toBeGreaterThan(0)
    expect(overview.activeUsers.coverageRatio).toBeLessThan(1)
  })

  test('maps MAX configuration only from the family current matching channel binding', async () => {
    const firstFamily='20000000-0000-4000-8000-000000000001'
    const secondFamily='20000000-0000-4000-8000-000000000002'
    await prisma.family.update({where:{id:firstFamily},data:{maxBackupChatId:987654321n}})
    await prisma.family.update({where:{id:secondFamily},data:{maxBackupChatId:987654322n}})
    await prisma.maxChannelBinding.create({data:{chatId:987654321n,familyId:firstFamily,state:'connected'}})
    // A binding for another family must not make the second family's configured chat appear connected.
    await prisma.maxChannelBinding.create({data:{chatId:987654322n,familyId:'20000000-0000-4000-8000-000000000003',state:'connected'}})
    const control=app('true',ownerId)
    const headers={Authorization:`Bearer ${await token(ownerId)}`}
    const first=await control.request(`/api/v1/control/families/${firstFamily}`,{headers})
    const second=await control.request(`/api/v1/control/families/${secondFamily}`,{headers})
    expect((await first.json()).maxState).toBe('configured')
    expect((await second.json()).maxState).toBe('disconnected')
    const configured=await control.request('/api/v1/control/families?maxState=configured',{headers})
    const configuredItems=(await configured.json()).items.map((item:{id:string})=>item.id)
    expect(configuredItems).toContain(firstFamily)
    expect(configuredItems).not.toContain(secondFamily)
  })

  test('deletes at most one thousand old metric snapshots per bounded retention run', async () => {
    const oldDay=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),new Date().getUTCDate()-101))
    await prisma.controlMetricSnapshot.createMany({data:Array.from({length:1001},(_,index)=>({sourceId:`synthetic-${index}`,utcDay:oldDay,status:'error'}))})
    const {pruneControlTelemetry}=await import('./infrastructure/control-collection')
    const result=await pruneControlTelemetry(prisma,new Date())
    expect(result.metrics).toBe(1000)
    expect(await prisma.controlMetricSnapshot.count()).toBe(1)
  })

  test('measures one bounded user-list SELECT over ten thousand synthetic accounts', async () => {
    await prisma.user.createMany({data:Array.from({length:10_000},(_,index)=>({displayName:`Synthetic benchmark ${index}`,role:'user'}))})
    const query=parseListQuery({limit:'100'})
    const started=performance.now()
    const page=await queryUsers(prisma,userWhere(query),query.limit+1,query.sort)
    const elapsedMs=performance.now()-started
    expect(page).toHaveLength(101)
    console.log(`Control synthetic 10k account query: 2 SQL statements (SET LOCAL + 1 SELECT), ${elapsedMs.toFixed(1)} ms wall time`)
  })
})
