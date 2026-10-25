import { lstat, open } from 'node:fs/promises'
import { z } from 'zod'
import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'

export const controlErrorCodes = ['timeout', 'unavailable', 'invalid_payload', 'permission_denied', 'unknown'] as const
export type ControlErrorCode = typeof controlErrorCodes[number]
export type ControlSourceSnapshot = { value: unknown; observedAt: Date }
export type ControlMetricSource = {
  id: string
  intervalSeconds: number
  shouldCollect?(): Promise<boolean>
  collect(signal: AbortSignal): Promise<ControlSourceSnapshot>
}
class SourceUnavailableError extends Error {}

export const CONTROL_STALE_AFTER_SECONDS = Object.freeze({
  product_db: 120,
  postgres_size: 600,
  host_filesystem: 180,
  service_probes: 180,
  max_binding_state: 180,
  worker_progress: 180,
  scheduler_progress: 180,
  media_storage: 90_000,
  backup_storage: 90_000,
  release_evidence: 86_400,
})

const hostSnapshotSchema = z.object({
  version: z.literal(1),
  observedAt: z.string().datetime({ offset: true }),
  mediaObservedAt: z.string().datetime({ offset: true }).nullable(),
  backupStorageObservedAt: z.string().datetime({ offset: true }).nullable(),
  filesystems: z.array(z.object({
    id: z.string().min(1).max(80), usedBytes: z.string().regex(/^(0|[1-9]\d{0,39})$/),
    availableBytes: z.string().regex(/^(0|[1-9]\d{0,39})$/), capacityBytes: z.string().regex(/^(0|[1-9]\d{0,39})$/),
    scope: z.enum(['host', 'media', 'backups']), parentResourceId: z.string().max(80).nullable(),
  }).strict()).max(3),
  media: z.object({ usedBytes: z.string().regex(/^(0|[1-9]\d{0,39})$/), entries: z.number().int().nonnegative().max(1_000_000) }).strict().nullable(),
  backupStorage: z.object({ usedBytes: z.string().regex(/^(0|[1-9]\d{0,39})$/), entries: z.number().int().nonnegative().max(1_000_000), resourceId:z.string().max(80), parentResourceId:z.string().max(80).nullable(), artifactAt:z.string().datetime({offset:true}).nullable(), validation:z.enum(['valid','invalid','unknown']), restoreTestAt:z.string().datetime({offset:true}).nullable() }).strict().nullable(),
  backup: z.object({ artifactAt: z.string().datetime({ offset: true }).nullable(), validation: z.enum(['valid', 'invalid', 'unknown']), restoreTestAt: z.string().datetime({ offset: true }).nullable() }).strict().nullable(),
  release: z.object({ backendSha:z.string().regex(/^[0-9a-f]{40}$/), staticSha:z.string().regex(/^[0-9a-f]{40}$/), migrationCatalogCount:z.number().int().nonnegative().max(1_000_000), migrationStatus:z.literal('up_to_date'), lastSuccessfulReleaseAt:z.string().datetime({offset:true}) }).strict().nullable(),
}).strict()

