import {
  createMemoryRequestSchema,
  memoryDtoSchema,
  reserveMediaUploadRequestSchema,
  updateMemoryRequestSchema,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

const photoMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const photoMimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
}

export type PhotoFileValidation =
  | { ok: true }
  | { ok: false; code: 'unsupported_format' | 'too_many' | 'too_small' | 'too_large_photo' | 'too_large_video' }

export type ComposerFileKind = 'photo' | 'video'
export type ComposerMedia = { kind: ComposerFileKind; contentType: string }

const videoMimeTypes = new Set(['video/mp4', 'video/quicktime'])

export function validatePhotoFile(file: File) {
  const resolved = resolveComposerFile(file)
  if (!resolved || resolved.kind !== 'photo') return { ok: false as const, code: 'unsupported_format' as const }
  return validateSize(file, resolved)
}

export function validatePhotoFiles(files: readonly File[]): PhotoFileValidation {
  if (files.length < 1 || files.length > 10) return { ok: false, code: 'too_many' }
  for (const file of files) {
    const result = validatePhotoFile(file)
    if (!result.ok) return result
  }
  return { ok: true }
}

export function resolveComposerFile(file: File): ComposerMedia | null {
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : ''
  const photoMime = photoMimeByExtension[extension]
  const declared = file.type.toLowerCase()
  const generic = !declared || declared === 'application/octet-stream'
  if (!extension) {
    if (photoMimeTypes.has(declared)) return { kind: 'photo', contentType: declared }
    if (videoMimeTypes.has(declared)) return { kind: 'video', contentType: declared }
  }
  const heicAlias = (extension === 'heic' || extension === 'heif') && (declared === 'image/heic' || declared === 'image/heif' || declared === 'image/heic-sequence' || declared === 'image/heif-sequence')
  const transcodedJpeg = (extension === 'heic' || extension === 'heif') && declared === 'image/jpeg'
  if (photoMime && (generic || declared === photoMime || heicAlias || transcodedJpeg)) return { kind: 'photo', contentType: generic || declared.endsWith('-sequence') ? photoMime : declared }
  const videoType = extension === 'mov' ? 'video/quicktime' : extension === 'mp4' ? 'video/mp4' : null
  const quicktimeAlias = extension === 'mov' && ['video/x-quicktime', 'video/mov', 'video/x-mov'].includes(declared)
  if (!videoType || !(generic || videoMimeTypes.has(declared) || quicktimeAlias)) return null
  return { kind: 'video', contentType: generic || quicktimeAlias ? videoType : declared }
}

export function validateComposerFiles(files: readonly File[]) {
  if (files.length < 1 || files.length > 10) return { ok: false as const, code: 'too_many' as const }
  for (const file of files) {
    const media = resolveComposerFile(file)
    if (!media && !(!file.name.includes('.') && (!file.type || file.type.toLowerCase() === 'application/octet-stream'))) return { ok: false as const, code: 'unsupported_format' as const }
    if (!media) {
      const provisional = validateSize(file, { kind: 'video', contentType: 'video/mp4' })
      if (!provisional.ok) return provisional
      continue
    }
    const size = validateSize(file, media)
    if (!size.ok) return size
  }
  return { ok: true as const }
}

export function validateSize(file: File, media: ComposerMedia) {
  const kind = media.kind
  const result = reserveMediaUploadRequestSchema.safeParse({ purpose: 'memory', kind, contentType: media.contentType, byteSize: file.size })
  if (!result.success) {
    if (result.error.issues.some((issue) => issue.code === 'too_small')) return { ok: false as const, code: 'too_small' as const }
    if (result.error.issues.some((issue) => issue.code === 'too_big')) return { ok: false as const, code: kind === 'photo' ? 'too_large_photo' as const : 'too_large_video' as const }
    return { ok: false as const, code: 'unsupported_format' as const }
  }
  return { ok: true as const }
}

/** Resolve ambiguous iOS picker metadata against the same signatures accepted by finalize. */
export async function verifyComposerFile(file: File) {
  const media = resolveComposerFile(file)
  if (!media && (file.name.includes('.') || (file.type && file.type.toLowerCase() !== 'application/octet-stream'))) return null
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  let actual: string | null = null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) actual = 'image/jpeg'
  else if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') actual = 'image/png'
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') actual = 'image/webp'
  else if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    actual = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis']).has(brand)
      ? 'image/heic' : brand === 'qt  ' ? 'video/quicktime' : 'video/mp4'
  }
  if (!actual || (media && !((media.kind === 'photo' && actual.startsWith('image/')) || (media.kind === 'video' && actual.startsWith('video/'))))) return null
  const generic = !file.type || file.type.toLowerCase() === 'application/octet-stream' || file.type.toLowerCase().endsWith('-sequence') || ['video/x-quicktime', 'video/mov', 'video/x-mov'].includes(file.type.toLowerCase())
  if (media && !generic && !(media.kind === 'photo' && /\.hei[cf]$/i.test(file.name) && file.type.toLowerCase() === 'image/jpeg')) {
    if (actual !== media.contentType && !(actual === 'image/heic' && media.contentType === 'image/heif')) return null
  }
  return { kind: actual.startsWith('image/') ? 'photo' as const : 'video' as const, contentType: actual }
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
