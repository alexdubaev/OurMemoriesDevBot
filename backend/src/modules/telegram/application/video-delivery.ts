import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { TelegramVideoOpenResponse } from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import { insertTask } from '../../../outbox/store'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../../memories'
import { isTelegramMessageAlreadyAbsent, type TelegramApiPort } from './ports'

const pointerLifetimeMs = 5 * 60 * 1_000
const pointerPrefix = 'watch_'
const navigationReplyLifetimeMs = 2 * 60 * 1_000
const navigationReplyText = 'Видео из воспоминания ↑'

type PayloadCrypto = {
  decrypt<T>(payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): T
}

type DeliveryOptions = {
  now?: () => Date
  beforeFinalAuthorization?: () => Promise<void>
}

/**
 * Separates the Mini App navigation hand-off from delivery authorization. The returned deep link
 * contains a random pointer only; Telegram source and media identifiers remain in the adapter
 * store. When the original video is in this requester's private bot chat, delivery creates a
 * temporary reply that Telegram can use to navigate back to that original message.
 */
export class TelegramVideoDeliveryService {
  constructor(
    private readonly db: DbClient,
    private readonly familyAccess: FamilyAccess,
    private readonly botUsername: string,
    private readonly options: DeliveryOptions = {},
  ) {}

  async request(scope: FamilyScope, memoryId: string): Promise<TelegramVideoOpenResponse> {
    await this.familyAccess.requireMember(scope)
    const reference = await this.db.telegramVideoReference.findFirst({
      where: {
        familyId: scope.familyId,
        memoryId,
        memory: { familyId: scope.familyId, status: 'published', deletedAt: null },
      },
      select: { id: true },
    })
    if (!reference) throw new MemoryFailure('not_found', 'Видео в Telegram не найдено')

    const pointer = `${pointerPrefix}${randomBytes(24).toString('base64url')}`
    const now = this.now()
    await this.db.telegramVideoDelivery.create({
      data: {
        tokenHash: hash(pointer),
        referenceId: reference.id,
        familyId: scope.familyId,
        userId: scope.principal.userId,
        expiresAt: new Date(now.getTime() + pointerLifetimeMs),
      },
    })
    return { telegramDeepLink: `https://t.me/${this.botUsername}?start=${pointer}` }
  }

