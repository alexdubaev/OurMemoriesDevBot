import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
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
  'INTERNAL_ERROR',
])

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
