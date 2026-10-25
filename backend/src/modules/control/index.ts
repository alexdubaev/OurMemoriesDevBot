import { Hono } from 'hono'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { AuthHttpEnv } from '../auth'
import { AppError } from '../../http/errors'
import {
  controlCursorQuerySchema, controlEventSchema, controlFamilyDetailSchema, controlMeSchema,
  controlFamilyMemberSchema, controlInviteSchema, controlMembershipSchema, controlFamilyRowSchema, controlOverviewSchema, controlPageSchema,
  controlSampleSchema, controlSourceSchema, controlStorageSchema,
  controlSystemSchema, controlUserDetailSchema, controlUserRowSchema,
} from '@web-app-demo/contracts'
import { decodeEventCursor, eventCursor, exportCsv, familyCsvRow, notFound, parseListQuery, sample, userCsvRow, uuidParam, validateChildListQuery, validateUserSort } from './application/control-helpers'
import { familyWhere, listChildren, listFamilies, listUsers, queryEvents, queryFamilyById, queryOverview, queryStorage, querySystem, queryUserById, queryFamilies, queryUsers, userWhere } from './infrastructure/control-read-repository'
import { z } from 'zod'

export function createControlModule({ db, env, requireAuth, ownerReadRateLimit }: {
  db: DbClient
  env: AppEnv
  requireAuth: import('hono').MiddlewareHandler<AuthHttpEnv>
  ownerReadRateLimit: import('hono').MiddlewareHandler<AuthHttpEnv>
}) {
  const routes = new Hono<AuthHttpEnv>()
  const exportsByOwner = new Map<string, number[]>()
  const ownerSet = new Set(env.CONTROL_OWNER_USER_IDS)

  routes.use('/control/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store, max-age=0')
    c.header('Pragma', 'no-cache')
    await next()
  })
  routes.use('/control/*', requireAuth)
  routes.use('/control/*', async (c, next) => {
    if (!env.CONTROL_ENABLED || !ownerSet.has(c.var.user.id) || c.var.user.externalIdentity?.provider !== 'max') {
      throw new AppError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия')
    }
    await next()
  })
  routes.use('/control/*', ownerReadRateLimit)

  routes.get('/control/me', (c) => c.json(controlMeSchema.parse({ allowed: true, serverNow: new Date().toISOString(), features: ['read', 'csv_export'] })))
  routes.get('/control/overview', async (c) => {
    const daysValue = c.req.query('days') ?? '7'
    if (!['7','30','90'].includes(daysValue)) throw new AppError(400,'INVALID_INPUT','Недопустимый период')
    const days = Number(daysValue) as 7|30|90
    const now = new Date()
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1))
    const { totals, registrations } = await queryOverview(db, from, now)
    const activity: Array<{ day: Date; count: bigint | null }> = []
    const activeUsers = sample(null, 'not_configured', 'user_activity', 60, null)
    const result = {
      serverNow: now.toISOString(), days,
      accountsTotal: Number(totals.accounts_total), accountsWithFamily: Number(totals.accounts_with_family),
      familiesActive: Number(totals.families_active), activeMemberships: Number(totals.active_memberships),
      invitePending: Number(totals.invite_pending), accountsWithoutFamily: Number(totals.accounts_total) - Number(totals.accounts_with_family),
      familyStorageUsedBytes: String(totals.storage_bytes), activeUsers,
      registrations: registrations.map(({ day, count }) => ({ day: day.toISOString().slice(0, 10), count: Number(count) })),
      activity: activity.map(({ day, count }) => ({ day: day.toISOString().slice(0, 10), count: count === null ? null : Number(count) })),
    }
    return c.json(controlOverviewSchema.parse(result))
  })

  routes.get('/control/families', async (c) => {
    const query = parseListQuery(c.req.query())
    const page = await listFamilies(db, query, env.MEDIA_FAMILY_QUOTA_BYTES)
    return c.json(controlPageSchema(controlFamilyRowSchema).parse(page))
  })
  routes.get('/control/families/:familyId', async (c) => {
    const id = uuidParam(c.req.param('familyId'))
    const [row] = await queryFamilyById(db, id, env.MEDIA_FAMILY_QUOTA_BYTES)
    if (!row) throw notFound()
    return c.json(controlFamilyRowSchema.parse(row))
  })
  routes.get('/control/families/:familyId/members', async (c) => {
    const id = uuidParam(c.req.param('familyId')); const query = parseListQuery(c.req.query())
    validateChildListQuery(query)
    const page = await listChildren(db, id, query, 'members')
    return c.json(controlPageSchema(controlFamilyMemberSchema).parse(page))
  })
  routes.get('/control/families/:familyId/invites', async (c) => {
    const id = uuidParam(c.req.param('familyId')); const query = parseListQuery(c.req.query())
    validateChildListQuery(query)
    const page = await listChildren(db, id, query, 'invites')
    return c.json(controlPageSchema(controlInviteSchema).parse(page))
  })
  routes.get('/control/users', async (c) => {
    const query = parseListQuery(c.req.query())
    validateUserSort(query)
    const page = await listUsers(db, query)
    return c.json(controlPageSchema(controlUserRowSchema).parse(page))
  })
  routes.get('/control/users/:userId', async (c) => {
    const id = uuidParam(c.req.param('userId')); const [row] = await queryUserById(db, id)
    if (!row) throw notFound()
    return c.json(controlUserRowSchema.parse(row))
  })
  routes.get('/control/users/:userId/memberships', async (c) => {
    const id = uuidParam(c.req.param('userId')); const query = parseListQuery(c.req.query())
    validateChildListQuery(query)
    return c.json(controlPageSchema(controlMembershipSchema).parse(await listChildren(db, id, query, 'memberships')))
  })
  routes.get('/control/storage', async (c) => {
    const { totals, databaseSize } = await queryStorage(db)
    const now = new Date().toISOString()
    const result = {
      familyAccounting: sample({ usedBytes: String(totals.used), reservedBytes: String(totals.reserved), quotaBytes: String(env.MEDIA_FAMILY_QUOTA_BYTES) }, 'ok', 'product_db', 30, now),
      mediaStorage: sample(null, 'not_configured', 'media_storage', 300, null),
      hostFilesystem: sample(null, 'not_configured', 'host_filesystem', 60, null),
      postgres: sample({ usedBytes: String(databaseSize) }, 'ok', 'postgres_size', 300, now),
    }
    return c.json(controlStorageSchema.parse(result))
  })
  routes.get('/control/sources', async (c) => {
    const now = new Date().toISOString()
    return c.json(z.array(controlSourceSchema).parse([
      { id: 'product_db', kind: 'product_db', status: 'ok', observedAt: now, lastAttemptAt: now, errorCode: null },
      { id: 'postgres_size', kind: 'postgres_size', status: 'ok', observedAt: now, lastAttemptAt: now, errorCode: null },
      ...['media_storage','host_filesystem','service_probes','max_binding_state','release_evidence'].map((id) => ({ id, kind: id, status: 'not_configured', observedAt: null, lastAttemptAt: null, errorCode: null })),
    ]))
  })
  routes.get('/control/system', async (c) => {
    const { databaseSize, pending } = await querySystem(db)
    const now = new Date().toISOString()
    const result = {
      serverNow: now, backend: sample(null, 'not_configured', 'backend_probe', 60, null),
      postgresSizeBytes: sample(String(databaseSize), 'ok', 'postgres_size', 300, now),
      staticEntry: sample(null, 'not_configured', 'static_entry', 60, null),
      worker: sample(null, 'not_configured', 'worker_progress', 60, null),
      scheduler: sample(null, 'not_configured', 'scheduler_progress', 60, null),
      outbox: sample({ pending: Number(pending.pending), oldestDueAgeSeconds: pending.age === null ? null : Number(pending.age) }, 'ok', 'product_db', 30, now),
    }
    return c.json(controlSystemSchema.parse(result))
  })
  routes.get('/control/events', async (c) => {
    const query = parseListQuery(c.req.query())
    if (query.sort !== 'createdAt' || query.status || query.maxState) throw new AppError(400,'INVALID_INPUT','Недопустимый фильтр событий')
    const cursor = query.cursor ? decodeEventCursor(query.cursor, query) : null
    const events = await queryEvents(db, query, cursor)
    const items = events.slice(0, query.limit).map((r) => ({ id: String(r.id), type: r.type, occurredAt: (r.occurred_at as Date).toISOString(), familyId: r.family_id, familyName: r.family_name }))
    const last=events[query.limit-1]
    const nextCursor=events.length>query.limit && last ? eventCursor(query,String(last.id),(last.occurred_at as Date).toISOString()) : null
    return c.json({ items: items.map((item) => controlEventSchema.parse(item)), nextCursor })
  })
  routes.get('/control/exports/families.csv', async (c) => { const query=parseListQuery(c.req.query()); return exportCsv(c, exportsByOwner, ['id','name','childName','ownerName','status','createdAt','activeMembers','storageUsedBytes','storageReservedBytes','quotaBytes','publishedMemories','mediaAttachments','maxState','lastObservedAt'], async () => (await queryFamilies(db, familyWhere(query), 10_001, env.MEDIA_FAMILY_QUOTA_BYTES, query.sort)).map(familyCsvRow)) })
  routes.get('/control/exports/users.csv', async (c) => { const query=parseListQuery(c.req.query()); validateUserSort(query); return exportCsv(c, exportsByOwner, ['id','displayName','createdAt','activeFamilies','familyNames','moreFamilies','lastSessionCreatedAt','lastActivityAt'], async () => (await queryUsers(db, userWhere(query), 10_001, query.sort)).map(userCsvRow)) })

  return { routes }
}
