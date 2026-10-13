import { randomUUID } from 'node:crypto'
import { createPrisma } from '../../backend/src/db'
import { createRefreshToken, hashRefreshToken, hashRefreshTokenFamily } from '../../backend/src/modules/auth/infrastructure/refresh-tokens'
import { jpegImage } from './helpers/images'
import { expect, test } from '@playwright/test'
import { completeChildProfile, uploadChildAvatar, uploadFamilyPhoto } from '../src/features/family/api'
import { createAvatarUpload, finalizeAvatarUpload } from '../src/features/avatar/api'
import { uploadAvatarObject } from '../src/features/avatar/upload'
import sharp from 'sharp'
import type { AuthenticatedTransport } from '../src/platform/api'
import type { z } from 'zod'

const maxSubject = 99130001
const fallbackSubject = 99130002
const jwtSecret = 'web-e2e-secret-at-least-thirty-two-characters'

async function seed() {
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    const old = await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: String(maxSubject) } }, select: { userId: true } })
    if (old) {
      await prisma.authSession.deleteMany({ where: { userId: old.userId } })
      await prisma.family.deleteMany({ where: { ownerUserId: old.userId } })
      await prisma.externalIdentity.deleteMany({ where: { userId: old.userId } })
      await prisma.user.deleteMany({ where: { id: old.userId } })
    }
    const oldFallback = await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: String(fallbackSubject) } }, select: { userId: true } })
    if (oldFallback) {
      await prisma.authSession.deleteMany({ where: { userId: oldFallback.userId } })
      await prisma.externalIdentity.deleteMany({ where: { userId: oldFallback.userId } })
      await prisma.user.deleteMany({ where: { id: oldFallback.userId } })
    }
    await prisma.pilotAdmission.upsert({ where: { provider_subject: { provider: 'max', subject: String(maxSubject) } }, update: { revokedAt: null }, create: { provider: 'max', subject: String(maxSubject) } })
    const user = await prisma.user.create({ data: { displayName: 'Synthetic MAX user' } })
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject: String(maxSubject) } })
    const fallbackUser = await prisma.user.create({ data: { displayName: 'Synthetic fallback author' } })
    await prisma.externalIdentity.create({ data: { userId: fallbackUser.id, provider: 'max', subject: String(fallbackSubject) } })
    const refreshToken = createRefreshToken(jwtSecret)
    await prisma.authSession.create({ data: {
      userId: user.id,
      externalIdentityId: identity.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      refreshTokenFamilyHash: hashRefreshTokenFamily(refreshToken, jwtSecret),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    } })
    const familyId = randomUUID()
    const childId = randomUUID()
    const publishedAt = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.family.create({ data: { id: familyId, name: 'Synthetic diagnostic family', timezone: 'Europe/Moscow', ownerUserId: user.id } })
      await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'full' } })
      await tx.familyMember.create({ data: { familyId, userId: fallbackUser.id, role: 'viewer' } })
      await tx.child.create({ data: { id: childId, familyId, displayName: 'Synthetic child' } })
      await tx.memory.createMany({ data: Array.from({ length: 21 }, (_, index) => ({
        familyId,
        childId,
        authorId: user.id,
        kind: 'note' as const,
        body: `Synthetic diagnostic note ${String(index + 1).padStart(2, '0')}`,
        occurredAt: new Date(publishedAt.getTime() - (index + 1) * 60_000),
        status: 'published' as const,
        firstPublishedAt: publishedAt,
        firstPublishedOrdinal: BigInt(index + 1),
      })) })
      await tx.memory.create({ data: {
        familyId,
        childId,
        authorId: fallbackUser.id,
        kind: 'note',
        body: 'Synthetic fallback author note',
        occurredAt: new Date(publishedAt.getTime() - 22 * 60_000),
        status: 'published',
        firstPublishedAt: publishedAt,
        firstPublishedOrdinal: 22n,
      } })
      await tx.family.update({ where: { id: familyId }, data: { publicationOrdinal: 22 } })
    })
    return { familyId, childId, refreshToken, userId: user.id, identityId: identity.id }
  } finally { await prisma.$disconnect() }
}

