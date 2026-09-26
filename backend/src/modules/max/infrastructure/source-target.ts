import type { MaxSource } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import { choiceWindowMs, loadPublishCandidates, readCandidates, lockBotActor, lockBotTarget } from '../../../bot-family-target'

export type MaxTarget = { userId: string; familyId: string; childId: string }
export type MaxTargetResult = { kind: 'target'; target: MaxTarget } | { kind: 'pending' | 'expired' | 'unavailable' }

export async function resolveMaxTarget(db: DbClient, source: MaxSource, now = new Date()): Promise<MaxTargetResult> {
  if (source.userId && source.familyId && source.childId) {
    return { kind: 'target', target: { userId: source.userId, familyId: source.familyId, childId: source.childId } }
  }
  if (source.choiceExpiresAt) return { kind: source.choiceExpiresAt > now ? 'pending' : 'expired' }
  const found = await loadPublishCandidates(db, 'max', source.senderSubject)
  if (!found || found.candidates.length === 0) return { kind: 'unavailable' }
  if (found.candidates.length > 1) {
    await db.$transaction(async (tx) => {
      await lockBotActor(tx, found.userId)
      const changed = await tx.maxSource.updateMany({ where: {
        id: source.id, status: 'accepted', userId: null, familyId: null, choiceExpiresAt: null,
      }, data: {
        userId: found.userId, choiceCandidates: found.candidates, choiceExpiresAt: new Date(source.createdAt.getTime() + choiceWindowMs),
      } })
      if (changed.count !== 1) return
      const response = await tx.maxOutgoingResponse.upsert({
        where: { inboxId_kind: { inboxId: source.inboxId, kind: 'family_choice' } },
        create: { inboxId: source.inboxId, destinationUserId: BigInt(source.senderSubject), kind: 'family_choice', text: 'Выберите семью для этого сообщения. Выбор доступен 15 минут.' },
        update: {}, select: { id: true },
      })
      await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: now }], skipDuplicates: true })
      await tx.taskOutbox.createMany({ data: [{ type: 'max:process', dedupeKey: `max-choice-expiry:${source.id}`,
        payload: { inboxId: source.inboxId }, scheduledFor: new Date(source.createdAt.getTime() + choiceWindowMs) }], skipDuplicates: true })
    })
  } else {
    const candidate = found.candidates[0]!
    await db.$transaction(async (tx) => {
      if (!(await lockBotTarget(tx, found.userId, candidate))) return
      await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted', userId: null, familyId: null }, data: {
        userId: found.userId, familyId: candidate.familyId, childId: candidate.childId,
      } })
    })
  }
  const current = await db.maxSource.findUnique({ where: { id: source.id } })
  if (!current) return { kind: 'unavailable' }
  if (current.userId && current.familyId && current.childId) {
    return { kind: 'target', target: { userId: current.userId, familyId: current.familyId, childId: current.childId } }
  }
  return { kind: !current.choiceExpiresAt ? 'unavailable' : current.choiceExpiresAt <= now ? 'expired' : 'pending' }
}

export async function chooseMaxTarget(db: DbClient, sourceId: string, index: number, senderSubject: string, now?: Date) {
  const source = await db.maxSource.findUnique({ where: { id: sourceId } })
  if (!source || source.senderSubject !== senderSubject || !source.userId) return 'denied' as const
  if (source.familyId && source.childId) return 'already_chosen' as const
  if (!source.choiceExpiresAt || source.choiceExpiresAt <= (now ?? new Date())) return 'expired' as const
  const candidate = readCandidates(source.choiceCandidates)[index]
  if (!candidate) return 'denied' as const
  return db.$transaction(async (tx) => {
    if (!(await lockBotTarget(tx, source.userId!, candidate))) return 'denied' as const
    const decisionTime = now ?? new Date()
    const changed = await tx.maxSource.updateMany({ where: {
      id: source.id, senderSubject, userId: source.userId!, familyId: null, childId: null,
      status: 'accepted', choiceExpiresAt: { gt: decisionTime },
    }, data: { familyId: candidate.familyId, childId: candidate.childId } })
    if (changed.count !== 1) {
      const current = await tx.maxSource.findUnique({ where: { id: source.id }, select: { familyId: true, status: true, choiceExpiresAt: true } })
      return current?.familyId ? 'already_chosen' as const :
        current?.choiceExpiresAt && current.choiceExpiresAt <= decisionTime ? 'expired' as const : 'denied' as const
    }
    await tx.taskOutbox.createMany({ data: [{ type: 'max:process', dedupeKey: `max-choice:${source.id}`, payload: { inboxId: source.inboxId }, scheduledFor: decisionTime }], skipDuplicates: true })
    return 'chosen' as const
  })
}

/** An expiry task may have loaded an untargeted snapshot before the callback committed. */
export async function expireMaxTarget(db: DbClient, sourceId: string, inboxId: string, destinationUserId: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: {
      id: sourceId, status: 'accepted', familyId: null, childId: null, choiceExpiresAt: { lte: now },
    }, data: { status: 'denied', rejectionCode: 'choice_expired' } })
    if (changed.count !== 1) return 'skipped' as const
    await tx.maxInbox.updateMany({ where: { id: inboxId, status: 'accepted' }, data: {
      status: 'processed', processedAt: now, encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
    } })
    const response = await tx.maxOutgoingResponse.upsert({ where: { inboxId_kind: { inboxId, kind: 'denied' } },
      create: { inboxId, destinationUserId: BigInt(destinationUserId), kind: 'denied', text: 'Время выбора семьи истекло. Отправьте материал заново.' },
      update: {}, select: { id: true } })
    await tx.taskOutbox.createMany({ data: [{ type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`,
      payload: { responseId: response.id }, scheduledFor: now }], skipDuplicates: true })
    return 'done' as const
  })
}
