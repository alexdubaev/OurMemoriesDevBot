import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpsRequest } from 'node:https'
import { Parser } from 'htmlparser2'
import sharp from 'sharp'
import type { GiftMetadataResponse } from '@web-app-demo/contracts'
import type { GiftMetadataProvider } from '../application/ports'

const TOTAL_TIMEOUT_MS = 8_000
const MAX_HTML_BYTES = 2_000_000
const MAX_IMAGE_BYTES = 5_000_000
const MAX_IMAGE_OUTPUT_BYTES = 512 * 1024
const MAX_PIXELS = 40_000_000
const REDIRECTS = 3

type Shop = 'wildberries' | 'ozon' | 'yandex'
type RoutingEntry = { vol_range_from: number; vol_range_to: number; host: string }
type RoutingMap = {
  origin?: { mediabasket_route_map?: Array<{ method?: string; hosts?: RoutingEntry[] }> }
  recommend?: { mediabasket_route_map?: Array<{ method?: string; hosts?: RoutingEntry[] }> }
}
type ProductMetadata = { title: string | null; price: string | null; image: string | null; imageHosts?: string[] }
export type MetadataReaderDependencies = Readonly<{
  resolveAll?: (hostname: string) => Promise<Array<{ address: string; family: number }>>
  request?: typeof httpsRequest
}>
type MetadataReader = ReturnType<typeof createSecureMetadataReader>

const unsupported = (): GiftMetadataResponse => ({ status: 'unsupported', title: null, price: null, photo: null })
const unavailable = (): GiftMetadataResponse => ({ status: 'unavailable', title: null, price: null, photo: null })

export function createGiftMetadataProvider(dependencies: MetadataReaderDependencies = {}): GiftMetadataProvider {
  const reader = createSecureMetadataReader(dependencies)
  return { resolve: (url) => resolveGiftMetadata(url, reader) }
}

/** Only exact, recognized shop hosts reach the network client. */
export function recognizeGiftShop(urlValue: string): { shop: Shop; url: URL } | null {
  let url: URL
  try { url = new URL(urlValue) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'wildberries.ru' || host === 'www.wildberries.ru') return { shop: 'wildberries', url }
  if (host === 'ozon.ru' || host === 'www.ozon.ru') return { shop: 'ozon', url }
  if (host === 'market.yandex.ru') return { shop: 'yandex', url }
  return null
}

export function isAllowedMetadataUrl(value: string, allowedHosts: Set<string>): URL | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !allowedHosts.has(url.hostname.toLowerCase())) return null
  return url
}

export function metadataRedirectTarget(location: string, current: URL, allowedHosts: Set<string>): URL | null {
  try {
    const target = new URL(location, current)
    return isAllowedMetadataUrl(target.toString(), allowedHosts)
  } catch { return null }
}

function appendBoundedResponseChunk(chunks: Buffer[], chunk: Buffer, currentBytes: number, maxBytes: number): number {
  if (chunk.byteLength > maxBytes - currentBytes) throw new Error('Upstream body too large')
  chunks.push(chunk)
  return currentBytes + chunk.byteLength
}

function pinnedAddressResult(address: string, family: number, all: boolean) {
  const pinned = { address, family }
  return all ? [pinned] : pinned
}

async function resolveGiftMetadata(urlValue: string, reader: MetadataReader): Promise<GiftMetadataResponse> {
  const recognized = recognizeGiftShop(urlValue)
  if (!recognized) return unsupported()
  const deadline = Date.now() + TOTAL_TIMEOUT_MS
  return resolveRecognizedMetadata(recognized.shop, recognized.url, deadline, reader)
}