function testTransport(accessToken: string): AuthenticatedTransport {
  const base = process.env.E2E_WEB_URL!
  const send = async (path: string, options: Parameters<AuthenticatedTransport['raw']>[1] = {}) => fetch(new URL(path, base), {
    method: options?.method ?? 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, ...(options?.headers as Record<string, string> | undefined), ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
    credentials: 'include',
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    ...(options?.rawBody ? { body: options.rawBody } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  })
  return {
    raw: send,
    async request<TSchema extends z.ZodType>(path: string, schema: TSchema, options?: Parameters<AuthenticatedTransport['raw']>[1]) {
      const response = await send(path, options)
      if (!response.ok) throw new Error(`Diagnostic setup API failed: ${response.status}`)
      return schema.parse(await response.json()) as z.infer<TSchema>
    },
  }
}

test('MAX identity opens the plain family feed with private photo, cursor paging, and the existing media worker', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { familyId, childId, refreshToken } = await seed()
  await page.context().addCookies([{
    name: 'web_app_demo_refresh',
    value: refreshToken,
    url: process.env.E2E_WEB_URL!,
    httpOnly: true,
    sameSite: 'Lax',
  }])
  const authResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/refresh'))
  await page.goto('/__experiments/minimal-feed/diagnostic.html')
  const authenticated = await authResponse
  expect(authenticated.ok()).toBe(true)
  const { accessToken } = await authenticated.json() as { accessToken: string }
  await expect(page.getByText(/Вы вошли как Synthetic MAX user/)).toBeVisible()
  const transport = testTransport(accessToken)
  const ownerAvatarBytes = await sharp({ create: { width: 240, height: 240, channels: 3, background: '#84634f' } }).jpeg().toBuffer()
  const ownerAvatarFile = new File([ownerAvatarBytes], 'diagnostic-author-avatar.jpg', { type: 'image/jpeg' })
  const ownerAvatarUpload = await createAvatarUpload(transport, { contentType: 'image/jpeg', byteSize: ownerAvatarFile.size })
  await uploadAvatarObject(ownerAvatarUpload.upload, ownerAvatarFile)
  const ownerAvatar = await finalizeAvatarUpload(transport, ownerAvatarUpload.upload.uploadId)
  const avatarBytes = await sharp({ create: { width: 240, height: 240, channels: 3, background: '#8a6454' } }).jpeg().toBuffer()
  const avatarMediaId = await uploadChildAvatar(transport, familyId, new File([avatarBytes], 'diagnostic-child-avatar.jpg', { type: 'image/jpeg' }), 'image/jpeg')
  await completeChildProfile(transport, familyId, {
    name: 'Synthetic diagnostic child',
    birthDate: '2020-01-01',
    sex: 'boy',
    avatarMediaId,
    avatarCrop: { x: 0, y: 0, width: 1, height: 1 },
    expectedVersion: 1,
  })
  const file = new File([jpegImage.buffer], 'diagnostic-photo.jpg', { type: 'image/jpeg' })
  const assetId = await uploadFamilyPhoto(transport, familyId, file, 'image/jpeg', 'memory')
  const portraitBytes = await sharp({ create: { width: 240, height: 360, channels: 3, background: '#547890' } }).jpeg().toBuffer()
  const secondAssetId = await uploadFamilyPhoto(transport, familyId, new File([portraitBytes], 'diagnostic-photo-2.jpg', { type: 'image/jpeg' }), 'image/jpeg', 'memory')
  const photoBody = `Synthetic diagnostic photo ${randomUUID()}`
  const created = await transport.raw(`/api/v1/families/${familyId}/memories`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { childId, kind: 'photo', mediaIds: [assetId, secondAssetId], body: photoBody, occurredAt: new Date().toISOString() },
  })
  expect(created.status).toBe(201)
  await page.route('**/api/v1/families/*/memories**', async (route) => {
    const response = await route.fetch()
    const payload = await response.json() as { items: Array<{ body: string; author: { avatarPath: string | null }; attachments: Array<Record<string, unknown>> }> }
    const fixtureMemory = payload.items.find((item) => item.body === photoBody)
    if (fixtureMemory) expect(fixtureMemory.author.avatarPath).toBeTruthy()
    if (fixtureMemory?.attachments[1]) {
      // Local-only fixture: the backend-served private image is presented as a pending video poster.
      const privatePhoto = fixtureMemory.attachments[1]
      fixtureMemory.attachments[1] = { ...privatePhoto, kind: 'video', width: null, height: null, previewPath: privatePhoto.originalDownloadPath, playbackPath: null }
    }
    await route.fulfill({ response, json: payload })
  })
  await page.evaluate((mediaId) => {
    type PosterGateWindow = Window & { __posterRequested?: () => void; __posterRequestedPromise?: Promise<void>; __releasePoster?: () => void }
    const target = window as unknown as PosterGateWindow
    const originalFetch = window.fetch.bind(window)
    let notifyRequested!: () => void
    let release!: () => void
    const requested = new Promise<void>((resolve) => { notifyRequested = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    target.__posterRequested = notifyRequested
    target.__posterRequestedPromise = requested
    target.__releasePoster = release
    const wrappedFetch = Object.assign((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString(), location.href)
      if (url.pathname.includes(`/media/${mediaId}/content`)) {
        notifyRequested()
        return gate.then(() => originalFetch(input, init))
      }
      return originalFetch(input, init)
    }, { preconnect: originalFetch.preconnect }) as typeof fetch
    window.fetch = wrappedFetch
  }, secondAssetId)
  let familyMetadataRequests = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === `/api/v1/families/${familyId}`) familyMetadataRequests += 1
  })
  await page.getByRole('button', { name: /Synthetic diagnostic family/ }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic diagnostic family' })).toBeVisible()
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(navigation).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Лента' })).toHaveAttribute('href', '#diagnostic-feed')
  await expect(navigation.getByRole('button', { name: 'Добавить' })).toBeDisabled()
  await expect(navigation.getByRole('button', { name: 'Семья' })).toBeDisabled()
  await expect(page.locator('#diagnostic-read-only-notice')).toContainText('управление семьёй недоступны')
  await expect.poll(() => navigation.locator('img').evaluateAll((images) => images.length === 3 && images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  const navigationGeometry = await navigation.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return { position: style.position, left: rect.left, width: rect.width, bottom: innerHeight - rect.bottom, height: rect.height, minHeight: style.minHeight, transform: style.transform }
  })
  expect(navigationGeometry.position).toBe('fixed')
  expect(navigationGeometry.left).toBe(12)
  expect(navigationGeometry.width).toBe(366)
  expect(navigationGeometry.bottom).toBe(8)
  expect(navigationGeometry.height).toBeGreaterThanOrEqual(82)
  expect(navigationGeometry.minHeight).toBe('82px')
  await expect(navigation.locator('.diagnostic-navigation-add-circle')).toHaveCSS('width', '48px')
  await expect(navigation.locator('.diagnostic-navigation-add-circle')).toHaveCSS('height', '48px')
  expect(navigationGeometry.transform).toBe('matrix(1, 0, 0, 1, -183, 0)')
  await expect(page.getByText('Synthetic diagnostic child', { exact: true })).toBeVisible()
  const logo = page.getByRole('img', { name: 'memoLy' })
  await expect(logo).toBeVisible()
  await expect.poll(() => logo.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  const childAvatar = page.getByRole('img', { name: 'Synthetic diagnostic child — фотография' })
  await expect(childAvatar).toBeVisible()
  await expect.poll(() => childAvatar.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 20_000 }).toBe(true)
  expect(familyMetadataRequests).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('diagnostic-feed-header-viewport.png') })
  await expect(page.getByText(photoBody)).toBeVisible()
  const images = page.getByRole('img', { name: 'Фотография воспоминания' })
  await expect(images).toHaveCount(1)
  const image = images.first()
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 20_000 }).toBe(true)
  const geometry = await image.evaluate((element: HTMLImageElement) => ({ naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
  const card = page.locator('.diagnostic-memory').filter({ hasText: photoBody }).first()
  const cardGeometry = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const authorRow = element.querySelector(':scope > .diagnostic-author-row')!.getBoundingClientRect()
    const avatar = element.querySelector<HTMLElement>('.diagnostic-author-avatar')!.getBoundingClientRect()
    const title = element.querySelector(':scope > .diagnostic-author-row h2')!.getBoundingClientRect()
    const date = element.querySelector(':scope > .diagnostic-author-row .diagnostic-meta')!.getBoundingClientRect()
    const media = element.querySelector(':scope > .diagnostic-carousel')!.getBoundingClientRect()
    const dots = element.querySelector(':scope > .diagnostic-carousel-dots')!.getBoundingClientRect()
    const caption = element.querySelector(':scope > .diagnostic-note')!.getBoundingClientRect()
    const style = getComputedStyle(element)
    return { width: rect.width, contentWidth: element.clientWidth, authorHeight: authorRow.height, avatarWidth: avatar.width, avatarHeight: avatar.height, titleTop: title.top, dateTop: date.top, mediaTop: media.top, mediaWidth: media.width, dotsTop: dots.top, dotsBottom: dots.bottom, captionTop: caption.top, borderRadius: style.borderRadius, borderColor: style.borderTopColor, marginBottom: style.marginBottom }
  })
  const pageContentWidth = await page.locator('.diagnostic-page').evaluate((element) => {
    const style = getComputedStyle(element)
    return element.getBoundingClientRect().width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
  })
  expect(cardGeometry.width).toBeCloseTo(pageContentWidth, 0)
  expect(cardGeometry.mediaWidth).toBeCloseTo(cardGeometry.contentWidth, 0)
  expect(cardGeometry.borderRadius).toBe('24px')
  expect(cardGeometry.borderColor).toBe('rgb(232, 223, 218)')
  expect(cardGeometry.marginBottom).toBe('16px')
  expect(cardGeometry.authorHeight).toBeCloseTo(58.5, 0)
  expect(cardGeometry.avatarWidth).toBe(40)
  expect(cardGeometry.avatarHeight).toBe(40)
  expect(cardGeometry.titleTop).toBeLessThanOrEqual(cardGeometry.dateTop)
  expect(cardGeometry.dateTop).toBeLessThan(cardGeometry.mediaTop)
  const ownerAvatarImage = card.locator('.diagnostic-author-avatar img')
  await expect(ownerAvatarImage).toHaveCount(1)
  await expect.poll(() => ownerAvatarImage.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 20_000 }).toBe(true)
  expect(ownerAvatar.avatar?.contentType).toBe('image/jpeg')
  expect(cardGeometry.mediaTop).toBeLessThan(cardGeometry.dotsTop)
  expect(cardGeometry.dotsBottom).toBeLessThanOrEqual(cardGeometry.captionTop)
  expect(geometry.width).toBeCloseTo(cardGeometry.mediaWidth, 0)
  expect(geometry.height).toBeCloseTo(geometry.width * geometry.naturalHeight / geometry.naturalWidth, 0)
  await page.screenshot({ path: testInfo.outputPath('diagnostic-card-geometry-390.png') })
  const secondDot = page.getByRole('button', { name: 'Медиа 2 из 2' })
  const firstStage = page.locator('[data-attachment-id]').first()
  const firstStageHeight = await firstStage.evaluate((element) => element.getBoundingClientRect().height)
  const posterRequest = page.evaluate(async () => await (window as unknown as Window & { __posterRequestedPromise: Promise<void> }).__posterRequestedPromise)
  await secondDot.click()
  await expect(secondDot).toHaveAttribute('aria-current', 'true')
  await posterRequest
  await expect.poll(() => firstStage.evaluate((element) => element.getBoundingClientRect().height)).toBe(firstStageHeight)
  await expect.poll(() => page.locator('[data-carousel-slide]').nth(1).evaluate((slide) => Math.abs(slide.getBoundingClientRect().left - slide.closest('.diagnostic-carousel')!.getBoundingClientRect().left) < 1)).toBe(true)
  await page.evaluate(() => (window as unknown as Window & { __releasePoster: () => void }).__releasePoster())
  const poster = page.getByRole('img', { name: 'Кадр видео' })
  await expect(poster).toBeVisible()
  await expect.poll(() => poster.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 20_000 }).toBe(true)
  const posterGeometry = await poster.evaluate((element: HTMLImageElement) => ({ naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }))
  expect(posterGeometry.width).toBeGreaterThan(300)
  expect(posterGeometry.height).toBeCloseTo(posterGeometry.width * posterGeometry.naturalHeight / posterGeometry.naturalWidth, 0)
  await expect.poll(() => firstStage.evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(posterGeometry.width * posterGeometry.naturalHeight / posterGeometry.naturalWidth, 0)
  const firstDot = page.getByRole('button', { name: 'Медиа 1 из 2' })
  await firstDot.click()
  await expect(firstDot).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => page.locator('[data-carousel-slide]').first().evaluate((slide) => Math.abs(slide.getBoundingClientRect().left - slide.closest('.diagnostic-carousel')!.getBoundingClientRect().left) < 1)).toBe(true)
  await secondDot.click()
  await expect(secondDot).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => page.locator('[data-carousel-slide]').nth(1).evaluate((slide) => Math.abs(slide.getBoundingClientRect().left - slide.closest('.diagnostic-carousel')!.getBoundingClientRect().left) < 1)).toBe(true)
  await expect(poster).toBeVisible()
  await expect.poll(() => poster.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  const revisitedGeometry = await page.locator('.diagnostic-carousel').evaluate((viewport) => ({ width: viewport.getBoundingClientRect().width, height: viewport.getBoundingClientRect().height, scrollLeft: viewport.scrollLeft }))
  expect(revisitedGeometry.width).toBeGreaterThan(300)
  expect(revisitedGeometry.height).toBeCloseTo(revisitedGeometry.width * posterGeometry.naturalHeight / posterGeometry.naturalWidth, 0)
  expect(posterGeometry.width).toBeCloseTo(revisitedGeometry.width, 0)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(secondDot).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => page.locator('[data-carousel-slide]').nth(1).evaluate((slide) => Math.abs(slide.getBoundingClientRect().left - slide.closest('.diagnostic-carousel')!.getBoundingClientRect().left) < 1)).toBe(true)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(secondDot).toHaveAttribute('aria-current', 'true')
  await page.screenshot({ path: testInfo.outputPath('diagnostic-feed-carousel-poster-viewport.png') })
  await expect(secondDot).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => page.locator('[data-carousel-slide]').nth(1).evaluate((slide) => Math.abs(slide.getBoundingClientRect().left - slide.closest('.diagnostic-carousel')!.getBoundingClientRect().left) < 1)).toBe(true)
  const capturedGeometry = await page.locator('.diagnostic-carousel').evaluate((viewport) => {
    const stage = viewport.querySelector<HTMLElement>('[data-attachment-id]')!
    return { width: viewport.getBoundingClientRect().width, height: viewport.getBoundingClientRect().height, stageWidth: stage.getBoundingClientRect().width, stageHeight: stage.getBoundingClientRect().height }
  })
  expect(capturedGeometry.width).toBeCloseTo(revisitedGeometry.width, 0)
  expect(capturedGeometry.height).toBeCloseTo(revisitedGeometry.height, 0)
  expect(capturedGeometry.stageWidth).toBeCloseTo(capturedGeometry.width, 0)
  expect(capturedGeometry.stageHeight).toBeCloseTo(capturedGeometry.width * posterGeometry.naturalHeight / posterGeometry.naturalWidth, 0)
  await expect.poll(() => poster.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0 && element.getBoundingClientRect().width > 300)).toBe(true)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 20_000 }).toBe(true)
  const cursorResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/memories') && url.searchParams.has('cursor')
  })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const nextPage = await cursorResponse
  expect(nextPage.ok()).toBe(true)
  await expect(page.getByText('Synthetic diagnostic note 21')).toBeVisible({ timeout: 20_000 })
  const fallbackCard = page.locator('.diagnostic-memory').filter({ hasText: 'Synthetic fallback author note' })
  await expect(fallbackCard.locator('.diagnostic-author-avatar')).toHaveText('S')
  await expect(fallbackCard.locator('.diagnostic-author-avatar img')).toHaveCount(0)
})

