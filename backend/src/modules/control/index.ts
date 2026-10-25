import { Hono } from 'hono'
import type { DbClient } from '../../db'
import type { AppEnv } from '../../env'
import type { PrivateStorage } from '../../storage'
import type { AuthHttpEnv } from '../auth'
import { AppError, errorResponse, requestIdFrom } from '../../http/errors'
import type { ApiErrorCode } from '@web-app-demo/contracts'
import {
  controlCursorQuerySchema, controlEventSchema, controlFamilyDetailSchema, controlMeSchema,
  controlFamilyMemberSchema, controlInviteSchema, controlMembershipSchema, controlFamilyRowSchema, controlOverviewSchema, controlPageSchema,
  controlSampleSchema, controlSourceSchema, controlStorageSchema,
  controlSystemSchema, controlUserDetailSchema, controlUserRowSchema,
  controlFamilyDeletionPreviewSchema, controlLifecycleResultSchema, controlUserDeletionPreviewSchema,
} from '@web-app-demo/contracts'
import { decodeEventCursor, eventCursor, exportCsv, familyCsvRow, notFound, parseListQuery, sample, userCsvRow, uuidParam, validateChildListQuery, validateFamilyListQuery, validateUserSort } from './application/control-helpers'
import { familyWhere, listChildren, listFamilies, listUsers, queryEvents, queryFamilyById, queryOverview, queryStorage, queryUserById, queryFamilies, queryUsers, userWhere } from './infrastructure/control-read-repository'
import { z } from 'zod'
import { bodyLimit } from 'hono/body-limit'
export { collectControlMetrics, createControlCollection, pruneControlTelemetry, readControlMetric, recordControlProgress, withControlReadTimeout } from './infrastructure/control-collection'
export { runControlDeletionMaintenance } from './infrastructure/control-purge'
import { CONTROL_STALE_AFTER_SECONDS, readControlMetric } from './infrastructure/control-collection'
import { withControlReadTimeout } from './infrastructure/control-collection'
import { ControlLifecycleFailure, previewFamilyDeletion, previewUserDeletion, purgeControlFamily, restoreControlUser, trashControlUser } from './infrastructure/control-lifecycle'

