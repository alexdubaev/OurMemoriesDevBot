import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import { decodeCursor, encodeCursor, filterHash, type ControlListQuery } from '../application/control-helpers'
import { withControlReadTimeout } from './control-collection'

type Row = Record<string, unknown>

export function familyWhere(query: ControlListQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor, query, 'families') : null
  const order = familyOrder(query.sort)
  const valueCast = ['createdAt','lastObservedAt'].includes(query.sort) ? Prisma.sql`${cursor?.value ?? null}::timestamptz` : query.sort === 'activeMembers' ? Prisma.sql`${cursor?.value ?? null}::bigint` : query.sort === 'storageUsedBytes' ? Prisma.sql`${cursor?.value ?? null}::bigint` : Prisma.sql`${cursor?.value ?? null}::text`
  const seek = cursor ? order.desc ? Prisma.sql`AND (${order.expression},f.id) < (${valueCast},${cursor.id}::uuid)` : Prisma.sql`AND (${order.expression},f.id) > (${valueCast},${cursor.id}::uuid)` : Prisma.empty
  return Prisma.sql`WHERE (${query.status ?? null}::text IS NULL OR f.status::text=${query.status ?? null})
    AND (${query.q ?? null}::text IS NULL OR f.name ILIKE ${query.q ? `%${query.q}%` : null})
    AND (${query.maxState ?? null}::text IS NULL OR (CASE WHEN f.max_backup_chat_id IS NULL THEN 'unconfigured' WHEN (SELECT b.state FROM max_channel_bindings b WHERE b.chat_id=f.max_backup_chat_id AND b.family_id=f.id LIMIT 1)='connected' THEN 'configured' ELSE 'disconnected' END)=${query.maxState ?? null}) ${seek}`
}
function familyOrder(sort:string) {
  const expressions:Record<string,Prisma.Sql>={createdAt:Prisma.raw('f.created_at'),name:Prisma.raw("coalesce(f.name,'')"),activeMembers:Prisma.raw('(SELECT count(*) FROM family_members m WHERE m.family_id=f.id AND m.revoked_at IS NULL)'),storageUsedBytes:Prisma.raw('f.storage_used_bytes'),lastObservedAt:Prisma.raw("coalesce((SELECT max(a.last_observed_at) FROM control_family_activity a WHERE a.family_id=f.id),'epoch'::timestamptz)")}
  return {expression:expressions[sort]!,desc:sort!=='name'}
}
export async function queryFamilies(db: DbClient, where: Prisma.Sql, limit: number, quotaBytes: number, sort: string) {
  const order=familyOrder(sort); const direction=Prisma.raw(order.desc?'DESC':'ASC')
  return withControlReadTimeout(db, async (tx) => {
  const rows = await tx.$queryRaw<Array<Row>>`
    SELECT f.id, f.name, f.status::text status, f.created_at, f.storage_used_bytes::text storage_used_bytes,
      f.storage_reserved_bytes::text storage_reserved_bytes, ${String(quotaBytes)}::text quota_bytes,
      u.display_name owner_name,
      (SELECT c.display_name FROM children c WHERE c.family_id=f.id AND c.deleted_at IS NULL ORDER BY c.created_at,c.id LIMIT 1) child_name,
      (SELECT count(*) FROM family_members m WHERE m.family_id=f.id AND m.revoked_at IS NULL) active_members,
      (SELECT count(*) FROM memories mm WHERE mm.family_id=f.id AND mm.status='published' AND mm.deleted_at IS NULL) published_memories,
      (SELECT count(*) FROM (
        SELECT mm.media_id::text attachment_id FROM memory_media mm JOIN memories m ON m.id=mm.memory_id AND m.family_id=mm.family_id WHERE mm.family_id=f.id AND m.status='published' AND m.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM max_video_references thumb WHERE thumb.family_id=f.id AND thumb.thumbnail_media_id=mm.media_id)
          AND NOT EXISTS (SELECT 1 FROM telegram_video_references thumb WHERE thumb.family_id=f.id AND thumb.thumbnail_media_id=mm.media_id)
        UNION
        SELECT 'max:' || v.provider_attachment_id FROM max_video_references v JOIN memories m ON m.id=v.memory_id AND m.family_id=v.family_id WHERE v.family_id=f.id AND m.status='published' AND m.deleted_at IS NULL
      ) attachments) media_attachments,
      (SELECT max(a.last_observed_at) FROM control_family_activity a WHERE a.family_id=f.id) last_observed_at,
      (SELECT max(b.last_provider_check_at) FROM max_channel_bindings b WHERE b.chat_id=f.max_backup_chat_id AND b.family_id=f.id) max_last_checked_at,
      (SELECT CASE WHEN f.max_backup_chat_id IS NULL THEN 'unconfigured' WHEN (SELECT b.state FROM max_channel_bindings b WHERE b.chat_id=f.max_backup_chat_id AND b.family_id=f.id LIMIT 1)='connected' THEN 'configured' ELSE 'disconnected' END) max_state,
      CASE WHEN f.status='deleted' OR cfd.purged_at IS NOT NULL THEN 'purged'
           WHEN cfd.id IS NOT NULL THEN 'purging'
           WHEN user_deletion.deletion_id IS NOT NULL THEN 'trashed'
           WHEN f.status='deleting' THEN 'inactive' ELSE 'active' END lifecycle_state,
      COALESCE(cfd.id, user_deletion.deletion_id) deletion_id,
      user_deletion.purge_after,
      COALESCE(cfd.purge_stage, user_deletion.purge_stage) operation_status,
      CASE WHEN COALESCE(cfd.last_error_code, user_deletion.last_error_code) IN
        ('profile_cleanup_failed','archive_cleanup_failed','storage_timeout','storage_not_found','storage_invalid_request','storage_forbidden','storage_unavailable')
        THEN COALESCE(cfd.last_error_code, user_deletion.last_error_code) ELSE NULL END error_code
    FROM families f JOIN users u ON u.id=f.owner_user_id
    LEFT JOIN control_family_deletions cfd ON cfd.family_id=f.id
    LEFT JOIN LATERAL (
      SELECT d.id AS deletion_id, d.purge_after, d.purge_stage, d.last_error_code
        FROM control_user_deletion_families df JOIN control_user_deletions d ON d.id=df.deletion_id
       WHERE df.family_id=f.id AND d.restored_at IS NULL ORDER BY d.deleted_at DESC LIMIT 1
    ) user_deletion ON TRUE ${where}
    ORDER BY ${order.expression} ${direction}, f.id ${direction} LIMIT ${limit}
  `
  return rows.map(familyRow)
  })
}
export async function queryFamilyById(db:DbClient,id:string,quotaBytes:number) { return queryFamilies(db,Prisma.sql`WHERE f.id=${id}::uuid`,1,quotaBytes,'createdAt') }
function familyRow(r: Row) {
  return { id: r.id, name: r.name, childName: r.child_name, ownerName: r.owner_name, status: r.status,
    lifecycleState:r.lifecycle_state, deletionId:r.deletion_id, purgeAfter:r.purge_after ? (r.purge_after as Date).toISOString() : null,
    operationStatus:r.operation_status, errorCode:r.error_code,
    createdAt: (r.created_at as Date).toISOString(), activeMembers: Number(r.active_members), storageUsedBytes: String(r.storage_used_bytes),
    storageReservedBytes: String(r.storage_reserved_bytes), quotaBytes: String(r.quota_bytes), publishedMemories: Number(r.published_memories),
    mediaAttachments: Number(r.media_attachments), maxState: r.max_state, lastObservedAt: r.last_observed_at ? (r.last_observed_at as Date).toISOString() : null,
    maxLastCheckedAt: r.max_last_checked_at ? (r.max_last_checked_at as Date).toISOString() : null,
    maxVerificationAgeSeconds: r.max_last_checked_at ? Math.max(0, Math.floor((Date.now() - (r.max_last_checked_at as Date).getTime()) / 1000)) : null }
}
export async function listFamilies(db: DbClient, query: ControlListQuery, quotaBytes: number) {
  const rows = await queryFamilies(db, familyWhere(query), query.limit + 1, quotaBytes, query.sort)
  return pageRows(rows, query, 'family')
}

