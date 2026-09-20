import { z } from 'zod'

import type { AuthenticatedTransport } from '@/platform/api'

export const MAX_VIDEO_BYTES = 250 * 1024 * 1024
const acceptedExtensions = new Set(['mp4', 'mov', 'mkv', 'webm'])
const acceptedMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm'])

const reserveResponseSchema = z.object({
  state: z.enum(['reserved', 'existing']),
  sessionId: z.string(),
  expiresAt: z.string(),
  uploadUrl: z.string().url().optional(),
  uploadToken: z.string().optional(),
}).strict()

const finalizeResponseSchema = z.object({
  state: z.enum(['finalized', 'processing', 'expired', 'failed']),
  sessionId: z.string(),
  memoryId: z.string().optional(),
  memory: z.unknown().optional(),
  retryable: z.boolean().optional(),
  code: z.string().optional(),
}).strict()

export type VideoFileValidation =
  | { ok: true }
  | { ok: false; code: 'unsupported_format' | 'too_large' }

export function validateVideoFile(file: File): VideoFileValidation {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!acceptedExtensions.has(extension)) return { ok: false, code: 'unsupported_format' }
  if (file.size > MAX_VIDEO_BYTES) return { ok: false, code: 'too_large' }
  if (file.type && !acceptedMimeTypes.has(file.type)) return { ok: false, code: 'unsupported_format' }
  return { ok: true }
}

export function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export type MaxVideoReservation = z.infer<typeof reserveResponseSchema>
export type MaxVideoFinalize = z.infer<typeof finalizeResponseSchema>

export function reserveMaxVideo(
  transport: AuthenticatedTransport,
  familyId: string,
  input: { childId: string; body: string; occurredAt: string; file: File; idempotencyKey?: string },
  signal?: AbortSignal,
) {
  const extension = input.file.name.split('.').pop()?.toLowerCase() ?? ''
  const mimeType = input.file.type || mimeTypeForExtension(extension)
  return transport.request(`/api/v1/families/${encodeURIComponent(familyId)}/max-video-uploads/reserve`, reserveResponseSchema, {
    method: 'POST',
    signal,
    body: {
      childId: input.childId,
      body: input.body.trim(),
      occurredAt: input.occurredAt,
      fileName: input.file.name,
      fileSize: input.file.size,
      mimeType,
      idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
    },
  })
}

export function finalizeMaxVideo(
  transport: AuthenticatedTransport,
  familyId: string,
  sessionId: string,
  uploadToken: string,
  signal?: AbortSignal,
) {
  return transport.request(`/api/v1/families/${encodeURIComponent(familyId)}/max-video-uploads/${encodeURIComponent(sessionId)}/finalize`, finalizeResponseSchema, {
    method: 'POST',
    signal,
    body: { uploadToken },
  })
}

function mimeTypeForExtension(extension: string) {
  if (extension === 'mov') return 'video/quicktime'
  if (extension === 'mkv') return 'video/x-matroska'
  if (extension === 'webm') return 'video/webm'
  return 'video/mp4'
}
