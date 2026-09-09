import { AppError } from '../../../http/errors'
import { MemoryCursorError } from '../domain/memory-cursor'
import { MemoryFailure } from '../domain/errors'

export function toMemoryAppError(error: unknown) {
  if (error instanceof MemoryCursorError) return new AppError(422, 'INVALID_INPUT', error.message)
  if (error instanceof MemoryFailure) {
    switch (error.kind) {
      case 'not_found': return new AppError(404, 'NOT_FOUND', error.message)
      case 'conflict': return new AppError(409, 'CONFLICT', error.message)
      case 'idempotency_conflict': return new AppError(409, 'IDEMPOTENCY_CONFLICT', error.message)
      case 'invalid_input': return new AppError(422, 'INVALID_INPUT', error.message)
      case 'media_unavailable': return new AppError(409, 'CONFLICT', error.message)
    }
  }
  if (isFamilyAccessFailure(error)) {
    return error.kind === 'forbidden'
      ? new AppError(403, 'ROLE_FORBIDDEN', error.message)
      : new AppError(404, 'NOT_FOUND', error.message)
  }
  return error
}

export async function executeMemory<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    throw toMemoryAppError(error)
  }
}

function isFamilyAccessFailure(error: unknown): error is { kind: 'forbidden' | 'not_found'; message: string } {
  return typeof error === 'object' && error !== null &&
    'kind' in error && ((error as { kind?: unknown }).kind === 'forbidden' ||
      (error as { kind?: unknown }).kind === 'not_found') &&
    'message' in error && typeof (error as { message?: unknown }).message === 'string'
}
