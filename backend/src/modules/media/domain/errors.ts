export type MediaFailureKind =
  | 'invalid_file'
  | 'unsupported_media'
  | 'range_not_satisfiable'
  | 'not_found'
  | 'forbidden'
  | 'quota_exceeded'
  | 'too_many_pending'
  | 'upload_incomplete'
  | 'upload_expired'
  | 'storage_unavailable'
  | 'idempotency_conflict'

export class MediaFailure extends Error {
  constructor(readonly kind: MediaFailureKind, message: string, readonly details?: { total?: number }) {
    super(message)
    this.name = 'MediaFailure'
  }
}
