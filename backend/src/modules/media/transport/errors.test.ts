import { expect, test } from 'bun:test'

import { AppError } from '../../../http/errors'
import { MediaFailure } from '../domain/errors'
import { toMediaAppError } from './errors'

test('preserves safe codes for every finalize branch that rejects an uploaded photo', () => {
  const cases = [
    ['forbidden', 'PHOTO_FINALIZE_ACCESS_REVOKED'],
    ['upload_expired', 'PHOTO_FINALIZE_RESERVATION_EXPIRED'],
    ['upload_incomplete', 'PHOTO_FINALIZE_OBJECT_METADATA_MISMATCH'],
    ['unsupported_media', 'PHOTO_FINALIZE_MEDIA_VERIFICATION_FAILED'],
    ['invalid_file', 'PHOTO_FINALIZE_MEDIA_PROCESSING_FAILED'],
  ] as const

  for (const [kind, code] of cases) {
    const result = toMediaAppError(new MediaFailure(kind, 'Безопасное сообщение', code))
    expect(result).toBeInstanceOf(AppError)
    expect((result as AppError).code).toBe(code)
  }
})
