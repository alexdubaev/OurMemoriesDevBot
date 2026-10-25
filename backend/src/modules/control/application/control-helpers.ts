import { AppError } from '../../../http/errors'
import { controlCursorQuerySchema } from '@web-app-demo/contracts'
import { z } from 'zod'

export type ControlListQuery = { limit: number; cursor?: string; q?: string; sort: string; status?: string; maxState?: string; userState?: string }

export function sample<T>(value: T | null, status: 'ok'|'stale'|'error'|'not_configured'|'unsupported'|'insufficient_history', sourceId: string, staleAfterSeconds: number, observedAt: string | null, lastAttemptAt: string | null = observedAt, coverageFrom: string | null = null, errorCode: 'timeout'|'unavailable'|'invalid_payload'|'permission_denied'|'unknown'|null = null) {
  return { value, status, sourceId, observedAt, lastAttemptAt, staleAfterSeconds, coverageFrom, coverageRatio: null, errorCode }
}
export function notFound() { return new AppError(404, 'NOT_FOUND', 'Запись не найдена') }
export function uuidParam(value: string) { const parsed = z.string().uuid().safeParse(value); if (!parsed.success) throw new AppError(400, 'INVALID_INPUT', 'Некорректный идентификатор'); return value }

export function parseListQuery(raw: Record<string, string | undefined>, { compositeCursor = false }: { compositeCursor?: boolean } = {}): ControlListQuery {
  const parsed = controlCursorQuerySchema.safeParse(raw)
  if (!parsed.success) throw new AppError(400, 'INVALID_INPUT', 'Некорректные параметры списка')
  const { limit, cursor, q, status, maxState, userState } = parsed.data
  const result = { limit, cursor, q, sort: parsed.data.sort ?? 'createdAt', status, maxState, userState }
  if (cursor) compositeCursor ? decodeEventCursor(cursor, result) : decodeCursor(cursor, result)
  return result
}
export function validateUserSort(query: ControlListQuery) { if (!['createdAt','name'].includes(query.sort) || query.status || query.maxState) throw new AppError(400,'INVALID_INPUT','Недопустимая сортировка или фильтр для пользователей') }
export function validateFamilyListQuery(query: ControlListQuery) { if (query.userState) throw new AppError(400,'INVALID_INPUT','Фильтр состояния пользователя неприменим к семьям') }
export function validateChildListQuery(query:ControlListQuery) { if(query.sort!=='createdAt'||query.status||query.maxState||query.userState) throw new AppError(400,'INVALID_INPUT','Недопустимый фильтр списка') }
export function filterHash(query:ControlListQuery) { return JSON.stringify({q:query.q ?? '',sort:query.sort,status:query.status ?? '',maxState:query.maxState ?? '',userState:query.userState ?? ''}) }
export function encodeCursor(value:unknown) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
export function decodeCursor(value:string,query:ControlListQuery,scope?:string):{v:number;filter:string;scope:string;id:string;value:string} {
  try {
    const decoded=Buffer.from(value,'base64url').toString('utf8')
    if(Buffer.from(decoded).toString('base64url')!==value) throw new Error('encoding')
    const valueSchema=query.sort==='createdAt' || query.sort==='lastObservedAt'
      ? z.string().datetime({offset:true})
      : ['activeMembers','storageUsedBytes'].includes(query.sort)
        ? z.string().regex(/^(0|[1-9][0-9]*)$/)
        : z.string().max(500)
    const parsed=z.object({v:z.literal(1),filter:z.string(),scope:z.string().min(1).max(200),id:z.string().uuid(),value:valueSchema}).strict().parse(JSON.parse(decoded))
    if(parsed.filter!==filterHash(query) || (scope !== undefined && parsed.scope!==scope)) throw new Error('filter')
    if(['activeMembers','storageUsedBytes'].includes(query.sort) && BigInt(parsed.value) > 9_223_372_036_854_775_807n) throw new Error('range')
    return parsed
  } catch { throw new AppError(400,'INVALID_INPUT','Некорректный курсор списка') }
}
export function decodeEventCursor(value:string,query:ControlListQuery):{v:number;filter:string;scope:string;id:string;value:string} {
  try {
    const decoded=Buffer.from(value,'base64url').toString('utf8')
    if(Buffer.from(decoded).toString('base64url')!==value) throw new Error('encoding')
    const parsed=z.object({v:z.literal(1),filter:z.string(),scope:z.literal('events'),id:z.string().min(1).max(100),value:z.string().datetime({offset:true})}).strict().parse(JSON.parse(decoded))
    if(parsed.filter!==filterHash(query)) throw new Error('filter')
    return parsed
  } catch { throw new AppError(400,'INVALID_INPUT','Некорректный курсор списка') }
}
export function eventCursor(query:ControlListQuery,id:string,value:string) { return encodeCursor({v:1,filter:filterHash(query),scope:'events',id,value}) }

export function familyCsvRow(r:Record<string,unknown>) { return [r.id,r.name,r.childName,r.ownerName,r.status,r.lifecycleState,r.deletionId,r.purgeAfter,r.operationStatus,r.errorCode,r.createdAt,r.activeMembers,r.storageUsedBytes,r.storageReservedBytes,r.quotaBytes,r.publishedMemories,r.mediaAttachments,r.maxState,r.lastObservedAt] }
export function userCsvRow(r:Record<string,unknown>) { return [r.id,r.displayName,r.createdAt,r.lifecycleState,r.deletionId,r.purgeAfter,r.operationStatus,r.errorCode,r.activeFamilies,(r.familyNames as string[]).join('; '),r.moreFamilies,r.lastSessionCreatedAt,r.lastActivityAt,r.lastActivitySurface] }
export async function exportCsv(c:{var:{user:{id:string}};body:(body:string,status:200,headers:Record<string,string>)=>Response},limits:Map<string,number[]>,headers:string[],rowsFn:()=>Promise<unknown[][]>) {
  const owner=c.var.user.id; const now=Date.now(); const recent=(limits.get(owner)??[]).filter((time)=>now-time<60_000)
  if(recent.length>=2) throw new AppError(429,'RATE_LIMITED','Экспорт доступен не чаще двух раз в минуту')
  recent.push(now); limits.set(owner,recent)
  const rows=await rowsFn(); if(rows.length>10_000) throw new AppError(413,'PAYLOAD_TOO_LARGE','Сузьте фильтр: экспорт превышает 10 000 строк')
  const csv='\uFEFF'+[headers,...rows].map((row)=>row.map(csvCell).join(',')).join('\r\n')+'\r\n'
  if(Buffer.byteLength(csv,'utf8')>10*1024*1024) throw new AppError(413,'PAYLOAD_TOO_LARGE','Сузьте фильтр: экспорт превышает 10 МиБ')
  return c.body(csv,200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="control-export.csv"','Cache-Control':'private, no-store, max-age=0'})
}
function csvCell(value:unknown) { let text=value==null?'':String(value); if(/^[\s]*[=+\-@\t\r\n]/.test(text)) text=`'${text}`; return `"${text.replaceAll('"','""')}"` }
