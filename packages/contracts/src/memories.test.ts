import { describe, expect, test } from 'bun:test'

import {
  createMemoryRequestSchema,
  listMemoriesQuerySchema,
  mediaDtoSchema,
  memoryDtoSchema,
  telegramVideoAttachmentSchema,
} from './memories'

const childId = '018f01d8-0c2a-7c25-bf83-ae68985c7e90'

describe('memory contracts', () => {
  test('accepts a note with up to 8,000 Unicode code points and preserves plain text', () => {
    const prefix = `<img src=x onerror=alert('xss')>`
    const body = `${prefix}${'💛'.repeat(8_000 - [...prefix].length)}`

    const parsed = createMemoryRequestSchema.parse({
      kind: 'note',
      childId,
      body,
      occurredAt: '2026-09-09T10:00:00.000Z',
    })

    expect(parsed.body).toBe(body)
    expect([...parsed.body]).toHaveLength(8_000)
  })

  test('rejects a note above the Unicode code point limit and undeclared media payloads', () => {
    expect(() => createMemoryRequestSchema.parse({
      kind: 'note',
      childId,
      body: '💛'.repeat(8_001),
      occurredAt: '2026-09-09T10:00:00.000Z',
    })).toThrow()
    expect(() => createMemoryRequestSchema.parse({
      kind: 'note',
      childId,
      body: 'Обычная заметка',
      occurredAt: '2026-09-09T10:00:00.000Z',
      media: { objectKey: 'private/key', telegramFileId: 'unsafe' },
    })).toThrow()
  })

  test('defaults feed limit to 20 and caps it at 50', () => {
    expect(listMemoriesQuerySchema.parse({})).toMatchObject({ limit: 20 })
    expect(() => listMemoriesQuerySchema.parse({ limit: '51' })).toThrow()
  })

  test('requires response attachments to remain typed DTOs rather than arbitrary JSON', () => {
    expect(() => memoryDtoSchema.parse({
      id: '018f01d8-0c2a-7c25-bf83-ae68985c7e90',
      familyId: '018f01d8-0c2a-7c25-bf83-ae68985c7e91',
      childId,
      author: { id: '018f01d8-0c2a-7c25-bf83-ae68985c7e92', name: 'Автор' },
      kind: 'photo',
      body: '',
      occurredAt: '2026-09-09T10:00:00.000Z',
      createdAt: '2026-09-09T10:00:00.000Z',
      version: 1,
      status: 'published',
      attachments: [{ objectKey: 'private/key' }],
      likes: { count: 0, likedByMe: false },
      capabilities: { edit: true, delete: true, like: true },
    })).toThrow()
  })

  test('accepts only backend API paths in media DTOs', () => {
    const mediaId = '018f01d8-0c2a-7c25-bf83-ae68985c7e94'
    const familyId = '018f01d8-0c2a-7c25-bf83-ae68985c7e91'
    const contentPath = `/api/v1/families/${familyId}/media/${mediaId}/content`
    const valid = {
      id: mediaId,
      source: 'private_storage' as const,
      kind: 'photo' as const,
      width: 1200,
      height: 800,
      durationMs: null,
      waveform: null,
      renditionStatus: 'ready' as const,
      previewPath: `${contentPath}?variant=preview`,
      displayPath: `${contentPath}?variant=display`,
      playbackPath: null,
      originalDownloadPath: `${contentPath}?variant=original`,
    }

    expect(mediaDtoSchema.parse(valid)).toEqual(valid)

    for (const unsafePath of [
      'https://storage.example/private/object?signature=secret',
      '//storage.example/private/object',
      '\\api\\v1\\private\\object',
      '/api/v1/families/../storage/private-object',
      '/api/v1/families/%2e%2e/storage/private-object',
      '/private/family/object-key',
      `${contentPath}?X-Amz-Credential=secret`,
      `${contentPath}?token=secret`,
      `${contentPath}#private-object`,
    ]) {
      expect(() => mediaDtoSchema.parse({ ...valid, originalDownloadPath: unsafePath })).toThrow()
    }
  })

  test('accepts only a normalized 48-peak measured waveform', () => {
    const mediaId = '018f01d8-0c2a-7c25-bf83-ae68985c7e94'
    const familyId = '018f01d8-0c2a-7c25-bf83-ae68985c7e91'
    const contentPath = `/api/v1/families/${familyId}/media/${mediaId}/content`
    const voice = {
      id: mediaId,
      source: 'private_storage' as const,
      kind: 'voice' as const,
      width: null,
      height: null,
      durationMs: 12_000,
      waveform: Array.from({ length: 48 }, (_, index) => (index + 1) / 48),
      renditionStatus: 'ready' as const,
      previewPath: null,
      displayPath: null,
      playbackPath: `${contentPath}?variant=playback`,
      originalDownloadPath: `${contentPath}?variant=original`,
    }

    expect(mediaDtoSchema.parse(voice)).toEqual(voice)
    expect(() => mediaDtoSchema.parse({ ...voice, waveform: voice.waveform.slice(1) })).toThrow()
    expect(() => mediaDtoSchema.parse({ ...voice, waveform: [...voice.waveform.slice(0, 47), 1.1] })).toThrow()
  })

  test('represents a Telegram-only video without a storage path or a Telegram file identifier', () => {
    const attachment = {
      id: '018f01d8-0c2a-7c25-bf83-ae68985c7e95',
      source: 'telegram',
      kind: 'video',
      width: 640,
      height: 360,
      durationMs: 24_000,
      thumbnailPath: null,
      openInTelegramPath: `/api/v1/families/018f01d8-0c2a-7c25-bf83-ae68985c7e91/memories/018f01d8-0c2a-7c25-bf83-ae68985c7e90/telegram-video`,
    } as const

    expect(telegramVideoAttachmentSchema.parse(attachment)).toEqual(attachment)
    expect(() => telegramVideoAttachmentSchema.parse({ ...attachment, fileId: 'private-file-id' })).toThrow()
    expect(() => telegramVideoAttachmentSchema.parse({ ...attachment, playbackPath: '/api/v1/families/018f01d8-0c2a-7c25-bf83-ae68985c7e91/media/018f01d8-0c2a-7c25-bf83-ae68985c7e95/content?variant=playback' })).toThrow()
  })
})