export function userWhere(query: ControlListQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor, query, 'users') : null
  const desc=query.sort==='createdAt'
  const expression=desc?Prisma.raw('u.created_at'):Prisma.raw("coalesce(u.display_name,'')")
  const valueCast=desc?Prisma.sql`${cursor?.value ?? null}::timestamptz`:Prisma.sql`${cursor?.value ?? null}::text`
  const seek = cursor ? desc?Prisma.sql`AND (${expression},u.id)<(${valueCast},${cursor.id}::uuid)`:Prisma.sql`AND (${expression},u.id)>(${valueCast},${cursor.id}::uuid)` : Prisma.empty
  return Prisma.sql`WHERE u.control_state <> 'purged'
    AND (${query.userState ?? null}::text IS NULL OR u.control_state::text=${query.userState ?? null})
    AND (${query.q ?? null}::text IS NULL OR coalesce(u.display_name,'') ILIKE ${query.q ? `%${query.q}%` : null}) ${seek}`
}
export async function queryUsers(db: DbClient, where: Prisma.Sql, limit: number, sort = 'createdAt') {
  return withControlReadTimeout(db, async (tx) => {
  const rows = await tx.$queryRaw<Array<Row>>`
    SELECT u.id,u.display_name,u.created_at,u.control_state::text AS lifecycle_state,
      CASE WHEN u.control_state='active' THEN NULL ELSE deletion.id END AS deletion_id,
      CASE WHEN u.control_state='active' THEN NULL ELSE deletion.purge_after END AS purge_after,
      CASE WHEN u.control_state='active' THEN NULL WHEN u.control_state='purged' THEN 'purged' ELSE deletion.purge_stage END AS operation_status,
      CASE WHEN deletion.last_error_code IN ('profile_cleanup_failed','archive_cleanup_failed','storage_timeout','storage_not_found','storage_invalid_request','storage_forbidden','storage_unavailable') THEN deletion.last_error_code ELSE NULL END AS error_code,
      (SELECT count(DISTINCT f.id) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.user_id=u.id AND m.revoked_at IS NULL AND f.status='active') active_families,
      (SELECT array_agg(f.name ORDER BY f.name) FROM (SELECT f.name FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.user_id=u.id AND m.revoked_at IS NULL AND f.status='active' ORDER BY f.name LIMIT 5) f) family_names,
      (SELECT greatest(count(DISTINCT f.id)-5,0) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.user_id=u.id AND m.revoked_at IS NULL AND f.status='active') more_families,
      (SELECT max(s.created_at) FROM auth_sessions s WHERE s.user_id=u.id) last_session_created_at,
      (SELECT a.last_observed_at FROM control_user_activity a WHERE a.user_id=u.id ORDER BY a.last_observed_at DESC,a.utc_day DESC LIMIT 1) last_activity_at,
      (SELECT a.surface FROM control_user_activity a WHERE a.user_id=u.id ORDER BY a.last_observed_at DESC,a.utc_day DESC LIMIT 1) last_activity_surface
    FROM users u LEFT JOIN LATERAL (
      SELECT id, purge_after, purge_stage, last_error_code FROM control_user_deletions
       WHERE target_user_id=u.id ORDER BY deleted_at DESC LIMIT 1
    ) deletion ON TRUE ${where} ORDER BY ${sort==='createdAt'?Prisma.raw('u.created_at DESC,u.id DESC'):Prisma.raw("coalesce(u.display_name,'') ASC,u.id ASC")} LIMIT ${limit}
  `
  return rows.map(userRow)
  })
}
export async function queryUserById(db:DbClient,id:string) { return queryUsers(db,Prisma.sql`WHERE u.id=${id}::uuid`,1) }
function userRow(r: Row) { return { id:r.id, displayName:r.display_name, createdAt:(r.created_at as Date).toISOString(), lifecycleState:r.lifecycle_state,
  deletionId:r.deletion_id, purgeAfter:r.purge_after ? (r.purge_after as Date).toISOString() : null, operationStatus:r.operation_status, errorCode:r.error_code,
  activeFamilies:Number(r.active_families),
  familyNames:(r.family_names as string[] | null) ?? [], moreFamilies:Number(r.more_families), lastSessionCreatedAt:r.last_session_created_at ? (r.last_session_created_at as Date).toISOString() : null, lastActivityAt:r.last_activity_at ? (r.last_activity_at as Date).toISOString() : null, lastActivitySurface:r.last_activity_surface ?? null } }
