import {
  createMemoryRequestSchema,
  memoryDtoSchema,
  updateMemoryRequestSchema,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

const photoMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const photoExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'])

export type PhotoFileValidation =
  | { ok: true }
  | { ok: false; code: 'unsupported_format' | 'too_many' }

export function validatePhotoFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!photoExtensions.has(extension)) return { ok: false as const, code: 'unsupported_format' as const }
  if (file.type && !photoMimeTypes.has(file.type.toLowerCase())) {
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

export function resolvePhotoContentType(file: File) {
  const declared = file.type.toLowerCase()
  if (photoMimeTypes.has(declared)) return declared as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif'
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'
  return null
}
