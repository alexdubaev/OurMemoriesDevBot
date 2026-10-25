import { EventEmitter } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, test } from 'bun:test'
import { createGiftMetadataProvider, createSecureMetadataReader, isPublicIp, isSupportedRasterHeader, parseProductHtml, parseYandexProductHtml, recognizeGiftShop, selectBasketHost } from './gift-metadata'

describe('gift metadata reader boundaries', () => {
  test('recognizes only the two exact HTTPS shop host families', () => {
    expect(recognizeGiftShop('https://www.wildberries.ru/catalog/859795006/detail.aspx')?.shop).toBe('wildberries')
    expect(recognizeGiftShop('https://ozon.ru/t/abc123')?.shop).toBe('ozon')
    expect(recognizeGiftShop('https://market.yandex.ru/cc/BNpQaH')?.shop).toBe('yandex')
    for (const url of [
      'http://www.wildberries.ru/catalog/859795006',
      'https://wildberries.ru.attacker.example/catalog/859795006',
      'https://user@ozon.ru/product/a-4911519644',
      'https://ozon.ru:444/product/a-4911519644',
      'https://yandex.ru/cc/BNpQaH',
      'https://market.yandex.ru.attacker.example/cc/BNpQaH',
    ]) expect(recognizeGiftShop(url)).toBeNull()
  })

  test('stops off-host redirects before making a second request and pins the actual request lookup', async () => {
    const requests = fakeHttpsRequests([
      { status: 302, headers: { location: 'https://outside.example/collect' } },
    ])
    const reader = createSecureMetadataReader({
      resolveAll: async () => [{ address: '8.8.8.8', family: 4 }],
      request: requests.factory,
    })
    await expect(reader('https://ozon.ru/t/short', new Set(['ozon.ru', 'www.ozon.ru']), 1024, Date.now() + 1000)).rejects.toThrow('Redirect outside allowlist')
    expect(requests.calls).toHaveLength(1)
    expect(requests.pinnedLookups).toEqual([{ address: '8.8.8.8', family: 4 }])
    expect(requests.requestOptions).toMatchObject({
      servername: 'ozon.ru', family: 4, autoSelectFamily: false, agent: false,
    })
    expect(requests.requestOptions).not.toHaveProperty('rejectUnauthorized', false)
  })

  test('rejects private DNS answers without opening a request', async () => {
    const requests = fakeHttpsRequests([{ status: 200, body: 'unused' }])
    const reader = createSecureMetadataReader({
      resolveAll: async () => [{ address: '10.2.3.4', family: 4 }],
      request: requests.factory,
    })
    await expect(reader('https://ozon.ru/item', new Set(['ozon.ru']), 1024, Date.now() + 1000)).rejects.toThrow('DNS resolved to non-public address')
    expect(requests.calls).toHaveLength(0)
  })

  test('enforces streaming byte, compression and truncated-response limits', async () => {
    for (const response of [
      { status: 200, body: '12345' },
      { status: 200, headers: { 'content-encoding': 'gzip' }, body: 'compressed' },
      { status: 200, body: 'truncated', aborted: true },
    ]) {
      const requests = fakeHttpsRequests([response])
      const reader = createSecureMetadataReader({
        resolveAll: async () => [{ address: '8.8.8.8', family: 4 }],
        request: requests.factory,
      })
      await expect(reader('https://ozon.ru/item', new Set(['ozon.ru']), 4, Date.now() + 1000)).rejects.toThrow()
      expect(requests.calls).toHaveLength(1)
    }
  })

  test('times out a slow DNS lookup before opening a request', async () => {
    const requests = fakeHttpsRequests([{ status: 200, body: 'unused' }])
    const reader = createSecureMetadataReader({
      resolveAll: () => new Promise(() => {}),
      request: requests.factory,
    })
    const started = Date.now()
    await expect(reader('https://ozon.ru/item', new Set(['ozon.ru']), 1024, started + 20)).rejects.toThrow('Metadata request timed out')
    expect(Date.now() - started).toBeLessThan(250)
    expect(requests.calls).toHaveLength(0)
  })

  test('follows a bounded Ozon short link and parses the resolved product SKU', async () => {
    const finalUrl = 'https://www.ozon.ru/product/item-4911519644/'
    const jsonLd = { '@type': 'Product', sku: '4911519644', name: 'Точный товар', offers: { price: 493, priceCurrency: 'RUB' } }
    const requests = fakeHttpsRequests([
      { status: 302, headers: { location: finalUrl } },
      { status: 200, headers: { 'content-type': 'text/html' }, body: `<link rel="canonical" href="${finalUrl}"><script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` },
    ])
    const provider = createGiftMetadataProvider({
      resolveAll: async () => [{ address: '8.8.8.8', family: 4 }],
      request: requests.factory,
    })
    await expect(provider.resolve('https://ozon.ru/t/BS7WuOt')).resolves.toMatchObject({
      status: 'partial', title: 'Точный товар', price: '493 ₽', photo: null,
    })
    expect(requests.calls).toEqual(['https://ozon.ru/t/BS7WuOt', finalUrl])
  })

  test('follows a Yandex short link and selects only a Product Offer matching the resolved card ID', async () => {
    const finalUrl = 'https://market.yandex.ru/card/roskoshnaya-model-avtomobilya/5065536273'
    const product = {
      '@graph': [
        { '@type': 'Product', sku: '1111111111', name: 'Рекомендация', offers: { '@type': 'Offer', url: 'https://market.yandex.ru/card/other/1111111111', price: 99, priceCurrency: 'RUB' } },
        { '@type': 'Product', sku: '5947182657', name: 'Роскошная модель автомобиля', image: 'https://avatars.mds.yandex.net/get-mpic/123/photo/orig', offers: { '@type': 'Offer', url: finalUrl, price: 1351, priceCurrency: 'RUB' } },
      ],
    }
    const requests = fakeHttpsRequests([
      { status: 302, headers: { location: finalUrl } },
      { status: 200, headers: { 'content-type': 'text/html' }, body: `<link rel="canonical" href="${finalUrl}"><script type="application/ld+json">${JSON.stringify(product)}</script>` },
      { status: 200, headers: { 'content-type': 'image/jpeg' }, body: 'invalid image bytes' },
    ])
    const provider = createGiftMetadataProvider({
      resolveAll: async () => [{ address: '8.8.8.8', family: 4 }],
      request: requests.factory,
    })
    await expect(provider.resolve('https://market.yandex.ru/cc/BNpQaH')).resolves.toMatchObject({
      status: 'partial', title: 'Роскошная модель автомобиля', price: '1351 ₽', photo: null,
    })
    expect(requests.calls).toEqual(['https://market.yandex.ru/cc/BNpQaH', finalUrl, 'https://avatars.mds.yandex.net/get-mpic/123/photo/orig'])
  })

  test('rejects Yandex recommendation identity mismatches and captcha pages without using generic metadata', async () => {
    const finalUrl = new URL('https://market.yandex.ru/card/item/5065536273')
    const mismatched = { '@type': 'Product', sku: '5947182657', name: 'Recommendation', offers: { '@type': 'Offer', url: 'https://market.yandex.ru/card/item/9999999999', price: 5, priceCurrency: 'RUB' } }
    expect(parseYandexProductHtml(`<meta property="og:title" content="Generic"><script type="application/ld+json">${JSON.stringify(mismatched)}</script>`, finalUrl)).toBeNull()
    expect(parseYandexProductHtml('<meta property="og:title" content="Captcha product"><meta property="og:image" content="https://avatars.mds.yandex.net/get-mpic/captcha"><p>showcaptcha challenge</p>', new URL('https://market.yandex.ru/showcaptcha'))).toBeNull()

    const requests = fakeHttpsRequests([
      { status: 302, headers: { location: 'https://market.yandex.ru/showcaptcha' } },
      { status: 200, headers: { 'content-type': 'text/html' }, body: '<meta property="og:title" content="Captcha product"><meta property="og:image" content="https://avatars.mds.yandex.net/get-mpic/captcha"><p>captcha challenge</p>' },
    ])
    const provider = createGiftMetadataProvider({
      resolveAll: async () => [{ address: '8.8.8.8', family: 4 }],
      request: requests.factory,
    })
    await expect(provider.resolve('https://market.yandex.ru/cc/BNpQaH')).resolves.toMatchObject({ status: 'unavailable' })
    expect(requests.calls).toEqual(['https://market.yandex.ru/cc/BNpQaH', 'https://market.yandex.ru/showcaptcha'])
  })

  test('parses a matching Yandex Product near the end of a legitimate page over 1 MB', () => {
    const requested = new URL('https://market.yandex.ru/card/item/5065536273')
    const product = { '@type': 'Product', sku: '5947182657', name: 'Точный товар', offers: {
      '@type': 'Offer', url: requested.href, price: 1351, priceCurrency: 'RUB',
    } }
    const html = `<html><body>${'x'.repeat(1_050_000)}<script type="application/ld+json">${JSON.stringify(product)}</script></body></html>`
    expect(html.length).toBeGreaterThan(1_000_000)
    expect(parseYandexProductHtml(html, requested)).toMatchObject({ title: 'Точный товар', price: '1351 ₽' })
  })

  test('truncates long exact product titles while preserving their price and image metadata', () => {
    const longTitle = 'Подарочный набор '.repeat(12)
    const ozonUrl = new URL('https://www.ozon.ru/product/item-4911519644/')
    const yandexUrl = new URL('https://market.yandex.ru/card/item/5065536273')
    const cases = [
      {
        parse: () => parseProductHtml(`<script type="application/ld+json">${JSON.stringify({
          '@type': 'Product', sku: '4911519644', name: longTitle, image: 'https://ir.ozone.ru/s3/item.jpg',
          offers: { price: 493, priceCurrency: 'RUB' },
        })}</script>`, ozonUrl),
        price: '493 ₽', image: 'https://ir.ozone.ru/s3/item.jpg',
      },
      {
        parse: () => parseYandexProductHtml(`<script type="application/ld+json">${JSON.stringify({
          '@type': 'Product', sku: '5947182657', name: longTitle, image: 'https://avatars.mds.yandex.net/get-mpic/item/orig',
          offers: { '@type': 'Offer', url: yandexUrl.href, price: 1351, priceCurrency: 'RUB' },
        })}</script>`, yandexUrl),
        price: '1351 ₽', image: 'https://avatars.mds.yandex.net/get-mpic/item/orig',
      },
    ]
    for (const entry of cases) {
      const result = entry.parse()
      expect(result?.title).toHaveLength(120)
      expect(result).toMatchObject({ price: entry.price, image: entry.image })
    }
  })

  test('filters HTML and SVG payloads before the image decoder', () => {
    expect(isSupportedRasterHeader(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(false)
    expect(isSupportedRasterHeader(Buffer.from('<!doctype html><title>challenge</title>'))).toBe(false)
    expect(isSupportedRasterHeader(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true)
  })

  test('rejects reserved DNS answers and accepts global addresses', () => {
    for (const ip of ['0.0.0.0', '10.2.3.4', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1',
      '192.0.0.1', '192.0.2.8', '192.88.99.1', '192.168.1.1', '198.18.0.1', '198.51.100.1',
      '203.0.113.8', '224.0.0.1', '::1', '::ffff:8.8.8.8', 'fc00::1', 'fe80::1', '2001:db8::1', '2002::1', '3fff::1']) {
      expect(isPublicIp(ip), ip).toBe(false)
    }
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true)
  })

  test('uses only the published origin range map and ignores recommend mod groups', () => {
    const routing = {
      origin: { mediabasket_route_map: [{ method: 'range', hosts: [
        { vol_range_from: 8590, vol_range_to: 8599, host: 'basket-38.wbbasket.ru' },
      ] }] },
      recommend: { mediabasket_route_map: [{ method: 'mod', hosts: [
        { vol_range_from: 0, vol_range_to: 99999, host: 'attacker.example' },
      ] }] },
    }
    expect(selectBasketHost(routing, 8597)?.host).toBe('basket-38.wbbasket.ru')
    expect(selectBasketHost(routing, 8600)).toBeNull()
  })

  test('uses matching Product JSON-LD identity and ignores recommended products and generic Open Graph', () => {
    const requested = new URL('https://www.ozon.ru/product/lego-4911519644/')
    expect(recognizeGiftShop('https://ozon.ru/t/1fK3Juz')?.shop).toBe('ozon')
    const product = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Product', sku: '4911519000', name: 'Рекомендация' },
        { '@type': 'Product', sku: '4911519644', name: 'Набор деталей',
          image: 'https://ir.ozone.ru/s3/multimedia-1-b/c600/13877255819.jpg',
          offers: { price: 493, priceCurrency: 'RUB' } },
      ],
    }
    const html = `<link rel="canonical" href="${requested.href}"><meta property="og:title" content="Магазин">
      <script type="application/ld+json">${JSON.stringify(product)}</script>`
    expect(parseProductHtml(html, requested)).toMatchObject({
      title: 'Набор деталей', price: '493 ₽', image: 'https://ir.ozone.ru/s3/multimedia-1-b/c600/13877255819.jpg',
    })
    expect(parseProductHtml('<meta property="og:title" content="Чужой товар">', requested)).toBeNull()
    const wrongProduct = { '@type': 'Product', sku: '4911519000', name: 'Не тот товар' }
    expect(parseProductHtml(`<script type="application/ld+json">${JSON.stringify(wrongProduct)}</script>`, requested)).toBeNull()
    const aggregateOffer = { '@type': 'Product', sku: '4911519644', name: 'Набор',
      offers: { '@type': 'AggregateOffer', lowPrice: 400, priceCurrency: 'RUB' } }
    expect(parseProductHtml(`<script type="application/ld+json">${JSON.stringify(aggregateOffer)}</script>`, requested)?.price).toBeNull()
  })
})

