import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_INPUT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'AUTH_PASSWORD_RESET_INVALID',
  'SESSION_REQUIRED',
  'ROLE_FORBIDDEN',
  'ALREADY_IN_FAMILY',
  'INVITE_USED',
  'INVITE_EXPIRED',
  'INVITE_REVOKED',
  // Upload failures a client can actually recover from, kept apart from generic CONFLICT so the
  // UI can say what to do: retry the transfer, pick a different file, or start over.
  'UPLOAD_NOT_COMPLETED',
  'UPLOAD_REJECTED',
  'UPLOAD_EXPIRED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'MAX_VIDEO_PROCESSING',
  'MAX_VIDEO_READINESS_UNKNOWN',
  'MAX_VIDEO_UNAVAILABLE',
  'INVALID_FILE',
  'STORAGE_UNAVAILABLE',
  'MAX_VIDEO_MEMBERSHIP_NOT_FOUND',
  'MAX_VIDEO_CHILD_NOT_FOUND',
  'PHOTO_FINALIZE_ACCESS_REVOKED',
  'PHOTO_FINALIZE_RESERVATION_EXPIRED',
  'PHOTO_FINALIZE_OBJECT_MISSING',
  'PHOTO_FINALIZE_OBJECT_METADATA_MISMATCH',
  'PHOTO_FINALIZE_MEDIA_VERIFICATION_FAILED',
  'PHOTO_FINALIZE_MEDIA_PROCESSING_FAILED',
  'INTERNAL_ERROR',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.uuid(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
  }).strict(),
}).strict()

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
