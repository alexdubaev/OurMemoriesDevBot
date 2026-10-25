import { Prisma } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import { decodeCursor, encodeCursor, filterHash, type ControlListQuery } from '../application/control-helpers'

type Row = Record<string, unknown>

export function familyWhere(query: ControlListQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor, query) : null
  const order = familyOrder(query.sort)
  const valueCast = query.sort === 'createdAt' ? Prisma.sql`${cursor?.value ?? null}::timestamptz` : query.sort === 'activeMembers' ? Prisma.sql`${cursor?.value ?? null}::bigint` : query.sort === 'storageUsedBytes' ? Prisma.sql`${cursor?.value ?? null}::bigint` : Prisma.sql`${cursor?.value ?? null}::text`
  const seek = cursor ? order.desc ? Prisma.sql`AND (${order.expression},f.id) < (${valueCast},${cursor.id}::uuid)` : Prisma.sql`AND (${order.expression},f.id) > (${valueCast},${cursor.id}::uuid)` : Prisma.empty
  return Prisma.sql`WHERE (${query.status ?? null}::text IS NULL OR f.status::text=${query.status ?? null})
    AND (${query.q ?? null}::text IS NULL OR f.name ILIKE ${query.q ? `%${query.q}%` : null})
    AND (${query.maxState ?? null}::text IS NULL OR (CASE WHEN f.max_backup_chat_id IS NULL THEN 'unconfigured' ELSE coalesce((SELECT b.state FROM max_channel_bindings b WHERE b.family_id=f.id ORDER BY b.updated_at DESC LIMIT 1),'disconnected') END)=${query.maxState ?? null}) ${seek}`
}
function familyOrder(sort:string) {
  const expressions:Record<string,Prisma.Sql>={createdAt:Prisma.raw('f.created_at'),name:Prisma.raw("coalesce(f.name,'')"),activeMembers:Prisma.raw('(SELECT count(*) FROM family_members m WHERE m.family_id=f.id AND m.revoked_at IS NULL)'),storageUsedBytes:Prisma.raw('f.storage_used_bytes')}
  return {expression:expressions[sort]!,desc:sort!=='name'}
}
export async function queryFamilies(db: DbClient, where: Prisma.Sql, limit: number, quotaBytes: number, sort: string) {
  const order=familyOrder(sort); const direction=Prisma.raw(order.desc?'DESC':'ASC')
  const rows = await db.$queryRaw<Array<Row>>`
    SELECT f.id, f.name, f.status::text status, f.created_at, f.storage_used_bytes::text storage_used_bytes,
      f.storage_reserved_bytes::text storage_reserved_bytes, ${String(quotaBytes)}::text quota_bytes,
      u.display_name owner_name,
      (SELECT c.display_name FROM children c WHERE c.family_id=f.id AND c.deleted_at IS NULL ORDER BY c.created_at,c.id LIMIT 1) child_name,
      (SELECT count(*) FROM family_members m WHERE m.family_id=f.id AND m.revoked_at IS NULL) active_members,
      (SELECT count(*) FROM memories mm WHERE mm.family_id=f.id AND mm.status='published' AND mm.deleted_at IS NULL) published_memories,
      (SELECT count(*) FROM (
        SELECT mm.media_id::text attachment_id FROM memory_media mm JOIN memories m ON m.id=mm.memory_id AND m.family_id=mm.family_id WHERE mm.family_id=f.id AND m.status='published' AND m.deleted_at IS NULL
        UNION
        SELECT 'max:' || v.provider_attachment_id FROM max_video_references v JOIN memories m ON m.id=v.memory_id AND m.family_id=v.family_id WHERE v.family_id=f.id AND m.status='published' AND m.deleted_at IS NULL
      ) attachments) media_attachments,
      NULL::timestamptz last_observed_at,
      (SELECT CASE WHEN f.max_backup_chat_id IS NULL THEN 'unconfigured' ELSE coalesce((SELECT b.state FROM max_channel_bindings b WHERE b.family_id=f.id ORDER BY b.updated_at DESC LIMIT 1),'disconnected') END) max_state
    FROM families f JOIN users u ON u.id=f.owner_user_id ${where}
    ORDER BY ${order.expression} ${direction}, f.id ${direction} LIMIT ${limit}
  `
  return rows.map(familyRow)
}
export async function queryFamilyById(db:DbClient,id:string,quotaBytes:number) { return queryFamilies(db,Prisma.sql`WHERE f.id=${id}::uuid`,1,quotaBytes,'createdAt') }
function familyRow(r: Row) {
  return { id: r.id, name: r.name, childName: r.child_name, ownerName: r.owner_name, status: r.status,
    createdAt: (r.created_at as Date).toISOString(), activeMembers: Number(r.active_members), storageUsedBytes: String(r.storage_used_bytes),
    storageReservedBytes: String(r.storage_reserved_bytes), quotaBytes: String(r.quota_bytes), publishedMemories: Number(r.published_memories),
    mediaAttachments: Number(r.media_attachments), maxState: r.max_state, lastObservedAt: r.last_observed_at ? (r.last_observed_at as Date).toISOString() : null }
}
export async function listFamilies(db: DbClient, query: ControlListQuery, quotaBytes: number) {
  const rows = await queryFamilies(db, familyWhere(query), query.limit + 1, quotaBytes, query.sort)
  return pageRows(rows, query, 'family')
}

