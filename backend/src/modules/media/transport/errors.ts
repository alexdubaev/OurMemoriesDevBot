import { AppError } from '../../../http/errors'
import { MediaFailure } from '../domain/errors'

export function toMediaAppError(error: unknown) {
  if (error instanceof MediaFailure) {
    switch (error.kind) {
      case 'not_found': return new AppError(404, 'NOT_FOUND', error.message)
      case 'forbidden': return new AppError(403, error.code ?? 'ROLE_FORBIDDEN', error.message)
      case 'quota_exceeded': case 'too_many_pending': return new AppError(413, 'FILE_TOO_LARGE', error.message)
      case 'upload_incomplete': return new AppError(409, error.code ?? 'UPLOAD_NOT_COMPLETED', error.message)
      case 'upload_expired': return new AppError(410, error.code ?? 'UPLOAD_EXPIRED', error.message)
      case 'unsupported_media': return new AppError(415, error.code ?? 'UNSUPPORTED_MEDIA', error.message)
      case 'video_processing': return new AppError(409, 'MAX_VIDEO_PROCESSING', error.message)
      case 'video_readiness_unknown': return new AppError(503, 'MAX_VIDEO_READINESS_UNKNOWN', error.message)
      case 'video_unavailable': return new AppError(415, 'MAX_VIDEO_UNAVAILABLE', error.message)
      case 'invalid_file': return new AppError(422, error.code ?? 'INVALID_FILE', error.message)
      case 'storage_unavailable': return new AppError(503, 'STORAGE_UNAVAILABLE', error.message)
      case 'idempotency_conflict': return new AppError(409, 'IDEMPOTENCY_CONFLICT', error.message)
      case 'range_not_satisfiable': return new AppError(416, 'BAD_REQUEST', error.message, error.details)
    }
  }
  if (typeof error === 'object' && error && 'kind' in error) {
    const kind = (error as { kind?: unknown }).kind
    if (kind === 'forbidden') return new AppError(403, 'ROLE_FORBIDDEN', 'Недостаточно прав')
    if (kind === 'not_found') return new AppError(404, 'NOT_FOUND', 'Семья не найдена')
  }
  return error
}

export async function executeMedia<T>(operation: () => Promise<T>) {
  try { return await operation() } catch (error) { throw toMediaAppError(error) }
}
