import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { TelegramVideoOpenResponse } from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../../memories'
import type { TelegramApiPort } from './ports'

const pointerLifetimeMs = 5 * 60 * 1_000
const pointerPrefix = 'watch_'

type PayloadCrypto = {
  decrypt<T>(payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): T
}

type DeliveryOptions = {
  now?: () => Date
  beforeFinalAuthorization?: () => Promise<void>
}

/**
 * Separates the Mini App navigation hand-off from delivery authorization. The returned deep link
 * contains a random pointer only; the Bot API file id remains encrypted in the adapter store.
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
        const authorized = await tx.$queryRaw<Array<{ referenceId: string }>>`
          SELECT d."reference_id" AS "referenceId"
          FROM "telegram_video_deliveries" d
          JOIN "telegram_video_references" r ON r."id" = d."reference_id"
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

        const reference = await tx.telegramVideoReference.findUniqueOrThrow({
          where: { id: authorized[0].referenceId },
          select: { fileIdCiphertext: true, encryptionIv: true, encryptionAuthTag: true },
        })
        const fileId = crypto.decrypt<string>({
          ciphertext: reference.fileIdCiphertext,
          iv: reference.encryptionIv,
          authTag: reference.encryptionAuthTag,
        })
        sendStarted = true
        await api.sendVideo(chatId, fileId)
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

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function isPointer(value: string) {
  return new RegExp(`^${pointerPrefix}[A-Za-z0-9_-]{32}$`).test(value)
}
