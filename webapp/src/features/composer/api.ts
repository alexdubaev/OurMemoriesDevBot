import {
  MAX_DIRECT_VIDEO_MAX_BYTES,
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

const videoMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'])
const videoMimeByExtension: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm' }

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
  const videoType = videoMimeByExtension[extension] ?? null
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
  if (kind === 'video') {
    if (file.size < 64) return { ok: false as const, code: 'too_small' as const }
    return file.size > MAX_DIRECT_VIDEO_MAX_BYTES
      ? { ok: false as const, code: 'too_large_video' as const }
      : { ok: true as const }
  }
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
  const bytes = new Uint8Array(await file.slice(0, 4_096).arrayBuffer())
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  let actual: string | null = null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) actual = 'image/jpeg'
  else if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') actual = 'image/png'
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') actual = 'image/webp'
  else if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12)
    actual = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis']).has(brand)
      ? 'image/heic' : brand === 'qt  ' ? 'video/quicktime'
        : new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', '3gp4']).has(brand) ? 'video/mp4' : null
  }
  else if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) actual = ebmlVideoMime(bytes)
  if (!actual || (media && !((media.kind === 'photo' && actual.startsWith('image/')) || (media.kind === 'video' && actual.startsWith('video/'))))) return null
  const generic = !file.type || file.type.toLowerCase() === 'application/octet-stream' || file.type.toLowerCase().endsWith('-sequence') || ['video/x-quicktime', 'video/mov', 'video/x-mov'].includes(file.type.toLowerCase())
  if (media && media.kind === 'video') return { kind: 'video' as const, contentType: actual }
  if (media && !generic && !(media.kind === 'photo' && /\.hei[cf]$/i.test(file.name) && file.type.toLowerCase() === 'image/jpeg')) {
    if (actual !== media.contentType && !(actual === 'image/heic' && media.contentType === 'image/heif')) return null
  }
  return { kind: actual.startsWith('image/') ? 'photo' as const : 'video' as const, contentType: actual }
}

function ebmlVideoMime(bytes: Uint8Array): string | null {
  const vint = (offset: number, keepMarker: boolean): { value: number; length: number } | null => {
    const first = bytes[offset]
    if (!first) return null
    let length = 1
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1
    if (length > 8 || offset + length > bytes.length) return null
    let value = keepMarker ? first : first & ((1 << (8 - length)) - 1)
    for (let index = 1; index < length; index += 1) value = value * 256 + bytes[offset + index]!
    return Number.isSafeInteger(value) ? { value, length } : null
  }
  const headerSize = vint(4, false)
  if (!headerSize || 4 + headerSize.length + headerSize.value > bytes.length) return null
  const end = 4 + headerSize.length + headerSize.value
  let cursor = 4 + headerSize.length
  while (cursor < end) {
    const id = vint(cursor, true)
    if (!id) return null
    cursor += id.length
    const size = vint(cursor, false)
    if (!size || cursor + size.length + size.value > end) return null
    cursor += size.length
    if (id.value === 0x4282) {
      const docType = new TextDecoder().decode(bytes.slice(cursor, cursor + size.value))
      return docType === 'webm' ? 'video/webm' : docType === 'matroska' ? 'video/x-matroska' : null
    }
    cursor += size.value
  }
  return null
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
  input: { kind: 'photo' | 'video' | 'media'; childId: string; body: string; occurredAt: string; mediaIds?: string[]; attachments?: Array<{ source: 'private_storage'; mediaId: string } | { source: 'max'; sessionId: string }>; idempotencyKey: string },
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
        ...(input.attachments ? { attachments: input.attachments } : { mediaIds: input.mediaIds }),
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
