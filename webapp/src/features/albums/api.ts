import { albumEntryMutationSchema, albumEntryPageSchema, albumEntryResponseSchema, albumMutationSchema, albumPageSchema, albumResponseSchema, createAlbumEntryRequestSchema, createAlbumRequestSchema, mediaPickerPageSchema, updateAlbumEntryRequestSchema, updateAlbumRequestSchema, albumSourceSelectionSchema, workshopGroupsSchema, type AlbumKind } from '@web-app-demo/contracts'
import type { z } from 'zod'
import type { AuthenticatedTransport } from '@/platform/api'

export function albumsApi(transport: AuthenticatedTransport, familyId: string, scopedSignal: AbortSignal | (() => AbortSignal)) {
  const root = `/api/v1/families/${encodeURIComponent(familyId)}/albums`
  const signal = () => typeof scopedSignal === 'function' ? scopedSignal() : scopedSignal
  const request = <S extends z.ZodType>(path: string, schema: S, method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET', body?: unknown, key?: string) => transport.request(path, schema, { signal: signal(), method, ...(body === undefined ? {} : { body }), ...(key ? { headers: { 'Idempotency-Key': key } } : {}) })
  const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString()
  return {
    list: (filter: string, cursor?: string) => request(`${root}?${query({ filter, limit: 20, cursor })}`, albumPageSchema),
    create: (input: z.input<typeof createAlbumRequestSchema>, key: string) => request(root, albumMutationSchema, 'POST', createAlbumRequestSchema.parse(input), key),
    album: (id: string) => request(`${root}/${id}`, albumResponseSchema),
    update: (id: string, input: z.input<typeof updateAlbumRequestSchema>) => request(`${root}/${id}`, albumResponseSchema, 'PATCH', updateAlbumRequestSchema.parse(input)),
    remove: (id: string, version: number) => transport.raw(`${root}/${id}`, { signal: signal(), method: 'DELETE', headers: { 'If-Match': String(version) } }),
    entries: (id: string, cursor?: string, category?: string, year?: number) => request(`${root}/${id}/entries?${query({ limit: 48, cursor, category, year })}`, albumEntryPageSchema),
    entry: (id: string, entryId: string) => request(`${root}/${id}/entries/${entryId}`, albumEntryResponseSchema),
    createEntry: (id: string, input: z.input<typeof createAlbumEntryRequestSchema>, key: string) => request(`${root}/${id}/entries`, albumEntryMutationSchema, 'POST', createAlbumEntryRequestSchema.parse(input), key),
    updateEntry: (id: string, entryId: string, input: z.input<typeof updateAlbumEntryRequestSchema>) => request(`${root}/${id}/entries/${entryId}`, albumEntryResponseSchema, 'PATCH', updateAlbumEntryRequestSchema.parse(input)),
    sources: (id: string, entryId: string, input: z.input<typeof albumSourceSelectionSchema>, key: string) => request(`${root}/${id}/entries/${entryId}/sources`, albumEntryResponseSchema, 'PUT', albumSourceSelectionSchema.parse(input), key),
    clear: (id: string, entryId: string, expectedVersion: number) => request(`${root}/${id}/entries/${entryId}/clear`, albumEntryResponseSchema, 'POST', { expectedVersion }),
    removeEntry: (id: string, entryId: string, version: number) => transport.raw(`${root}/${id}/entries/${entryId}`, { signal: signal(), method: 'DELETE', headers: { 'If-Match': String(version) } }),
    reorder: (id: string, entryId: string, beforeEntryId: string | null, expectedVersion: number) => request(`${root}/${id}/entries:reorder`, albumResponseSchema, 'POST', { entryId, beforeEntryId, expectedVersion }),
    groups: (id: string) => request(`${root}/${id}/workshop-groups`, workshopGroupsSchema),
    picker: (kind?: 'photo' | 'video' | 'voice' | 'note', cursor?: string, from?: string, to?: string) => request(`/api/v1/families/${encodeURIComponent(familyId)}/media-picker?${query({ limit: 20, kind, cursor, from, to })}`, mediaPickerPageSchema),
  }
}
export type AlbumsApi = ReturnType<typeof albumsApi>

export function createAlbumRequestScope() {
  let controller = new AbortController()
  return {
    signal: () => controller.signal,
    isAborted: () => controller.signal.aborted,
    renewIfAborted: () => { if (controller.signal.aborted) controller = new AbortController() },
    abort: () => controller.abort(),
  }
}
export type AlbumFilter = 'all' | 'template' | 'custom'
export const defaultTitle = (kind: AlbumKind, childName?: string) => ({ year: `Первый год${childName ? ` · ${childName}` : ''}`, events: 'Первые открытия', workshop: 'Мастерская', free: '' })[kind]
