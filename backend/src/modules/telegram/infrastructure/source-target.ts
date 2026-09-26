import type { DbClient } from '../../../db'
import { lockBotActor, lockBotTarget, readCandidates } from '../../../bot-family-target'

export async function chooseTelegramTarget(db: DbClient, input: {
  sourceId: string; index: number; senderSubject: string; chatId: string; now?: Date
}) {
  const now = input.now ?? new Date()
  const source = await db.telegramSource.findUnique({ where: { id: input.sourceId } })
  if (!source || source.senderSubject !== input.senderSubject || source.chatId !== BigInt(input.chatId)) return 'denied' as const
  if (source.familyId && source.childId) return 'already_chosen' as const
  if (!source.choiceExpiresAt || source.choiceExpiresAt <= now) return 'expired' as const
  const candidate = readCandidates(source.choiceCandidates)[input.index]
  if (!candidate) return 'denied' as const
  return db.$transaction(async (tx) => {
    if (!(await lockBotTarget(tx, source.userId, candidate))) return 'denied' as const
    const decisionTime = input.now ?? new Date()
    if (source.mediaGroupId) {
      const selected = await tx.telegramSource.findFirst({ where: {
        botId: source.botId, chatId: source.chatId, mediaGroupId: source.mediaGroupId, familyId: { not: null },
      }, select: { id: true } })
      if (selected) return 'already_chosen' as const
    }
    const changed = await tx.telegramSource.updateMany({ where: {
      id: source.id, botId: source.botId, chatId: source.chatId, senderSubject: input.senderSubject,
      familyId: null, childId: null, status: 'accepted', choiceExpiresAt: { gt: decisionTime },
    }, data: { familyId: candidate.familyId, childId: candidate.childId } })
    if (changed.count !== 1) {
      const current = await tx.telegramSource.findUnique({ where: { id: source.id }, select: { familyId: true, choiceExpiresAt: true } })
      return current?.familyId ? 'already_chosen' as const :
        current?.choiceExpiresAt && current.choiceExpiresAt <= decisionTime ? 'expired' as const : 'denied' as const
    }
    if (source.mediaGroupId) {
      await tx.telegramSource.updateMany({ where: {
        botId: source.botId, chatId: source.chatId, mediaGroupId: source.mediaGroupId,
        senderSubject: source.senderSubject, userId: source.userId, familyId: null, childId: null,
        status: 'accepted', choiceExpiresAt: { gt: decisionTime },
      }, data: { familyId: candidate.familyId, childId: candidate.childId } })
      const album = await tx.telegramAlbum.findUnique({ where: { botId_chatId_mediaGroupId: {
        botId: source.botId, chatId: source.chatId, mediaGroupId: source.mediaGroupId,
      } }, select: { id: true } })
      if (album) await tx.taskOutbox.createMany({ data: [{ type: 'telegram:process', dedupeKey: `telegram-choice-album:${album.id}`,
        payload: { albumId: album.id }, scheduledFor: decisionTime }], skipDuplicates: true })
    } else {
      await tx.taskOutbox.createMany({ data: [{ type: 'telegram:process', dedupeKey: `telegram-choice-source:${source.id}`,
        payload: { sourceId: source.id }, scheduledFor: decisionTime }], skipDuplicates: true })
    }
    return 'chosen' as const
  })
}

/** The actor lock serializes album expiry with a callback selecting the entire album. */
export async function expireTelegramChoice(db: DbClient, sourceId: string, albumId?: string, now = new Date()) {
  const source = await db.telegramSource.findUnique({ where: { id: sourceId } })
  if (!source) return null
  return db.$transaction(async (tx) => {
    await lockBotActor(tx, source.userId)
    const album = albumId ? await tx.telegramAlbum.findUnique({ where: { id: albumId } }) : null
    if (albumId && (!album || album.status === 'published' || album.status === 'rejected' ||
      album.botId !== source.botId || album.chatId !== source.chatId || album.mediaGroupId !== source.mediaGroupId)) return null
    const sources = album ? await tx.telegramSource.findMany({ where: {
      botId: album.botId, chatId: album.chatId, mediaGroupId: album.mediaGroupId,
    }, select: { id: true, inboxId: true, familyId: true, childId: true, status: true, choiceExpiresAt: true } })
      : await tx.telegramSource.findMany({ where: { id: sourceId },
        select: { id: true, inboxId: true, familyId: true, childId: true, status: true, choiceExpiresAt: true } })
    if (!sources.length || sources.some((item) => item.status !== 'accepted' || item.familyId || item.childId ||
      !item.choiceExpiresAt || item.choiceExpiresAt > now)) return null
    const changed = await tx.telegramSource.updateMany({ where: {
      id: { in: sources.map(({ id }) => id) }, status: 'accepted', familyId: null, childId: null, choiceExpiresAt: { lte: now },
    }, data: { status: 'rejected', rejectionCode: 'choice_expired' } })
    if (changed.count !== sources.length) throw new Error('Telegram choice expiry lost its source transition')
    await tx.telegramInbox.updateMany({ where: { id: { in: sources.map(({ inboxId }) => inboxId) } }, data: {
      processedAt: now, encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
    } })
    if (album) await tx.telegramAlbum.update({ where: { id: album.id }, data: { status: 'rejected' } })
    return source.chatId.toString()
  })
}
