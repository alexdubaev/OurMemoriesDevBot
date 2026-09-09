export type MemoryFailureKind =
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'invalid_input'
  | 'media_unavailable'

export class MemoryFailure extends Error {
  constructor(public readonly kind: MemoryFailureKind, message: string) {
    super(message)
    this.name = 'MemoryFailure'
  }
}