export function userWhere(query: ControlListQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor, query) : null
  const desc=query.sort==='createdAt'
  const expression=desc?Prisma.raw('u.created_at'):Prisma.raw("coalesce(u.display_name,'')")
  const valueCast=desc?Prisma.sql`${cursor?.value ?? null}::timestamptz`:Prisma.sql`${cursor?.value ?? null}::text`
  const seek = cursor ? desc?Prisma.sql`AND (${expression},u.id)<(${valueCast},${cursor.id}::uuid)`:Prisma.sql`AND (${expression},u.id)>(${valueCast},${cursor.id}::uuid)` : Prisma.empty
  return Prisma.sql`WHERE (${query.q ?? null}::text IS NULL OR coalesce(u.display_name,'') ILIKE ${query.q ? `%${query.q}%` : null}) ${seek}`
}
export async function queryUsers(db: DbClient, where: Prisma.Sql, limit: number, sort = 'createdAt') {
  const rows = await db.$queryRaw<Array<Row>>`
    SELECT u.id,u.display_name,u.created_at,
      (SELECT count(DISTINCT f.id) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.user_id=u.id AND m.revoked_at IS NULL AND f.status='active') active_families,
      (SELECT array_agg(f.name ORDER BY f.name) FROM (SELECT f.name FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.user_id=u.id AND m.revoked_at IS NULL AND f.status='active' ORDER BY f.name LIMIT 5) f) family_names,
      (SELECT greatest(count(DISTINCT f.id)-5,0) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.user_id=u.id AND m.revoked_at IS NULL AND f.status='active') more_families,
      (SELECT max(s.created_at) FROM auth_sessions s WHERE s.user_id=u.id) last_session_created_at,
      NULL::timestamptz last_activity_at
    FROM users u ${where} ORDER BY ${sort==='createdAt'?Prisma.raw('u.created_at DESC,u.id DESC'):Prisma.raw("coalesce(u.display_name,'') ASC,u.id ASC")} LIMIT ${limit}
  `
  return rows.map(userRow)
}
export async function queryUserById(db:DbClient,id:string) { return queryUsers(db,Prisma.sql`WHERE u.id=${id}::uuid`,1) }
function userRow(r: Row) { return { id:r.id, displayName:r.display_name, createdAt:(r.created_at as Date).toISOString(), activeFamilies:Number(r.active_families),
  familyNames:(r.family_names as string[] | null) ?? [], moreFamilies:Number(r.more_families), lastSessionCreatedAt:r.last_session_created_at ? (r.last_session_created_at as Date).toISOString() : null, lastActivityAt:null } }
export async function listUsers(db: DbClient, query: ControlListQuery) { return pageRows(await queryUsers(db,userWhere(query),query.limit+1,query.sort),query, 'user') }
function pageRows<T extends Record<string, unknown>>(rows:T[], query:ControlListQuery, kind:'family'|'user') { const hasNext=rows.length>query.limit; const items=rows.slice(0,query.limit); const last=items.at(-1); const cursorKey=query.sort==='name'?(kind==='family'?'name':'displayName'):query.sort; return {items,nextCursor:hasNext && last ? encodeCursor({v:1,filter:filterHash(query),id:String(last.id),value:String(last[cursorKey] ?? '')}) : null} }