async function resolveRecognizedMetadata(shop: Shop, url: URL, deadline: number, reader: MetadataReader): Promise<GiftMetadataResponse> {
  try {
    const metadata = shop === 'wildberries' ? await readWildberries(url, deadline, reader)
      : shop === 'ozon' ? await readOzon(url, deadline, reader) : await readYandex(url, deadline, reader)
    if (!metadata) return unavailable()
    let photo: GiftMetadataResponse['photo'] = null
    if (metadata.image) {
      try {
        const imageHost = new URL(metadata.image).hostname
        const allowedImageHosts = metadata.imageHosts?.includes(imageHost)
          ? new Set([imageHost])
          : shop === 'ozon' && imageHost === 'ir.ozone.ru' ? new Set(['ir.ozone.ru'])
            : shop === 'yandex' && imageHost === 'avatars.mds.yandex.net' && new URL(metadata.image).pathname.startsWith('/get-mpic/')
              ? new Set(['avatars.mds.yandex.net']) : new Set<string>()
        const image = await reader(metadata.image, allowedImageHosts, MAX_IMAGE_BYTES, deadline)
        photo = { contentType: 'image/webp', dataBase64: (await raceUntil(normalizeImage(image.body), deadline)).toString('base64') }
      } catch { /* A missing/invalid image leaves text metadata usable. */ }
    }
    if (!metadata.title && !photo) return unavailable()
    return { status: metadata.title && photo ? 'ready' : 'partial', title: metadata.title, price: metadata.price, photo }
  } catch {
    return unavailable()
  }
}

function raceUntil<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return Promise.reject(new Error('Metadata request timed out'))
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([operation, new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Metadata request timed out')), remaining)
  })]).finally(() => { if (timer) clearTimeout(timer) })
}

async function readWildberries(url: URL, deadline: number, reader: MetadataReader): Promise<ProductMetadata | null> {
  const match = url.pathname.match(/(?:^|\/)catalog\/(\d+)(?:\/|$)/i)
  if (!match) return null
  const nmId = Number(match[1])
  if (!Number.isSafeInteger(nmId) || nmId <= 0) return null
  const vol = Math.floor(nmId / 100_000)
  const part = Math.floor(nmId / 1_000)
  const routeUrl = 'https://cdn.wbbasket.ru/api/v3/upstreams'
  const rawMap = await reader(routeUrl, new Set(['cdn.wbbasket.ru']), 300_000, deadline)
  const routing = parseJson<RoutingMap>(rawMap.body)
  const candidate = selectBasketHost(routing, vol)
  if (!candidate) return null
  const cardUrl = `https://${candidate.host}/vol${vol}/part${part}/${nmId}/info/ru/card.json`
  const rawCard = await reader(cardUrl, new Set([candidate.host]), 500_000, deadline)
  const card = parseJson<{ nm_id?: number; imt_name?: string; media?: { photo_count?: number } }>(rawCard.body)
  const title = cleanProductTitle(card?.imt_name)
  if (!card || card.nm_id !== nmId || !Number.isInteger(card.media?.photo_count) || !card.media!.photo_count! || !title) return null
  return { title, price: null,
    image: `https://${candidate.host}/vol${vol}/part${part}/${nmId}/images/big/1.webp`, imageHosts: [candidate.host] }
}

export function selectBasketHost(routing: RoutingMap | null, vol: number): RoutingEntry | null {
  const originRanges = routing?.origin?.mediabasket_route_map?.filter((route) => route.method === 'range') ?? []
  const recommendRanges = routing?.recommend?.mediabasket_route_map?.filter((route) => route.method === 'range') ?? []
  const routes = originRanges.length > 0 ? originRanges : recommendRanges
  for (const route of routes) {
    const match = (route.hosts ?? []).find((entry) => Number.isInteger(entry.vol_range_from)
      && Number.isInteger(entry.vol_range_to) && entry.vol_range_from <= vol && entry.vol_range_to >= vol
      && /^basket-\d{2}\.wbbasket\.ru$/.test(entry.host))
    if (match) return match
  }
  return null
}

