import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  commentDtoSchema,
  createCommentRequestSchema,
  listCommentsQuerySchema,
  commentSummariesRequestSchema,
  updateCommentRequestSchema,
  commentsParamsSchema,
  commentParamsSchema,
  commentSummariesParamsSchema,
} from './comments'

describe('comment contracts', () => {
  test('canonicalizes comment UUID inputs before duplicate detection', () => {
    const familyId = randomUUID(),
      memoryId = randomUUID(),
      commentId = randomUUID()
    expect(
      commentsParamsSchema.parse({
        familyId: familyId.toUpperCase(),
        memoryId: memoryId.toUpperCase(),
      }),
    ).toEqual({ familyId, memoryId })
    expect(
      commentParamsSchema.parse({
        familyId: familyId.toUpperCase(),
        memoryId: memoryId.toUpperCase(),
        commentId: commentId.toUpperCase(),
      }),
    ).toEqual({ familyId, memoryId, commentId })
    expect(
      commentSummariesParamsSchema.parse({ familyId: familyId.toUpperCase() }),
    ).toEqual({ familyId })
    expect(
      commentSummariesRequestSchema.parse({
        memoryIds: [memoryId.toUpperCase()],
      }).memoryIds,
    ).toEqual([memoryId])
    expect(
      commentSummariesRequestSchema.safeParse({
        memoryIds: [memoryId, memoryId.toUpperCase()],
      }).success,
    ).toBe(false)
  })
  test('normalizes once and counts Unicode code points at the text boundaries', () => {
    for (const body of ['', ' \r\n ', 'x'.repeat(2001), 'a\0b'])
      expect(createCommentRequestSchema.safeParse({ body }).success).toBe(false)
    for (const body of ['x', '😀'.repeat(2000)])
      expect(createCommentRequestSchema.parse({ body }).body).toBe(body)
    expect(
      createCommentRequestSchema.parse({ body: '  a\r\nb \n ' }).body,
    ).toBe('a\nb')
    expect(
      updateCommentRequestSchema.parse({ body: ' 😀 ', expectedVersion: 1 })
        .body,
    ).toBe('😀')
  })
  test('rejects forged metadata and bounds page and batch inputs', () => {
    for (const field of ['authorId', 'createdAt', 'role'])
      expect(
        createCommentRequestSchema.safeParse({ body: 'a', [field]: 'forged' })
          .success,
      ).toBe(false)
    expect(listCommentsQuerySchema.parse({}).limit).toBe(20)
    for (const query of [
      { limit: 0 },
      { limit: 51 },
      { cursor: 'a'.repeat(2049) },
      { offset: 1 },
    ])
      expect(listCommentsQuerySchema.safeParse(query).success).toBe(false)
    const ids = Array.from({ length: 50 }, () => randomUUID())
    expect(
      commentSummariesRequestSchema.parse({ memoryIds: ids }).memoryIds,
    ).toHaveLength(50)
    for (const memoryIds of [[], [...ids, randomUUID()], [ids[0], ids[0]]])
      expect(
        commentSummariesRequestSchema.safeParse({ memoryIds }).success,
      ).toBe(false)
  })
  test('DTO is strict and permits only private avatar paths', () => {
    const familyId = randomUUID(),
      authorId = randomUUID()
    const dto = {
      id: randomUUID(),
      familyId,
      memoryId: randomUUID(),
      author: {
        id: authorId,
        name: 'Человек',
        avatarPath: null,
        avatarCrop: null,
      },
      body: '<b>plain text</b>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      capabilities: { edit: false, delete: false },
    }
    expect(commentDtoSchema.safeParse(dto).success).toBe(true)
    expect(
      commentDtoSchema.safeParse({ ...dto, createRequestId: randomUUID() })
        .success,
    ).toBe(false)
    const privatePath = `/api/v1/families/${familyId}/media/avatars/${authorId}/${randomUUID()}/content`
    expect(
      commentDtoSchema.safeParse({
        ...dto,
        author: { ...dto.author, avatarPath: privatePath },
      }).success,
    ).toBe(true)
    for (const avatarPath of [
      'https://example.com/a',
      '//example.com/a',
      privatePath + '?token=secret',
      privatePath.replace('/avatars/', '/avatars/../'),
    ])
      expect(
        commentDtoSchema.safeParse({
          ...dto,
          author: { ...dto.author, avatarPath },
        }).success,
      ).toBe(false)
  })
})
