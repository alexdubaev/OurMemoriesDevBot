import type { Page } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { createPrisma } from '../../backend/src/db'
import { FilesystemPrivateStorage } from '../../backend/src/storage/filesystem-storage'
import { pngImage } from './helpers/images'
import { expect, test } from './helpers/test'

const subject = '81000013'
const databaseUrl = process.env.TEST_DATABASE_URL!
const backendUrl = process.env.E2E_BACKEND_URL!
const storageRoot = resolve('e2e/.artifacts/storage')
const prisma = createPrisma(databaseUrl)
const storage = new FilesystemPrivateStorage({
  driver: 'filesystem',
  root: storageRoot,
  publicBaseUrl: backendUrl,
  signingKey: Buffer.alloc(32, 1),
  uploadMaxBytes: 100_000_000,
  uploadUrlTtlSeconds: 300,
  downloadUrlTtlSeconds: 300,
})

let fixture: Awaited<ReturnType<typeof seedFeed>>

test.describe.serial('T07 live feed', () => {
  test.beforeAll(async () => {
    fixture = await seedFeed()
  })

  test.afterAll(async () => {
    if (!fixture) {
      await prisma.$disconnect()
      return
    }
    await prisma.telegramVideoDelivery.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramVideoReference.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramSource.deleteMany({ where: { familyId: fixture.familyId } })
    await prisma.telegramInbox.deleteMany({ where: { botId: fixture.botId } })
    await prisma.family.delete({ where: { id: fixture.familyId } })
    await prisma.externalIdentity.deleteMany({ where: { userId: fixture.userId } })
    await prisma.authSession.deleteMany({ where: { userId: fixture.userId } })
    await prisma.user.delete({ where: { id: fixture.userId } })
    await prisma.user.delete({ where: { id: fixture.ownerUserId } })
    await Promise.all(fixture.objectKeys.map((key) => storage.deleteObject(key)))
    await prisma.$disconnect()
  })

  test.beforeEach(async ({ page }) => {
    await installTelegramHost(page, signedInitData(Number(subject), 'Лента E2E'))
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Лента' })).toBeVisible()
  })

  test('keeps page one through a next-page failure, retries, and deduplicates 40+ memories', async ({ page }) => {
    let failedOnce = false
    let blockCursor = true
    await page.route('**/api/v1/families/*/memories**', async (route) => {
      const url = new URL(route.request().url())
      if (blockCursor && url.searchParams.has('cursor')) {
        failedOnce = true
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic page failure' } }),
        })
        return
      }
      await route.continue()
    })

    await openFeed(page)
    await page.getByLabel('Загрузить ещё').scrollIntoViewIfNeeded()
    await expect.poll(() => failedOnce).toBe(true)
    await expect(page.getByText('Фотоальбом E2E')).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось обновить ленту' })).toBeVisible()
    blockCursor = false
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.getByText('Заметка E2E 20')).toBeVisible()
    await page.getByLabel('Загрузить ещё').scrollIntoViewIfNeeded()
    await expect(page.getByText('Заметка E2E 42')).toBeVisible()

    const cards = page.locator('[data-slot="memory-card-frame"]')
    await expect(cards).toHaveCount(fixture.memoryCount)
    const ids = await cards.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-memory-id')))
    expect(new Set(ids).size).toBe(ids.length)
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-feed.png'), fullPage: true })
  })

  test('rolls back a failed like without losing the memory', async ({ page }) => {
    await openFeed(page)
    await page.route('**/api/v1/families/*/memories/*/like', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Synthetic like failure' } }),
    }))
    const albumCard = page.locator('[data-memory-id]').filter({ hasText: 'Фотоальбом E2E' })
    const like = albumCard.getByRole('button', { name: /Сердечко/ })
    await like.click()
    await expect(like).toHaveAttribute('aria-pressed', 'false')
    await expect(albumCard).toContainText('Фотоальбом E2E')
  })

  test('offers only truly newer memories and preserves the visible anchor when applying them', async ({ page }) => {
    await openFeed(page)
    const target = page.locator('[data-memory-id]').filter({ hasText: 'Заметка E2E 10' })
    await target.scrollIntoViewIfNeeded()
    const anchorId = await page.locator('[data-memory-id]').evaluateAll((cards) =>
      cards.find((card) => {
        const rect = card.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < window.innerHeight
      })?.getAttribute('data-memory-id'))
    const anchor = page.locator(`[data-memory-id="${anchorId}"]`)

    await prisma.memory.create({ data: {
      familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
      kind: 'note', body: 'Старая добавленная запись', occurredAt: new Date(Date.now() - 7 * 24 * 60 * 60_000),
    } })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('button', { name: 'Показать новые' })).toHaveCount(0)

    await prisma.memory.create({ data: {
      familyId: fixture.familyId, childId: fixture.childId, authorId: fixture.ownerUserId,
      kind: 'note', body: 'Совсем новое воспоминание', occurredAt: new Date(),
    } })
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.getByRole('button', { name: 'Показать новые' })).toBeVisible()
    const beforeTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
    await page.getByRole('button', { name: 'Показать новые' }).click()
    await expect(page.getByText('Совсем новое воспоминание')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Показать новые' })).toHaveCount(0)
    const afterTop = await anchor.evaluate((element) => element.getBoundingClientRect().top)
    expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(2)
  })

  test('opens a two-photo PhotoSwipe album and restores focus and scroll on close', async ({ page }) => {
    await openFeed(page)
    const singleOpener = page.locator('[data-memory-id]').filter({ hasText: 'Одиночное фото E2E' }).getByRole('button', { name: 'Открыть фото' })
    await singleOpener.scrollIntoViewIfNeeded()
    await installObjectUrlTracker(page)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    const singleScroll = await page.evaluate(() => window.scrollY)
    await singleOpener.click()
    await expect(page.locator('.pswp__counter')).toContainText('1 / 1')
    await expect(page.locator('.pswp__zoom-wrap > img')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(1)
    await page.locator('.pswp__button--close').click()
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(singleOpener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(singleScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 1)

    const opener = page.getByRole('button', { name: 'Открыть фото' }).first()
    await opener.scrollIntoViewIfNeeded()
    const beforeScroll = await page.evaluate(() => window.scrollY)
    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect(page.locator('.pswp__counter')).toContainText('1 / 2')
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(3)
    await page.locator('.pswp__button--arrow--next').click()
    await expect(page.locator('.pswp__counter')).toContainText('2 / 2')
    await page.screenshot({ path: resolve('e2e/.artifacts/t07-photoswipe.png') })
    await triggerTelegramBack(page)
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 3)

    await triggerTelegramBack(page)
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expect.poll(() => page.evaluate(() => Boolean(window.history.state?.privatePhotoViewer))).toBe(false)

    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(5)
    await page.goBack()
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 5)

    await opener.click()
    await expect(page.locator('.pswp')).toBeVisible()
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(1)
    await expect.poll(async () => (await objectUrlSnapshot(page)).created.length).toBe(7)
    await page.getByRole('button', { name: 'Семья', exact: true }).evaluate((button) => (button as HTMLButtonElement).click())
    await expect(page.locator('.pswp')).toHaveCount(0)
    await expect.poll(() => telegramBackHandlerCount(page)).toBe(0)
    await expectObjectUrlsClean(page, 7)
  })

  test('streams voice and legacy video only after play, seeks with Range/206, and pauses on hide', async ({ page }) => {
    await openFeed(page)
    const responses: Array<{ range: string | null; status: number; url: string }> = []
    page.on('response', (response) => {
      if (!response.url().includes('/media/') || !response.url().includes('variant=playback')) return
      responses.push({
        range: response.request().headers()['range'] ?? null,
        status: response.status(),
        url: response.url(),
      })
    })

    await page.waitForTimeout(500)
    expect(responses).toEqual([])

    const voiceCard = page.locator('[data-memory-id]').filter({ hasText: 'Голос E2E' })
    const voice = voiceCard.locator('audio')
    await expect(voice).toHaveAttribute('src', /^\/api\//)
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await voiceCard.getByRole('button', { name: 'Слушать' }).click()
    await expect.poll(() => responses.some((response) => response.range && response.status === 206)).toBe(true)
    await expect.poll(() => voice.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true)

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => voice.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => voice.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)

    const videoCard = page.locator('[data-memory-id]').filter({ hasText: 'Legacy video E2E' })
    await videoCard.getByRole('button', { name: 'Смотреть' }).click()
    await expect.poll(() => responses.filter((response) => response.range && response.status === 206).length).toBeGreaterThan(1)
    await videoCard.getByLabel('Позиция видео').fill('2')
    await expect.poll(() => responses.every((response) => response.status === 206)).toBe(true)
  })

  test('opens Telegram-only video through the guarded opaque hand-off', async ({ page }) => {
    await openFeed(page)
    const card = page.locator('[data-memory-id]').filter({ hasText: 'Telegram video E2E' })
    await card.getByRole('button', { name: 'Смотреть в Telegram' }).click()
    await expect.poll(() => page.evaluate(() => (window as typeof window & { __openedTelegramLink?: string }).__openedTelegramLink)).toMatch(/^https:\/\/t\.me\/OurMemoriesDevBot\?start=watch_[A-Za-z0-9_-]{32}$/)
    const deepLink = await page.evaluate(() => (window as typeof window & { __openedTelegramLink?: string }).__openedTelegramLink)
    expect(deepLink).not.toContain('synthetic-file-id')
  })

  test('closes access and pauses playback after membership revoke', async ({ page }) => {
    await openFeed(page)
    const voiceCard = page.locator('[data-memory-id]').filter({ hasText: 'Голос E2E' })
    const voice = voiceCard.locator('audio')
    await voiceCard.getByRole('button', { name: 'Слушать' }).click()
    await expect.poll(() => voice.evaluate((element) => !(element as HTMLAudioElement).paused)).toBe(true)
    const voiceHandle = await voice.elementHandle()
    expect(voiceHandle).not.toBeNull()

    await prisma.familyMember.update({
      where: { familyId_userId: { familyId: fixture.familyId, userId: fixture.userId } },
      data: { revokedAt: new Date() },
    })
    await page.getByRole('button', { name: 'Фото', exact: true }).click()

    await expect(page.getByText('Доступ к семейной ленте закрыт.')).toBeVisible()
    await expect.poll(() => voiceHandle!.evaluate((element) => (element as HTMLAudioElement).paused)).toBe(true)
    await expect(page.locator('[data-memory-id]')).toHaveCount(0)
  })
})

