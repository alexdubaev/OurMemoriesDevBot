import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  MAX_ACTIVE_GIFTS,
  createGiftRequestSchema,
  giftDtoSchema,
  giftListResponseSchema,
  giftMetadataRequestSchema,
  giftMetadataResponseSchema,
  giftPriceSchema,
  giftTitleSchema,
  giftUrlSchema,
  giftVersionRequestSchema,
  mediaPurposeSchema,
  reserveMediaUploadRequestSchema,
  updateGiftRequestSchema,
} from './index'

const photoMediaId = randomUUID()
const valid = { title: 'Конструктор', url: 'https://shop.example/item/1', photoMediaId }

describe('gift contracts', () => {
  test('metadata request and bounded response have strict shapes', () => {
    expect(giftMetadataRequestSchema.parse({ url: 'https://www.ozon.ru/product/a-123' })).toEqual({ url: 'https://www.ozon.ru/product/a-123' })
    expect(giftMetadataRequestSchema.safeParse({ url: 'https://shop.example/a', title: 'inject' }).success).toBe(false)
    expect(giftMetadataResponseSchema.safeParse({ status: 'partial', title: 'Подарок', price: null, photo: null }).success).toBe(true)
    expect(giftMetadataResponseSchema.safeParse({ status: 'ready', title: null, price: null, photo: null }).success).toBe(false)
    expect(giftMetadataResponseSchema.safeParse({ status: 'unknown', title: null, price: null, photo: null }).success).toBe(false)
    expect(giftMetadataResponseSchema.safeParse({ status: 'ready', title: null, price: null, photo: { contentType: 'image/png', dataBase64: 'AA==' } }).success).toBe(false)
  })
  test('accepts http and https shop links', () => {
    expect(giftUrlSchema.parse('https://shop.example/item?id=1')).toBe('https://shop.example/item?id=1')
    expect(giftUrlSchema.parse('http://shop.example/')).toBe('http://shop.example/')
  })

  test('rejects links that are not http or https', () => {
    for (const url of ['javascript:alert(1)', 'ftp://shop.example/a', 'data:text/html,hi', 'shop.example/item', '', 'mailto:a@b.example'])
      expect(giftUrlSchema.safeParse(url).success).toBe(false)
  })

  test('rejects links with a login or password', () => {
    expect(giftUrlSchema.safeParse('https://user:secret@shop.example/item').success).toBe(false)
    expect(giftUrlSchema.safeParse('https://user@shop.example/item').success).toBe(false)
  })

  test('rejects links longer than 2048 characters', () => {
    expect(giftUrlSchema.safeParse(`https://shop.example/${'a'.repeat(2048)}`).success).toBe(false)
  })

  test('title is trimmed and limited to 1..120 characters', () => {
    expect(giftTitleSchema.parse('  Мяч  ')).toBe('Мяч')
    expect(giftTitleSchema.safeParse('').success).toBe(false)
    expect(giftTitleSchema.safeParse('   ').success).toBe(false)
    expect(giftTitleSchema.safeParse('я'.repeat(120)).success).toBe(true)
    expect(giftTitleSchema.safeParse('я'.repeat(121)).success).toBe(false)
  })

  test('price is free text up to 30 characters', () => {
    expect(giftPriceSchema.parse(' 2 500 ₽ ')).toBe('2 500 ₽')
    expect(giftPriceSchema.safeParse('1'.repeat(30)).success).toBe(true)
    expect(giftPriceSchema.safeParse('1'.repeat(31)).success).toBe(false)
    expect(giftPriceSchema.safeParse('').success).toBe(false)
  })

  test('create requires title, url and photo; price is optional', () => {
    expect(createGiftRequestSchema.safeParse(valid).success).toBe(true)
    expect(createGiftRequestSchema.safeParse({ ...valid, price: 'около 3000' }).success).toBe(true)
    for (const key of ['title', 'url', 'photoMediaId'] as const) {
      const { [key]: _omitted, ...rest } = valid
      expect(createGiftRequestSchema.safeParse(rest).success).toBe(false)
    }
    expect(createGiftRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
  })

  test('update requires expectedVersion and allows clearing the price', () => {
    expect(updateGiftRequestSchema.safeParse({ expectedVersion: 1, price: null }).success).toBe(true)
    expect(updateGiftRequestSchema.safeParse({ title: 'x' }).success).toBe(false)
    expect(updateGiftRequestSchema.safeParse({ expectedVersion: 1, url: 'javascript:1' }).success).toBe(false)
    expect(giftVersionRequestSchema.safeParse({ expectedVersion: 0 }).success).toBe(false)
  })

  test('gift DTO and list accept the documented shape', () => {
    const now = new Date().toISOString()
    const gift = {
      id: randomUUID(), childId: randomUUID(), title: 'Мяч', url: 'https://shop.example/', price: null,
      photoMediaId, createdBy: { userId: randomUUID(), name: 'Мама' },
      reservation: { userId: randomUUID(), name: 'Бабушка', reservedAt: now, boughtAt: null },
      version: 1, createdAt: now, updatedAt: now,
    }
    expect(giftDtoSchema.parse(gift)).toEqual(gift)
    expect(giftListResponseSchema.safeParse({ gifts: [gift, { ...gift, reservation: null }] }).success).toBe(true)
  })

  test('media purpose accepts gift photos only', () => {
    expect(MAX_ACTIVE_GIFTS).toBe(200)
    expect(mediaPurposeSchema.parse('gift')).toBe('gift')
    expect(reserveMediaUploadRequestSchema.safeParse({ purpose: 'gift', kind: 'photo', contentType: 'image/png', byteSize: 1024 }).success).toBe(true)
    expect(reserveMediaUploadRequestSchema.safeParse({ purpose: 'gift', kind: 'video', contentType: 'video/mp4', byteSize: 1024 }).success).toBe(false)
  })
})
