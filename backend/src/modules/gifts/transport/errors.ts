import { AppError } from '../../../http/errors'
import { GiftFailure } from '../domain/errors'

export function toGiftAppError(error: unknown) {
  if (error instanceof GiftFailure) {
    switch (error.kind) {
      case 'not_found': return new AppError(404, 'NOT_FOUND', error.message)
      case 'forbidden': return new AppError(403, 'ROLE_FORBIDDEN', error.message)
      case 'conflict': return new AppError(409, 'CONFLICT', error.message)
      case 'version_conflict': return new AppError(409, 'VERSION_CONFLICT', error.message)
      case 'idempotency_conflict': return new AppError(409, 'IDEMPOTENCY_CONFLICT', error.message)
      case 'invalid_input': return new AppError(422, 'INVALID_INPUT', error.message)
    }
  }
  if (isFamilyAccessFailure(error)) {
    return error.kind === 'forbidden'
      ? new AppError(403, 'ROLE_FORBIDDEN', error.message)
      : new AppError(404, 'NOT_FOUND', error.message)
  }
  return error
}

export async function executeGift<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toGiftAppError(error)
  }
}

/** `FamilyFailure` from `FamilyAccess`, matched by shape so this module does not import its internals. */
function isFamilyAccessFailure(error: unknown): error is { kind: 'forbidden' | 'not_found'; message: string } {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { kind?: unknown; message?: unknown }
  return (candidate.kind === 'forbidden' || candidate.kind === 'not_found') && typeof candidate.message === 'string'
}