async function readOzon(url: URL, deadline: number, reader: MetadataReader): Promise<ProductMetadata | null> {
  if (!(/^\/(?:product\/)?[^/]+-\d+(?:\/|$)/i.test(url.pathname) || /^\/t\/[a-z\d]+\/?$/i.test(url.pathname))) return null
  const fetched = await reader(url.toString(), new Set(['ozon.ru', 'www.ozon.ru']), MAX_HTML_BYTES, deadline, 'text/html')
  const data = parseProductHtml(fetched.body.toString('utf8'), fetched.url)
  if (!data?.title) return null
  return data
}

async function readYandex(url: URL, deadline: number, reader: MetadataReader): Promise<ProductMetadata | null> {
  if (!(/^\/cc\/[A-Za-z0-9]+\/?$/.test(url.pathname) || isYandexProductPath(url.pathname))) return null
  const fetched = await reader(url.toString(), new Set(['market.yandex.ru']), MAX_HTML_BYTES, deadline, 'text/html')
  if (!isYandexProductPath(fetched.url.pathname) || /\/showcaptcha\/?$/i.test(fetched.url.pathname)) return null
  return parseYandexProductHtml(fetched.body.toString('utf8'), fetched.url)
}

function isYandexProductPath(pathname: string): boolean {
  return /^\/card\/.+\/\d+\/?$/.test(pathname) || /^\/product--[^/]+\/\d+\/?$/.test(pathname)
}

type YandexOffer = { '@type'?: unknown; price?: unknown; priceCurrency?: unknown; url?: unknown }
type YandexProduct = { '@type'?: unknown; name?: unknown; sku?: unknown; productID?: unknown; image?: unknown; offers?: unknown }

/** Read only the Product whose Offer URL identifies the resolved card. Yandex SKU can differ from its card ID. */
export function parseYandexProductHtml(html: string, requested: URL): ProductMetadata | null {
  if (html.length > MAX_HTML_BYTES || /\/showcaptcha\/?$/i.test(requested.pathname)
    || /captcha|robot check|access denied|challenge/i.test(html.slice(0, 50_000))) return null
  const scripts: string[] = []
  let canonical: string | null = null
  let currentScript = ''
  let inScript = false
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'link' && (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) canonical = attrs.href ?? null
      else if (name === 'script' && (attrs.type ?? '').toLowerCase() === 'application/ld+json') { inScript = true; currentScript = '' }
    },
    ontext(text) { if (inScript && currentScript.length < 300_000) currentScript += text },
    onclosetag(name) { if (name === 'script' && inScript) { inScript = false; scripts.push(currentScript) } },
  }, { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true })
  parser.write(html)
  parser.end()

  const requestedId = yandexCardId(requested)
  if (!requestedId) return null
  if (canonical) {
    const canonicalUrl = isAllowedMetadataUrl(new URL(canonical, requested).toString(), new Set(['market.yandex.ru']))
    if (!canonicalUrl || yandexCardId(canonicalUrl) !== requestedId) return null
  }
  const products = scripts.map(parseJson<unknown>).flatMap(collectYandexProducts)
  const matching = products.map((product) => ({ product, offer: matchingYandexOffer(product.offers, requestedId) }))
    .find((entry) => entry.offer !== null)
  if (!matching) return null
  // Require an explicit product identifier. It is intentionally not compared with the card URL ID.
  if (!productIdentity(matching.product)) return null
  const title = cleanProductTitle(matching.product.name)
  if (!title) return null
  let image: string | null = typeof matching.product.image === 'string' ? matching.product.image
    : Array.isArray(matching.product.image) ? matching.product.image[0] as string : null
  if (image) {
    try {
      const imageUrl = new URL(image, requested)
      if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'avatars.mds.yandex.net' || !imageUrl.pathname.startsWith('/get-mpic/')) image = null
      else image = imageUrl.toString()
    } catch { image = null }
  }
  const priceValue = matching.offer!.price
  const price = matching.offer!.priceCurrency === 'RUB' && validPrice(priceValue) ? `${priceValue} ₽` : null
  return { title, price: cleanText(price, 30), image }
}