export function withControlReadTimeout<T>(db: DbClient, read: (tx: Parameters<Parameters<DbClient['$transaction']>[0]>[0]) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`
    return read(tx)
  }, { timeout: 5_500, maxWait: 1_000 })
}

function utcDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) }
function errorCode(error: unknown): ControlErrorCode {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout'
  if (error instanceof Error && error.name === 'AbortError') return 'timeout'
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 'invalid_payload'
  if (error instanceof SourceUnavailableError || error instanceof TypeError) return 'unavailable'
  const systemCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (systemCode === 'EACCES' || systemCode === 'EPERM') return 'permission_denied'
  if (systemCode === 'ENOENT' || systemCode === 'ECONNREFUSED' || systemCode === 'ENOTFOUND' || systemCode === 'ECONNRESET') return 'unavailable'
  return 'unknown'
}

export async function readBoundedBody(response: Response, maximumBytes = 32_768) {
  const reader = response.body?.getReader()
  if (!reader) throw new SourceUnavailableError()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.byteLength
    if (size > maximumBytes) { await reader.cancel(); throw new z.ZodError([]) }
    chunks.push(part.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new z.ZodError([]) }
}

async function fetchBounded(fetcher: typeof fetch, url: string, signal: AbortSignal, accept = 'application/json') {
  const response = await fetcher(url, { method: 'GET', redirect: 'error', signal, headers: { accept } })
  return { response, text: await readBoundedBody(response) }
}

async function readBoundedSnapshot(path: string) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 65_536) throw new z.ZodError([])
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(65_537)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > 65_536) throw new z.ZodError([])
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await handle.close() }
}

export async function collectWithDeadline<T>(collect: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parentSignal?: AbortSignal) {
  const controller = new AbortController()
  parentSignal?.throwIfAborted()
  const abortParent = () => controller.abort(parentSignal?.reason)
  if (parentSignal?.aborted) abortParent()
  else parentSignal?.addEventListener('abort', abortParent, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs)
  try {
    return await Promise.race([
      collect(controller.signal),
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })),
    ])
  } finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', abortParent) }
}

export function assertObservedAt(observedAt: Date, now: Date) {
  if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > now.getTime() + 60_000) throw new z.ZodError([])
}

export function deriveLastGood<T>(rows: Array<{ value:T|null; observedAt:Date|null; lastAttemptAt:Date|null; status:string; errorCode:string|null }>, staleAfterSeconds:number, now:Date) {
  const latestAttempt = rows[0]
  const lastGood = rows.find((row) => row.value !== null && row.observedAt !== null)
  if (!latestAttempt && !lastGood) return { value:null, status:'not_configured' as const, observedAt:null, lastAttemptAt:null, errorCode:null }
  const stale = Boolean(!lastGood || now.getTime() - lastGood.observedAt!.getTime() > staleAfterSeconds * 1000 || latestAttempt?.status === 'error' || latestAttempt?.status === 'stale')
  return { value:lastGood?.value ?? null, status:stale ? lastGood ? 'stale' as const : 'error' as const : 'ok' as const,
    observedAt:lastGood?.observedAt?.toISOString() ?? null, lastAttemptAt:latestAttempt?.lastAttemptAt?.toISOString() ?? null, errorCode:latestAttempt?.errorCode ?? null }
}

export function createControlCollection({ db, env, fetcher = fetch, now = () => new Date() }: {
  db: DbClient; env: AppEnv; fetcher?: typeof fetch; now?: () => Date
}) {
  const sources: ControlMetricSource[] = [
    {
      id: 'product_db', intervalSeconds: 30,
      collect: async (signal) => {
        signal.throwIfAborted()
        const value = await withControlReadTimeout(db, async (tx) => {
          const [totals] = await tx.$queryRaw<Array<Record<string, bigint|null>> >`
            SELECT (SELECT COUNT(*) FROM users) AS accounts_total,
              (SELECT COUNT(*) FROM families WHERE status='active') AS families_active,
              (SELECT COUNT(*) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.revoked_at IS NULL AND f.status='active') AS active_memberships,
              (SELECT COUNT(DISTINCT m.user_id) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.revoked_at IS NULL AND f.status='active') AS accounts_with_family,
              (SELECT COUNT(*) FROM family_invites i JOIN families f ON f.id=i.family_id WHERE i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at > now() AND f.status='active') AS invite_pending,
              (SELECT COUNT(*) FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > now()) AS valid_sessions,
              (SELECT COUNT(*) FROM memories WHERE status='published' AND deleted_at IS NULL) AS published_memories,
              (SELECT COUNT(*) FROM memory_comments c JOIN memories m ON m.id=c.memory_id AND m.family_id=c.family_id WHERE c.deleted_at IS NULL AND m.status='published' AND m.deleted_at IS NULL) AS current_comments,
              (SELECT COUNT(*) FROM memory_likes l JOIN memories m ON m.id=l.memory_id AND m.family_id=l.family_id WHERE m.status='published' AND m.deleted_at IS NULL) AS current_reactions,
              (SELECT COUNT(*) FROM task_outbox WHERE status='pending') AS outbox_pending,
              (SELECT EXTRACT(EPOCH FROM (now()-MIN(scheduled_for) FILTER (WHERE scheduled_for <= now())))::bigint FROM task_outbox WHERE status='pending') AS oldest_due_age_seconds
          `
          return Object.fromEntries(Object.entries(totals).map(([key, val]) => [key, val === null ? null : Number(val)]))
        })
        return { value, observedAt: now() }
      },
    },
    {
      id: 'postgres_size', intervalSeconds: 300,
      collect: async (signal) => {
        signal.throwIfAborted()
        const rows = await withControlReadTimeout(db, (tx) => tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`)
        return { value: { usedBytes: String(rows[0]!.bytes) }, observedAt: now() }
      },
    },
    {
      id: 'max_binding_state', intervalSeconds: 60,
      collect: async (signal) => {
        signal.throwIfAborted()
        const value = await withControlReadTimeout(db, async (tx) => tx.$queryRaw<Array<Record<string, unknown>>>`
          SELECT COUNT(*) FILTER (WHERE f.max_backup_chat_id IS NOT NULL AND b.state='connected')::int AS connected,
            COUNT(*) FILTER (WHERE f.max_backup_chat_id IS NOT NULL AND (b.chat_id IS NULL OR b.state<>'connected'))::int AS needs_attention,
            COUNT(*) FILTER (WHERE f.max_backup_chat_id IS NULL)::int AS unconfigured,
            MAX(b.last_provider_check_at) AS last_checked_at
          FROM families f LEFT JOIN max_channel_bindings b ON b.chat_id=f.max_backup_chat_id AND b.family_id=f.id
          WHERE f.status='active'
        `)
        return { value: value[0], observedAt: now() }
      },
    },
    {
      id: 'service_probes', intervalSeconds: 60,
      collect: async (signal) => {
        const probes = await Promise.all([
          ['backend', 'http://backend:3000/health/ready'], ['static', 'http://static:80/control/'],
        ].map(async ([id, url]) => {
          try {
            const started = performance.now()
            const { response, text } = await fetchBounded(fetcher, url!, signal, id === 'static' ? 'text/html' : 'application/json')
            if (id === 'backend') {
              const parsed = z.object({ status: z.enum(['ok','unavailable']) }).strict().parse(JSON.parse(text))
              return [id, { ok: response.ok && parsed.status === 'ok', latencyMs: Math.round(performance.now() - started) }] as const
            }
            if (!response.ok) throw new SourceUnavailableError()
            const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
            if (contentType !== 'text/html' || !/\bid=["']memoly-control-root["']/.test(text)) throw new SourceUnavailableError()
            return [id, { ok: true, latencyMs: Math.round(performance.now() - started) }] as const
          } catch {
            return [id, null] as const
          }
        }))
        if (probes.every(([, value]) => value === null)) throw new Error('all readiness probes unavailable')
        return { value: Object.fromEntries(probes), observedAt: now() }
      },
    },
    {
      id: 'host_filesystem', intervalSeconds: 60,
      collect: async (signal) => {
        signal.throwIfAborted()
        const path = env.CONTROL_HOST_SNAPSHOT_PATH
        if (!path) throw new Error('snapshot is not configured')
        const parsed = hostSnapshotSchema.parse(JSON.parse(await readBoundedSnapshot(path)))
        const observedAt = new Date(parsed.observedAt)
        if (observedAt.getTime() > now().getTime() + 60_000) throw new z.ZodError([])
        return { value: parsed, observedAt }
      },
    },
    {
      id: 'media_storage', intervalSeconds: 86_400,
      shouldCollect: async () => env.PRIVATE_STORAGE_DRIVER === 'filesystem',
      collect: async (signal) => {
        signal.throwIfAborted()
        const path = env.CONTROL_HOST_SNAPSHOT_PATH
        const parsed = hostSnapshotSchema.parse(JSON.parse(await readBoundedSnapshot(path)))
        if (!parsed.media || !parsed.mediaObservedAt) throw new z.ZodError([])
        const observedAt = new Date(parsed.mediaObservedAt)
        if (observedAt.getTime() > now().getTime() + 60_000) throw new z.ZodError([])
        const mediaFilesystem = parsed.filesystems.find((entry) => entry.scope === 'media')
        return { value: { ...parsed.media, resourceId: 'media-logical-files', parentResourceId: mediaFilesystem?.parentResourceId ?? null }, observedAt }
      },
    },
    {
      // The inventory is daily, while evidence metadata in the host snapshot refreshes each minute.
      id: 'backup_storage', intervalSeconds: 60,
      collect: async (signal) => {
        signal.throwIfAborted()
        const parsed = hostSnapshotSchema.parse(JSON.parse(await readBoundedSnapshot(env.CONTROL_HOST_SNAPSHOT_PATH)))
        if (!parsed.backupStorage || !parsed.backupStorageObservedAt) throw new z.ZodError([])
        const observedAt = new Date(parsed.backupStorageObservedAt)
        if (observedAt.getTime() > now().getTime() + 60_000) throw new z.ZodError([])
        return { value: parsed.backupStorage, observedAt }
      },
    },
    {
      id: 'release_evidence', intervalSeconds: 60,
      shouldCollect: async () => {
        if (!env.CONTROL_HOST_SNAPSHOT_PATH) return false
        try {
          const snapshot = hostSnapshotSchema.parse(JSON.parse(await readBoundedSnapshot(env.CONTROL_HOST_SNAPSHOT_PATH)))
          return snapshot.release !== null
        } catch { return false }
      },
      collect: async (signal) => {
        signal.throwIfAborted()
        const parsed = hostSnapshotSchema.parse(JSON.parse(await readBoundedSnapshot(env.CONTROL_HOST_SNAPSHOT_PATH)))
        if (!parsed.release) throw new SourceUnavailableError()
        const observedAt = new Date(parsed.release.lastSuccessfulReleaseAt)
        if (observedAt.getTime() > now().getTime() + 60_000) throw new z.ZodError([])
        return { value: parsed.release, observedAt }
      },
    },
  ]

  async function collect() {
    if (!env.CONTROL_ENABLED) return { attempted: 0, succeeded: 0 }
    const day = utcDay(now())
    let next = 0
    let succeeded = 0
    const run = async () => {
      while (true) {
        const index = next++
        if (index >= sources.length) return
        const source = sources[index]!
        if (source.shouldCollect && !(await source.shouldCollect())) continue
        const previous = await db.controlMetricSnapshot.findUnique({ where: { sourceId_utcDay: { sourceId: source.id, utcDay: day } } })
        if (previous?.lastAttemptAt && now().getTime() - previous.lastAttemptAt.getTime() < source.intervalSeconds * 1000) continue
        const attemptedAt = now()
        try {
          const snapshot = await collectWithDeadline(source.collect, 10_000, AbortSignal.timeout(60_000))
          assertObservedAt(snapshot.observedAt, now())
          await db.controlMetricSnapshot.upsert({
            where: { sourceId_utcDay: { sourceId: source.id, utcDay: day } },
            create: { sourceId: source.id, utcDay: day, value: snapshot.value as object, observedAt: snapshot.observedAt, lastAttemptAt: attemptedAt, status: 'ok', attempts: 1, successes: 1 },
            update: { value: snapshot.value as object, observedAt: snapshot.observedAt, lastAttemptAt: attemptedAt, status: 'ok', errorCode: null, attempts: { increment: 1 }, successes: { increment: 1 } },
          })
          const coverageId = `metric:${source.id}`
          await db.controlCollectionState.upsert({ where: { id: coverageId }, create: { id: coverageId, startedAt: snapshot.observedAt }, update: {} })
          succeeded += 1
        } catch (error) {
          await db.controlMetricSnapshot.upsert({
            where: { sourceId_utcDay: { sourceId: source.id, utcDay: day } },
            create: { sourceId: source.id, utcDay: day, value: Prisma.JsonNull, observedAt: null, lastAttemptAt: attemptedAt, status: 'error', errorCode: errorCode(error), attempts: 1, successes: 0 },
            update: { lastAttemptAt: attemptedAt, status: previous?.observedAt ? 'stale' : 'error', errorCode: errorCode(error), attempts: { increment: 1 } },
          })
        }
      }
    }
    await Promise.all([run(), run()])
    if (succeeded > 0) await db.controlCollectionState.upsert({ where: { id: 'metrics' }, create: { id: 'metrics', startedAt: now() }, update: {} })
    return { attempted: sources.length, succeeded }
  }
  return { collect }
}

