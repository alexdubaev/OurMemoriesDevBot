import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  createAlbumEntryCommentRequestSchema, listAlbumEntryCommentsQuerySchema,
  setAlbumEntryReactionRequestSchema, updateAlbumEntryCommentRequestSchema,
  type CreateAlbumEntryCommentRequest, type ListAlbumEntryCommentsQuery,
  type SetAlbumEntryReactionRequest, type UpdateAlbumEntryCommentRequest,
} from '@web-app-demo/contracts'
import type { FamilyScope } from '../../families'
import { AlbumFailure } from '../domain/errors'
import type { AlbumCommentPosition, AlbumDiscussionTarget, AlbumSocialRepository } from './album-social-ports'

const cursorSchema = z.object({
  version: z.literal(1), familyId: z.uuid(), albumId: z.uuid(), entryId: z.uuid(),
  discussionGeneration: z.number().int().positive(), createdAt: z.string().datetime(), id: z.uuid(),
}).strict()

export class AlbumSocialService {
  constructor(private readonly repository: AlbumSocialRepository, private readonly secret: string) {}
  discussion(scope: FamilyScope, albumId: string, entryId: string) { return this.repository.discussion(scope, albumId, entryId) }
  async list(scope: FamilyScope, albumId: string, entryId: string, input: ListAlbumEntryCommentsQuery) {
    const query = listAlbumEntryCommentsQuerySchema.parse(input)
    const target = { albumId, entryId, discussionGeneration: query.discussionGeneration }
    let before: AlbumCommentPosition | undefined
    if (query.cursor) {
      try {
        const [payload, signature, ...extra] = query.cursor.split('.')
        if (!payload || !signature || extra.length) throw new Error()
        const expected = this.sign(payload), supplied = Buffer.from(signature, 'base64url')
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error()
        const claims = cursorSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
        if (claims.familyId !== scope.familyId || claims.albumId !== albumId || claims.entryId !== entryId || claims.discussionGeneration !== target.discussionGeneration) throw new Error()
        before = { createdAt: claims.createdAt, id: claims.id }
      } catch { throw new AlbumFailure('invalid_input', 'Курсор комментариев недействителен') }
    }
    const page = await this.repository.list(scope, target, query.limit, before)
    const last = page.items.at(-1)
    let nextCursor: string | null = null
    if (page.hasNext && last) {
      const payload = Buffer.from(JSON.stringify({ version: 1, familyId: scope.familyId, ...target, createdAt: last.createdAt, id: last.id })).toString('base64url')
      nextCursor = `${payload}.${this.sign(payload).toString('base64url')}`
    }
    return { items: page.items, nextCursor, summary: page.summary }
  }
  create(scope: FamilyScope, albumId: string, entryId: string, input: CreateAlbumEntryCommentRequest, key: string) {
    const normalized = createAlbumEntryCommentRequestSchema.parse(input)
    const target = { albumId, entryId, discussionGeneration: normalized.discussionGeneration }
    return this.repository.create(scope, target, normalized, {
      key: key.toLowerCase(), now: new Date(),
      payloadHash: createHash('sha256').update(JSON.stringify({ familyId: scope.familyId, ...target, body: normalized.body })).digest('hex'),
    })
  }
  update(scope: FamilyScope, target: AlbumDiscussionTarget, commentId: string, input: UpdateAlbumEntryCommentRequest) {
    return this.repository.update(scope, target, commentId, updateAlbumEntryCommentRequestSchema.parse(input))
  }
  delete(scope: FamilyScope, target: AlbumDiscussionTarget, commentId: string, expectedVersion: number) {
    return this.repository.delete(scope, target, commentId, expectedVersion)
  }
  setReaction(scope: FamilyScope, albumId: string, entryId: string, input: SetAlbumEntryReactionRequest) {
    const normalized = setAlbumEntryReactionRequestSchema.parse(input)
    return this.repository.setReaction(scope, { albumId, entryId, discussionGeneration: normalized.discussionGeneration }, normalized)
  }
  private sign(payload: string) { return createHmac('sha256', this.secret).update(`album-entry-comments-v1:${payload}`).digest() }
}
