import {
  likeResponseSchema,
  memoryPageSchema,
  telegramVideoOpenResponseSchema,
  type MemoryPage,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'
import type { FeedFilter } from './presentation'

export function loadFeed(
  transport: AuthenticatedTransport,
  familyId: string,
  filter: FeedFilter,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<MemoryPage> {
  const query = new URLSearchParams({ limit: '20' })
  if (filter !== 'all') query.set('kind', filter)
  if (cursor) query.set('cursor', cursor)
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories?${query.toString()}`,
    memoryPageSchema,
    { signal },
  )
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
