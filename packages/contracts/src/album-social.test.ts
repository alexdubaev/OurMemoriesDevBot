import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  albumEntryCommentDtoSchema,
  createAlbumEntryCommentRequestSchema,
  listAlbumEntryCommentsQuerySchema,
  setAlbumEntryReactionRequestSchema,
} from './album-social'
import { createCommentRequestSchema, commentDtoSchema } from './comments'

test('album social contracts reuse text and reactions while requiring a discussion generation', () => {
  expect(createAlbumEntryCommentRequestSchema.parse({ body: '  a\r\nb  ', discussionGeneration: 2 })).toEqual({ body: 'a\nb', discussionGeneration: 2 })
  for (const body of ['', 'a\0b', '😀'.repeat(2001)])
    expect(createAlbumEntryCommentRequestSchema.safeParse({ body, discussionGeneration: 1 }).success).toBe(false)
  for (const discussionGeneration of [undefined, 0, -1, 1.5])
    expect(createAlbumEntryCommentRequestSchema.safeParse({ body: 'a', discussionGeneration }).success).toBe(false)
  expect(listAlbumEntryCommentsQuerySchema.parse({ discussionGeneration: '2' })).toEqual({ discussionGeneration: 2, limit: 20 })
  expect(listAlbumEntryCommentsQuerySchema.safeParse({ discussionGeneration: 1, limit: 51 }).success).toBe(false)
  for (const reaction of ['heart', 'love', 'laugh', 'touched', 'wow', 'clap', null])
    expect(setAlbumEntryReactionRequestSchema.safeParse({ reaction, discussionGeneration: 1 }).success).toBe(true)
  expect(setAlbumEntryReactionRequestSchema.safeParse({ reaction: 'star', discussionGeneration: 1 }).success).toBe(false)
  expect(createCommentRequestSchema.safeParse({ body: 'a', discussionGeneration: 1 }).success).toBe(false)
})

test('album and memory comment DTO identities cannot be interchanged', () => {
  const dto = {
    id: randomUUID(), familyId: randomUUID(), albumId: randomUUID(), entryId: randomUUID(), discussionGeneration: 1,
    author: { id: randomUUID(), name: 'Участник', avatarPath: null, avatarCrop: null }, body: 'Текст',
    version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), capabilities: { edit: true, delete: true },
  }
  expect(albumEntryCommentDtoSchema.safeParse(dto).success).toBe(true)
  expect(commentDtoSchema.safeParse(dto).success).toBe(false)
  expect(albumEntryCommentDtoSchema.safeParse({ ...dto, memoryId: dto.entryId }).success).toBe(false)
  expect(albumEntryCommentDtoSchema.safeParse({ ...dto, author: { ...dto.author, avatarPath: 'https://example.org/private.jpg' } }).success).toBe(false)
})
