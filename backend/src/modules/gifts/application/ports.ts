import type { CreateGiftRequest, GiftDto, UpdateGiftRequest } from '@web-app-demo/contracts'
import type { FamilyScope } from '../../families'
import type { GiftActor, GiftReservationState, ReservationDecision } from '../domain/gift-rules'

export type GiftIdempotency = { key: string; payloadHash: string; now: Date }

export interface GiftRepository {
  /** Gifts of the family's first child: unbought by createdAt desc, then bought by boughtAt desc. */
  list(scope: FamilyScope): Promise<GiftDto[]>
  create(
    scope: FamilyScope,
    input: CreateGiftRequest,
    idempotency: GiftIdempotency,
    maxActiveGifts: number,
  ): Promise<{ gift: GiftDto; replayed: boolean }>
  update(scope: FamilyScope, giftId: string, input: UpdateGiftRequest, now: Date): Promise<GiftDto>
  remove(scope: FamilyScope, giftId: string, expectedVersion: number, now: Date): Promise<void>
  /** Locks the scope and the gift, asks `decide` for the change and applies it in one transaction. */
  changeReservation(
    scope: FamilyScope,
    giftId: string,
    decide: (gift: GiftReservationState, actor: GiftActor) => ReservationDecision,
  ): Promise<GiftDto>
}