async function seedFeed() {
  const objectKeys: string[] = []
  const prior = await prisma.externalIdentity.findUnique({
    where: { provider_subject: { provider: 'telegram', subject } },
    select: { userId: true },
  })
  if (prior) {
    const priorFamilies = await prisma.familyMember.findMany({ where: { userId: prior.userId }, select: { familyId: true, family: { select: { ownerUserId: true } } } })
    await prisma.family.deleteMany({ where: { id: { in: priorFamilies.map(({ familyId }) => familyId) } } })
    await prisma.user.delete({ where: { id: prior.userId } })
    const orphanedOwners = priorFamilies.map(({ family }) => family.ownerUserId).filter((userId) => userId !== prior.userId)
    if (orphanedOwners.length > 0) await prisma.user.deleteMany({ where: { id: { in: orphanedOwners } } })
  }
  const user = await prisma.user.create({ data: { displayName: 'Зритель E2E' } })
  const ownerUser = await prisma.user.create({ data: { displayName: 'Мама E2E' } })
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
  const familyId = randomUUID()
  const childId = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.family.create({ data: { id: familyId, ownerUserId: ownerUser.id, name: 'Семья E2E', timezone: 'Europe/Moscow' } })
    await tx.familyMember.create({ data: { familyId, userId: ownerUser.id, role: 'full' } })
    await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'viewer' } })
    await tx.child.create({ data: { id: childId, familyId, displayName: 'Лиза', birthDate: new Date('2024-02-29T00:00:00.000Z'), sex: 'girl' } })
  })

  const baseTime = Date.now() - 60_000
  await prisma.memory.createMany({
    data: Array.from({ length: 43 }, (_, index) => ({
      familyId,
      childId,
      authorId: ownerUser.id,
      kind: 'note' as const,
      body: `Заметка E2E ${index}`,
      occurredAt: new Date(baseTime - (index + 4) * 60_000),
    })),
  })

  const photoAssets = await Promise.all([0, 1].map(async (index) => {
    const key = `media-display/${randomUUID()}-${index}.png`
    objectKeys.push(key)
    await store(key, pngImage.buffer, 'image/png')
    return createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  }))
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'photo', body: 'Фотоальбом E2E', occurredAt: new Date(baseTime), assets: photoAssets })

  const singlePhotoKey = `media-display/${randomUUID()}-single.png`
  objectKeys.push(singlePhotoKey)
  await store(singlePhotoKey, pngImage.buffer, 'image/png')
  const singlePhotoAsset = await createAsset({ familyId, userId: ownerUser.id, kind: 'photo', variant: 'display', key: singlePhotoKey, bytes: pngImage.buffer, mime: 'image/png', width: 1, height: 1 })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'photo', body: 'Одиночное фото E2E', occurredAt: new Date(baseTime - 30_000), assets: [singlePhotoAsset] })

  const voiceBytes = generatedMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'frag_keyframe+empty_moov', '-f', 'ipod', 'pipe:1'])
  const voiceKey = `media-playback/${randomUUID()}.m4a`
  objectKeys.push(voiceKey)
  await store(voiceKey, voiceBytes, 'audio/mp4')
  const voiceAsset = await createAsset({
    familyId, userId: ownerUser.id, kind: 'voice', variant: 'playback', key: voiceKey, bytes: voiceBytes, mime: 'audio/mp4', durationMs: 8_000,
    waveform: Array.from({ length: 48 }, (_, index) => ((index % 12) + 1) / 12),
  })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'voice', body: 'Голос E2E', occurredAt: new Date(baseTime - 60_000), assets: [voiceAsset] })

  const videoBytes = generatedMedia(['-f', 'lavfi', '-i', 'color=c=pink:s=320x180:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'])
  const videoKey = `media-playback/${randomUUID()}.mp4`
  objectKeys.push(videoKey)
  await store(videoKey, videoBytes, 'video/mp4')
  const videoAsset = await createAsset({ familyId, userId: ownerUser.id, kind: 'video', variant: 'playback', key: videoKey, bytes: videoBytes, mime: 'video/mp4', width: 320, height: 180, durationMs: 8_000 })
  await createMemoryWithMedia({ familyId, childId, userId: ownerUser.id, kind: 'video', body: 'Legacy video E2E', occurredAt: new Date(baseTime - 120_000), assets: [videoAsset] })

  const telegramMemory = await prisma.memory.create({ data: { familyId, childId, authorId: ownerUser.id, kind: 'video', body: 'Telegram video E2E', occurredAt: new Date(baseTime - 180_000) } })
  const botId = BigInt(`777${subject}`)
  const inbox = await prisma.telegramInbox.create({ data: { botId, updateId: 1n, eventKind: 'content', encryptedPayload: Buffer.from([1]), encryptionIv: Buffer.alloc(12, 2), encryptionAuthTag: Buffer.alloc(16, 3), processedAt: new Date() } })
  const source = await prisma.telegramSource.create({ data: { inboxId: inbox.id, botId, chatId: BigInt(subject), messageId: 1n, senderSubject: subject, userId: user.id, familyId, childId, kind: 'video', status: 'published', plannedMemoryId: telegramMemory.id, memoryId: telegramMemory.id } })
  await prisma.telegramVideoReference.create({ data: { sourceId: source.id, memoryId: telegramMemory.id, familyId, fileIdCiphertext: Buffer.from('synthetic-file-id'), encryptionIv: Buffer.alloc(12, 4), encryptionAuthTag: Buffer.alloc(16, 5), fileUniqueId: 'synthetic-unique-id', width: 320, height: 180, durationMs: 8_000 } })

  return { familyId, childId, userId: user.id, ownerUserId: ownerUser.id, botId, objectKeys, memoryCount: 48 }
}

