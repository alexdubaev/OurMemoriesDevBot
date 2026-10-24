import { describe, expect, it } from 'bun:test'
import type { GiftDto } from '@web-app-demo/contracts'

import { ApiRequestError } from '../src/platform/api'
import {
  boughtSummary,
  giftActions,
  giftFailureMessage,
  photoErrorMessage,
  parseGiftShareClipboard,
  reservationConflictMessage,
  reservationStatus,
  shopName,
  splitGifts,
  validateGiftDraft,
} from '../src/features/gifts/model'

const me = '00000000-0000-4000-8000-000000000001'
const aunt = '00000000-0000-4000-8000-000000000002'

function gift(overrides: Partial<GiftDto> = {}): GiftDto {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    childId: '20000000-0000-4000-8000-000000000001',
    title: 'Синтетический конструктор',
    url: 'https://shop.example.test/item/1',
    price: null,
    photoMediaId: '30000000-0000-4000-8000-000000000001',
    createdBy: { userId: me, name: 'Родитель' },
    reservation: null,
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}
const reservedBy = (userId: string, name: string, boughtAt: string | null = null) => ({
  userId, name, reservedAt: '2026-10-02T10:00:00.000Z', boughtAt,
})

describe('giftActions', () => {
  const guest = { currentUserId: aunt, role: 'viewer' as const, isOwner: false }

  it('lets a viewer reserve a free gift but never edit or delete', () => {
    expect(giftActions(gift(), guest)).toEqual({
      canEdit: false, canDelete: false, canReserve: true, canCancelReservation: false, canMarkBought: false, canUnmarkBought: false,
    })
  })

  it('lets a full member edit and delete', () => {
    const actions = giftActions(gift(), { currentUserId: me, role: 'full', isOwner: false })
    expect(actions.canEdit).toBe(true)
    expect(actions.canDelete).toBe(true)
  })

  it('offers cancel and bought only to the person who reserved', () => {
    const reserved = gift({ reservation: reservedBy(aunt, 'Тётя') })
    expect(giftActions(reserved, guest)).toMatchObject({ canReserve: false, canCancelReservation: true, canMarkBought: true })
    const other = giftActions(reserved, { currentUserId: me, role: 'full', isOwner: false })
    expect(other).toMatchObject({ canReserve: false, canCancelReservation: false, canMarkBought: false })
  })

  it('lets the owner release someone else reservation but not mark it bought', () => {
    const reserved = gift({ reservation: reservedBy(aunt, 'Тётя') })
    expect(giftActions(reserved, { currentUserId: me, role: 'full', isOwner: true }))
      .toMatchObject({ canCancelReservation: true, canMarkBought: false })
  })

  it('blocks reservation changes once bought and lets only the buyer undo the mark', () => {
    const bought = gift({ reservation: reservedBy(aunt, 'Тётя', '2026-10-05T10:00:00.000Z') })
    expect(giftActions(bought, guest)).toMatchObject({
      canReserve: false, canCancelReservation: false, canMarkBought: false, canUnmarkBought: true,
    })
    expect(giftActions(bought, { currentUserId: me, role: 'full', isOwner: true }))
      .toMatchObject({ canCancelReservation: false, canUnmarkBought: false })
  })
})

describe('reservation labels', () => {
  it('names who holds the gift', () => {
    expect(reservationStatus(gift(), me)).toEqual({ kind: 'free', label: 'Свободен' })
    expect(reservationStatus(gift({ reservation: reservedBy(me, 'Я') }), me)).toEqual({ kind: 'mine', label: 'Вы забронировали' })
    expect(reservationStatus(gift({ reservation: reservedBy(aunt, 'Тётя') }), me)).toEqual({ kind: 'other', label: 'Забронировал(а) Тётя' })
  })

  it('summarises a bought gift with the buyer and the date', () => {
    const bought = (userId: string, name: string) => gift({ reservation: reservedBy(userId, name, '2026-10-05T10:00:00.000Z') })
    expect(boughtSummary(bought(aunt, 'Тётя'), me, 'UTC')).toBe('Тётя · 5 октября')
    expect(boughtSummary(bought(me, 'Я'), me, 'UTC')).toBe('Вы · 5 октября')
  })

  it('explains a lost reservation race with the winner name from the fresh list', () => {
    const fresh = [gift({ reservation: reservedBy(aunt, 'Тётя') })]
    expect(reservationConflictMessage(fresh, fresh[0]!.id)).toBe('Уже забронировал(а) Тётя')
    expect(reservationConflictMessage([], fresh[0]!.id)).toBe('Подарок уже забронирован или удалён.')
  })
})

describe('splitGifts', () => {
  it('moves bought gifts into their own group and keeps server order', () => {
    const a = gift({ id: '10000000-0000-4000-8000-00000000000a' })
    const b = gift({ id: '10000000-0000-4000-8000-00000000000b', reservation: reservedBy(aunt, 'Тётя', '2026-10-05T10:00:00.000Z') })
    const c = gift({ id: '10000000-0000-4000-8000-00000000000c', reservation: reservedBy(aunt, 'Тётя') })
    const { open, bought } = splitGifts([a, c, b])
    expect(open.map((item) => item.id)).toEqual([a.id, c.id])
    expect(bought.map((item) => item.id)).toEqual([b.id])
  })
})