function yandexCardId(url: URL): string | null {
  if (url.hostname !== 'market.yandex.ru' || url.protocol !== 'https:' || !isYandexProductPath(url.pathname)) return null
  return url.pathname.match(/\/(\d+)\/?$/)?.[1] ?? null
}

function collectYandexProducts(value: unknown): YandexProduct[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(collectYandexProducts)
  const node = value as Record<string, unknown>
  const type = node['@type']
  const own = type === 'Product' || (Array.isArray(type) && type.includes('Product')) ? [node as YandexProduct] : []
  return [...own, ...collectYandexProducts(node['@graph'])]
}

function matchingYandexOffer(value: unknown, expectedCardId: string): YandexOffer | null {
  const offers = Array.isArray(value) ? value : [value]
  return offers.find((candidate): candidate is YandexOffer => {
    if (!candidate || typeof candidate !== 'object') return false
    const offer = candidate as YandexOffer
    if (offer['@type'] !== 'Offer' || typeof offer.url !== 'string') return false
    try {
      const offerUrl = new URL(offer.url)
      return yandexCardId(offerUrl) === expectedCardId
    } catch { return false }
  }) ?? null
}

function validPrice(value: unknown): boolean {
  return (typeof value === 'string' && /^\d{1,8}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0 && Number(value) < 100_000_000)
    || (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000_000)
}

type HtmlData = { metas: Map<string, string>; canonical: string | null; scripts: string[] }
export function parseProductHtml(html: string, requested: URL): ProductMetadata | null {
  const data: HtmlData = { metas: new Map(), canonical: null, scripts: [] }
  let currentScript = ''
  let inScript = false
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'meta') {
        const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
        if (['og:title', 'og:image', 'product:price:amount', 'product:price:currency'].includes(key)) data.metas.set(key, attrs.content ?? '')
      } else if (name === 'link' && (attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical')) {
        data.canonical = attrs.href ?? null
      } else if (name === 'script' && (attrs.type ?? '').toLowerCase() === 'application/ld+json') {
        inScript = true
        currentScript = ''
      }
    },
    ontext(text) { if (inScript && currentScript.length < 300_000) currentScript += text },
    onclosetag(name) { if (name === 'script' && inScript) { inScript = false; data.scripts.push(currentScript) } },
  }, { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true })
  parser.write(html)
  parser.end()
  if (html.length > MAX_HTML_BYTES || /captcha|robot check|access denied|challenge/i.test(html.slice(0, 50_000))) return null
  if (data.canonical) {
    try {
      const canonical = new URL(data.canonical, requested)
      const canonicalId = canonical.pathname.match(/-(\d+)(?:\/|$)/)?.[1]
      const requestedId = requested.pathname.match(/-(\d+)(?:\/|$)/)?.[1]
      if (!isAllowedMetadataUrl(canonical.toString(), new Set(['ozon.ru', 'www.ozon.ru']))
        || !canonicalId || canonicalId !== requestedId) return null
    } catch { return null }
  }
  const productId = requested.pathname.match(/-(\d+)(?:\/|$)/)?.[1]
  if (!productId) return null
  const product = data.scripts.map(parseJson<unknown>).map((value) => findProduct(value, productId)).find(Boolean)
  if (!product) return null
  const identity = productIdentity(product)
  if (!identity || productId !== identity) return null
  const title = cleanProductTitle(product.name)
  if (!title || /^(ozon|купить|интернет-магазин)/i.test(title)) return null
  let image = typeof product?.image === 'string' ? product.image : Array.isArray(product?.image) ? product.image[0] : data.metas.get('og:image')
  if (typeof image !== 'string') image = null
  if (image) {
    try {
      const imageUrl = new URL(image, requested)
      if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'ir.ozone.ru' || !/^\/s3\//.test(imageUrl.pathname)) image = null
      else image = imageUrl.toString()
    } catch { image = null }
  }
  const offer = product?.offers && !Array.isArray(product.offers) ? product.offers : null
  const priceValue = offer?.price
  const currency = offer?.priceCurrency
  const price = offer?.['@type'] !== 'AggregateOffer' && currency === 'RUB' && typeof priceValue === 'string'
    && /^\d{1,8}(?:\.\d{1,2})?$/.test(priceValue) && Number(priceValue) > 0 && Number(priceValue) < 100_000_000
    ? `${priceValue} ₽` : offer?.['@type'] !== 'AggregateOffer' && currency === 'RUB' && typeof priceValue === 'number' && Number.isFinite(priceValue) && priceValue > 0 && priceValue < 100_000_000
      ? `${priceValue} ₽` : null
  return { title, price: cleanText(price, 30), image }
}

