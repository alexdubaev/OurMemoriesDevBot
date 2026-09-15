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
        if (input.response?.kind === 'accepted' && attachments.length > 0) {
          await tx.maxSourceAttachment.createMany({ data: attachments.map((attachment, position) => ({
            sourceId: source.id,
            position,
            providerKind: attachment.kind,
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

async function queue(
  tx: Pick<PrismaTransactionClient, 'taskOutbox'>,
  type: string,
  dedupeKey: string,
  payload: Record<string, string>,
  scheduledFor: Date,
) {
  await tx.taskOutbox.create({ data: { type, dedupeKey, payload, scheduledFor } })
}
