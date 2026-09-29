export type MediaFailureKind =
  | 'invalid_file'
  | 'unsupported_media'
  | 'video_processing'
  | 'video_readiness_unknown'
  | 'video_unavailable'
  | 'range_not_satisfiable'
  | 'not_found'
  | 'forbidden'
  | 'quota_exceeded'
  | 'too_many_pending'
  | 'upload_incomplete'
  | 'upload_expired'
  | 'storage_unavailable'
  | 'idempotency_conflict'

export type MediaFailureCode =
  | 'PHOTO_FINALIZE_ACCESS_REVOKED'
  | 'PHOTO_FINALIZE_RESERVATION_EXPIRED'
  | 'PHOTO_FINALIZE_OBJECT_MISSING'
  | 'PHOTO_FINALIZE_OBJECT_METADATA_MISMATCH'
  | 'PHOTO_FINALIZE_MEDIA_VERIFICATION_FAILED'
  | 'PHOTO_FINALIZE_MEDIA_PROCESSING_FAILED'

export class MediaFailure extends Error {
  constructor(
    readonly kind: MediaFailureKind,
    message: string,
    readonly code?: MediaFailureCode,
    readonly details?: { total?: number },
  ) {
    super(message)
    this.name = 'MediaFailure'
  }
}