type ProductNode = { name?: unknown; image?: unknown; sku?: unknown; productID?: unknown; offers?: { '@type'?: unknown; price?: unknown; priceCurrency?: unknown } }
function findProduct(value: unknown, expectedId: string): ProductNode | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) return value.map((item) => findProduct(item, expectedId)).find(Boolean) ?? null
  const node = value as Record<string, unknown>
  const type = node['@type']
  if ((type === 'Product' || (Array.isArray(type) && type.includes('Product')))
    && typeof node.name === 'string' && productIdentity(node) === expectedId) return node as ProductNode
  return findProduct(node['@graph'], expectedId)
}

function productIdentity(product: Record<string, unknown>): string | null {
  const raw = String(product.sku ?? product.productID ?? '')
  return raw.match(/(?:^|[-/])(\d{6,})\/?$/)?.[1] ?? null
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/<[^>]*>/g, ' ').replace(/[\s\u00a0]+/g, ' ').trim()
  if (!text || text.length > max || /captcha|challenge|access denied/i.test(text)) return null
  return text
}

function cleanProductTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/<[^>]*>/g, ' ').replace(/[\s\u00a0]+/g, ' ').trim()
  if (!normalized || /captcha|challenge|access denied/i.test(normalized)) return null
  return Array.from(normalized).slice(0, 120).join('')
}

function parseJson<T>(bytes: Buffer | string): T | null {
  try { return JSON.parse(bytes.toString()) as T } catch { return null }
}

async function normalizeImage(bytes: Buffer): Promise<Buffer> {
  if (!isSupportedRasterHeader(bytes)) throw new Error('Unsupported product image format')
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS, pages: 1 })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS
    || (metadata.pages ?? 1) > 1 || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) throw new Error('Unsupported product image')
  const output = await image.rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  if (output.byteLength > MAX_IMAGE_OUTPUT_BYTES) throw new Error('Product image too large')
  return output
}

export function isSupportedRasterHeader(bytes: Buffer): boolean {
  return (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    || (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
}

export function createSecureMetadataReader(dependencies: MetadataReaderDependencies = {}) {
  const resolveAll = dependencies.resolveAll ?? (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }))
  const request = dependencies.request ?? httpsRequest
  return async function secureGet(
    value: string,
    allowedHosts: Set<string>,
    maxBytes: number,
    deadline: number,
    accept = 'application/json,image/webp,image/jpeg,image/png,text/html;q=0.9,*/*;q=0.1',
  ): Promise<{ body: Buffer; url: URL }> {
    let url = new URL(value)
    for (let hop = 0; hop <= REDIRECTS; hop++) {
      if (!isAllowedMetadataUrl(url.toString(), allowedHosts)) throw new Error('URL outside allowlist')
      const response = await pinnedHttpsRequest(url, maxBytes, deadline, accept, resolveAll, request)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === REDIRECTS || !response.location) throw new Error('Too many redirects')
        const destination = metadataRedirectTarget(response.location, url, allowedHosts)
        if (!destination) throw new Error('Redirect outside allowlist')
        url = destination
        continue
      }
      if (response.status < 200 || response.status >= 300) throw new Error(`Upstream status ${response.status}`)
      return { body: response.body, url }
    }
    throw new Error('Too many redirects')
  }
}

