import { describe, expect, test } from 'bun:test'

import {
  createMemoryRequestSchema,
  listMemoriesQuerySchema,
  memoryDtoSchema,
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
})