export async function listUsers(db: DbClient, query: ControlListQuery) { return pageRows(await queryUsers(db,userWhere(query),query.limit+1,query.sort),query, 'user') }
function pageRows<T extends Record<string, unknown>>(rows:T[], query:ControlListQuery, kind:'family'|'user') { const hasNext=rows.length>query.limit; const items=rows.slice(0,query.limit); const last=items.at(-1); const cursorKey=query.sort==='name'?(kind==='family'?'name':'displayName'):query.sort; const rawValue=last?.[cursorKey]; const value=query.sort==='lastObservedAt'&&rawValue===null?new Date(0).toISOString():String(rawValue??''); return {items,nextCursor:hasNext && last ? encodeCursor({v:1,filter:filterHash(query),scope:kind==='family'?'families':'users',id:String(last.id),value}) : null} }

export async function listChildren(db:DbClient,id:string,query:ControlListQuery,kind:'members'|'invites'|'memberships') {
  return withControlReadTimeout(db, async (tx) => {
  let rows: Array<Row>
  if (kind==='members' || kind==='memberships') {
    const familyMode=kind==='members'
    const predicate=familyMode ? Prisma.sql`m.family_id=${id}::uuid` : Prisma.sql`m.user_id=${id}::uuid`
    const cursor=query.cursor?decodeCursor(query.cursor,query,`${familyMode?'families':'users'}:${id}:${familyMode?'members':'memberships'}`):null
    const seek=cursor?(familyMode?Prisma.sql`AND (m.joined_at,m.user_id)<(${cursor.value}::timestamptz,${cursor.id}::uuid)`:Prisma.sql`AND (m.joined_at,m.family_id)<(${cursor.value}::timestamptz,${cursor.id}::uuid)`):Prisma.empty
    const tieBreaker=familyMode?Prisma.raw('m.user_id'):Prisma.raw('m.family_id')
    rows=await tx.$queryRaw<Array<Row>>`
      SELECT m.family_id,m.user_id,m.role::text role,m.family_display_name,m.joined_at,u.display_name,f.name family_name,f.owner_user_id
      FROM family_members m JOIN users u ON u.id=m.user_id JOIN families f ON f.id=m.family_id
      WHERE ${predicate} AND m.revoked_at IS NULL AND f.status='active' ${seek}
      ORDER BY m.joined_at DESC,${tieBreaker} DESC LIMIT ${query.limit+1}
    `
    const items=rows.slice(0,query.limit).map((r)=>familyMode?{userId:r.user_id,displayName:r.display_name,alias:r.family_display_name,role:r.role,isOwner:r.user_id===r.owner_user_id,joinedAt:(r.joined_at as Date).toISOString()}:{familyId:r.family_id,familyName:r.family_name,alias:r.family_display_name,role:r.role,isOwner:r.user_id===r.owner_user_id,joinedAt:(r.joined_at as Date).toISOString()})
    const last=rows[query.limit-1]
    return {items,nextCursor:rows.length>query.limit&&last?encodeCursor({v:1,filter:filterHash(query),scope:`${familyMode?'families':'users'}:${id}:${familyMode?'members':'memberships'}`,id:String(familyMode?last.user_id:last.family_id),value:(last.joined_at as Date).toISOString()}):null}
  }
  const cursor=query.cursor?decodeCursor(query.cursor,query,`families:${id}:invites`):null
  const seek=cursor?Prisma.sql`AND (created_at,id)<(${cursor.value}::timestamptz,${cursor.id}::uuid)`:Prisma.empty
  rows=await tx.$queryRaw<Array<Row>>`
    SELECT id,accepted_at,revoked_at,expires_at,created_at FROM family_invites WHERE family_id=${id}::uuid ${seek} ORDER BY created_at DESC,id DESC LIMIT ${query.limit+1}
  `
  const now=Date.now(); const items=rows.slice(0,query.limit).map((r)=>({id:r.id,state:r.revoked_at?'revoked':r.accepted_at?'accepted':(r.expires_at as Date).getTime()<=now?'expired':'pending',createdAt:(r.created_at as Date).toISOString(),expiresAt:(r.expires_at as Date).toISOString()}))
  const last=rows[query.limit-1]
  return {items,nextCursor:rows.length>query.limit&&last?encodeCursor({v:1,filter:filterHash(query),scope:`families:${id}:invites`,id:String(last.id),value:(last.created_at as Date).toISOString()}):null}
  })
}