const secureGet = createSecureMetadataReader()

function pinnedHttpsRequest(
  url: URL,
  maxBytes: number,
  deadline: number,
  accept: string,
  resolveAll: NonNullable<MetadataReaderDependencies['resolveAll']>,
  request: NonNullable<MetadataReaderDependencies['request']>,
): Promise<{ status: number; location?: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let settled = false
    let req: ReturnType<typeof httpsRequest> | undefined
    const remainingAtStart = deadline - Date.now()
    if (remainingAtStart <= 0) { reject(new Error('Metadata request timed out')); return }
    const timer = setTimeout(() => {
      req?.destroy(new Error('Metadata request timed out'))
      finish(new Error('Metadata request timed out'))
    }, remainingAtStart)
    const finish = (error?: Error, value?: { status: number; location?: string; body: Buffer }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value!)
    }
    void resolveAll(url.hostname).then((addresses) => {
      if (settled) return
      if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) throw new Error('DNS resolved to non-public address')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('Metadata request timed out')
      const address = addresses[0]
      const requestOptions = {
        method: 'GET', agent: false, servername: url.hostname,
        family: address.family, autoSelectFamily: false,
        lookup: (_hostname, options, callback) => {
          const result = pinnedAddressResult(address.address, address.family, typeof options === 'object' && options.all === true)
          if (Array.isArray(result)) callback(null, result)
          else callback(null, result.address, result.family)
        },
        headers: { Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'OurMemoriesGiftMetadata/1.0' },
        timeout: remaining,
      } as Parameters<typeof httpsRequest>[1]
      req = request(url, requestOptions, (res) => {
        if (settled) { res.destroy(); return }
        const status = res.statusCode ?? 0
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.destroy()
          finish(undefined, { status, location: res.headers.location, body: Buffer.alloc(0) })
          return
        }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); finish(new Error('Compressed upstream response rejected')); return }
        const declared = Number(res.headers['content-length'])
        if (Number.isFinite(declared) && declared > maxBytes) { res.destroy(); finish(new Error('Upstream body too large')); return }
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (chunk: Buffer) => {
          try { total = appendBoundedResponseChunk(chunks, chunk, total, maxBytes) }
          catch { res.destroy(); finish(new Error('Upstream body too large')) }
        })
        res.on('end', () => finish(undefined, { status, body: Buffer.concat(chunks) }))
        res.on('error', (error) => finish(error))
        res.on('aborted', () => finish(new Error('Truncated upstream response')))
      })
      req.on('timeout', () => req?.destroy(new Error('Upstream timed out')))
      req.on('error', (error) => finish(error))
      req.end()
    }).catch((error: unknown) => finish(error instanceof Error ? error : new Error('DNS lookup failed')))
  })
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const octets = address.split('.').map(Number)
    const [a, b] = octets
    const [c] = octets.slice(2)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99) || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113))
  }
  if (family !== 6) return false
  const expanded = expandIpv6(address)
  if (!expanded) return false
  const first = parseInt(expanded[0], 16)
  // Conservative global-unicast range. Exclude special-use, documentation, transition,
  // mapped, multicast, link-local, ULA and unspecified ranges.
  const second = parseInt(expanded[1], 16)
  return (first & 0xe000) === 0x2000
    && !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8))
    && first !== 0x3fff
    && first !== 0x2002
}

function expandIpv6(address: string): string[] | null {
  if (address.includes('.')) return null
  const halves = address.toLowerCase().split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const fill = 8 - left.length - right.length
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null
  const groups = [...left, ...Array(fill).fill('0'), ...right]
  return groups.length === 8 && groups.every((part) => /^[0-9a-f]{1,4}$/.test(part)) ? groups : null
}
