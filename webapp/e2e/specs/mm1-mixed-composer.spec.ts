import type { Locator, Page } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { createPrisma } from '../../../backend/src/db'
import { expect, test } from '../helpers/test'

const subject = '81000191'
const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
const occurredAt = '2024-06-15T09:00:00.000Z' // Local noon in the family's Europe/Moscow timezone.

let fixture: { userId: string; familyId: string; childId: string } | undefined

test.describe('MM-1 mixed media composer', () => {
  test.beforeAll(async () => {
    fixture = await seedOwner()
  })

  test.afterAll(async () => {
    if (fixture) {
      const memories = await prisma.memory.findMany({ where: { familyId: fixture.familyId }, select: { id: true } })
      await prisma.taskOutbox.deleteMany({ where: { type: 'max:backup-media', dedupeKey: { in: memories.map(({ id }) => `max-backup-media:${id}`) } } })
      await prisma.maxMemoryBackup.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.maxVideoReference.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.memoryMedia.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.memory.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.maxOutboundSource.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.maxVideoUploadSession.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.mediaAsset.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.child.deleteMany({ where: { familyId: fixture.familyId } })
      await prisma.family.deleteMany({ where: { id: fixture.familyId } })
      await prisma.externalIdentity.deleteMany({ where: { userId: fixture.userId } })
      await prisma.authSession.deleteMany({ where: { userId: fixture.userId } })
      await prisma.user.deleteMany({ where: { id: fixture.userId } })
    }
    await prisma.$disconnect()
  })

  test('publishes photo-video-photo-video as one ordered media Memory on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installTelegramHost(page, signedInitData(Number(subject), 'MM-1 E2E'))
    await page.clock.setFixedTime(new Date('2026-09-20T06:00:00.000Z'))
    await page.goto('/')
    const provider = await installSyntheticMaxProvider(page, fixture!, generatedVideo())
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    await page.locator('.family-hub-card').click()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await page.getByRole('button', { name: 'Добавить' }).click()
    await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
    await expect(page.locator('[data-add-screen="photo"]')).toBeVisible()

    const files = [
      { name: 'mm1-photo-a.png', mimeType: 'image/png', buffer: generatedPhoto(1) },
      { name: 'mm1-video-b.mp4', mimeType: 'video/mp4', buffer: generatedVideo() },
      { name: 'mm1-photo-c.png', mimeType: 'image/png', buffer: generatedPhoto(2) },
      { name: 'mm1-video-d.mp4', mimeType: 'video/mp4', buffer: generatedVideo() },
    ]
    const expectedKinds = ['photo', 'video', 'photo', 'video']
    await page.locator('#photo-composer-files').setInputFiles(files)
    await page.locator('#photo-composer-caption').fill('Первый смешанный день')
    await page.locator('#photo-composer-date').fill('2024-06-15')
    await expect(page.getByRole('button', { name: 'Опубликовать (4)' })).toBeEnabled()
    await expect(page.locator('.memoly-add-photo-thumb')).toHaveCount(4)
    await expect(page.locator('.memoly-add-photo-thumb').evaluateAll((items) => items.map((item) => item.getAttribute('data-media-kind')))).resolves.toEqual(expectedKinds)
    await expect(page.getByRole('button', { name: 'Удалить mm1-video-b.mp4' })).toBeVisible()
    await expect(page.locator('.memoly-add-media-order')).toHaveText(['1', '2', '3', '4'])
    await test.info().attach('mm1-mixed-composer-selected-390.png', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.setViewportSize({ width: 320, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await page.setViewportSize({ width: 390, height: 844 })

    const requestBodies: Array<Record<string, unknown>> = []
    await page.evaluate(() => {
      const observed: string[] = []
      Object.assign(window, { __mm1ProgressStates: observed })
      new MutationObserver(() => {
        const loading = document.querySelector('.memoly-add-loading')
        if (loading) observed.push(loading.textContent ?? '')
      }).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/families/${fixture!.familyId}/memories`) {
        requestBodies.push(request.postDataJSON() as Record<string, unknown>)
      }
    })
    const before = await prisma.memory.count({ where: { familyId: fixture!.familyId } })
    const publishResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/v1/families/${fixture!.familyId}/memories`))
    await page.getByRole('button', { name: 'Опубликовать (4)' }).click()
    await provider.finalizeStarted
    await expect(page.getByText('Обрабатываем вложения…')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Сохранение вложений' })).toHaveAttribute('aria-valuenow', '100')
    provider.releaseFinalizes()
    const response = await publishResponse
    expect(response.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Воспоминание опубликовано!' })).toBeVisible()
    const progressStates = await page.evaluate(() => (window as Window & { __mm1ProgressStates?: string[] }).__mm1ProgressStates ?? [])
    expect(progressStates.some((state) => /Загружено \d+% байт/.test(state))).toBe(true)
    expect(progressStates.some((state) => state.includes('Обрабатываем вложения…'))).toBe(true)
    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).toMatchObject({ kind: 'media', body: 'Первый смешанный день', occurredAt })
    const submittedAttachments = requestBodies[0]!.attachments as Array<{ source: 'private_storage'; mediaId: string } | { source: 'max'; sessionId: string }>
    expect(submittedAttachments.map((item) => item.source)).toEqual(['private_storage', 'max', 'private_storage', 'max'])
    expect(provider.finalizedSessionIds.toSorted()).toEqual(submittedAttachments.filter((item) => item.source === 'max').map((item) => item.sessionId).toSorted())
    expect(provider.uploadedSessionIds.toSorted()).toEqual(provider.finalizedSessionIds.toSorted())

    const created = await prisma.memory.findMany({
      where: { familyId: fixture!.familyId },
      include: { media: { orderBy: { position: 'asc' }, include: { asset: true } }, maxVideoReferences: { orderBy: { attachmentPosition: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    expect(await prisma.memory.count({ where: { familyId: fixture!.familyId } })).toBe(before + 1)
    expect(created).toHaveLength(1)
    const memory = created[0]!
    expect(memory.kind).toBe('media')
    expect(memory.body).toBe('Первый смешанный день')
    expect(memory.occurredAt.toISOString()).toBe(occurredAt)
    expect(memory.sourcePublishedAt).toBeNull()
    expect(memory.media.map(({ mediaId }) => mediaId)).toEqual(submittedAttachments.filter((item) => item.source === 'private_storage').map((item) => item.mediaId))
    expect(memory.media.map(({ position }) => position)).toEqual([0, 2])
    expect(memory.media.map(({ asset }) => asset.mediaKind)).toEqual(['photo', 'photo'])
    expect(memory.maxVideoReferences.map(({ attachmentPosition }) => attachmentPosition)).toEqual([1, 3])
    expect(memory.maxVideoReferences.map(({ providerAttachmentId }) => providerAttachmentId)).toEqual(['synthetic-video-1', 'synthetic-video-2'])

    const playbackResponses: Array<{ status: number; contentType: string }> = []
    page.on('response', (entry) => {
      if (entry.request().method() === 'GET' && entry.url().includes('/media/max-videos/') && entry.url().endsWith('/content')) {
        playbackResponses.push({ status: entry.status(), contentType: entry.headers()['content-type'] ?? '' })
      }
    })
    const feedResponse = page.waitForResponse((entry) => entry.request().method() === 'GET' && new URL(entry.url()).pathname === `/api/v1/families/${fixture!.familyId}/memories`)
    await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
    const feedPayload = await (await feedResponse).json() as { items: Array<{ id: string; familyId: string; childId: string; author: { id: string; name: string }; kind: string; body: string; occurredAt: string; attachments: Array<{ id: string; kind: string; renditionStatus?: string; playbackPath?: string | null }>; likes: { count: number; likedByMe: boolean }; capabilities: { edit: boolean; delete: boolean; like: boolean } }> }
    const feedMatches = feedPayload.items.filter((item) => item.id === memory.id)
    expect(feedMatches).toHaveLength(1)
    expect(feedMatches[0]).toMatchObject({
      familyId: fixture!.familyId,
      childId: fixture!.childId,
      author: { id: fixture!.userId, name: 'MM-1 E2E owner' },
      kind: 'media', body: 'Первый смешанный день', occurredAt,
      likes: { count: 0, likedByMe: false },
      capabilities: { edit: true, delete: true, like: true },
    })
    expect(feedMatches[0]!.attachments.map(({ kind, source }) => ({ kind, source }))).toEqual([
      { kind: 'photo', source: 'private_storage' }, { kind: 'video', source: 'max' },
      { kind: 'photo', source: 'private_storage' }, { kind: 'video', source: 'max' },
    ])
    expect(feedMatches[0]!.attachments[1]).toMatchObject({ id: memory.maxVideoReferences[0]!.id, playbackPath: expect.any(String) })

    const card = page.locator(`[data-memory-id="${memory.id}"]`)
    await expect(card).toHaveCount(1)
    await expect(card.locator('.author-name')).toHaveText('MM-1 E2E owner')
    await expect(card.locator('.author-time')).toContainText('15')
    await expect(card.locator('.caption')).toContainText('Первый смешанный день')
    await expect(card.getByRole('button', { name: 'Поставить сердечко' })).toHaveAttribute('aria-pressed', 'false')
    await expect(card.getByRole('button', { name: 'Действия с воспоминанием' })).toHaveCount(1)
    await expect(card.locator('.memoly-mixed-slide')).toHaveCount(4)
    await expect(card.locator('.memoly-mixed-slide').evaluateAll((slides) => slides.map((slide) => slide.getAttribute('data-media-kind')))).resolves.toEqual(expectedKinds)
    await expect(card).toContainText('1 / 4')
    const photoStage390 = await card.locator('[data-carousel-active="true"]').evaluate((slide) => {
      const bounds = slide.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height }
    })
    expect(Math.abs(photoStage390.width / photoStage390.height - 4 / 5)).toBeLessThan(0.02)
    await test.info().attach('mm4-created-feed-card-390.png', { body: await card.screenshot({ animations: 'disabled' }), contentType: 'image/png' })

    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card).toContainText('2 / 4')
    for (const width of [390, 320, 430]) {
      await page.setViewportSize({ width, height: 844 })
      const stage = await card.locator('[data-carousel-active="true"]').evaluate((slide) => {
        const bounds = slide.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height }
      })
      expect(Math.abs(stage.width / stage.height - 4 / 5), `video stage at ${width}px`).toBeLessThan(0.02)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width)
      if (width === 390) expect(Math.abs(stage.height - photoStage390.height)).toBeLessThan(2)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const cardVideo = card.locator('[data-carousel-active="true"] video')
    await expect(cardVideo).toHaveCount(1)
    await expect(cardVideo).not.toHaveAttribute('autoplay', /.*/)
    await expect.poll(() => cardVideo.evaluate((video: HTMLVideoElement) => ({ width: video.videoWidth, height: video.videoHeight, error: video.error?.code ?? null }))).toMatchObject({ width: 320, height: 180, error: null })
    await expect(card.locator('[data-carousel-active="true"] [role="alert"]')).toHaveCount(0)
    await card.locator('[data-carousel-active="true"]').getByRole('button', { name: 'Смотреть видео', exact: true }).click()
    await expect.poll(() => cardVideo.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
    await expect.poll(() => cardVideo.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false)
    await expect.poll(() => cardVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0)
    await test.info().attach('mm4-created-ready-video-card-390.png', { body: await card.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    await card.getByRole('button', { name: 'Открыть воспоминание Первый смешанный день' }).click()
    const viewer = page.locator('[data-mixed-viewer]')
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('2 / 4')
    await expect(viewer.locator('video')).toHaveCount(1)
    await expect.poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => ({ readyState: video.readyState, width: video.videoWidth, height: video.videoHeight, error: video.error?.code ?? null }))).toMatchObject({ width: 320, height: 180, error: null })
    await expect(viewer.getByRole('alert')).toHaveCount(0)
    await viewer.getByRole('button', { name: 'Смотреть видео', exact: true }).click()
    await expect.poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
    await expect.poll(() => viewer.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0)
    await expect.poll(() => playbackResponses.length).toBeGreaterThan(0)
    expect(playbackResponses.every(({ status, contentType }) => [200, 206].includes(status) && contentType.startsWith('video/mp4')), JSON.stringify(playbackResponses)).toBe(true)
    await expect.poll(() => viewer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await test.info().attach('mm4-created-video-viewer-390.png', { body: await viewer.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    await viewer.getByRole('button', { name: 'Далее' }).click()
    await expect(viewer).toContainText('3 / 4')
    await expect(viewer.locator('img')).toBeVisible()
    await test.info().attach('mm4-created-photo-viewer-390.png', { body: await viewer.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Открыть воспоминание Первый смешанный день' })).toBeFocused()
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card).toContainText('3 / 4')
    await expect(cardVideo).toHaveCount(0)
    await waitForActiveSlideAlignment(card)
    const returnedPhotoStage390 = await card.locator('[data-carousel-active="true"]').evaluate((slide) => {
      const bounds = slide.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height }
    })
    expect(Math.abs(returnedPhotoStage390.height - photoStage390.height)).toBeLessThan(2)
    await test.info().attach('int1-mixed-returned-photo-card-390.png', {
      body: await card.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    })
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card).toContainText('4 / 4')
    await expect(card.locator('[data-carousel-active="true"]')).toHaveAttribute('data-media-kind', 'video')
  })

  test('publishes five app photos once and opens the selected Feed slide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installTelegramHost(page, signedInitData(Number(subject), 'MM-1 E2E'))
    await page.clock.setFixedTime(new Date('2026-09-20T06:00:00.000Z'))
    await page.goto('/')
    let documentNavigations = 0
    page.on('request', (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentNavigations += 1 })
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    await page.locator('.family-hub-card').click()
    await page.getByRole('button', { name: 'Добавить' }).click()
    await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
    await expect(page.locator('[data-add-screen="photo"]')).toBeVisible()

    const files = Array.from({ length: 5 }, (_, index) => ({
      name: `five-photo-${index + 1}.png`, mimeType: 'image/png', buffer: generatedLargePhoto(index),
    }))
    await page.locator('#photo-composer-files').setInputFiles(files)
    await page.locator('#photo-composer-caption').fill('Пять кадров E2E')
    await page.locator('#photo-composer-date').fill('2024-06-15')
    await expect(page.locator('.memoly-add-photo-thumb')).toHaveCount(5)
    await expect(page.locator('.memoly-add-media-order')).toHaveText(['1', '2', '3', '4', '5'])

    // Let the real signed PUTs reach the backend, then hold their responses so the browser
    // visibly reports aggregate upload progress before the remaining three files start.
    let signalTwoUploads!: () => void
    let releaseUploads!: () => void
    const twoUploads = new Promise<void>((resolve) => { signalTwoUploads = resolve })
    const uploadGate = new Promise<void>((resolve) => { releaseUploads = resolve })
    let uploaded = 0
    await page.route('**/storage/objects/**', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      uploaded += 1
      if (uploaded === 2) signalTwoUploads()
      await uploadGate
      await route.fulfill({ response })
    })
    const requestBodies: Array<Record<string, unknown>> = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/families/${fixture!.familyId}/memories`) {
        requestBodies.push(request.postDataJSON() as Record<string, unknown>)
      }
    })
    let signalCreateReached!: () => void
    let releaseCreate!: () => void
    const createReached = new Promise<void>((resolve) => { signalCreateReached = resolve })
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
    await page.route(`**/api/v1/families/${fixture!.familyId}/memories`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      signalCreateReached()
      await createGate
      await route.fulfill({ response })
    })
    const before = await prisma.memory.count({ where: { familyId: fixture!.familyId } })
    const publishResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/v1/families/${fixture!.familyId}/memories`))
    await page.getByRole('button', { name: 'Опубликовать (5)' }).click()
    await twoUploads
    try {
      await expect(page.locator('.memoly-add-loading')).toContainText('Готово вложений: 0 из 5')
      await test.info().attach('int1-five-photo-upload-active-390.png', {
        body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
      })
    } finally { releaseUploads() }
    await createReached
    try {
      await expect(page.getByRole('progressbar', { name: 'Сохранение вложений' })).toHaveAttribute('aria-valuenow', '100')
      await test.info().attach('int1-five-photo-upload-complete-390.png', {
        body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
      })
    } finally { releaseCreate() }
    expect((await publishResponse).ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Фото опубликованы!' })).toBeVisible()
    expect(uploaded).toBe(5)
    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).toMatchObject({ kind: 'photo', body: 'Пять кадров E2E', occurredAt })
    const submittedIds = requestBodies[0]!.mediaIds as string[]
    expect(submittedIds).toHaveLength(5)
    expect(new Set(submittedIds).size).toBe(5)

    const memory = await prisma.memory.findFirstOrThrow({
      where: { familyId: fixture!.familyId, body: 'Пять кадров E2E' },
      include: { media: { orderBy: { position: 'asc' }, include: { asset: true } } },
    })
    expect(await prisma.memory.count({ where: { familyId: fixture!.familyId } })).toBe(before + 1)
    expect(memory.kind).toBe('photo')
    expect(memory.media.map(({ position }) => position)).toEqual([0, 1, 2, 3, 4])
    expect(memory.media.map(({ mediaId }) => mediaId)).toEqual(submittedIds)
    expect(memory.media.map(({ asset }) => asset.mediaKind)).toEqual(['photo', 'photo', 'photo', 'photo', 'photo'])

    await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
    const card = page.locator(`[data-memory-id="${memory.id}"]`)
    await expect(card).toHaveCount(1)
    await expect(card.locator('.memoly-mixed-slide')).toHaveCount(5)
    await expect(card.locator('.memoly-mixed-slide').evaluateAll((slides) => slides.map((slide) => slide.getAttribute('data-media-kind')))).resolves.toEqual(['photo', 'photo', 'photo', 'photo', 'photo'])
    await expect(card).toContainText('1 / 5')
    for (const width of [390, 320, 430]) {
      await page.setViewportSize({ width, height: 844 })
      const stage = await card.locator('[data-carousel-active="true"]').evaluate((slide) => {
        const bounds = slide.getBoundingClientRect()
        return { width: bounds.width, height: bounds.height }
      })
      expect(Math.abs(stage.width / stage.height - 4 / 5), `photo stage at ${width}px`).toBeLessThan(0.02)
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await test.info().attach('int1-five-photo-feed-carousel-390.png', {
      body: await card.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    })
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await card.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(card).toContainText('3 / 5')
    await waitForActiveSlideAlignment(card)
    await card.locator('[data-carousel-active="true"]').getByRole('button', { name: 'Открыть фото' }).click()
    const viewer = page.locator('.pswp--open')
    await expect(viewer).toBeVisible()
    await expect(viewer.locator('.pswp__counter')).toHaveText('3 / 5')
    await test.info().attach('int1-five-photo-selected-viewer-390.png', {
      body: await viewer.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    })
    expect(documentNavigations).toBe(0)
    expect(await prisma.memory.count({ where: { familyId: fixture!.familyId } })).toBe(before + 1)
  })
})

async function waitForActiveSlideAlignment(card: Locator) {
  let previousLeftDelta: number | null = null
  let alignedFrames = 0
  await expect.poll(async () => {
    const leftDelta = await card.evaluate((element) => {
      const viewport = element.querySelector('.memoly-mixed-viewport')!
      const activeSlide = element.querySelector('[data-carousel-active="true"]')!
      return activeSlide.getBoundingClientRect().left - viewport.getBoundingClientRect().left
    })
    alignedFrames = Math.abs(leftDelta) < 1 && previousLeftDelta !== null && Math.abs(leftDelta - previousLeftDelta) < 0.05
      ? alignedFrames + 1 : 0
    previousLeftDelta = leftDelta
    return alignedFrames
  }, { intervals: [40, 40, 40, 40, 40, 40, 40, 40, 40, 40], timeout: 5_000 }).toBeGreaterThanOrEqual(3)
}

async function installSyntheticMaxProvider(page: Page, owner: { userId: string; familyId: string; childId: string }, video: Buffer) {
  const sessions = new Map<string, { uploadToken: string; uploaded: boolean; providerAttachmentId: string }>()
  const uploadedSessionIds: string[] = []
  const finalizedSessionIds: string[] = []
  let signalFinalizeStarted!: () => void
  let releaseFinalizes!: () => void
  const finalizeStarted = new Promise<void>((resolve) => { signalFinalizeStarted = resolve })
  const finalizeGate = new Promise<void>((resolve) => { releaseFinalizes = resolve })
  const base = `/api/v1/families/${owner.familyId}/max-video-uploads`

  // The E2E API intentionally runs with MAX disabled. These three routes simulate only its
  // provider boundary; the real Memory create and Feed still execute against PostgreSQL.
  await page.route(`**${base}/reserve`, async (route) => {
    const input = route.request().postDataJSON() as {
      childId: string; body: string; mode: string; occurredAt: string; fileName: string;
      idempotencyKey: string
    }
    expect(input).toMatchObject({ childId: owner.childId, body: '', mode: 'attachment' })
    const sessionId = randomUUID()
    const uploadToken = `synthetic-max-token-${sessionId}`
    const expiresAt = new Date(Date.now() + 15 * 60_000)
    await prisma.maxVideoUploadSession.create({ data: {
      id: sessionId, familyId: owner.familyId, authorId: owner.userId, childId: owner.childId,
      plannedMemoryId: randomUUID(), body: '', mode: 'attachment', occurredAt: new Date(input.occurredAt),
      idempotencyFingerprint: randomUUID(), idempotencyKey: input.idempotencyKey,
      expiresAt, state: 'reserved', providerUploadToken: uploadToken,
    } })
    sessions.set(sessionId, { uploadToken, uploaded: false,
      providerAttachmentId: input.fileName.includes('video-b') ? 'synthetic-video-1' : 'synthetic-video-2' })
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
      state: 'reserved', sessionId, expiresAt: expiresAt.toISOString(),
      uploadUrl: new URL(`/synthetic-max-upload/${sessionId}`, page.url()).toString(), uploadToken,
    }) })
  })
  await page.route('**/synthetic-max-upload/*', async (route) => {
    const sessionId = new URL(route.request().url()).pathname.split('/').at(-1)!
    const session = sessions.get(sessionId)
    expect(session).toBeDefined()
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataBuffer()?.byteLength).toBeGreaterThan(video.byteLength)
    await new Promise((resolve) => setTimeout(resolve, 150))
    session!.uploaded = true
    uploadedSessionIds.push(sessionId)
    await route.fulfill({ status: 200, body: '{}' })
  })
  await page.route(new RegExp(`${base}/[0-9a-f-]{36}/finalize$`), async (route) => {
    const sessionId = new URL(route.request().url()).pathname.split('/').at(-2)!
    const session = sessions.get(sessionId)
    expect(session?.uploaded).toBe(true)
    expect(route.request().postDataJSON()).toEqual({ uploadToken: session!.uploadToken })
    signalFinalizeStarted()
    await finalizeGate
    await prisma.$transaction(async (tx) => {
      await tx.maxVideoUploadSession.update({ where: { id: sessionId }, data: { state: 'finalized' } })
      await tx.maxOutboundSource.create({ data: {
        uploadSessionId: sessionId, familyId: owner.familyId, recipientId: 900n,
        messageId: `synthetic-max-message-${sessionId}`, providerAttachmentId: session!.providerAttachmentId,
        width: 320, height: 180, durationMs: 2_000,
      } })
    })
    finalizedSessionIds.push(sessionId)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'finalized', sessionId }) })
  })
  await page.route(`**/api/v1/families/${owner.familyId}/media/max-videos/*/readiness`, (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ state: 'ready', recheckable: false }),
  }))
  // Private playback is fetched by the service worker, so route at context scope.
  await page.context().route(`**/api/v1/families/${owner.familyId}/media/max-videos/*/content`, (route) => route.fulfill({
    body: video, contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes' },
  }))
  return { uploadedSessionIds, finalizedSessionIds, finalizeStarted, releaseFinalizes }
}