export function createControlModule({ db, env, storage, requireAuth, ownerReadRateLimit }: {
  db: DbClient
  env: AppEnv
  storage?: PrivateStorage
  requireAuth: import('hono').MiddlewareHandler<AuthHttpEnv>
  ownerReadRateLimit: import('hono').MiddlewareHandler<AuthHttpEnv>
}) {
  const retirementSupported = typeof storage?.retireObject === 'function'
  const routes = new Hono<AuthHttpEnv>()
  const exportsByOwner = new Map<string, number[]>()
  const mutationRequestsByOwner = new Map<string, number[]>()
  const ownerSet = new Set(env.CONTROL_OWNER_USER_IDS)
  const protectedOwnerIds = [...ownerSet]
  const mutationRateLimit: import('hono').MiddlewareHandler<AuthHttpEnv> = async (c, next) => {
    const owner = c.var.user.id
    const now = Date.now()
    const recent = (mutationRequestsByOwner.get(owner) ?? []).filter((at) => now - at < 60_000)
    if (recent.length >= 20) throw new AppError(429, 'RATE_LIMITED', 'Слишком много операций удаления. Попробуйте позже')
    recent.push(now)
    if (mutationRequestsByOwner.size >= 1_000 && !mutationRequestsByOwner.has(owner)) mutationRequestsByOwner.delete(mutationRequestsByOwner.keys().next().value!)
    mutationRequestsByOwner.set(owner, recent)
    await next()
  }
  const parseLifecycleBody = async <T extends z.ZodType>(c: import('hono').Context<AuthHttpEnv>, schema: T): Promise<z.infer<T>> => {
    let body: unknown
    try { body = await c.req.json() } catch { throw new AppError(400, 'INVALID_INPUT', 'Некорректное тело запроса') }
    const parsed = schema.safeParse(body)
    if (!parsed.success) throw new AppError(400, 'INVALID_INPUT', 'Некорректное тело запроса')
    return parsed.data
  }

  routes.post('/activity', requireAuth, async (c) => {
    if (c.var.user.externalIdentity?.provider !== 'max') {
      throw new AppError(404, 'NOT_FOUND', 'Запись не найдена')
    }
    if (!env.CONTROL_ENABLED) return c.body(null, 204)
    let body: unknown
    try { body = await c.req.json() } catch { throw new AppError(400, 'INVALID_INPUT', 'Некорректное тело запроса') }
    const parsed = z.object({
      surface: z.enum(['max_mini_app', 'pwa', 'browser']),
      familyId: z.string().uuid().optional(),
    }).strict().safeParse(body)
    if (!parsed.success) throw new AppError(400, 'INVALID_INPUT', 'Некорректное тело запроса')

    const now = new Date()
    const utcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`
      if (parsed.data.familyId) {
        const families = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM families WHERE id = ${parsed.data.familyId}::uuid AND status = 'active' FOR UPDATE
        `
        if (!families.length) throw new AppError(404, 'NOT_FOUND', 'Запись не найдена')
        const memberships = await tx.$queryRaw<Array<{ user_id: string }>>`
          SELECT user_id FROM family_members
          WHERE family_id = ${parsed.data.familyId}::uuid AND user_id = ${c.var.user.id}::uuid AND revoked_at IS NULL
          FOR SHARE
        `
        if (!memberships.length) throw new AppError(404, 'NOT_FOUND', 'Запись не найдена')
      }
      await tx.$executeRaw`
        INSERT INTO control_user_activity (user_id, utc_day, first_observed_at, last_observed_at, surface)
        VALUES (${c.var.user.id}::uuid, ${utcDay}::date, ${now}::timestamptz, ${now}::timestamptz, ${parsed.data.surface})
        ON CONFLICT (user_id, utc_day) DO UPDATE SET
          last_observed_at = EXCLUDED.last_observed_at, surface = EXCLUDED.surface
        WHERE EXCLUDED.last_observed_at >= control_user_activity.last_observed_at + INTERVAL '5 minutes'
      `
      if (parsed.data.familyId) {
        await tx.$executeRaw`
          INSERT INTO control_family_activity (family_id, user_id, utc_day, first_observed_at, last_observed_at)
          VALUES (${parsed.data.familyId}::uuid, ${c.var.user.id}::uuid, ${utcDay}::date, ${now}::timestamptz, ${now}::timestamptz)
          ON CONFLICT (family_id, user_id, utc_day) DO UPDATE SET last_observed_at = EXCLUDED.last_observed_at
          WHERE EXCLUDED.last_observed_at >= control_family_activity.last_observed_at + INTERVAL '5 minutes'
        `
      }
      await tx.controlCollectionState.upsert({
        where: { id: 'user_activity' },
        create: { id: 'user_activity', startedAt: now },
        update: {},
      })
    }, { timeout: 5_000 })
    return c.body(null, 204)
  })

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
  routes.use('/control/*', bodyLimit({
    maxSize: env.AUTH_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorResponse('PAYLOAD_TOO_LARGE', 'Размер запроса превышает допустимый', requestIdFrom(c)), 413),
  }))
  routes.use('/control/*', ownerReadRateLimit)

  routes.get('/control/me', (c) => c.json(controlMeSchema.parse({ allowed: true, serverNow: new Date().toISOString(), features: ['read', 'csv_export'] })))
  routes.get('/control/overview', async (c) => {
    const daysValue = c.req.query('days') ?? '7'
    if (!['7','30','90'].includes(daysValue)) throw new AppError(400,'INVALID_INPUT','Недопустимый период')
    const days = Number(daysValue) as 7|30|90
    const now = new Date()
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1))
    const { totals, registrations } = await queryOverview(db, from, now)
    const { activityRows, coverage, activeCount } = await withControlReadTimeout(db, async (tx) => {
      const [activityRows, coverage, activeCount] = await Promise.all([
      tx.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT a.utc_day AS day, COUNT(DISTINCT a.user_id)::bigint AS count
        FROM control_user_activity a JOIN users u ON u.id=a.user_id
        WHERE u.control_state <> 'purged' AND a.utc_day >= ${from}::date AND a.utc_day <= ${now}::date
        GROUP BY utc_day ORDER BY utc_day
      `,
      tx.controlCollectionState.findUnique({ where: { id: 'user_activity' }, select: { startedAt: true } }),
      tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT a.user_id)::bigint AS count FROM control_user_activity a JOIN users u ON u.id=a.user_id WHERE u.control_state <> 'purged' AND a.utc_day >= ${from}::date AND a.utc_day <= ${now}::date AND a.last_observed_at >= coalesce((SELECT started_at FROM control_collection_state WHERE id='user_activity'),${now}::timestamptz)`,
      ])
      return { activityRows, coverage, activeCount }
    })
    const byDay = new Map(activityRows.map((row) => [row.day.toISOString().slice(0, 10), Number(row.count)]))
    const activity = Array.from({ length: days }, (_, offset) => {
      const day = new Date(from.getTime() + offset * 86_400_000)
      const label = day.toISOString().slice(0, 10)
      return { day: label, count: coverage && day >= new Date(Date.UTC(coverage.startedAt.getUTCFullYear(), coverage.startedAt.getUTCMonth(), coverage.startedAt.getUTCDate())) ? byDay.get(label) ?? 0 : null }
    })
    const coverageFrom = coverage?.startedAt.toISOString() ?? null
    const coverageStart = coverage ? Math.max(from.getTime(), coverage.startedAt.getTime()) : now.getTime()
    const coverageRatio = coverage ? Math.max(0, Math.min(1, (now.getTime() - coverageStart) / Math.max(1, now.getTime() - from.getTime()))) : null
    const activeUsers = coverage
      ? { ...sample(Number(activeCount[0]?.count ?? 0), 'ok', 'user_activity', 86_400, now.toISOString(), now.toISOString(), coverageFrom), coverageRatio }
      : sample(null, 'not_configured', 'user_activity', 86_400, null)
    const result = {
      serverNow: now.toISOString(), days,
      accountsTotal: Number(totals.accounts_total), accountsActive: Number(totals.accounts_active),
      accountsTrashed: Number(totals.accounts_trashed), accountsPurging: Number(totals.accounts_purging),
      accountsWithFamily: Number(totals.accounts_with_family),
      familiesActive: Number(totals.families_active), activeMemberships: Number(totals.active_memberships),
      invitePending: Number(totals.invite_pending), accountsWithoutFamily: Number(totals.accounts_active) - Number(totals.accounts_with_family),
      validSessions: Number(totals.valid_sessions),
      familyStorageUsedBytes: String(totals.storage_bytes), activeUsers,
      registrations: registrations.map(({ day, count }) => ({ day: day.toISOString().slice(0, 10), count: Number(count) })),
      activity,
    }
    return c.json(controlOverviewSchema.parse(result))
  })

  routes.get('/control/families', async (c) => {
    const query = parseListQuery(c.req.query())
    validateFamilyListQuery(query)
    const page = await listFamilies(db, query, env.MEDIA_FAMILY_QUOTA_BYTES)
    return c.json(controlPageSchema(controlFamilyRowSchema).parse(page))
  })
  routes.get('/control/families/:familyId', async (c) => {
    const id = uuidParam(c.req.param('familyId'))
    const [row] = await queryFamilyById(db, id, env.MEDIA_FAMILY_QUOTA_BYTES)
    if (!row) throw notFound()
    return c.json(controlFamilyRowSchema.parse(row))
  })
  routes.get('/control/families/:familyId/deletion-preview', async (c) => {
    const id = uuidParam(c.req.param('familyId')).toLowerCase()
    try {
      const preview = await previewFamilyDeletion(db, id)
      return c.json(controlFamilyDeletionPreviewSchema.parse({ ...preview, retirementSupported, serverNow: new Date().toISOString() }))
    } catch (error) { throw lifecycleAppError(error) }
  })
  routes.post('/control/families/:familyId/purge', mutationRateLimit, async (c) => {
    if (!retirementSupported) throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Не поддерживается безопасное окончательное удаление файлов')
    const id = uuidParam(c.req.param('familyId')).toLowerCase()
    const body = await parseLifecycleBody(c, z.object({ key: z.string().uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirmation: z.string().uuid() }).strict())
    try {
      const result = await purgeControlFamily(db, { actorId: c.var.user.id, targetId: id, protectedIds: protectedOwnerIds, ...body })
      return c.json(controlLifecycleResultSchema.parse(result))
    } catch (error) { throw lifecycleAppError(error) }
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
  routes.get('/control/users/:userId/deletion-preview', async (c) => {
    const id = uuidParam(c.req.param('userId')).toLowerCase()
    try {
      const preview = await previewUserDeletion(db, id, protectedOwnerIds)
      const [lifecycle] = await queryUserById(db, id)
      const protectedAccount = protectedOwnerIds.some((ownerId) => ownerId.toLowerCase() === id)
      const serverNow = new Date().toISOString()
      const lifecycleMatches = lifecycle?.lifecycleState === preview.state
      return c.json(controlUserDeletionPreviewSchema.parse({
        ...preview, deletionId: lifecycleMatches ? lifecycle.deletionId : null,
        purgeAfter: lifecycleMatches ? lifecycle.purgeAfter : null,
        operationStatus: lifecycleMatches ? lifecycle.operationStatus : null,
        errorCode: lifecycleMatches ? lifecycle.errorCode : null,
        protectedAccount, retirementSupported, canTrash: retirementSupported && preview.state === 'active' && !protectedAccount,
        canRestore: lifecycleMatches && preview.state === 'trashed' && lifecycle.operationStatus === 'waiting' && Boolean(lifecycle.purgeAfter && Date.parse(lifecycle.purgeAfter) > Date.parse(serverNow)),
        serverNow,
      }))
    } catch (error) { throw lifecycleAppError(error) }
  })
  routes.post('/control/users/:userId/trash', mutationRateLimit, async (c) => {
    if (!retirementSupported) throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Не поддерживается безопасное окончательное удаление файлов')
    const id = uuidParam(c.req.param('userId')).toLowerCase()
    const body = await parseLifecycleBody(c, z.object({ key: z.string().uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/), confirmation: z.string().uuid() }).strict())
    try {
      const result = await trashControlUser(db, { actorId: c.var.user.id, targetId: id, protectedIds: protectedOwnerIds, ...body })
      return c.json(controlLifecycleResultSchema.parse(result))
    } catch (error) { throw lifecycleAppError(error) }
  })
  routes.post('/control/users/:userId/restore', mutationRateLimit, async (c) => {
    const id = uuidParam(c.req.param('userId')).toLowerCase()
    const body = await parseLifecycleBody(c, z.object({ key: z.string().uuid(), deletionId: z.string().uuid() }).strict())
    try {
      const result = await restoreControlUser(db, { actorId: c.var.user.id, targetId: id, protectedIds: protectedOwnerIds, ...body })
      return c.json(controlLifecycleResultSchema.parse(result))
    } catch (error) { throw lifecycleAppError(error) }
  })
  routes.get('/control/users/:userId/memberships', async (c) => {
    const id = uuidParam(c.req.param('userId')); const query = parseListQuery(c.req.query())
    validateChildListQuery(query)
    return c.json(controlPageSchema(controlMembershipSchema).parse(await listChildren(db, id, query, 'memberships')))
  })
  routes.get('/control/storage', async (c) => {
    const nowDate = new Date()
    const [totals, pg, host, media, backup] = await Promise.all([
      queryStorage(db), readControlMetric(db, 'postgres_size', CONTROL_STALE_AFTER_SECONDS.postgres_size, nowDate), readControlMetric(db, 'host_filesystem', CONTROL_STALE_AFTER_SECONDS.host_filesystem, nowDate),
      readControlMetric(db, 'media_storage', CONTROL_STALE_AFTER_SECONDS.media_storage, nowDate, env.PRIVATE_STORAGE_DRIVER === 'filesystem' ? undefined : 'unsupported'),
      readControlMetric(db, 'backup_storage', CONTROL_STALE_AFTER_SECONDS.backup_storage, nowDate),
    ])
    const now = nowDate.toISOString()
    const hostValue = host.value as { filesystems?: Array<{ id:string; scope:'host'|'media'|'backups'; usedBytes:string; availableBytes:string; capacityBytes:string; parentResourceId:string|null }> } | null
    const hostFs = hostValue?.filesystems?.find((entry) => entry.scope === 'host')
    const mediaValue = media.value as { usedBytes:string; resourceId:string; parentResourceId:string|null } | null
    const result = {
      familyAccounting: sample({ resourceId:'family-quota-total', parentResourceId:null, scopeLabel:'Учёт квоты семей', accountingBasis:'Сумма счётчиков хранилища активных и сохранённых семей', capacityKind:'configured_budget' as const, usedBytes: String(totals.totals.used), reservedBytes: String(totals.totals.reserved), quotaBytes: String(env.MEDIA_FAMILY_QUOTA_BYTES), capacityBytes: null, availableBytes:null }, 'ok', 'product_db', CONTROL_STALE_AFTER_SECONDS.product_db, now),
      mediaStorage: sample(mediaValue ? { resourceId:mediaValue.resourceId, parentResourceId:mediaValue.parentResourceId, scopeLabel:'Логические байты текущих файлов', accountingBasis:'Ограниченный обход хоста: размеры файлов без выделенных блоков диска', capacityKind:'unknown' as const, usedBytes:mediaValue.usedBytes, capacityBytes:null, availableBytes:null } : null, media.status, 'media_storage', CONTROL_STALE_AFTER_SECONDS.media_storage, media.observedAt, media.lastAttemptAt, media.coverageFrom, media.errorCode),
      hostFilesystem: sample(hostFs ? { resourceId:hostFs.id, parentResourceId:hostFs.parentResourceId, scopeLabel:'Файловая система хоста', accountingBasis:'statvfs для разрешённого пути', capacityKind:'physical' as const, usedBytes:hostFs.usedBytes, capacityBytes:hostFs.capacityBytes, availableBytes:hostFs.availableBytes } : null, host.status, 'host_filesystem', CONTROL_STALE_AFTER_SECONDS.host_filesystem, host.observedAt, host.lastAttemptAt, host.coverageFrom, host.errorCode),
      postgres: sample(pg.value ? { resourceId:'postgres-database', parentResourceId:null, scopeLabel:'База данных PostgreSQL', accountingBasis:'pg_database_size(current_database()); входит в диск хоста, если размещена там же', capacityKind:'unknown' as const, usedBytes:String((pg.value as {usedBytes:string}).usedBytes), capacityBytes:null, availableBytes:null } : null, pg.status, 'postgres_size', CONTROL_STALE_AFTER_SECONDS.postgres_size, pg.observedAt, pg.lastAttemptAt, pg.coverageFrom, pg.errorCode),
      backup: sample(backup.value ? { ...(backup.value as {resourceId:string;parentResourceId:string|null;usedBytes:string;entries:number;artifactAt:string|null;validation:'valid'|'invalid'|'unknown';restoreTestAt:string|null}), scopeLabel:'Логические байты файлов резервных копий', accountingBasis:'Ограниченный обход регулярных файлов; отдельно от statvfs файловой системы', capacityKind:'unknown' as const, capacityBytes:null, availableBytes:null } : null, backup.status, 'backup_storage', CONTROL_STALE_AFTER_SECONDS.backup_storage, backup.observedAt, backup.lastAttemptAt, backup.coverageFrom, backup.errorCode),
    }
    return c.json(controlStorageSchema.parse(result))
  })
  routes.get('/control/sources', async (c) => {
    const now = new Date().toISOString()
    const ids = ['product_db','postgres_size','media_storage','backup_storage','host_filesystem','service_probes','max_binding_state','release_evidence'] as const
    const samples = await Promise.all(ids.map(async (id) => ({ id, ...(await readControlMetric(db, id, CONTROL_STALE_AFTER_SECONDS[id], new Date(), id === 'media_storage' && env.PRIVATE_STORAGE_DRIVER !== 'filesystem' ? 'unsupported' : undefined)) })))
    return c.json(z.array(controlSourceSchema).parse([
      ...samples.map(({id, status, observedAt, lastAttemptAt, errorCode}) => ({ id, kind:id, status, observedAt, lastAttemptAt, errorCode })),
    ]))
  })
  routes.get('/control/system', async (c) => {
    const nowDate = new Date(); const now = nowDate.toISOString()
    const [database, product, probes, releaseEvidence, progress] = await Promise.all([
      readControlMetric(db, 'postgres_size', CONTROL_STALE_AFTER_SECONDS.postgres_size, nowDate), readControlMetric(db, 'product_db', CONTROL_STALE_AFTER_SECONDS.product_db, nowDate),
      readControlMetric(db, 'service_probes', CONTROL_STALE_AFTER_SECONDS.service_probes, nowDate),
      readControlMetric(db, 'release_evidence', CONTROL_STALE_AFTER_SECONDS.release_evidence, nowDate),
      withControlReadTimeout(db, async (tx) => Promise.all([
        tx.controlCollectionState.findUnique({ where:{id:'worker_progress'}, select:{startedAt:true} }),
        tx.controlCollectionState.findUnique({ where:{id:'scheduler_progress'}, select:{startedAt:true} }),
      ])),
    ])
    const [workerProgress, schedulerProgress] = progress
    const productValue = product.value as { outbox_pending?: number; oldest_due_age_seconds?: number | null } | null
    const probeValue = probes.value as { backend?: {ok:boolean;latencyMs:number}; static?: {ok:boolean;latencyMs:number} } | null
    const probeStatus = (value: unknown) => value ? probes.status : probes.status === 'ok' ? 'error' as const : probes.status
    const probeError = (value: unknown) => value ? probes.errorCode : probes.status === 'ok' ? 'unavailable' as const : probes.errorCode
    const result = {
      serverNow: now,
      backend: sample(probeValue?.backend ? {live:true,ready:probeValue.backend.ok,readinessProbeLatencyMs:probeValue.backend.latencyMs} : null, probeStatus(probeValue?.backend), 'service_probes', CONTROL_STALE_AFTER_SECONDS.service_probes, probes.observedAt, probes.lastAttemptAt, probes.coverageFrom, probeError(probeValue?.backend)),
      postgresSizeBytes: sample(database.value ? String((database.value as {usedBytes:string}).usedBytes) : null, database.status, 'postgres_size', CONTROL_STALE_AFTER_SECONDS.postgres_size, database.observedAt, database.lastAttemptAt, database.coverageFrom, database.errorCode),
      staticEntry: sample(probeValue?.static ? {available:probeValue.static.ok,probeLatencyMs:probeValue.static.latencyMs} : null, probeStatus(probeValue?.static), 'service_probes', CONTROL_STALE_AFTER_SECONDS.service_probes, probes.observedAt, probes.lastAttemptAt, probes.coverageFrom, probeError(probeValue?.static)),
      worker: sample(workerProgress ? {progressAt:workerProgress.startedAt.toISOString()} : null, workerProgress ? nowDate.getTime()-workerProgress.startedAt.getTime() <= CONTROL_STALE_AFTER_SECONDS.worker_progress * 1000 ? 'ok' : 'stale' : 'not_configured', 'worker_progress', CONTROL_STALE_AFTER_SECONDS.worker_progress, workerProgress?.startedAt.toISOString() ?? null),
      scheduler: sample(schedulerProgress ? {progressAt:schedulerProgress.startedAt.toISOString()} : null, schedulerProgress ? nowDate.getTime()-schedulerProgress.startedAt.getTime() <= CONTROL_STALE_AFTER_SECONDS.scheduler_progress * 1000 ? 'ok' : 'stale' : 'not_configured', 'scheduler_progress', CONTROL_STALE_AFTER_SECONDS.scheduler_progress, schedulerProgress?.startedAt.toISOString() ?? null),
      outbox: sample(productValue ? { pending: Number(productValue.outbox_pending ?? 0), oldestDueAgeSeconds: productValue.oldest_due_age_seconds === null || productValue.oldest_due_age_seconds === undefined ? null : Number(productValue.oldest_due_age_seconds) } : null, product.status, 'product_db', CONTROL_STALE_AFTER_SECONDS.product_db, product.observedAt, product.lastAttemptAt, product.coverageFrom, product.errorCode),
      release: sample(releaseEvidence.value ? releaseEvidence.value as {backendSha:string;staticSha:string;migrationCatalogCount:number;migrationStatus:'up_to_date';lastSuccessfulReleaseAt:string} : null, releaseEvidence.status, 'release_evidence', CONTROL_STALE_AFTER_SECONDS.release_evidence, releaseEvidence.observedAt, releaseEvidence.lastAttemptAt, releaseEvidence.coverageFrom, releaseEvidence.errorCode),
    }
    return c.json(controlSystemSchema.parse(result))
  })
  routes.get('/control/events', async (c) => {
    const query = parseListQuery(c.req.query(), { compositeCursor:true })
    if (query.sort !== 'createdAt' || query.status || query.maxState || query.userState) throw new AppError(400,'INVALID_INPUT','Недопустимый фильтр событий')
    const cursor = query.cursor ? decodeEventCursor(query.cursor, query) : null
    const events = await queryEvents(db, query, cursor)
    const items = events.slice(0, query.limit).map((r) => ({ id: String(r.id), type: r.type, occurredAt: (r.occurred_at as Date).toISOString(), familyId: r.family_id, familyName: r.family_name }))
    const last=events[query.limit-1]
    const nextCursor=events.length>query.limit && last ? eventCursor(query,String(last.id),(last.occurred_at as Date).toISOString()) : null
    return c.json({ items: items.map((item) => controlEventSchema.parse(item)), nextCursor })
  })
  routes.get('/control/exports/families.csv', async (c) => { const query=parseListQuery(c.req.query()); validateFamilyListQuery(query); return exportCsv(c, exportsByOwner, ['id','name','childName','ownerName','status','lifecycleState','deletionId','purgeAfter','operationStatus','errorCode','createdAt','activeMembers','storageUsedBytes','storageReservedBytes','quotaBytes','publishedMemories','mediaAttachments','maxState','lastObservedAt'], async () => (await queryFamilies(db, familyWhere(query), 10_001, env.MEDIA_FAMILY_QUOTA_BYTES, query.sort)).map(familyCsvRow)) })
  routes.get('/control/exports/users.csv', async (c) => { const query=parseListQuery(c.req.query()); validateUserSort(query); return exportCsv(c, exportsByOwner, ['id','displayName','createdAt','lifecycleState','deletionId','purgeAfter','operationStatus','errorCode','activeFamilies','familyNames','moreFamilies','lastSessionCreatedAt','lastActivityAt','lastActivitySurface'], async () => (await queryUsers(db, userWhere(query), 10_001, query.sort)).map(userCsvRow)) })

  return { routes }
}