test('signed-out diagnostic starts MAX browser link and redeems into the same diagnostic feed', async ({ page }) => {
  const { userId, identityId } = await seed()
  const diagnosticPath = '/__experiments/minimal-feed/diagnostic.html'
  await page.goto(diagnosticPath)
  const startButton = page.getByRole('button', { name: 'Создать код для входа через MAX' })
  await expect(startButton).toBeVisible()
  const startResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/browser-link/start'))
  await startButton.click()
  const started = await startResponse
  expect(started.ok()).toBe(true)
  const challenge = await started.json() as { challengeId: string; displayCode: string; startParam: string }
  await expect(page.getByLabel('Код подтверждения')).toHaveText(challenge.displayCode)
  await expect(page.getByRole('link', { name: 'Открыть MAX' })).toHaveAttribute('href', `https://max.ru/id911018762027_bot?startapp=${challenge.startParam}`)
  expect(new URL(page.url()).pathname).toBe(diagnosticPath)

  const redeemResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/auth/browser-link/${challenge.challengeId}/redeem`))
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    // MAX approval happens outside the browser; this smoke keeps its boundary at the real redeem endpoint.
    await prisma.browserLoginChallenge.update({ where: { id: challenge.challengeId }, data: {
      state: 'approved',
      approvedAt: new Date(),
      approvedUserId: userId,
      approvedExternalIdentityId: identityId,
    } })
  } finally { await prisma.$disconnect() }

  const redeemed = await redeemResponse
  expect(redeemed.ok()).toBe(true)
  await expect(page.getByText(/Вы вошли как Synthetic MAX user/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Synthetic diagnostic family/ })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(diagnosticPath)
  await page.getByRole('button', { name: /Synthetic diagnostic family/ }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic diagnostic family' })).toBeVisible()
  await expect(page.getByText('Synthetic diagnostic note 01')).toBeVisible()
})
