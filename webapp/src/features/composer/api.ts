import {
  createMemoryRequestSchema,
  finalizeMediaUploadResponseSchema,
  reserveMediaUploadRequestSchema,
  reserveMediaUploadResponseSchema,
  memoryDtoSchema,
  updateMemoryRequestSchema,
  type MediaAssetDto,
  type ReserveMediaUploadResponse,
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

export function reservePhotoUpload(
  transport: AuthenticatedTransport,
  familyId: string,
  file: File,
  signal?: AbortSignal,
  idempotencyKey?: string,
) {
  const contentType = resolvePhotoContentType(file)
  if (!contentType) throw new Error('Поддерживаются JPG, PNG, WebP и HEIC.')
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/uploads`,
    reserveMediaUploadResponseSchema,
    {
      method: 'POST',
      signal,
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: reserveMediaUploadRequestSchema.parse({
        purpose: 'memory',
        kind: 'photo',
        contentType,
        byteSize: file.size,
      }),
    },
  )
}

/** Stable per-asset derivative of the one logical memory-create key. */
export function createPhotoUploadIdempotencyKey(logicalKey: string, index: number) {
  const normalized = logicalKey.toLowerCase().replaceAll('-', '')
  if (!/^[0-9a-f]{32}$/.test(normalized) || !Number.isInteger(index) || index < 0 || index > 0xffffffffff) {
    throw new Error('Invalid photo upload idempotency key')
  }
  return `${normalized.slice(0, 20)}-${normalized.slice(20, 24)}-${normalized.slice(24, 28)}-${normalized.slice(28, 32)}-${index.toString(16).padStart(12, '0')}`
}

export async function uploadPhotoObject(
  reservation: ReserveMediaUploadResponse,
  file: File,
  signal?: AbortSignal,
) {
  const response = await fetch(reservation.upload.url, {
    method: reservation.upload.method,
    headers: reservation.upload.headers,
    body: file,
    credentials: 'omit',
    mode: 'cors',
    signal,
  })
  if (!response.ok && response.status !== 412) throw new Error('Не удалось загрузить фотографию.')
}

export function finalizePhotoUpload(
  transport: AuthenticatedTransport,
  familyId: string,
  uploadId: string,
  signal?: AbortSignal,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/uploads/${encodeURIComponent(uploadId)}/finalize`,
    finalizeMediaUploadResponseSchema,
    { method: 'POST', signal },
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

export type FinalizedPhoto = Pick<MediaAssetDto, 'id'>
