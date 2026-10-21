import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('production feed carousel selects attachments through drags and opens the selection fullscreen', async ({ page }) => {
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
  await expect(card.locator('[data-carousel-position="1"] .memoly-mixed-slide-poster[data-poster-ready="true"] img[alt="Кадр видео"]')).toBeVisible()
  await expect(card.locator('[data-carousel-dot]')).toHaveCount(4)

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
      if (lastSelected <= 2) await expect(card.locator(`[data-carousel-position="${lastSelected}"] .memoly-mixed-slide-poster[data-poster-ready="true"] img[alt="Кадр видео"]`)).toBeVisible()
    }
    await page.mouse.up()
    await expect(card.locator(`[data-carousel-dot="${selected}"]`)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
    if (selected === 2 && !delayedPosterReleased) {
      await expect.poll(() => page.evaluate(() => window.__fixedCarouselProbe?.delayedPosterWaiters.length ?? 0)).toBeGreaterThan(0)
      await page.evaluate(() => window.__fixedCarouselProbe?.release())
      delayedPosterReleased = true
      await expect(card.locator('[data-carousel-position="2"] img[alt="Кадр видео"]')).toBeVisible()
    }
    lastSelected = selected
  }

  await expect(card.locator('[data-carousel-position="1"] video')).toHaveCount(0)
  await expect(card.locator('[data-carousel-position="2"] video')).toHaveCount(0)
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
  await expect(card.locator('[data-carousel-dot="1"]')).toHaveAttribute('aria-pressed', 'true')
  await swipeNext()
  await expect(card.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(card.locator('[data-carousel-position="2"] img[alt="Кадр видео"]')).toBeVisible()

  await card.locator('[data-carousel-position="2"] button[aria-label^="Открыть видео"]').click()
  const viewer = page.locator('[data-mixed-viewer]')
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText('2 / 4')).toBeVisible()
  await expect(viewer.locator('.memoly-viewer-thumbnails button').nth(1)).toHaveAttribute('aria-pressed', 'true')
  const viewerVideo = viewer.locator('video')
  await expect.poll(() => viewerVideo.evaluate((video: HTMLVideoElement) => [video.videoWidth, video.videoHeight])).toEqual([640, 360])
  await viewer.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect(viewer.getByRole('button', { name: 'Поставить видео на паузу' })).toBeVisible()
  await expect.poll(() => viewerVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1)
  const timeline = viewer.getByRole('slider', { name: 'Позиция видео' })
  await timeline.fill('1.2')
  await expect.poll(() => viewerVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(1)
  await timeline.focus()
  const seekBeforeArrow = Number(await timeline.inputValue())
  await page.keyboard.press('ArrowRight')
  await expect(viewer.getByText('2 / 4')).toBeVisible()
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(seekBeforeArrow)
  const previousViewerVideo = await viewerVideo.elementHandle()
  await viewer.getByRole('button', { name: 'Назад' }).click()
  await expect(viewer.getByText('1 / 4')).toBeVisible()
  await expect.poll(() => previousViewerVideo!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  await expect.poll(() => previousViewerVideo!.evaluate((video: HTMLVideoElement) => [video.getAttribute('src'), video.networkState, video.buffered.length])).toEqual([null, 0, 0])
  const currentViewerVideo = viewer.locator('video')
  await currentViewerVideo.waitFor({ state: 'visible' })
  await viewer.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect(viewer.getByRole('button', { name: 'Поставить видео на паузу' })).toBeVisible()
  const closingViewerVideo = await currentViewerVideo.elementHandle()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await viewer.getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(viewer).toHaveCount(0)
  await expect.poll(() => closingViewerVideo!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  await expect.poll(() => closingViewerVideo!.evaluate((video: HTMLVideoElement) => [video.getAttribute('src'), video.networkState, video.buffered.length])).toEqual([null, 0, 0])
  await expect(card.locator('[data-carousel-dot="1"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(card.locator('[data-carousel-position="1"] button[aria-label^="Открыть видео"]')).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  await swipeNext()
  await swipeNext()
  await expect(card.locator('[data-carousel-dot="3"]')).toHaveAttribute('aria-pressed', 'true')
  await card.locator('[data-carousel-position="3"] button[aria-label="Открыть фото"]').click()
  await expect(viewer).toBeVisible()
  await expect(viewer.getByText('3 / 4')).toBeVisible()
  await viewer.getByRole('button', { name: 'Далее' }).click()
  await expect(viewer.getByText('4 / 4')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)
  await expect(card.locator('[data-carousel-dot="4"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(card.locator('[data-carousel-position="4"] button[aria-label="Открыть фото"]')).toBeFocused()

  const photoAlbumCard = page.locator('.memory-card').nth(2)
  await photoAlbumCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  const photoViewer = page.locator('.pswp')
  await expect(photoViewer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(photoViewer).toHaveCount(0)
  await expect(photoAlbumCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]')).toBeFocused()

  await photoAlbumCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  await expect(photoViewer).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(photoViewer.locator('.pswp__counter')).toContainText('2 / 4')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(photoViewer.locator('.pswp__counter')).toContainText('4 / 4')
  await page.keyboard.press('Escape')
  await expect(photoViewer).toHaveCount(0)
  await expect(photoAlbumCard.locator('[data-carousel-dot="4"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(photoAlbumCard.locator('[data-carousel-position="4"] button[aria-label="Открыть фото"]')).toBeFocused()
})
