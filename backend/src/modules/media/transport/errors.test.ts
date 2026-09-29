import { expect, test } from 'bun:test'

import { AppError } from '../../../http/errors'
import { MediaFailure } from '../domain/errors'
import { toMediaAppError } from './errors'

test('preserves safe codes for every finalize branch that rejects an uploaded photo', () => {
  const cases = [
    ['forbidden', 'PHOTO_FINALIZE_ACCESS_REVOKED'],
    ['upload_expired', 'PHOTO_FINALIZE_RESERVATION_EXPIRED'],
    ['upload_incomplete', 'PHOTO_FINALIZE_OBJECT_METADATA_MISMATCH'],
    ['upload_incomplete', 'PHOTO_FINALIZE_OBJECT_MISSING'],
    ['unsupported_media', 'PHOTO_FINALIZE_MEDIA_VERIFICATION_FAILED'],
    ['invalid_file', 'PHOTO_FINALIZE_MEDIA_PROCESSING_FAILED'],
  ] as const

  for (const [kind, code] of cases) {
    const result = toMediaAppError(new MediaFailure(kind, 'Безопасное сообщение', code))
    expect(result).toBeInstanceOf(AppError)
    expect((result as AppError).code).toBe(code)
  }
})

test('MAX processing and terminal playback have distinct HTTP codes', () => {
  const processing = toMediaAppError(new MediaFailure('video_processing', 'processing')) as AppError
  const unknown = toMediaAppError(new MediaFailure('video_readiness_unknown', 'unknown')) as AppError
  const terminal = toMediaAppError(new MediaFailure('video_unavailable', 'unavailable')) as AppError
  expect([processing.status, processing.code]).toEqual([409, 'MAX_VIDEO_PROCESSING'])
  expect([unknown.status, unknown.code]).toEqual([503, 'MAX_VIDEO_READINESS_UNKNOWN'])
  expect([terminal.status, terminal.code]).toEqual([415, 'MAX_VIDEO_UNAVAILABLE'])
})
