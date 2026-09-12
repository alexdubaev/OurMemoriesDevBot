import { randomUUID } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type {
  AcceptedTelegramUpdate,
  TelegramAcceptRepository,
  TelegramAdmission,
} from '../application/ports'
import type { TelegramInboundEvent } from '../domain/inbound-event'

const silenceWindowMs = 1_500
const albumMaxWaitMs = 8_000

export class PrismaTelegramRepository implements TelegramAcceptRepository {
  constructor(private readonly db: DbClient) {}

  async findAdmission(senderSubject: string): Promise<TelegramAdmission> {
    const admitted = await this.db.pilotAdmission.findUnique({
      where: { provider_subject: { provider: 'telegram', subject: senderSubject } },
      select: { revokedAt: true },
    })
    if (!admitted || admitted.revokedAt) return null
    const identity = await this.db.externalIdentity.findUnique({
      where: { provider_subject: { provider: 'telegram', subject: senderSubject } },
      select: {
        user: {
          select: {
            id: true,
            familyMemberships: {
              where: { revokedAt: null, family: { status: 'active' } },
              orderBy: { joinedAt: 'asc' },
              take: 2,
              select: {
                familyId: true,
                role: true,
                family: { select: { children: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true } } } },
              },
            },
          },
        },
      },
    })
    const membership = identity?.user.familyMemberships[0]
    const child = membership?.family.children[0]
    if (!identity || !membership || !child || identity.user.familyMemberships.length !== 1) return null
    return { userId: identity.user.id, familyId: membership.familyId, childId: child.id, role: membership.role }
  }

  async accept({ botId, event, encrypted, admission, now, queueInboxTask = true }: Parameters<TelegramAcceptRepository['accept']>[0]): Promise<AcceptedTelegramUpdate> {
    return this.db.$transaction(async (tx) => {
      const inboxId = randomUUID()
      const insertedInbox = await tx.telegramInbox.createMany({
        data: [{
          id: inboxId,
          botId,
          updateId: BigInt(event.updateId),
          eventKind: event.kind === 'command' ? 'command' : event.kind === 'denied_content' ? 'denied' : 'content',
          encryptedPayload: Buffer.from(encrypted.ciphertext),
          encryptionIv: Buffer.from(encrypted.iv),
          encryptionAuthTag: Buffer.from(encrypted.authTag),
          receivedAt: now,
        }],
        skipDuplicates: true,
      })
      if (insertedInbox.count === 0) {
        const existing = await tx.telegramInbox.findUnique({
          where: { botId_updateId: { botId, updateId: BigInt(event.updateId) } }, select: { id: true },
        })
        return { inboxId: existing?.id ?? null, duplicate: true }
      }

      if (event.kind === 'command' || event.kind === 'denied_content' || event.kind === 'caption_reply') {
        if (queueInboxTask) await queue(tx, `telegram-inbox:${inboxId}`, { inboxId }, now)
        return { inboxId, duplicate: false }
      }
      if (!isContent(event) || !admission || admission.role !== 'full') {
        throw new Error('Telegram content reached durable acceptance without full family access')
      }

      const sourceId = randomUUID()
      const sourceCreated = await tx.telegramSource.createMany({
        data: [{
          id: sourceId,
          inboxId,
          botId,
          chatId: BigInt(event.chatId),
          messageId: BigInt(event.messageId),
          senderSubject: event.senderId,
          userId: admission.userId,
          familyId: admission.familyId,
          childId: admission.childId,
          kind: event.kind === 'note' ? 'note' : event.mediaKind,
          mediaGroupId: event.kind === 'media' ? event.mediaGroupId : null,
          plannedMemoryId: randomUUID(),
          // The video itself remains a Telegram-only reference. A supplied Telegram thumbnail is
          // the sole derived object we keep, using this stable id to make retries idempotent.
          plannedMediaId: event.kind === 'media' && (event.mediaKind !== 'video' || event.thumbnail) ? randomUUID() : null,
          createdAt: now,
        }],
        skipDuplicates: true,
      })
      if (sourceCreated.count === 0) {
        await tx.telegramInbox.update({ where: { id: inboxId }, data: {
          processedAt: now, encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
        } })
        return { inboxId, duplicate: true }
      }

      if (event.kind === 'media' && event.mediaGroupId) {
        const existing = await tx.telegramAlbum.findUnique({
          where: { botId_chatId_mediaGroupId: { botId, chatId: BigInt(event.chatId), mediaGroupId: event.mediaGroupId } },
        })
        const hardDeadline = existing?.hardDeadline ?? new Date(now.getTime() + albumMaxWaitMs)
        const readyAt = new Date(Math.min(now.getTime() + silenceWindowMs, hardDeadline.getTime()))
        const album = existing
          ? await tx.telegramAlbum.update({
              where: { id: existing.id }, data: { lastSeenAt: now, readyAt },
            })
          : await tx.telegramAlbum.create({ data: {
              botId, chatId: BigInt(event.chatId), mediaGroupId: event.mediaGroupId,
              firstSeenAt: now, lastSeenAt: now, readyAt, hardDeadline,
            } })
        await queue(tx, `telegram-album:${album.id}:${event.updateId}`, { albumId: album.id }, readyAt)
      } else {
        await queue(tx, `telegram-source:${sourceId}`, { sourceId }, now)
      }
      return { inboxId, duplicate: false }
    })
  }
}

function isContent(event: TelegramInboundEvent): event is Extract<TelegramInboundEvent, { kind: 'note' | 'media' | 'caption_reply' }> {
  return event.kind === 'note' || event.kind === 'media' || event.kind === 'caption_reply'
}

async function queue(
  tx: Pick<PrismaTransactionClient, 'taskOutbox'>,
  dedupeKey: string,
  payload: Record<string, string>,
  scheduledFor: Date,
) {
  await tx.taskOutbox.create({ data: { type: 'telegram:process', dedupeKey, payload, scheduledFor } })
}