export async function listChildren(db:DbClient,id:string,query:ControlListQuery,kind:'members'|'invites'|'memberships') {
  let rows: Array<Row>
  if (kind==='members' || kind==='memberships') {
    const familyMode=kind==='members'
    const predicate=familyMode ? Prisma.sql`m.family_id=${id}::uuid` : Prisma.sql`m.user_id=${id}::uuid`
    const cursor=query.cursor?decodeCursor(query.cursor,query):null
    const seek=cursor?(familyMode?Prisma.sql`AND (m.joined_at,m.user_id)<(${cursor.value}::timestamptz,${cursor.id}::uuid)`:Prisma.sql`AND (m.joined_at,m.family_id)<(${cursor.value}::timestamptz,${cursor.id}::uuid)`):Prisma.empty
    const tieBreaker=familyMode?Prisma.raw('m.user_id'):Prisma.raw('m.family_id')
    rows=await db.$queryRaw<Array<Row>>`
      SELECT m.family_id,m.user_id,m.role::text role,m.family_display_name,m.joined_at,u.display_name,f.name family_name
      FROM family_members m JOIN users u ON u.id=m.user_id JOIN families f ON f.id=m.family_id
      WHERE ${predicate} AND m.revoked_at IS NULL AND f.status='active' ${seek}
      ORDER BY m.joined_at DESC,${tieBreaker} DESC LIMIT ${query.limit+1}
    `
    const items=rows.slice(0,query.limit).map((r)=>familyMode?{userId:r.user_id,displayName:r.display_name,alias:r.family_display_name,role:r.role,joinedAt:(r.joined_at as Date).toISOString()}:{familyId:r.family_id,familyName:r.family_name,alias:r.family_display_name,role:r.role,joinedAt:(r.joined_at as Date).toISOString()})
    const last=rows[query.limit-1]
    return {items,nextCursor:rows.length>query.limit&&last?encodeCursor({v:1,filter:filterHash(query),id:String(familyMode?last.user_id:last.family_id),value:(last.joined_at as Date).toISOString()}):null}
  }
  const cursor=query.cursor?decodeCursor(query.cursor,query):null
  const seek=cursor?Prisma.sql`AND (created_at,id)<(${cursor.value}::timestamptz,${cursor.id}::uuid)`:Prisma.empty
  rows=await db.$queryRaw<Array<Row>>`
    SELECT id,accepted_at,revoked_at,expires_at,created_at FROM family_invites WHERE family_id=${id}::uuid ${seek} ORDER BY created_at DESC,id DESC LIMIT ${query.limit+1}
  `
  const now=Date.now(); const items=rows.slice(0,query.limit).map((r)=>({id:r.id,state:r.revoked_at?'revoked':r.accepted_at?'accepted':(r.expires_at as Date).getTime()<=now?'expired':'pending',createdAt:(r.created_at as Date).toISOString(),expiresAt:(r.expires_at as Date).toISOString()}))
  const last=rows[query.limit-1]
  return {items,nextCursor:rows.length>query.limit&&last?encodeCursor({v:1,filter:filterHash(query),id:String(last.id),value:(last.created_at as Date).toISOString()}):null}
}

export async function queryOverview(db:DbClient, from:Date, now:Date) {
  const [totals] = await db.$queryRaw<Array<Row>>`
    SELECT (SELECT count(*) FROM users) AS accounts_total,
      (SELECT count(*) FROM families WHERE status='active') AS families_active,
      (SELECT count(*) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.revoked_at IS NULL AND f.status='active') AS active_memberships,
      (SELECT count(DISTINCT m.user_id) FROM family_members m JOIN families f ON f.id=m.family_id WHERE m.revoked_at IS NULL AND f.status='active') AS accounts_with_family,
      (SELECT count(*) FROM family_invites i JOIN families f ON f.id=i.family_id WHERE i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>${now} AND f.status='active') AS invite_pending,
      (SELECT coalesce(sum(storage_used_bytes),0)::text FROM families) AS storage_bytes`
  const registrations = await db.$queryRaw<Array<{ day:Date; count:bigint }>>`
    SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day,count(*) AS count
    FROM users WHERE created_at>=${from} AND created_at<${now} GROUP BY 1 ORDER BY 1`
  return { totals, registrations }
}
export async function queryStorage(db:DbClient) {
  const [[totals],[database]] = await Promise.all([
    db.$queryRaw<Array<{used:string;reserved:string}>>`SELECT coalesce(sum(storage_used_bytes),0)::text used,coalesce(sum(storage_reserved_bytes),0)::text reserved FROM families`,
    db.$queryRaw<Array<{size:bigint}>>`SELECT pg_database_size(current_database()) size`,
  ])
  return { totals, databaseSize:database.size }
}
export async function querySystem(db:DbClient) {
  const [[database],[pending]] = await Promise.all([
    db.$queryRaw<Array<{size:bigint}>>`SELECT pg_database_size(current_database()) size`,
    db.$queryRaw<Array<{pending:bigint;age:bigint|null}>>`SELECT count(*) pending,extract(epoch FROM (now()-min(scheduled_for) FILTER (WHERE scheduled_for<=now())))::bigint age FROM task_outbox WHERE status='pending'`,
  ])
  return { databaseSize:database.size, pending }
}
export async function queryEvents(db:DbClient, query:ControlListQuery, cursor:{id:string;value:string}|null) {
  const seek=cursor?Prisma.sql`AND (e.occurred_at,e.id)<(${cursor.value}::timestamptz,${cursor.id})`:Prisma.empty
  return db.$queryRaw<Array<Row>>`
    SELECT id,type,occurred_at,family_id,family_name FROM (
      SELECT f.id::text id,'family_created' type,f.created_at occurred_at,f.id family_id,f.name family_name FROM families f
      UNION ALL
      SELECT m.family_id::text||':'||m.user_id::text id,'membership_joined' type,m.joined_at occurred_at,m.family_id,f.name family_name FROM family_members m JOIN families f ON f.id=m.family_id
      UNION ALL
      SELECT m.id::text id,'memory_published' type,m.first_published_at occurred_at,m.family_id,f.name family_name FROM memories m JOIN families f ON f.id=m.family_id WHERE m.status='published' AND m.deleted_at IS NULL AND m.first_published_at IS NOT NULL
    ) e WHERE (${query.q??null}::text IS NULL OR e.family_name ILIKE ${query.q?`%${query.q}%`:null}) ${seek}
    ORDER BY occurred_at DESC,id DESC LIMIT ${query.limit+1}`
}
