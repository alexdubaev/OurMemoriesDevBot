import { GiftFailure } from './errors'

/** The acting member as seen under the family and membership locks. */
export type GiftActor = { userId: string; role: 'full' | 'viewer'; isOwner: boolean }

/** Reservation columns of a gift row locked for update. */
export type GiftReservationState = {
  version: number
  reservedByUserId: string | null
  reservedByName: string | null
  reservedAt: Date | null
  boughtAt: Date | null
}

export type ReservationChange = {
  reservedByUserId: string | null
  reservedAt: Date | null
  boughtAt: Date | null
}

/** `null` means the request is already satisfied and the row stays untouched. */
export type ReservationDecision = ReservationChange | null

export type ReservationAction = 'reserve' | 'cancelReservation' | 'markBought' | 'unmarkBought'

export function assertMayEditGifts(actor: GiftActor) {
  if (actor.role !== 'full') throw new GiftFailure('forbidden', 'Менять список подарков могут только участники с полным доступом')
}

export function decideReservation(
  action: ReservationAction,
  gift: GiftReservationState,
  actor: GiftActor,
  expectedVersion: number,
  now: Date,
): ReservationDecision {
  const holder = gift.reservedByUserId
  const mine = holder === actor.userId
  switch (action) {
    case 'reserve':
      if (mine) return null
      if (holder) throw new GiftFailure('conflict', `Уже забронировал(а) ${gift.reservedByName ?? 'участник семьи'}`)
      assertVersion(gift, expectedVersion)
      return { reservedByUserId: actor.userId, reservedAt: now, boughtAt: null }
    case 'cancelReservation':
      if (!holder) return null
      if (!mine && !actor.isOwner) throw new GiftFailure('forbidden', 'Снять бронь может только тот, кто бронировал, или владелец семьи')
      if (gift.boughtAt) throw new GiftFailure('conflict', 'Подарок уже куплен — сначала снимите отметку «куплено»')
      assertVersion(gift, expectedVersion)
      return { reservedByUserId: null, reservedAt: null, boughtAt: null }
    case 'markBought':
      if (!holder) throw new GiftFailure('conflict', 'Сначала забронируйте подарок')
      if (!mine) throw new GiftFailure('forbidden', 'Отметить покупку может только тот, кто бронировал')
      if (gift.boughtAt) return null
      assertVersion(gift, expectedVersion)
      return { reservedByUserId: holder, reservedAt: gift.reservedAt, boughtAt: now }
    case 'unmarkBought':
      if (!mine) throw new GiftFailure('forbidden', 'Снять отметку может только тот, кто бронировал')
      if (!gift.boughtAt) return null
      assertVersion(gift, expectedVersion)
      return { reservedByUserId: holder, reservedAt: gift.reservedAt, boughtAt: null }
  }
}

function assertVersion(gift: GiftReservationState, expectedVersion: number) {
  if (gift.version !== expectedVersion) throw new GiftFailure('version_conflict', 'Подарок изменён другим участником')
}
