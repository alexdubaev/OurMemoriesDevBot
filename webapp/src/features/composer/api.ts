import {
  createMemoryRequestSchema,
  memoryDtoSchema,
  updateMemoryRequestSchema,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

const photoMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const photoMimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
}

export type PhotoFileValidation =
  | { ok: true }
  | { ok: false; code: 'unsupported_format' | 'too_many' }

export type ComposerFileKind = 'photo' | 'video'

const videoMimeTypes = new Set(['video/mp4', 'video/quicktime'])

export function validatePhotoFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const expectedMime = photoMimeByExtension[extension]
  if (!expectedMime) return { ok: false as const, code: 'unsupported_format' as const }
  const declared = file.type.toLowerCase()
  const heicAlias = (extension === 'heic' || extension === 'heif') && (declared === 'image/heic' || declared === 'image/heif')
  if (declared && declared !== expectedMime && !heicAlias) {
    return { ok: false as const, code: 'unsupported_format' as const }
  }
  return { ok: true as const }
}

export function validatePhotoFiles(files: readonly File[]): PhotoFileValidation {
  if (files.length < 1 || files.length > 10) return { ok: false, code: 'too_many' }
  for (const file of files) {
    const result = validatePhotoFile(file)
    if (!result.ok) return result
  }
  return { ok: true }
}

export function resolveComposerFile(file: File): { kind: ComposerFileKind; contentType: string } | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const photoMime = photoMimeByExtension[extension]
  const declared = file.type.toLowerCase()
  const heicAlias = (extension === 'heic' || extension === 'heif') && (declared === 'image/heic' || declared === 'image/heif')
  if (photoMime && (!declared || declared === photoMime || heicAlias)) return { kind: 'photo', contentType: declared || photoMime }
  const videoType = extension === 'mov' ? 'video/quicktime' : extension === 'mp4' ? 'video/mp4' : null
  if (!videoType || !videoMimeTypes.has(videoType) || (file.type && file.type.toLowerCase() !== videoType)) return null
  if (file.size < 64 || file.size > 100_000_000) return null
  return { kind: 'video', contentType: videoType }
}

export function validateComposerFiles(files: readonly File[]) {
  if (files.length < 1 || files.length > 10) return { ok: false as const, code: 'too_many' as const }
  for (const file of files) if (!resolveComposerFile(file)) return { ok: false as const, code: 'unsupported_format' as const }
  return { ok: true as const }
}

export function createPhotoIdempotencyKey() {
  return createIdempotencyKey()
}

export function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createNoteMemory(
  transport: AuthenticatedTransport,
  familyId: string,
  input: { childId: string; body: string; occurredAt: string; idempotencyKey: string },
  signal?: AbortSignal,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories`,
    memoryDtoSchema,
    {
      method: 'POST',
      signal,
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: createMemoryRequestSchema.parse({
        kind: 'note',
        childId: input.childId,
        body: input.body,
        occurredAt: input.occurredAt,
      }),
    },
  )
}

export function updateMemory(
  transport: AuthenticatedTransport,
  familyId: string,
  memoryId: string,
  input: { body: string; occurredAt: string; expectedVersion: number },
  signal?: AbortSignal,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}`,
    memoryDtoSchema,
    {
      method: 'PATCH',
      signal,
      body: updateMemoryRequestSchema.parse(input),
    },
  )
}

export function getMemory(
  transport: AuthenticatedTransport,
  familyId: string,
  memoryId: string,
  signal?: AbortSignal,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories/${encodeURIComponent(memoryId)}`,
    memoryDtoSchema,
    { signal },
  )
}

export function createPhotoMemory(
  transport: AuthenticatedTransport,
  familyId: string,
  input: { childId: string; body: string; occurredAt: string; mediaIds: string[]; idempotencyKey: string },
  signal?: AbortSignal,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories`,
    memoryDtoSchema,
    {
      method: 'POST',
      signal,
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: createMemoryRequestSchema.parse({
        kind: 'photo',
        childId: input.childId,
        body: input.body,
        occurredAt: input.occurredAt,
        mediaIds: input.mediaIds,
      }),
    },
  )
}

export function createMediaMemory(
  transport: AuthenticatedTransport,
  familyId: string,
  input: { kind: 'photo' | 'video' | 'media'; childId: string; body: string; occurredAt: string; mediaIds: string[]; idempotencyKey: string },
  signal?: AbortSignal,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/memories`,
    memoryDtoSchema,
    {
      method: 'POST',
      signal,
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: createMemoryRequestSchema.parse({
        kind: input.kind,
        childId: input.childId,
        body: input.body,
        occurredAt: input.occurredAt,
        mediaIds: input.mediaIds,
      }),
    },
  )
}

export function resolvePhotoContentType(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase()
  const expectedMime = extension ? photoMimeByExtension[extension] : undefined
  if (!expectedMime || !photoMimeTypes.has(expectedMime)) return null
  const declared = file.type.toLowerCase()
  return declared && declared !== expectedMime ? null : expectedMime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif'
}