describe('shopName', () => {
  it('shows the host without www and falls back to nothing for junk', () => {
    expect(shopName('https://www.shop.example.test/item?id=1')).toBe('shop.example.test')
    expect(shopName('http://market.example.test')).toBe('market.example.test')
    expect(shopName('not a link')).toBe('')
  })

  it('uses friendly names for supported marketplaces', () => {
    const shops = [
      ['https://www.ozon.ru/product/item', 'Ozon'],
      ['https://www.wildberries.ru/catalog/123/detail.aspx', 'Wildberries'],
      ['https://market.yandex.ru/cc/BNpQaH', 'Яндекс Маркет'],
    ] as const
    for (const [url, name] of shops) expect(shopName(url)).toBe(name)
  })
})

describe('validateGiftDraft', () => {
  const valid = { url: 'https://shop.example.test/item', title: '', price: '' }

  it('allows saving with a valid link and blank optional fields', () => {
    expect(validateGiftDraft(valid)).toEqual({ errors: {}, canSave: true })
    expect(validateGiftDraft({ ...valid, url: '' }).canSave).toBe(false)
    expect(validateGiftDraft({ ...valid, title: '   ', price: '   ' }).canSave).toBe(true)
  })

  it('stays quiet about empty required fields but names the problem for a bad value', () => {
    expect(validateGiftDraft({ ...valid, url: '' }).errors).toEqual({})
    expect(validateGiftDraft({ ...valid, url: 'ozon.ru/item' })).toEqual({
      errors: { url: 'Нужна ссылка на товар, которая начинается с http:// или https://' }, canSave: false,
    })
    expect(validateGiftDraft({ ...valid, url: 'javascript:alert(1)' }).errors.url).toBeDefined()
    expect(validateGiftDraft({ ...valid, url: 'https://a:b@shop.example.test/' }).errors.url).toBeDefined()
    expect(validateGiftDraft({ ...valid, title: 'я'.repeat(121) })).toEqual({
      errors: { title: 'Название — до 120 символов' }, canSave: false,
    })
    expect(validateGiftDraft({ ...valid, title: 'я'.repeat(120) }).canSave).toBe(true)
    expect(validateGiftDraft({ ...valid, price: '1'.repeat(31) }).errors.price).toBe('Цена — до 30 символов')
    expect(validateGiftDraft({ ...valid, price: '2 500 ₽' }).canSave).toBe(true)
  })
})

describe('parseGiftShareClipboard', () => {
  const clipboard = 'Magno World Магнитный конструктор робот трансформер спецтехника\nhttps://www.wildberries.ru/catalog/859795006/detail.aspx?size=1294253169'

  it('extracts the title and complete URL from the marketplace share text', () => {
    expect(parseGiftShareClipboard(clipboard)).toEqual({
      title: 'Magno World Магнитный конструктор робот трансформер спецтехника',
      url: 'https://www.wildberries.ru/catalog/859795006/detail.aspx?size=1294253169',
    })
  })

  it('accepts CRLF, but rejects ambiguity, malformed URLs, controls and credentials', () => {
    expect(parseGiftShareClipboard(clipboard.replace('\n', '\r\n'))?.url).toBe('https://www.wildberries.ru/catalog/859795006/detail.aspx?size=1294253169')
    expect(parseGiftShareClipboard(`Title https://a.example\nhttps://b.example`)).toBeNull()
    expect(parseGiftShareClipboard('Title\nhttps://shop.example/item trailing')).toBeNull()
    expect(parseGiftShareClipboard('Title\nhttps://user@shop.example/item')).toBeNull()
    expect(parseGiftShareClipboard('Title\nhttps://shop.example/item\u0001')).toBeNull()
  })

  it('leaves an overlong product title for the existing title validation to explain', () => {
    const title = 'Товар '.repeat(21)
    expect(parseGiftShareClipboard(`${title}\nhttps://shop.example/item`)).toEqual({ title: title.trim(), url: 'https://shop.example/item' })
  })
})

describe('error texts', () => {
  it('maps photo checks to the existing composer wording', () => {
    expect(photoErrorMessage('too_large_photo')).toBe('Фото должно быть не больше 20 МБ.')
    expect(photoErrorMessage('too_small')).toBe('Файл должен быть не меньше 64 байт.')
    expect(photoErrorMessage('unsupported_format')).toBe('Поддерживаются JPG, PNG, WebP, HEIC и HEIF.')
  })

  it('turns API failures into short Russian messages', () => {
    expect(giftFailureMessage(new ApiRequestError(409, 'VERSION_CONFLICT', 'x'))).toBe('Подарок только что изменили. Список обновлён.')
    expect(giftFailureMessage(new ApiRequestError(404, 'NOT_FOUND', 'x'))).toBe('Подарок не найден. Список обновлён.')
    expect(giftFailureMessage(new ApiRequestError(403, 'ROLE_FORBIDDEN', 'x'))).toBe('Недостаточно прав для этого действия.')
    expect(giftFailureMessage(new ApiRequestError(422, 'INVALID_INPUT', 'В списке уже 200 подарков — удалите ненужные'))).toBe('В списке уже 200 подарков — удалите ненужные')
    expect(giftFailureMessage(new TypeError('Failed to fetch'))).toBe('Не удалось выполнить действие. Проверьте соединение и повторите.')
  })
})
