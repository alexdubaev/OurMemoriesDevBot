import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('production feed carousel keeps a fixed frame through real drags and opens the selected attachment fullscreen', async ({ page }, testInfo) => {
  const portraitVideo = await readFile(fileURLToPath(new URL('./fixtures/portrait-edges.mp4', import.meta.url)))
  const landscapeVideo = await readFile(fileURLToPath(new URL('./fixtures/landscape-edges.mp4', import.meta.url)))
  await page.route('**/api/v1/families/*/media/playback-session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('**/media/videos/*/content', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: route.request().url().includes('444444444442') ? landscapeVideo : portraitVideo, headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/fixed-carousel.harness.html')
  const card = page.locator('.memory-card').first()
  const viewport = card.locator('.memoly-mixed-viewport')
  await expect(viewport).toBeVisible()
  await expect(page.locator('.memoly-app-root[data-ui-version="v2"]')).toBeVisible()
  await expect(page.locator('[data-carousel-position="1"] .memoly-mixed-slide-poster[data-poster-ready="true"] img[alt="Кадр видео"]')).toBeVisible()
  await expect(page.locator('[data-carousel-dot]')).toHaveCount(4)
  await expect(page.getByText('Synthetic carousel caption')).toBeVisible()
  const singleViewport = page.locator('.memory-card').nth(1).locator('.memoly-mixed-viewport')
  await expect(singleViewport).toBeVisible()
  await expect.poll(async () => { const box = await singleViewport.boundingBox(); return box ? box.height / box.width : 0 }).toBeCloseTo(1280 / 720, 2)

  const initial = await viewport.boundingBox()
  const caption = await card.locator('.caption').boundingBox()
  expect(initial).not.toBeNull()
  expect(initial!.height / initial!.width).toBeCloseTo(1.25, 2)
  await page.screenshot({ path: testInfo.outputPath('feed-v2-carousel.png') })
  const startDots = await card.locator('.memoly-mixed-controls').boundingBox()

  let lastSelected = 1
  let delayedPosterReleased = false
  for (const selected of [2, 3, 4, 3, 2, 1]) {
    const rect = await viewport.boundingBox()
    const y = rect!.y + rect!.height / 2
    const forward = selected > lastSelected
    await page.mouse.move(forward ? rect!.x + rect!.width - 20 : rect!.x + 20, y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(forward ? rect!.x + rect!.width - 20 - step * (rect!.width / 10) : rect!.x + 20 + step * (rect!.width / 10), y, { steps: 1 })
      await page.waitForTimeout(12)
      const duringDrag = await viewport.boundingBox()
      expect(duringDrag!.height).toBeCloseTo(initial!.height, 0)
      expect(duringDrag!.width).toBeCloseTo(initial!.width, 0)
      if (lastSelected <= 2) await expect(page.locator(`[data-carousel-position="${lastSelected}"] .memoly-mixed-slide-poster[data-poster-ready="true"] img[alt="Кадр видео"]`)).toBeVisible()
    }
    await page.mouse.up()
    await expect(page.locator(`[data-carousel-dot="${selected}"]`)).toHaveClass(/active/)
    await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
    const nextRect = await viewport.boundingBox()
    expect(nextRect!.height).toBeCloseTo(initial!.height, 0)
    expect(nextRect!.width).toBeCloseTo(initial!.width, 0)
    expect((await card.locator('.caption').boundingBox())!.y).toBeCloseTo(caption!.y, 0)
    expect((await card.locator('.memoly-mixed-controls').boundingBox())!.y).toBeCloseTo(startDots!.y, 0)
    if (selected === 2 && !delayedPosterReleased) {
      await expect.poll(() => page.evaluate(() => window.__fixedCarouselProbe?.delayedPosterWaiters.length ?? 0)).toBeGreaterThan(0)
      await page.evaluate(() => window.__fixedCarouselProbe?.release())
      delayedPosterReleased = true
      await expect(page.locator('[data-carousel-position="2"] img[alt="Кадр видео"]')).toBeVisible()
    }
    lastSelected = selected
  }

  await expect(page.locator('[data-carousel-position="1"] video')).toHaveCount(0)
  await expect(page.locator('[data-carousel-position="2"] video')).toHaveCount(0)
  const swipeNext = async () => {
    const rect = await viewport.boundingBox()
    const y = rect!.y + rect!.height / 2
    await page.mouse.move(rect!.x + rect!.width - 20, y)
    await page.mouse.down()
    await page.mouse.move(rect!.x + 20, y, { steps: 8 })
    await page.mouse.up()
  }
  const swipePrevious = async () => {
    const rect = await viewport.boundingBox()
    const y = rect!.y + rect!.height / 2
    await page.mouse.move(rect!.x + 20, y)
    await page.mouse.down()
    await page.mouse.move(rect!.x + rect!.width - 20, y, { steps: 8 })
    await page.mouse.up()
  }
  await swipeNext()
  await swipePrevious()
  await expect(page.locator('[data-carousel-dot="1"]')).toHaveClass(/active/)
  await swipeNext()
  await expect(page.locator('[data-carousel-dot="2"]')).toHaveClass(/active/)
  await expect(page.locator('[data-carousel-position="2"] img[alt="Кадр видео"]')).toBeVisible()
  await expect(page.locator('[data-carousel-position="3"] img[alt="Воспоминание"]')).toHaveCSS('object-fit', 'contain')

  await page.locator('[data-carousel-position="2"] button[aria-label^="Открыть видео"]').click()
  const viewer = page.locator('[data-mixed-viewer]')
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText('2 / 4')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('feed-v2-fullscreen-video.png') })
  const viewerVideo = viewer.locator('video')
  await expect.poll(() => viewerVideo.evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight])).toEqual([640, 360])
  const viewerMedia = viewer.locator('.memoly-mixed-viewer-media')
  const mediaBox = await viewerMedia.boundingBox()
  const videoBox = await viewerVideo.boundingBox()
  expect(mediaBox).not.toBeNull()
  expect(videoBox).not.toBeNull()
  expect(videoBox!.width).toBeGreaterThan(0.8 * mediaBox!.width)
  expect(videoBox!.height).toBeGreaterThan(0.8 * mediaBox!.height)
  await viewer.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect(viewer.getByRole('button', { name: 'Поставить видео на паузу' })).toBeVisible()
  await expect.poll(() => viewerVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1)
  const timeline = viewer.getByRole('slider', { name: 'Позиция видео' })
  await timeline.fill('1.2')
  await expect.poll(() => viewerVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(1)
  await viewer.getByRole('button', { name: 'Поставить видео на паузу' }).click()
  await expect.poll(() => viewerVideo.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  await viewer.getByRole('button', { name: 'Далее' }).click()
  await expect(viewer.getByText('3 / 4')).toBeVisible()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await viewer.getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(viewer).toHaveCount(0)
  await expect(page.locator('[data-carousel-dot="3"]')).toHaveClass(/active/)
  await expect(page.locator('[data-carousel-position="3"] button[aria-label="Открыть фото"]')).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  await page.locator('[data-carousel-position="3"] button[aria-label="Открыть фото"]').click()
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText('3 / 4')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(page.locator('[data-carousel-dot="3"]')).toHaveClass(/active/)
})
