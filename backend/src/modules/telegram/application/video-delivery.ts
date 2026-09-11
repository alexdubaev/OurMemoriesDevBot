import { createHash, randomBytes } from 'node:crypto'

import type { TelegramVideoOpenResponse } from '@web-app-demo/contracts'

import type { DbClient } from '../../../db'
import type { FamilyAccess, FamilyScope } from '../../families'
import { MemoryFailure } from '../../memories/domain/errors'
import type { TelegramApiPort } from './ports'

const pointerLifetimeMs = 5 * 60 * 1_000
const pointerPrefix = 'watch_'

type PayloadCrypto = {
  decrypt<T>(payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): T
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
    private readonly now: () => Date = () => new Date(),
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
  ): Promise<'delivered' | 'denied' | 'not_video_pointer'> {
    if (!isPointer(pointer)) return 'not_video_pointer'
    const delivery = await this.db.telegramVideoDelivery.findUnique({
      where: { tokenHash: hash(pointer) },
      include: {
        reference: {
          include: { memory: { select: { familyId: true, status: true, deletedAt: true } } },
        },
      },
    })
    const now = this.now()
    if (!delivery || delivery.expiresAt <= now || delivery.deliveredAt) return 'denied'
    if (delivery.reference.familyId !== delivery.familyId ||
        delivery.reference.memory.familyId !== delivery.familyId ||
        delivery.reference.memory.status !== 'published' || delivery.reference.memory.deletedAt) return 'denied'

    const identity = await this.db.externalIdentity.findUnique({
      where: { provider_subject: { provider: 'telegram', subject: senderSubject } },
      select: { userId: true },
    })
    if (identity?.userId !== delivery.userId) return 'denied'
    const membership = await this.db.familyMember.findUnique({
      where: { familyId_userId: { familyId: delivery.familyId, userId: delivery.userId } },
      select: { revokedAt: true, family: { select: { status: true } } },
    })
    if (!membership || membership.revokedAt || membership.family.status !== 'active') return 'denied'

    const fileId = crypto.decrypt<string>({
      ciphertext: delivery.reference.fileIdCiphertext,
      iv: delivery.reference.encryptionIv,
      authTag: delivery.reference.encryptionAuthTag,
    })
    await api.sendVideo(chatId, fileId)
    await this.db.telegramVideoDelivery.updateMany({
      where: { id: delivery.id, deliveredAt: null }, data: { deliveredAt: now },
    })
    return 'delivered'
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function isPointer(value: string) {
  return new RegExp(`^${pointerPrefix}[A-Za-z0-9_-]{32}$`).test(value)
}