async function seedOwner() {
  const prior = await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'telegram', subject } }, select: { userId: true } })
  if (prior) {
    await prisma.authSession.deleteMany({ where: { userId: prior.userId } })
    await prisma.family.deleteMany({ where: { ownerUserId: prior.userId } })
    await prisma.externalIdentity.deleteMany({ where: { userId: prior.userId } })
    await prisma.user.deleteMany({ where: { id: prior.userId } })
  }
  const user = await prisma.user.create({ data: { displayName: 'MM-1 E2E owner' } })
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
  const familyId = randomUUID()
  const childId = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.family.create({ data: { id: familyId, ownerUserId: user.id, name: 'MM-1 E2E', timezone: 'Europe/Moscow' } })
    await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'full' } })
    await tx.child.create({ data: { id: childId, familyId, displayName: 'Лиза' } })
  })
  return { userId: user.id, familyId, childId }
}

function signedInitData(id: number, name: string) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1_000)), query_id: randomUUID(), user: JSON.stringify({ id, first_name: name }) })
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}

async function installTelegramHost(page: Page, initData: string) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((value) => {
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
      initData: value, version: '8.0', platform: 'tdesktop', safeAreaInset: { top: 24, bottom: 18 }, contentSafeAreaInset: { top: 24, bottom: 18 },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, ready() {},
    } } })
  }, initData)
}

function generatedVideo() {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x180:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { encoding: 'buffer', maxBuffer: 10_000_000 })
  if (result.status !== 0) throw new Error(`synthetic video fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function generatedPhoto(index: number) {
  const color = index === 1 ? 'orange' : 'blue'
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=32x24:d=0.1`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1_000_000 })
  if (result.status !== 0) throw new Error(`synthetic photo fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function generatedLargePhoto(index: number) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `testsrc2=s=1024x768:d=0.1:rate=${25 + index}`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'],
  { encoding: 'buffer', maxBuffer: 2_000_000 })
  if (result.status !== 0) throw new Error(`synthetic large photo fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}