type FakeResponse = {
  status: number
  headers?: Record<string, string>
  body?: string
  aborted?: boolean
}

function fakeHttpsRequests(responses: FakeResponse[]) {
  const calls: string[] = []
  const pinnedLookups: Array<{ address: string; family: number }> = []
  let requestOptions: Record<string, unknown> = {}
  let index = 0
  const factory = ((input: string | URL, options: Parameters<typeof import('node:https').request>[1], callback: (response: IncomingMessage) => void) => {
    requestOptions = options as unknown as Record<string, unknown>
    const url = new URL(input.toString())
    calls.push(url.toString())
    const fake = Object.assign(new EventEmitter(), {
      end() {
        const opts = options as unknown as {
          lookup: (hostname: string, opts: { all?: boolean }, callback: (error: Error | null, addresses: unknown, family?: number) => void) => void
        }
        opts.lookup(url.hostname, { all: true }, (error, addresses, family) => {
          if (error) throw error
          const address = Array.isArray(addresses) ? addresses[0] as { address: string; family: number } : { address: String(addresses), family: family ?? 0 }
          pinnedLookups.push(address)
        })
        const definition = responses[index++]
        const response = new Readable({ read() {} }) as Readable & { statusCode?: number; headers: Record<string, string> }
        response.statusCode = definition.status
        response.headers = definition.headers ?? {}
        callback(response as unknown as IncomingMessage)
        if ([301, 302, 303, 307, 308].includes(definition.status)) return
        if (definition.aborted) {
          queueMicrotask(() => response.emit('aborted'))
          return
        }
        if (definition.body !== undefined) response.push(Buffer.from(definition.body))
        response.push(null)
      },
      destroy() { return this },
    })
    return fake as unknown as ClientRequest
  }) as typeof import('node:https').request
  return { calls, pinnedLookups, get requestOptions() { return requestOptions }, factory }
}
