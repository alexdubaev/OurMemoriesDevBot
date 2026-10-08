import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { CaptionRepository } from '../application/captions'

export class PrismaCaptionRepository implements CaptionRepository {
  constructor(private readonly db: DbClient) {}

  async consumeReply(input: Parameters<CaptionRepository['consumeReply']>[0]) {
    return this.db.$transaction(async (tx) => {
      const request = await tx.captionRequest.findFirst({ where: {
        familyId: input.familyId, userId: input.userId, chatId: BigInt(input.chatId), promptMessageId: BigInt(input.replyToMessageId!),
      } })
      if (!request) return { kind: 'not_found' as const }
      if (request.consumedAt) return { kind: 'updated' as const }
      if (request.cancelledAt || request.expiresAt <= new Date()) return { kind: 'expired' as const }
      const full = await tx.familyMember.count({ where: { familyId: input.familyId, userId: input.userId, role: 'full', revokedAt: null,
        family: { status: 'active' } } })
      const authorized = full === 1 && await lockCurrentFullMember(tx, input.familyId, input.userId)

      // Preserve the user/family/member lock order above, then serialize reply and /cancel on the
      // request itself. The first read only identifies the request; this read decides whether it
      // may still change a memory after any concurrent cancellation has committed.
      await tx.$queryRaw`SELECT id FROM caption_requests WHERE id = ${request.id}::uuid FOR UPDATE`
      const current = await tx.captionRequest.findUnique({ where: { id: request.id } })
      if (!current) return { kind: 'not_found' as const }
      if (current.consumedAt) return { kind: 'updated' as const }
      const checkedAt = new Date()
      if (current.cancelledAt || current.expiresAt <= checkedAt) return { kind: 'expired' as const }

      if (!authorized) {
        await tx.captionRequest.update({ where: { id: current.id }, data: { cancelledAt: checkedAt } })
        return { kind: 'forbidden' as const }
      }
      const updated = await tx.memory.updateMany({ where: { id: current.memoryId, familyId: input.familyId, deletedAt: null,
        version: current.expectedVersion }, data: { body: input.text, version: { increment: 1 } } })
      if (updated.count !== 1) return { kind: 'stale' as const }
      await tx.captionRequest.update({ where: { id: current.id }, data: { consumedAt: checkedAt } })
      return { kind: 'updated' as const }
    })
  }

  async cancel(input: { familyId: string; userId: string; chatId: string }) {
    const current = await this.db.captionRequest.findFirst({ where: { familyId: input.familyId, userId: input.userId,
      chatId: BigInt(input.chatId), consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (!current) return false
    const result = await this.db.captionRequest.updateMany({ where: { id: current.id, consumedAt: null, cancelledAt: null,
      expiresAt: { gt: new Date() } }, data: { cancelledAt: new Date() } })
    return result.count === 1
  }
}

async function lockCurrentFullMember(tx: PrismaTransactionClient, familyId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
  const family = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM families WHERE id = ${familyId}::uuid AND status = 'active' FOR SHARE`
  if (!family[0]) return false
  const rows = await tx.$queryRaw<Array<{ role: string }>>`
    SELECT fm.role::text AS role
      FROM family_members fm
     WHERE fm.family_id = ${familyId}::uuid
       AND fm.user_id = ${userId}::uuid
       AND fm.role = 'full'
       AND fm.revoked_at IS NULL
     FOR SHARE OF fm
  `
  return rows.length === 1
}