function lifecycleAppError(error: unknown): AppError {
  if (!(error instanceof ControlLifecycleFailure)) throw error
  const mappings: Record<string, { status: 400 | 404 | 409; code: ApiErrorCode; message: string }> = {
    invalid_command: { status: 400, code: 'INVALID_INPUT', message: 'Некорректная команда удаления' },
    confirmation_mismatch: { status: 400, code: 'INVALID_INPUT', message: 'Подтверждение не совпадает с выбранной записью' },
    not_found: { status: 404, code: 'NOT_FOUND', message: 'Запись не найдена' },
    protected_account: { status: 409, code: 'CONFLICT', message: 'Аккаунт владельца Control защищён от удаления' },
    stale_preview: { status: 409, code: 'VERSION_CONFLICT', message: 'Данные изменились. Обновите предварительный просмотр' },
    scope_changed: { status: 409, code: 'VERSION_CONFLICT', message: 'Состав данных изменился. Обновите предварительный просмотр' },
    restore_expired: { status: 409, code: 'CONFLICT', message: 'Срок восстановления завершён' },
    conflict: { status: 409, code: 'CONFLICT', message: 'Операция больше недоступна для этого состояния' },
    already_purging: { status: 409, code: 'CONFLICT', message: 'Очистка этой семьи уже началась' },
    stale_deletion_cycle: { status: 409, code: 'CONFLICT', message: 'Цикл удаления изменился. Обновите данные' },
    idempotency_conflict: { status: 409, code: 'IDEMPOTENCY_CONFLICT', message: 'Ключ операции уже использован для другой команды' },
  }
  const mapped = mappings[error.code] ?? mappings.conflict!
  return new AppError(mapped.status, mapped.code, mapped.message)
}
