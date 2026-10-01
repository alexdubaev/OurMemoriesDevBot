import { randomUUID } from 'node:crypto'

import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type {
  MaxAcceptRepository,
  MaxAcceptResult,
} from '../application/ports'

function attachmentsOf(event: Extract<Parameters<MaxAcceptRepository['accept']>[0]['event'], { kind: 'message_created' }>) {
  return event.attachments ?? (event.hasAttachments ? [{ kind: 'file' as const, providerAttachmentId: 'unsupported:legacy', filename: null, declaredSize: null }] : [])
}

export class PrismaMaxRepository implements MaxAcceptRepository {
  constructor(private readonly db: DbClient) {}

  async accept(input: Parameters<MaxAcceptRepository['accept']>[0]): Promise<MaxAcceptResult> {
    return this.db.$transaction(async (tx) => {
      // Suppress only a positively correlated echo. Senderless updates with an unknown
      // provider identity must be durably captured and deferred by the worker.
      if (input.event.kind === 'message_created' && input.event.isChannel) {
        const selfBackup = await tx.maxMemoryBackup.findFirst({ where: {
          channelChatId: BigInt(input.event.recipientId), providerMessageId: input.event.messageId,
        }, select: { id: true } })
        if (selfBackup) return { inboxId: '', duplicate: true }
      }
      const inboxId = randomUUID()
      const inserted = await tx.maxInbox.createMany({
        data: [{
          id: inboxId,
          eventKey: input.eventKey,
          botId: BigInt(input.botId),
          eventKind: input.event.kind,
          encryptedPayload: Buffer.from(input.encrypted.ciphertext),
          encryptionIv: Buffer.from(input.encrypted.iv),
          encryptionAuthTag: Buffer.from(input.encrypted.authTag),
          receivedAt: input.now,
        }],
        skipDuplicates: true,
      })
      if (inserted.count === 0) {
        const existing = await tx.maxInbox.findUnique({ where: { eventKey: input.eventKey }, select: { id: true } })
        if (!existing) throw new Error('MAX duplicate boundary is unavailable')
        return { inboxId: existing.id, duplicate: true }
      }

      // Newly accepted lifecycle updates use the same durable worker boundary, where they are
      // interpreted as channel state only. Existing captured rows have no task and are never replayed.
      if (isLifecycleEvent(input.event)) {
        await queue(tx, 'max:process', `max-process:${inboxId}`, { inboxId }, input.now)
        return { inboxId, duplicate: false }
      }

      if (input.event.kind === 'message_created') {
        const source = await tx.maxSource.create({
          data: {
            id: randomUUID(),
            inboxId,
            botId: BigInt(input.botId),
            senderSubject: input.event.senderId,
            recipientId: BigInt(input.event.recipientId),
            messageId: input.event.messageId,
            plannedMemoryId: randomUUID(),
            createdAt: input.now,
          },
        })
        const attachments = attachmentsOf(input.event)
        // The legacy single-video reference does not reserve a private media asset.
        const stagedAttachments = attachments.filter((attachment) => attachment.kind === 'image' || attachment.kind === 'file' ||
          attachment.kind === 'voice' || (attachment.kind === 'video' && attachments.length > 1))
        if ((input.response?.kind === 'accepted' || (input.event.isChannel && isSupportedChannelAttachmentSet(attachments))) &&
            stagedAttachments.length > 0 && stagedAttachments.length === attachments.length) {
          await tx.maxSourceAttachment.createMany({ data: stagedAttachments.map((attachment, position) => ({
            sourceId: source.id,
            position,
            // MAX's current schema predates native audio; voice uses the generic file row
            // while the encrypted event retains the exact audio classification.
            providerKind: attachment.kind === 'image' ? 'image' : attachment.kind === 'video' ? 'video' : 'file',
            providerAttachmentId: attachment.providerAttachmentId,
            plannedMediaId: randomUUID(),
          })) })
        }
      }

      await queue(tx, 'max:process', `max-process:${inboxId}`, { inboxId }, input.now)
      if (input.response) {
        const responseId = randomUUID()
        await tx.maxOutgoingResponse.create({
          data: {
            id: responseId,
            inboxId,
            destinationUserId: BigInt(input.response.destinationUserId),
            kind: input.response.kind,
            text: input.response.text,
            createdAt: input.now,
          },
        })
        await queue(tx, 'max:deliver-response', `max-response:${responseId}`, { responseId }, input.now)
      }

      return { inboxId, duplicate: false }
    })
  }
}

function isSupportedChannelAttachmentSet(attachments: ReturnType<typeof attachmentsOf>) {
  if (attachments.length === 0 || attachments.length > 10) return false
  const imagesAndVideos = attachments.every((attachment) => attachment.kind === 'image' || attachment.kind === 'video')
  if (imagesAndVideos) return true
  return attachments.length === 1 && (attachments[0]!.kind === 'file' || attachments[0]!.kind === 'voice')
}

function isLifecycleEvent(event: Parameters<MaxAcceptRepository['accept']>[0]['event']) {
  return event.kind === 'bot_added' || event.kind === 'bot_removed' || event.kind === 'bot_admin_permissions_changed'
}

async function queue(
  tx: Pick<PrismaTransactionClient, 'taskOutbox'>,
  type: string,
  dedupeKey: string,
  payload: Record<string, string>,
  scheduledFor: Date,
) {
  await tx.taskOutbox.create({ data: { type, dedupeKey, payload, scheduledFor } })
}