async function createAsset(input: { familyId: string; userId: string; kind: 'photo' | 'video' | 'voice'; variant: 'display' | 'playback'; key: string; bytes: Buffer; mime: string; width?: number; height?: number; durationMs?: number; waveform?: number[] }) {
  return prisma.mediaAsset.create({ data: {
    familyId: input.familyId,
    uploaderId: input.userId,
    sourceKind: 'upload',
    purpose: 'memory',
    mediaKind: input.kind,
    originalKey: `media-originals/${randomUUID()}`,
    declaredMime: input.kind === 'photo' ? 'image/png' : input.kind === 'video' ? 'video/mp4' : 'audio/ogg',
    verifiedMime: input.kind === 'photo' ? 'image/png' : input.kind === 'video' ? 'video/mp4' : 'audio/ogg',
    sha256: randomUUID().replaceAll('-', '').repeat(2),
    byteSize: BigInt(input.bytes.byteLength),
    width: input.width,
    height: input.height,
    durationMs: input.durationMs,
    waveform: input.waveform,
    originalStatus: 'stored',
    renditionStatus: 'ready',
    variants: { create: { variant: input.variant, objectKey: input.key, sha256: randomUUID().replaceAll('-', '').repeat(2), byteSize: BigInt(input.bytes.byteLength), mime: input.mime, width: input.width, height: input.height, durationMs: input.durationMs } },
  } })
}

