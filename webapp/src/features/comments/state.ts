import { commentBodySchema, type CommentDto } from '@web-app-demo/contracts'

export type CommentScope = {
  familyId: string
  accountId: string
  membershipEpoch: number
  memoryId: string
}

export type CommentCreateAttempt = Readonly<{
  body: string
  idempotencyKey: string
}>

export function normalizeCommentBody(body: string) {
  return commentBodySchema.parse(body)
}

export function createCommentAttempt(body: string, idempotencyKey = crypto.randomUUID()): CommentCreateAttempt {
  return Object.freeze({ body: normalizeCommentBody(body), idempotencyKey })
}

export function isCurrentCommentScope(expected: CommentScope, current: CommentScope | null, mounted: boolean) {
  return mounted && current !== null && expected.familyId === current.familyId && expected.accountId === current.accountId &&
    expected.membershipEpoch === current.membershipEpoch && expected.memoryId === current.memoryId
}

export function mergeCommentPages(pages: readonly CommentDto[][]) {
  const unique = new Map<string, CommentDto>()
  for (const page of pages) for (const item of page) {
    const existing = unique.get(item.id)
    if (!existing || item.version > existing.version) unique.set(item.id, item)
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
}