export async function queryOverview(db:DbClient, from:Date, now:Date) {
  return withControlReadTimeout(db, async (tx) => {
  const [totals] = await tx.$queryRaw<Array<Row>>`
    SELECT (SELECT count(*) FROM users WHERE control_state <> 'purged') AS accounts_total,
      (SELECT count(*) FROM users WHERE control_state = 'active') AS accounts_active,
      (SELECT count(*) FROM users WHERE control_state = 'trashed') AS accounts_trashed,
      (SELECT count(*) FROM users WHERE control_state = 'purging') AS accounts_purging,
      (SELECT count(*) FROM families WHERE status='active') AS families_active,
      (SELECT count(*) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.revoked_at IS NULL AND f.status='active') AS active_memberships,
      (SELECT count(DISTINCT m.user_id) FROM family_members m JOIN families f ON f.id=m.family_id JOIN users u ON u.id=m.user_id WHERE m.revoked_at IS NULL AND f.status='active' AND u.control_state='active') AS accounts_with_family,
      (SELECT count(*) FROM family_invites i JOIN families f ON f.id=i.family_id WHERE i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>${now} AND f.status='active') AS invite_pending,
      (SELECT count(*) FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.revoked_at IS NULL AND s.expires_at>${now} AND u.control_state='active') AS valid_sessions,
      (SELECT coalesce(sum(storage_used_bytes),0)::text FROM families) AS storage_bytes`
  const registrations = await tx.$queryRaw<Array<{ day:Date; count:bigint }>>`
    SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day,count(*) AS count
    FROM users WHERE created_at>=${from} AND created_at<${now} GROUP BY 1 ORDER BY 1`
  return { totals, registrations }
  })
}
export async function queryStorage(db:DbClient) {
  const totals = await withControlReadTimeout(db, async (tx) => {
    const [row] = await tx.$queryRaw<Array<{used:string;reserved:string}>>`SELECT coalesce(sum(storage_used_bytes),0)::text used,coalesce(sum(storage_reserved_bytes),0)::text reserved FROM families`
    return row!
  })
  return { totals }
}
export async function queryEvents(db:DbClient, query:ControlListQuery, cursor:{id:string;value:string}|null) {
  const seek=cursor?Prisma.sql`AND (e.occurred_at,e.id)<(${cursor.value}::timestamptz,${cursor.id})`:Prisma.empty
  return withControlReadTimeout(db, (tx) => tx.$queryRaw<Array<Row>>`
    SELECT id,type,occurred_at,family_id,family_name FROM (
      SELECT f.id::text id,'family_created' type,f.created_at occurred_at,f.id family_id,f.name family_name FROM families f
      UNION ALL
      SELECT m.family_id::text||':'||m.user_id::text id,'membership_joined' type,m.joined_at occurred_at,m.family_id,f.name family_name FROM family_members m JOIN families f ON f.id=m.family_id
      UNION ALL
      SELECT m.id::text id,'memory_published' type,m.first_published_at occurred_at,m.family_id,f.name family_name FROM memories m JOIN families f ON f.id=m.family_id WHERE m.status='published' AND m.deleted_at IS NULL AND m.first_published_at IS NOT NULL
    ) e WHERE (${query.q??null}::text IS NULL OR e.family_name ILIKE ${query.q?`%${query.q}%`:null}) ${seek}
    ORDER BY occurred_at DESC,id DESC LIMIT ${query.limit+1}`)
}
