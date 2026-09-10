import type { DbClient } from '../../../db'
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
      if (full !== 1) return { kind: 'forbidden' as const }
      const updated = await tx.memory.updateMany({ where: { id: request.memoryId, familyId: input.familyId, deletedAt: null,
        version: request.expectedVersion }, data: { body: input.text, version: { increment: 1 } } })
      if (updated.count !== 1) return { kind: 'stale' as const }
      await tx.captionRequest.update({ where: { id: request.id }, data: { consumedAt: new Date() } })
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
