import type { DbClient } from '../../../db'
import type { MaxNotificationPilot, PilotEvent } from '../../../max-notifications-pilot'
import { albumNotificationText, pilotEnabled, pilotRecipient, pilotSubjectHash } from '../../../max-notifications-pilot'
import { TerminalTaskError } from '../../../outbox/errors'
import type { MaxApiPort } from '../application/ports'
import { MaxProviderError } from './max-api'

export function createPilotNotificationDelivery(options: { prisma: DbClient; config: MaxNotificationPilot; api: MaxApiPort }) {
  return async (payload: unknown, signal?: AbortSignal): Promise<'done' | 'skipped'> => {
    if (!pilotEnabled(options.config)) return 'skipped'
    const input = readPayload(payload)
    if (input.pilotSince !== options.config.MAX_NOTIFICATIONS_PILOT_SINCE) return 'skipped'
    return options.prisma.$transaction(async (tx) => {
      // Serializes this pilot's dialog across workers and spaces messages below MAX's 2/s limit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`max-pilot:${input.identityId}`}, 0))`
      const recipient = await pilotRecipient(tx, options.config, input.familyId)
      if (!recipient || recipient.id !== input.identityId || pilotSubjectHash(recipient.subject) !== input.subjectHash || recipient.botId !== input.botId || recipient.membershipEpoch !== input.membershipEpoch) return 'skipped'
      let text: string
      if (input.kind === 'album') {
        const album = await tx.album.findFirst({ where: { id: input.albumId, familyId: input.familyId, deletedAt: null,
          entries: { some: { id: input.entryId, deletedAt: null } } }, select: { title: true } })
        if (!album) return 'skipped'
        text = albumNotificationText(album.title, input.photoCount)
      } else {
        const memory = await tx.memory.findFirst({ where: { id: input.memoryId, familyId: input.familyId, status: 'published', deletedAt: null },
          select: { kind: true, media: { select: { asset: { select: { mediaKind: true } } } }, maxVideoReferences: { select: { id: true } }, telegramVideoReference: { select: { id: true } } } })
        if (!memory) return 'skipped'
        const kinds = memory.media.map(({ asset }) => asset.mediaKind)
        const videos = memory.maxVideoReferences.length + (memory.telegramVideoReference ? 1 : 0) + kinds.filter((kind) => kind === 'video').length
        const photos = kinds.filter((kind) => kind === 'photo').length
        text = memory.kind === 'note' ? 'В семейной ленте — новая заметка ✨'
          : memory.kind === 'voice' ? 'В семейной ленте — новое голосовое сообщение 🎤'
            : photos && !videos ? `В семейной ленте — ${photos === 1 ? 'новое фото' : 'новые фото'} 📸`
              : videos && !photos ? 'В семейной ленте — новое видео 🎬' : 'В семейной ленте — новая публикация 📷'
      }
      try {
        const bot = await options.api.getMe(signal)
        if (!bot.isBot || String(bot.userId) !== recipient.botId || bot.username.toLowerCase() !== options.config.MAX_BOT_EXPECTED_USERNAME!.toLowerCase()) return 'skipped'
        await tx.$executeRaw`SELECT pg_sleep(0.55)`
        // Recheck stop state after provider identity lookup/delay, immediately before the send.
        const current = await pilotRecipient(tx, options.config, input.familyId)
        if (!current || current.id !== recipient.id || current.subject !== recipient.subject ||
          current.botId !== recipient.botId || current.membershipEpoch !== recipient.membershipEpoch) return 'skipped'
        await options.api.sendMessage({ userId: recipient.subject, text,
          buttons: [{ type: 'open_app', text: 'Открыть memoLy', webApp: options.config.MAX_BOT_EXPECTED_USERNAME! }] }, signal)
      } catch (error) {
        if (error instanceof MaxProviderError && !error.retryable) {
          if (error.status === 403 || error.status === 404 || error.status === 400) return 'skipped'
          throw new TerminalTaskError('MAX pilot delivery rejected')
        }
        throw error
      }
      return 'done'
    }, { timeout: 35_000 })
  }
}

type PilotPayload = PilotEvent & { identityId: string; subjectHash: string; membershipEpoch: number; botId: string; pilotSince: string }
function readPayload(payload: unknown): PilotPayload {
  const value = payload as Partial<PilotPayload> | null
  const uuid = (item: unknown) => typeof item === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item)
  if (!value || !uuid(value.familyId) || !uuid(value.identityId) || typeof value.botId !== 'string' || !/^[1-9][0-9]*$/.test(value.botId) ||
    !Number.isInteger(value.membershipEpoch) || typeof value.pilotSince !== 'string' || typeof value.subjectHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.subjectHash) ||
    !(value.kind === 'feed' && uuid(value.memoryId) || value.kind === 'album' && uuid(value.albumId) && uuid(value.entryId) &&
      typeof value.photoCount === 'number' && Number.isSafeInteger(value.photoCount) && value.photoCount > 0)) throw new TerminalTaskError('Invalid MAX pilot intent')
  return value as PilotPayload
}
