import { AppError } from '../../../http/errors'
import { FamilyFailure } from '../domain/errors'

export function toFamilyAppError(error: unknown) {
  if (!(error instanceof FamilyFailure)) return error
  switch (error.kind) {
    case 'not_found':
      return new AppError(404, 'NOT_FOUND', error.message)
    case 'forbidden':
      return new AppError(403, 'ROLE_FORBIDDEN', error.message)
    case 'already_in_family':
      return new AppError(409, 'ALREADY_IN_FAMILY', error.message)
    case 'invite_used':
      return new AppError(409, 'INVITE_USED', error.message)
    case 'invite_expired':
      return new AppError(410, 'INVITE_EXPIRED', error.message)
    case 'invite_revoked':
      return new AppError(410, 'INVITE_REVOKED', error.message)
    case 'conflict':
      return new AppError(409, 'CONFLICT', error.message)
    case 'version_conflict':
      return new AppError(409, 'VERSION_CONFLICT', error.message)
    case 'idempotency_conflict':
      return new AppError(409, 'IDEMPOTENCY_CONFLICT', error.message)
  }
}

export async function executeFamily<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    throw toFamilyAppError(error)
  }
}
