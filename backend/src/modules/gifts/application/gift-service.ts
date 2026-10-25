import { createHash } from 'node:crypto'
import {
  MAX_ACTIVE_GIFTS,
  createGiftRequestSchema,
  updateGiftRequestSchema,
  type CreateGiftRequest,
  type GiftDto,
  type GiftListResponse,
  type UpdateGiftRequest,
} from '@web-app-demo/contracts'
import type { FamilyAccess, FamilyScope } from '../../families'
import { decideReservation, type ReservationAction } from '../domain/gift-rules'
import type { GiftMetadataProvider, GiftRepository } from './ports'

export class GiftService {
  constructor(
    private readonly access: FamilyAccess,
    private readonly repository: GiftRepository,
    private readonly metadataProvider: GiftMetadataProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(scope: FamilyScope): Promise<GiftListResponse> {
    await this.access.requireMember(scope)
    return { gifts: await this.repository.list(scope) }
  }

  async metadata(scope: FamilyScope, url: string) {
    await this.access.requireFull(scope)
    return this.metadataProvider.resolve(url)
  }

  async create(scope: FamilyScope, input: CreateGiftRequest, key: string) {
    await this.access.requireFull(scope)
    const normalized = createGiftRequestSchema.parse(input)
    const payloadHash = createHash('sha256')
      .update(JSON.stringify({
        title: normalized.title,
        url: normalized.url,
        price: normalized.price ?? null,
        photoMediaId: normalized.photoMediaId,
      }))
      .digest('hex')
    return this.repository.create(scope, normalized, { key: key.toLowerCase(), payloadHash, now: this.now() }, MAX_ACTIVE_GIFTS)
  }

  async update(scope: FamilyScope, giftId: string, input: UpdateGiftRequest): Promise<GiftDto> {
    await this.access.requireFull(scope)
    return this.repository.update(scope, giftId, updateGiftRequestSchema.parse(input), this.now())
  }

  async remove(scope: FamilyScope, giftId: string, expectedVersion: number): Promise<void> {
    await this.access.requireFull(scope)
    await this.repository.remove(scope, giftId, expectedVersion, this.now())
  }

  reserve(scope: FamilyScope, giftId: string, expectedVersion: number) {
    return this.changeReservation('reserve', scope, giftId, expectedVersion)
  }

  cancelReservation(scope: FamilyScope, giftId: string, expectedVersion: number) {
    return this.changeReservation('cancelReservation', scope, giftId, expectedVersion)
  }

  markBought(scope: FamilyScope, giftId: string, expectedVersion: number) {
    return this.changeReservation('markBought', scope, giftId, expectedVersion)
  }

  unmarkBought(scope: FamilyScope, giftId: string, expectedVersion: number) {
    return this.changeReservation('unmarkBought', scope, giftId, expectedVersion)
  }

  private async changeReservation(
    action: ReservationAction,
    scope: FamilyScope,
    giftId: string,
    expectedVersion: number,
  ): Promise<GiftDto> {
    await this.access.requireMember(scope)
    const now = this.now()
    return this.repository.changeReservation(scope, giftId, (gift, actor) =>
      decideReservation(action, gift, actor, expectedVersion, now))
  }
}