  async deliverFromStart(
    senderSubject: string,
    chatId: string,
    pointer: string,
    api: TelegramApiPort,
    crypto: PayloadCrypto,
  ): Promise<'delivered' | 'ambiguous' | 'denied' | 'not_video_pointer'> {
    if (!isPointer(pointer)) return pointer.startsWith(pointerPrefix) ? 'denied' : 'not_video_pointer'
    const delivery = await this.db.telegramVideoDelivery.findUnique({
      where: { tokenHash: hash(pointer) },
      select: { id: true, userId: true },
    })
    const now = this.now()
    if (!delivery) return 'denied'

    const identity = await this.db.externalIdentity.findUnique({
      where: { provider_subject: { provider: 'telegram', subject: senderSubject } },
      select: { userId: true },
    })
    if (identity?.userId !== delivery.userId) return 'denied'

    const claimToken = randomUUID()
    const claimed = await this.db.telegramVideoDelivery.updateMany({
      where: {
        id: delivery.id,
        expiresAt: { gt: now },
        claimToken: null,
        deliveredAt: null,
        ambiguousAt: null,
        deniedAt: null,
      },
      data: { claimToken, claimedAt: now },
    })
    if (claimed.count === 0) return 'denied'

    await this.options.beforeFinalAuthorization?.()

    let sendStarted = false
    try {
      const delivered = await this.db.$transaction(async (tx) => {
        const authorized = await tx.$queryRaw<Array<{
          referenceId: string
          sourceChatId: string
          sourceMessageId: string
          sourceSenderSubject: string
        }>>`
          SELECT d."reference_id" AS "referenceId",
                 s."chat_id"::text AS "sourceChatId",
                 s."message_id"::text AS "sourceMessageId",
                 s."sender_subject" AS "sourceSenderSubject"
          FROM "telegram_video_deliveries" d
          JOIN "telegram_video_references" r ON r."id" = d."reference_id"
          JOIN "telegram_sources" s ON s."id" = r."source_id" AND s."family_id" = r."family_id"
          JOIN "memories" m ON m."id" = r."memory_id" AND m."family_id" = d."family_id"
          JOIN "family_members" fm ON fm."family_id" = d."family_id" AND fm."user_id" = d."user_id"
          JOIN "families" f ON f."id" = d."family_id"
          JOIN "external_identities" ei ON ei."user_id" = d."user_id"
          WHERE d."id" = ${delivery.id}::uuid
            AND d."claim_token" = ${claimToken}::uuid
            AND d."expires_at" > ${this.now()}
            AND d."delivered_at" IS NULL
            AND d."ambiguous_at" IS NULL
            AND d."denied_at" IS NULL
            AND r."family_id" = d."family_id"
            AND m."status" = 'published'::"memory_status"
            AND m."deleted_at" IS NULL
            AND fm."revoked_at" IS NULL
            AND f."status" = 'active'::"family_status"
            AND ei."provider" = 'telegram'::"external_identity_provider"
            AND ei."subject" = ${senderSubject}
          FOR SHARE OF d, r, m, fm, f, ei
        `
        if (!authorized[0]) return false

        const original = authorized[0]
        sendStarted = true
        if (original.sourceChatId === chatId && original.sourceSenderSubject === senderSubject) {
          const sent = await api.sendMessage(chatId, navigationReplyText, {
            replyToMessageId: original.sourceMessageId,
          })
          if (!sent || !('messageId' in sent) || !isTelegramMessageId(sent.messageId)) {
            throw new Error('Telegram navigation reply did not return a usable message id')
          }
          const cleanupAt = new Date(this.now().getTime() + navigationReplyLifetimeMs)
          const navigation = await tx.telegramVideoNavigationReply.create({
            data: {
              deliveryId: delivery.id,
              chatId: BigInt(chatId),
              messageId: BigInt(sent.messageId),
              cleanupAt,
            },
            select: { id: true },
          })
          await insertTask(tx, {
            type: 'telegram:navigation-reply:cleanup',
            dedupeKey: `telegram-navigation-reply-cleanup:${navigation.id}`,
            payload: { navigationReplyId: navigation.id },
            scheduledFor: cleanupAt,
          })
        } else {
          const reference = await tx.telegramVideoReference.findUniqueOrThrow({
            where: { id: original.referenceId },
            select: { fileIdCiphertext: true, encryptionIv: true, encryptionAuthTag: true },
          })
          const fileId = crypto.decrypt<string>({
            ciphertext: reference.fileIdCiphertext,
            iv: reference.encryptionIv,
            authTag: reference.encryptionAuthTag,
          })
          await api.sendVideo(chatId, fileId)
        }
        await tx.telegramVideoDelivery.update({ where: { id: delivery.id }, data: { deliveredAt: this.now() } })
        return true
      }, { timeout: 15_000 })

      if (delivered) return 'delivered'
      await this.markDenied(delivery.id, claimToken)
      return 'denied'
    } catch (error) {
      if (!sendStarted) throw error
      await this.db.telegramVideoDelivery.updateMany({
        where: { id: delivery.id, claimToken, deliveredAt: null, deniedAt: null },
        data: { ambiguousAt: this.now() },
      })
      return 'ambiguous'
    }
  }

  private now() {
    return this.options.now?.() ?? new Date()
  }

  private async markDenied(id: string, claimToken: string) {
    await this.db.telegramVideoDelivery.updateMany({
      where: { id, claimToken, deliveredAt: null, ambiguousAt: null },
      data: { deniedAt: this.now() },
    })
  }
}

/**
 * Best-effort cleanup for exactly one bot-created navigation reply. A missing message is already
 * clean; other provider failures are intentionally contained so video navigation remains a
 * successful primary action and the shared outbox never retries this secondary work forever.
 */
export async function cleanupTelegramVideoNavigationReply(
  db: DbClient,
  api: TelegramApiPort,
  navigationReplyId: string,
  now = new Date(),
): Promise<'done' | 'skipped'> {
  const navigation = await db.telegramVideoNavigationReply.findUnique({
    where: { id: navigationReplyId },
    select: { chatId: true, messageId: true, deletedAt: true },
  })
  if (!navigation || navigation.deletedAt) return 'skipped'

  try {
    await api.deleteMessage(navigation.chatId.toString(), navigation.messageId.toString())
  } catch (error) {
    if (!isTelegramMessageAlreadyAbsent(error)) {
      console.warn('Telegram navigation reply cleanup failed', {
        errorType: error instanceof Error ? error.name : typeof error,
      })
      return 'skipped'
    }
  }

  await db.telegramVideoNavigationReply.updateMany({
    where: { id: navigationReplyId, deletedAt: null },
    data: { deletedAt: now },
  })
  return 'done'
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function isPointer(value: string) {
  return new RegExp(`^${pointerPrefix}[A-Za-z0-9_-]{32}$`).test(value)
}

function isTelegramMessageId(value: string) {
  return /^\d+$/.test(value)
}
