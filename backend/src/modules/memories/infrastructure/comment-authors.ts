import { avatarCropSchema, type CommentDto } from '@web-app-demo/contracts'
import type { PrismaTransactionClient } from '../../../idempotency'

/** Shared private author projection; callers retain ownership of target identity and ACL. */
export async function projectCommentAuthors(tx: PrismaTransactionClient, familyId: string, authorIds: string[]): Promise<Map<string, CommentDto['author']>> {
  if (!authorIds.length) return new Map()
  const members = await tx.familyMember.findMany({
    where: { familyId, userId: { in: [...new Set(authorIds)] } },
    select: {
      userId: true, familyDisplayName: true, revokedAt: true,
      user: { select: { displayName: true, avatars: { where: { state: 'ready' }, select: { id: true, avatarCrop: true }, take: 1 } } },
    },
  })
  const byId = new Map(members.map((member) => [member.userId, member]))
  return new Map(authorIds.map((id) => {
    const member = byId.get(id)
    const avatar = member && !member.revokedAt ? member.user.avatars[0] : undefined
    const crop = avatarCropSchema.safeParse(avatar?.avatarCrop)
    return [id, {
      id,
      name: member?.familyDisplayName?.trim() || member?.user.displayName?.trim() || 'Участник семьи',
      avatarPath: avatar ? `/api/v1/families/${familyId}/media/avatars/${id}/${avatar.id}/content` : null,
      avatarCrop: avatar && crop.success ? crop.data : null,
    }]
  }))
}
