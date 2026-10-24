import { giftPriceSchema, giftTitleSchema, giftUrlSchema, type GiftDto } from '@web-app-demo/contracts'

import { ApiRequestError } from '@/platform/api'

export type GiftViewer = { currentUserId: string; role: 'full' | 'viewer'; isOwner: boolean }

export type GiftActions = {
  canEdit: boolean
  canDelete: boolean
  canReserve: boolean
  canCancelReservation: boolean
  canMarkBought: boolean
  canUnmarkBought: boolean
}

export const isGiftBought = (gift: GiftDto) => Boolean(gift.reservation?.boughtAt)

/** Which buttons a person sees on a card. The server enforces the same rules. */
export function giftActions(gift: GiftDto, viewer: GiftViewer): GiftActions {
  const reservation = gift.reservation
  const bought = isGiftBought(gift)
  const holder = reservation?.userId === viewer.currentUserId
  return {
    canEdit: viewer.role === 'full',
    canDelete: viewer.role === 'full',
    canReserve: !reservation,
    canCancelReservation: Boolean(reservation) && !bought && (holder || viewer.isOwner),
    canMarkBought: Boolean(reservation) && !bought && holder,
    canUnmarkBought: bought && holder,
  }
}

export type ReservationStatus = { kind: 'free' | 'mine' | 'other'; label: string }

export function reservationStatus(gift: GiftDto, currentUserId: string): ReservationStatus {
  if (!gift.reservation) return { kind: 'free', label: 'Свободен' }
  if (gift.reservation.userId === currentUserId) return { kind: 'mine', label: 'Вы забронировали' }
  return { kind: 'other', label: `Забронировал(а) ${gift.reservation.name}` }
}

/** "Тётя · 5 октября" for the collapsed "Подарено" block. */
export function boughtSummary(gift: GiftDto, currentUserId: string, timeZone?: string) {
  const reservation = gift.reservation
  if (!reservation?.boughtAt) return ''
  const who = reservation.userId === currentUserId ? 'Вы' : reservation.name
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone })
    .format(new Date(reservation.boughtAt))
  return `${who} · ${date}`
}

export function reservationConflictMessage(freshGifts: readonly GiftDto[] | undefined, giftId: string) {
  const holder = freshGifts?.find((gift) => gift.id === giftId)?.reservation?.name
  return holder ? `Уже забронировал(а) ${holder}` : 'Подарок уже забронирован или удалён.'
}

/** Open gifts keep the order the server sent; bought ones go to their own block. */
export function splitGifts(gifts: readonly GiftDto[]) {
  const open: GiftDto[] = []
  const bought: GiftDto[] = []
  for (const gift of gifts) (isGiftBought(gift) ? bought : open).push(gift)
  return { open, bought }
}

/** Host name shown under the title, e.g. "shop.example". Empty when the link is unreadable. */
export function shopName(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export type GiftDraft = { url: string; title: string; price: string; hasPhoto: boolean }
export type GiftDraftErrors = { url?: string; title?: string; price?: string }

export const giftUrlErrorText = 'Нужна ссылка на товар, которая начинается с http:// или https://'
export const giftTitleErrorText = 'Название — до 120 символов'
export const giftPriceErrorText = 'Цена — до 30 символов'

/** Parse the two-line title + URL text copied by marketplace share actions. */
export function parseGiftShareClipboard(text: string): { title: string; url: string } | null {
  if (/\p{Cc}/u.test(text.replace(/\r\n|\r|\n/gu, ''))) return null
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length !== 2) return null
  const title = lines[0]?.trim() ?? ''
  const url = lines[1]?.trim() ?? ''
  if (!title || !giftUrlSchema.safeParse(url).success) return null
  if ((text.match(/https?:\/\//giu) ?? []).length !== 1) return null
  return { title, url }
}

/** Required fields stay quiet while empty (the save button is just disabled); wrong values get a text. */
export function validateGiftDraft(draft: GiftDraft): { errors: GiftDraftErrors; canSave: boolean } {
  const errors: GiftDraftErrors = {}
  const url = draft.url.trim()
  const title = draft.title.trim()
  const price = draft.price.trim()
  if (url && !giftUrlSchema.safeParse(url).success) errors.url = giftUrlErrorText
  if (title && !giftTitleSchema.safeParse(title).success) errors.title = giftTitleErrorText
  if (price && !giftPriceSchema.safeParse(price).success) errors.price = giftPriceErrorText
  const canSave = Boolean(url) && Boolean(title) && draft.hasPhoto && Object.keys(errors).length === 0
  return { errors, canSave }
}

export type PhotoCheckCode = 'unsupported_format' | 'too_many' | 'too_small' | 'too_large_photo' | 'too_large_video'

export function photoErrorMessage(code: PhotoCheckCode) {
  if (code === 'too_large_photo') return 'Фото должно быть не больше 20 МБ.'
  if (code === 'too_small') return 'Файл должен быть не меньше 64 байт.'
  return 'Поддерживаются JPG, PNG, WebP, HEIC и HEIF.'
}

export const networkFailureText = 'Не удалось выполнить действие. Проверьте соединение и повторите.'

export function giftFailureMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.code === 'VERSION_CONFLICT') return 'Подарок только что изменили. Список обновлён.'
    if (error.status === 404) return 'Подарок не найден. Список обновлён.'
    if (error.status === 403) return 'Недостаточно прав для этого действия.'
    if (error.status === 409) return 'Состояние подарка изменилось. Список обновлён.'
    if (error.status === 422 && error.message) return error.message
  }
  return networkFailureText
}

/** Failures after which the list on screen is outdated and must be reloaded. */
export function isGiftStateConflict(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 404 || error.status === 409)
}
