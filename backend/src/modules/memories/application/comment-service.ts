import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  createCommentRequestSchema,
  updateCommentRequestSchema,
  type CreateCommentRequest,
  type ListCommentsQuery,
  type CommentPage,
  type CommentMutationResponse,
  type UpdateCommentRequest,
} from '@web-app-demo/contracts'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'
import type { CommentPosition, CommentRepository } from './comment-ports'

const cursorSchema = z
  .object({
    version: z.literal(1),
    familyId: z.uuid(),
    memoryId: z.uuid(),
    createdAt: z.string().datetime(),
    id: z.uuid(),
  })
  .strict()
export class CommentService {
  constructor(
    private readonly access: FamilyAccess,
    private readonly repository: CommentRepository,
    private readonly secret: string,
  ) {}
  async list(
    scope: FamilyScope,
    memoryId: string,
    query: ListCommentsQuery,
  ): Promise<CommentPage> {
    await this.access.requireMember(scope)
    let before: CommentPosition | undefined
    if (query.cursor) {
      try {
        const [payload, signature, ...extra] = query.cursor.split('.')
        if (!payload || !signature || extra.length) throw new Error()
        const expected = this.sign(payload),
          supplied = Buffer.from(signature, 'base64url')
        if (
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          throw new Error()
        const claims = cursorSchema.parse(
          JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
        )
        if (claims.familyId !== scope.familyId || claims.memoryId !== memoryId)
          throw new Error()
        before = { createdAt: claims.createdAt, id: claims.id }
      } catch {
        throw new MemoryFailure(
          'invalid_input',
          'Курсор комментариев недействителен',
        )
      }
    }
    const page = await this.repository.list(
      scope,
      memoryId,
      query.limit,
      before,
    )
    const last = page.items.at(-1)
    let nextCursor: string | null = null
    if (page.hasNext && last) {
      const payload = Buffer.from(
        JSON.stringify({
          version: 1,
          familyId: scope.familyId,
          memoryId,
          createdAt: last.createdAt,
          id: last.id,
        }),
      ).toString('base64url')
      nextCursor = `${payload}.${this.sign(payload).toString('base64url')}`
    }
    return { items: page.items, nextCursor, summary: page.summary }
  }
  async create(
    scope: FamilyScope,
    memoryId: string,
    input: CreateCommentRequest,
    key: string,
  ): Promise<CommentMutationResponse & { replayed: boolean }> {
    await this.access.requireMember(scope)
    const normalized = createCommentRequestSchema.parse(input)
    return this.repository.create(scope, memoryId, normalized, {
      key: key.toLowerCase(),
      payloadHash: createHash('sha256')
        .update(JSON.stringify({ memoryId, body: normalized.body }))
        .digest('hex'),
      now: new Date(),
    })
  }
  async summaries(scope: FamilyScope, memoryIds: string[]) {
    await this.access.requireMember(scope)
    return this.repository.summaries(scope, memoryIds)
  }
  async update(scope: FamilyScope, memoryId: string, commentId: string, input: UpdateCommentRequest) {
    await this.access.requireMember(scope)
    const normalized = updateCommentRequestSchema.parse(input)
    return this.repository.update(scope, memoryId, commentId, normalized)
  }
  async delete(scope: FamilyScope, memoryId: string, commentId: string, expectedVersion: number) {
    await this.access.requireMember(scope)
    return this.repository.delete(scope, memoryId, commentId, expectedVersion)
  }
  private sign(payload: string) {
    return createHmac('sha256', this.secret)
      .update(`memory-comments-v1:${payload}`)
      .digest()
  }
}
