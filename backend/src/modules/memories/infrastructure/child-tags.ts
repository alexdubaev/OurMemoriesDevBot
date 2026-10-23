import { MAX_FAMILY_CHILDREN } from '@web-app-demo/contracts'
import { Prisma } from '../../../generated/prisma/client'

import type { PrismaTransactionClient } from '../../../idempotency'
import { MemoryFailure } from '../domain/errors'

type TagWriter = Pick<PrismaTransactionClient, '$queryRaw' | 'memoryChildTag'>
export type ChildTag = { childId: string; attachmentId: string | null }
export type CreationChildTags = {
  /** Legacy mandatory `Memory.childId`: first requested child, else the oldest live child. */
  anchorChildId: string
  /** Children tagged on the whole publication. */
  childIds: string[]
}

/**
 * The one default rule for every new memory (app form, MAX, Mini App video, historical bots).
 * `requested` given (even empty) → exactly those children; absent → the only live child when the
 * family has exactly one, otherwise no tags. Call after the family row lock.
 */
export async function resolveCreationChildTags(
  tx: Pick<PrismaTransactionClient, '$queryRaw'>,
  familyId: string,
  requested: readonly string[] | undefined,
): Promise<CreationChildTags> {
  const live = await lockLiveChildren(tx, familyId)
  const oldest = live[0]
  if (requested === undefined) {
    if (!oldest) throw childNotFound()
    return { anchorChildId: oldest, childIds: live.length === 1 ? [oldest] : [] }
  }
  if (new Set(requested).size !== requested.length || requested.length > MAX_FAMILY_CHILDREN) {
    throw new MemoryFailure('invalid_input', 'Дети не должны повторяться')
  }
  const liveIds = new Set(live)
  if (requested.some((childId) => !liveIds.has(childId))) throw childNotFound()
  const anchorChildId = requested[0] ?? oldest
  if (!anchorChildId) throw childNotFound()
  return { anchorChildId, childIds: [...requested] }
}

export async function insertPublicationChildTags(
  tx: Pick<PrismaTransactionClient, 'memoryChildTag'>,
  input: { familyId: string; memoryId: string; createdBy: string; childIds: readonly string[] },
) {
  if (input.childIds.length === 0) return
  await tx.memoryChildTag.createMany({ data: input.childIds.map((childId) => ({
    familyId: input.familyId, memoryId: input.memoryId, childId, attachmentId: null, createdBy: input.createdBy,
  })) })
}

/**
 * Validates and normalizes a full replacement tag set for one memory. `attachments` are the
 * memory's attachments; only photos and videos can carry their own tags. A child tagged on any
 * attachment loses its whole-publication tag. Children are checked separately (live, same family).
 */
export function normalizeChildTags(
  tags: readonly ChildTag[],
  attachments: ReadonlyArray<{ id: string; kind: 'photo' | 'video' | 'voice' }>,
): ChildTag[] {
  const keys = tags.map(({ childId, attachmentId }) => `${childId}:${attachmentId ?? ''}`)
  if (new Set(keys).size !== keys.length) throw new MemoryFailure('invalid_input', 'Отметки не должны повторяться')
  const children = new Set(tags.map(({ childId }) => childId))
  if (children.size > MAX_FAMILY_CHILDREN) throw new MemoryFailure('invalid_input', 'Слишком много детей в отметках')
  const visual = new Set(attachments.filter(({ kind }) => kind === 'photo' || kind === 'video').map(({ id }) => id))
  const attachmentTags = tags.filter(({ attachmentId }) => attachmentId !== null)
  if (attachmentTags.length > 0 && visual.size === 0) {
    throw new MemoryFailure('invalid_input', 'В публикации без фото и видео детей отмечают на всей публикации')
  }
  if (attachmentTags.some(({ attachmentId }) => !visual.has(attachmentId!))) {
    throw new MemoryFailure('not_found', 'Вложение не найдено')
  }
  const onAttachments = new Set(attachmentTags.map(({ childId }) => childId))
  return tags
    .filter(({ childId, attachmentId }) => attachmentId !== null || !onAttachments.has(childId))
    .map(({ childId, attachmentId }) => ({ childId, attachmentId }))
}

/** Fails with 404 unless every child is a live child of this family; locks them against deletion. */
export async function assertLiveFamilyChildren(tx: Pick<PrismaTransactionClient, '$queryRaw'>, familyId: string, childIds: readonly string[]) {
  const unique = [...new Set(childIds)]
  if (unique.length === 0) return
  const live = new Set(await lockLiveChildren(tx, familyId))
  if (unique.some((childId) => !live.has(childId))) throw childNotFound()
}

/** Trusted media replacement: tags of attachments that no longer exist are removed. */
export async function removeDetachedAttachmentTags(
  tx: TagWriter & Pick<PrismaTransactionClient, 'memory'>,
  input: { familyId: string; memoryId: string; attachmentIds: readonly string[] },
) {
  if (input.attachmentIds.length === 0) return
  const removed = await tx.memoryChildTag.deleteMany({ where: {
    familyId: input.familyId, memoryId: input.memoryId, attachmentId: { in: [...input.attachmentIds] },
  } })
  if (removed.count > 0) {
    await tx.memory.update({ where: { id: input.memoryId }, data: { childTagsVersion: { increment: 1 } } })
  }
}

/** Live children ordered oldest first by creation; row locks serialize with child deletion. */
async function lockLiveChildren(tx: Pick<PrismaTransactionClient, '$queryRaw'>, familyId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM children
     WHERE family_id = ${familyId}::uuid AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC
     FOR SHARE
  `)
  return rows.map(({ id }) => id)
}

function childNotFound() {
  return new MemoryFailure('not_found', 'Профиль ребёнка не найден')
}