export async function collectControlMetrics(input: Parameters<typeof createControlCollection>[0]) {
  return createControlCollection(input).collect()
}

export async function readControlMetric(db: DbClient, sourceId: string, staleAfterSeconds: number, now = new Date(), unavailableStatus?: 'unsupported' | 'not_configured') {
  if (unavailableStatus) return { value:null, status:unavailableStatus, observedAt:null, lastAttemptAt:null, errorCode:null, coverageFrom:null }
  return withControlReadTimeout(db, async (tx) => {
    const rows = await tx.controlMetricSnapshot.findMany({ where: { sourceId }, orderBy: { utcDay: 'desc' }, take: 100 })
    const coverage = await tx.controlCollectionState.findUnique({ where: { id: `metric:${sourceId}` }, select: { startedAt: true } })
    const result = deriveLastGood(rows, staleAfterSeconds, now)
    return { ...result, errorCode: result.errorCode as ControlErrorCode|null, coverageFrom: coverage?.startedAt.toISOString() ?? null }
  })
}

export async function recordControlProgress(db: DbClient, enabled: boolean, process: 'worker' | 'scheduler', now = new Date()) {
  if (!enabled) return false
  const id = `${process}_progress`
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO control_collection_state (id, started_at) VALUES (${id}, ${now}::timestamptz)
            ON CONFLICT (id) DO UPDATE SET started_at=EXCLUDED.started_at
    WHERE control_collection_state.started_at <= ${new Date(now.getTime() - 60_000)}::timestamptz
    RETURNING id
  `
  return rows.length === 1
}

export async function pruneControlTelemetry(db: DbClient, now = new Date()) {
  const cutoff = utcDay(new Date(now.getTime() - 100 * 86_400_000))
  const [users, families, metrics] = await Promise.all([
    db.$executeRaw`DELETE FROM control_user_activity WHERE ctid IN (SELECT ctid FROM control_user_activity WHERE utc_day < ${cutoff}::date LIMIT 1000)`,
    db.$executeRaw`DELETE FROM control_family_activity WHERE ctid IN (SELECT ctid FROM control_family_activity WHERE utc_day < ${cutoff}::date LIMIT 1000)`,
    db.$executeRaw`DELETE FROM control_metric_snapshot WHERE ctid IN (SELECT ctid FROM control_metric_snapshot WHERE utc_day < ${cutoff}::date LIMIT 1000)`,
  ])
  return { users, families, metrics }
}
