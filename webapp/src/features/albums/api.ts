import { albumEntryMutationSchema, albumEntryPageSchema, albumEntryResponseSchema, albumMutationSchema, albumPageSchema, albumResponseSchema, createAlbumEntryRequestSchema, createAlbumRequestSchema, mediaPickerPageSchema, updateAlbumEntryRequestSchema, updateAlbumRequestSchema, albumSourceSelectionSchema, workshopGroupsSchema, type AlbumKind } from '@web-app-demo/contracts'
import { albumEntrySourcePageSchema, albumMonthCoverRequestSchema, albumMonthPhotoAppendRequestSchema, albumMonthPhotoBatchGrantSchema, albumMonthPhotoBatchRequestSchema, type AlbumMonthPhotoAppendRequest, type AlbumMonthPhotoBatchRequest } from '@web-app-demo/contracts'
import type { z } from 'zod'
import type { AuthenticatedTransport } from '@/platform/api'
import { ApiRequestError } from '@/platform/api'

export function albumsApi(transport: AuthenticatedTransport, familyId: string, scopedSignal: AbortSignal | (() => AbortSignal), onScopeUnavailable: (error: ApiRequestError) => void) {
  const root = `/api/v1/families/${encodeURIComponent(familyId)}/albums`
  const signal = () => typeof scopedSignal === 'function' ? scopedSignal() : scopedSignal
  async function scopedRequest<T>(operation: () => Promise<T>, requestSignal?: AbortSignal): Promise<T> {
    try { return await operation() }
    catch (error) { if (!requestSignal?.aborted && isAlbumScopeFailure(error)) onScopeUnavailable(error); throw error }
  }
  const request = <S extends z.ZodType>(path: string, schema: S, method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET', body?: unknown, key?: string) => scopedRequest(() => transport.request(path, schema, { signal: signal(), method, ...(body === undefined ? {} : { body }), ...(key ? { headers: { 'Idempotency-Key': key } } : {}) }))
  const remove = (path: string, version: number) => scopedRequest(() => transport.raw(path, { signal: signal(), method: 'DELETE', headers: { 'If-Match': String(version) } }))
  const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()
  const monthView = (month?: boolean) => month ? '?view=month-summary' : ''
  async function withMonthPhotoScope<T>(local: AbortSignal, operation: (requestSignal: AbortSignal) => Promise<T>) {
    const scope = signal()
    const controller = new AbortController()
    const abortLocal = () => controller.abort(local.reason)
    const abortScope = () => controller.abort(scope.reason)
    if (scope.aborted) abortScope()
    if (local.aborted) abortLocal()
    local.addEventListener('abort', abortLocal, { once: true })
    scope.addEventListener('abort', abortScope, { once: true })
    try { return await operation(controller.signal) }
    finally {
      local.removeEventListener('abort', abortLocal)
      scope.removeEventListener('abort', abortScope)
    }
  }
  return {
    list: (filter: string, cursor?: string) => request(`${root}?${query({ filter, limit: 20, cursor })}`, albumPageSchema),
    create: (input: z.input<typeof createAlbumRequestSchema>, key: string) => request(root, albumMutationSchema, 'POST', createAlbumRequestSchema.parse(input), key),
    album: (id: string) => request(`${root}/${id}`, albumResponseSchema),
    update: (id: string, input: z.input<typeof updateAlbumRequestSchema>) => request(`${root}/${id}`, albumResponseSchema, 'PATCH', updateAlbumRequestSchema.parse(input)),
    remove: (id: string, version: number) => remove(`${root}/${id}`, version),
    entries: (id: string, cursor?: string, category?: string, year?: number, month?: boolean) => request(`${root}/${id}/entries?${query({ limit: 48, cursor, category, year, view: month ? 'month-summary' : undefined })}`, albumEntryPageSchema),
    entry: (id: string, entryId: string, month?: boolean) => request(`${root}/${id}/entries/${entryId}${monthView(month)}`, albumEntryResponseSchema),
    createEntry: (id: string, input: z.input<typeof createAlbumEntryRequestSchema>, key: string) => request(`${root}/${id}/entries`, albumEntryMutationSchema, 'POST', createAlbumEntryRequestSchema.parse(input), key),
    updateEntry: (id: string, entryId: string, input: z.input<typeof updateAlbumEntryRequestSchema>, month?: boolean) => request(`${root}/${id}/entries/${entryId}${monthView(month)}`, albumEntryResponseSchema, 'PATCH', updateAlbumEntryRequestSchema.parse(input)),
    sources: (id: string, entryId: string, input: z.input<typeof albumSourceSelectionSchema>, key: string) => request(`${root}/${id}/entries/${entryId}/sources`, albumEntryResponseSchema, 'PUT', albumSourceSelectionSchema.parse(input), key),
    clear: (id: string, entryId: string, expectedVersion: number, month?: boolean) => request(`${root}/${id}/entries/${entryId}/clear${monthView(month)}`, albumEntryResponseSchema, 'POST', { expectedVersion }),
    monthSources: (id: string, entryId: string, kind: 'photo' | 'other' | 'cover-media', cursor: string | undefined, local: AbortSignal, limit = 24) => withMonthPhotoScope(local, (requestSignal) => scopedRequest(
      () => transport.request(`${root}/${id}/entries/${entryId}/sources?${query({ kind, cursor, limit })}`, albumEntrySourcePageSchema, { signal: requestSignal }), requestSignal,
    )),
    setMonthCover: (id: string, entryId: string, expectedVersion: number, sourceId: string | null) => request(
      `${root}/${id}/entries/${entryId}/month-cover`, albumEntryResponseSchema, 'PUT', albumMonthCoverRequestSchema.parse({ expectedVersion, sourceId }),
    ),
    removeMonthPhoto: (id: string, entryId: string, sourceId: string, version: number) => remove(`${root}/${id}/entries/${entryId}/photos/${sourceId}`, version),
    removeEntry: (id: string, entryId: string, version: number) => remove(`${root}/${id}/entries/${entryId}`, version),
    reorder: (id: string, entryId: string, beforeEntryId: string | null, expectedVersion: number) => request(`${root}/${id}/entries:reorder`, albumResponseSchema, 'POST', { entryId, beforeEntryId, expectedVersion }),
    groups: (id: string) => request(`${root}/${id}/workshop-groups`, workshopGroupsSchema),
    picker: (kind?: 'photo' | 'video' | 'voice' | 'note', cursor?: string, from?: string, to?: string) => request(`/api/v1/families/${encodeURIComponent(familyId)}/media-picker?${query({ limit: 20, kind, cursor, from, to })}`, mediaPickerPageSchema),
    withMonthPhotoScope,
    reserveMonthPhotoBatch: (id: string, entryId: string, input: AlbumMonthPhotoBatchRequest, key: string, requestSignal: AbortSignal) => scopedRequest(
      () => transport.request(`${root}/${id}/entries/${entryId}/photo-batches`, albumMonthPhotoBatchGrantSchema, {
        method: 'POST', body: albumMonthPhotoBatchRequestSchema.parse(input), headers: { 'Idempotency-Key': key }, signal: requestSignal,
      }), requestSignal,
    ),
    appendMonthPhoto: (id: string, entryId: string, input: AlbumMonthPhotoAppendRequest, key: string, requestSignal: AbortSignal) => scopedRequest(
      () => transport.raw(`${root}/${id}/entries/${entryId}/photos`, {
        method: 'POST', body: albumMonthPhotoAppendRequestSchema.parse(input), headers: { 'Idempotency-Key': key }, signal: requestSignal,
      }), requestSignal,
    ),
  }
}
export type AlbumsApi = ReturnType<typeof albumsApi>

export function isAlbumScopeFailure(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403 || error.status === 404 && error.code === 'ALBUM_SCOPE_UNAVAILABLE')
}

export function createAlbumRequestScope() {
  let controller = new AbortController()
  return {
    signal: () => controller.signal,
    isAborted: () => controller.signal.aborted,
    renewIfAborted: () => { if (controller.signal.aborted) controller = new AbortController() },
    abort: () => controller.abort(),
  }
}

export function createAlbumScopeFailureSink() {
  let handler: (error: ApiRequestError) => void = () => undefined
  return {
    notify: (error: ApiRequestError) => handler(error),
    setHandler: (next: (error: ApiRequestError) => void) => { handler = next },
  }
}
export type AlbumFilter = 'all' | 'template' | 'custom'
export const defaultTitle = (kind: AlbumKind, childName?: string) => ({ year: `Первый год${childName ? ` · ${childName}` : ''}`, events: 'Первые открытия', workshop: 'Мастерская', free: '' })[kind]
