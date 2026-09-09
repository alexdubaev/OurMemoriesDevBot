import { describe, expect, test } from 'bun:test'

import {
  finalizeMediaUploadResponseSchema,
  mediaContentQuerySchema,
  reserveMediaUploadRequestSchema,
  reserveMediaUploadResponseSchema,
} from './media'

const uuid = '01991fe1-4bc9-7a4a-a8b6-3bb8ce1ab6ef'

describe('private media contracts', () => {
  test('accepts documented memory originals and enforces their per-kind size limits', () => {
    expect(reserveMediaUploadRequestSchema.parse({
      purpose: 'memory', kind: 'photo', contentType: 'image/webp', byteSize: 20_000_000,
    }).kind).toBe('photo')
    expect(reserveMediaUploadRequestSchema.parse({
      purpose: 'memory', kind: 'video', contentType: 'video/mp4', byteSize: 100_000_000,
    }).kind).toBe('video')
    expect(reserveMediaUploadRequestSchema.parse({
      purpose: 'memory', kind: 'voice', contentType: 'audio/ogg', byteSize: 20_000_000,
    }).kind).toBe('voice')

    expect(reserveMediaUploadRequestSchema.safeParse({
      purpose: 'memory', kind: 'photo', contentType: 'image/jpeg', byteSize: 20_000_001,
    }).success).toBe(false)
    expect(reserveMediaUploadRequestSchema.safeParse({
      purpose: 'memory', kind: 'video', contentType: 'text/html', byteSize: 100,
    }).success).toBe(false)
  })

  test('reserves child avatars through the same lifecycle but only as photos', () => {
    expect(reserveMediaUploadRequestSchema.safeParse({
      purpose: 'child_avatar', kind: 'photo', contentType: 'image/heic', byteSize: 1_024,
    }).success).toBe(true)
    expect(reserveMediaUploadRequestSchema.safeParse({
      purpose: 'child_avatar', kind: 'video', contentType: 'video/mp4', byteSize: 1_024,
    }).success).toBe(false)
  })

  test('returns an opaque asset id and short-lived upload ticket without storage keys', () => {
    const parsed = reserveMediaUploadResponseSchema.parse({
      assetId: uuid,
      upload: {
        uploadId: uuid,
        method: 'PUT',
        url: 'https://storage.example/upload',
        headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
        contentLength: 1_024,
        expiresAt: '2026-09-10T00:05:00.000Z',
      },
      reservationExpiresAt: '2026-09-10T00:15:00.000Z',
    })

    expect(parsed.assetId).toBe(uuid)
    expect('objectKey' in parsed).toBe(false)
  })

  test('finalize exposes only authenticated backend paths and split lifecycle status', () => {
    expect(finalizeMediaUploadResponseSchema.parse({
      asset: {
        id: uuid,
        purpose: 'memory',
        kind: 'photo',
        originalStatus: 'stored',
        renditionStatus: 'ready',
        width: 1,
        height: 1,
        durationMs: null,
        previewPath: `/api/v1/families/${uuid}/media/${uuid}/content?variant=preview`,
        displayPath: `/api/v1/families/${uuid}/media/${uuid}/content?variant=display`,
        playbackPath: null,
        originalDownloadPath: `/api/v1/families/${uuid}/media/${uuid}/content?variant=original`,
      },
    }).asset.originalStatus).toBe('stored')
  })

  test('content query allows one known variant only', () => {
    expect(mediaContentQuerySchema.parse({}).variant).toBe('display')
    expect(mediaContentQuerySchema.safeParse({ variant: 'original' }).success).toBe(true)
    expect(mediaContentQuerySchema.safeParse({ variant: 'raw' }).success).toBe(false)
  })
})