async function createMemoryWithMedia(input: { familyId: string; childId: string; userId: string; kind: 'photo' | 'video' | 'voice'; body: string; occurredAt: Date; assets: Array<{ id: string }> }) {
  return prisma.memory.create({ data: {
    familyId: input.familyId,
    childId: input.childId,
    authorId: input.userId,
    kind: input.kind,
    body: input.body,
    occurredAt: input.occurredAt,
    media: { create: input.assets.map((asset, position) => ({ mediaId: asset.id, position })) },
  } })
}

async function store(key: string, bytes: Buffer, contentType: string) {
  await storage.writeObject({ key, body: new Blob([bytes]).stream(), contentLength: bytes.byteLength, contentType })
}

function generatedMedia(args: string[]) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'buffer', maxBuffer: 20_000_000 })
  if (result.status !== 0) throw new Error(`ffmpeg fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function signedInitData(id: number, name: string) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1_000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id, first_name: name }),
  })
  const dataCheckString = [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return fields.toString()
}

async function installTelegramHost(page: Page, initData: string) {
  await page.addInitScript((value) => {
    const backHandlers = new Set<() => void>()
    const testWindow = window as typeof window & {
      __openedTelegramLink?: string
      __telegramBackHandlerCount?: () => number
      __triggerTelegramBack?: () => void
    }
    testWindow.__telegramBackHandlerCount = () => backHandlers.size
    testWindow.__triggerTelegramBack = () => { backHandlers.forEach((handler) => handler()) }
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
      initData: value,
      version: '8.0',
      platform: 'tdesktop',
      safeAreaInset: {},
      contentSafeAreaInset: {},
      BackButton: {
        show() {},
        hide() {},
        onClick(handler: () => void) { backHandlers.add(handler) },
        offClick(handler: () => void) { backHandlers.delete(handler) },
      },
      ready() {},
      openTelegramLink(url: string) { testWindow.__openedTelegramLink = url },
    } } })
  }, initData)
}

async function installObjectUrlTracker(page: Page) {
  await page.evaluate(() => {
    const tracked = { created: [] as string[], revoked: [] as string[] }
    const createObjectUrl = URL.createObjectURL.bind(URL)
    const revokeObjectUrl = URL.revokeObjectURL.bind(URL)
    const testWindow = window as typeof window & { __photoObjectUrls?: typeof tracked }
    testWindow.__photoObjectUrls = tracked
    URL.createObjectURL = (blob) => {
      const url = createObjectUrl(blob)
      tracked.created.push(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      if (tracked.created.includes(url)) tracked.revoked.push(url)
      revokeObjectUrl(url)
    }
  })
}

function objectUrlSnapshot(page: Page) {
  return page.evaluate(() => {
    const tracked = (window as typeof window & {
      __photoObjectUrls?: { created: string[]; revoked: string[] }
    }).__photoObjectUrls
    if (!tracked) throw new Error('Object URL tracker is not installed')
    return { created: [...tracked.created], revoked: [...tracked.revoked] }
  })
}

async function expectObjectUrlsClean(page: Page, expectedCount: number) {
  await expect.poll(async () => (await objectUrlSnapshot(page)).revoked.length).toBe(expectedCount)
  const snapshot = await objectUrlSnapshot(page)
  expect(snapshot.created).toHaveLength(expectedCount)
  expect(snapshot.revoked).toHaveLength(expectedCount)
  expect(new Set(snapshot.created).size).toBe(expectedCount)
  expect(new Set(snapshot.revoked).size).toBe(expectedCount)
  expect([...snapshot.revoked].sort()).toEqual([...snapshot.created].sort())
}

function telegramBackHandlerCount(page: Page) {
  return page.evaluate(() => {
    const count = (window as typeof window & { __telegramBackHandlerCount?: () => number }).__telegramBackHandlerCount
    if (!count) throw new Error('Telegram BackButton harness is not installed')
    return count()
  })
}

function triggerTelegramBack(page: Page) {
  return page.evaluate(() => {
    const trigger = (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack
    if (!trigger) throw new Error('Telegram BackButton harness is not installed')
    trigger()
  })
}

async function openFeed(page: Page) {
  await page.getByRole('button', { name: 'Лента' }).click()
  await expect(page.getByText('Фотоальбом E2E')).toBeVisible()
}
