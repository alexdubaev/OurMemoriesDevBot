import {
  MEMOLY_CHILDREN_HEADER,
  albumMutationSchema,
  albumPageSchema,
  likeResponseSchema,
  reactionResponseSchema,
  memoryChildTagsResponseSchema,
  memoryDtoSchema,
  memoryPageSchema,
  telegramVideoOpenResponseSchema,
  type MemoryChildTag,
  type MemoryPage,
  type MemoryReaction,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'
import type { FeedFilter } from './presentation'
import { UNTAGGED_CHILD_FILTER, type ChildFilter } from './child-filter'

/** Child tags ride along only when the client asks; old clients keep the strict old DTO. */
const feedHeaders = { 'X-Memoly-Publication-Attribution': '2', [MEMOLY_CHILDREN_HEADER]: '1' }

export function loadFeed(
  transport: AuthenticatedTransport,
  familyId: string,
  filter: FeedFilter,
  cursor?: string | null,
  signal?: AbortSignal,
  unreadOnly = false,
  childFilter: ChildFilter = null,
): Promise<MemoryPage> {
  const query = new URLSearchParams({ limit: '20' })
  if (filter !== 'all') query.set('kind', filter)
  if (cursor) query.set('cursor', cursor)
  if (unreadOnly) query.set('unreadOnly', 'true')
  if (childFilter === UNTAGGED_CHILD_FILTER) query.set('untagged', 'true')
  else if (childFilter) query.set('childId', childFilter)
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories?${query.toString()}`,
    memoryPageSchema,
    { signal, headers: feedHeaders },
  )
}

export function loadMemory(transport: AuthenticatedTransport, familyId: string, memoryId: string, signal?: AbortSignal) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}`,
    memoryDtoSchema,
    { signal, headers: feedHeaders },
  )
}

/** Replaces all child tags of a publication; a stale `expectedChildTagsVersion` is a 409 VERSION_CONFLICT. */
export function replaceMemoryChildTags(transport: AuthenticatedTransport, familyId: string, memoryId: string, tags: MemoryChildTag[], expectedChildTagsVersion: number, signal?: AbortSignal) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}/child-tags`,
    memoryChildTagsResponseSchema,
    { method: 'PUT', body: { tags, expectedChildTagsVersion }, signal, headers: feedHeaders },
  )
}

/** A child's albums for the strip on the child's page (one page: a child has a handful). */
export function loadChildAlbums(transport: AuthenticatedTransport, familyId: string, childId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ childId, filter: 'all', limit: '50' })
  return transport.request(`/api/v1/families/${encodeURIComponent(familyId)}/albums?${query.toString()}`, albumPageSchema, { signal })
}

/** Creates a template album for one child from the invitation on the child's page. */
export function createChildAlbum(transport: AuthenticatedTransport, familyId: string, input: { kind: 'year' | 'workshop'; childId: string; title: string }, idempotencyKey: string) {
  return transport.request(`/api/v1/families/${encodeURIComponent(familyId)}/albums`, albumMutationSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { kind: input.kind, childId: input.childId, title: input.title, description: null },
  })
}

export function setMemoryLike(
  transport: AuthenticatedTransport,
  familyId: string,
  memoryId: string,
  liked: boolean,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}/like`,
    likeResponseSchema,
    { method: 'PUT', body: { liked } },
  )
}

export function setMemoryReaction(transport: AuthenticatedTransport, familyId: string, memoryId: string, reaction: MemoryReaction | null) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}/reaction`,
    reactionResponseSchema,
    { method: 'PUT', body: { reaction } },
  )
}

export async function deleteMemory(
  transport: AuthenticatedTransport,
  familyId: string,
  memoryId: string,
  version: number,
) {
  await transport.raw(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}`,
    { method: 'DELETE', headers: { 'If-Match': String(version) } },
  )
}

export function openTelegramVideo(transport: AuthenticatedTransport, familyId: string, memoryId: string) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}/telegram-video`,
    telegramVideoOpenResponseSchema,
    { method: 'POST' },
  )
}
