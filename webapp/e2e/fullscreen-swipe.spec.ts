import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

async function touchSwipe(page: import('@playwright/test').Page, selector: string, direction: 'left' | 'right', origin = { x: 0.5, y: 0.5 }) {
  const target = page.locator(selector)
  const box = await target.boundingBox()
  if (!box) throw new Error(`Missing swipe target: ${selector}`)
  const x = box.x + box.width * origin.x
  const y = box.y + box.height * origin.y
  const fromX = direction === 'left' ? x + Math.min(145, box.width * 0.38) : x - Math.min(145, box.width * 0.38)
  const toX = direction === 'left' ? x - Math.min(145, box.width * 0.38) : x + Math.min(145, box.width * 0.38)
  if (page.context().browser()?.browserType().name() !== 'chromium') {
    await target.evaluate(async (element, { fromX, toX, y }) => {
      const dispatch = (type: string, points: Array<{ identifier: number; clientX: number; clientY: number }>, changed = points) => {
        const event = new TouchEvent(type, { bubbles: true, cancelable: true })
        const touches = points.map((point) => ({ ...point, target: element }))
        Object.defineProperties(event, { touches: { value: touches }, targetTouches: { value: touches }, changedTouches: { value: changed.map((point) => ({ ...point, target: element })) } })
        element.dispatchEvent(event)
      }
      dispatch('touchstart', [{ identifier: 1, clientX: fromX, clientY: y }])
      for (let step = 1; step <= 6; step++) {
        dispatch('touchmove', [{ identifier: 1, clientX: fromX + (toX - fromX) * step / 6, clientY: y }])
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      dispatch('touchend', [], [{ identifier: 1, clientX: toX, clientY: y }])
    }, { fromX, toX, y })
    return
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y, id: 1 }] })
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * step / 6, y, id: 1 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

async function expectFullscreenSlideSettled(viewer: import('@playwright/test').Locator) {
  await expect.poll(() => viewer.locator('.memoly-mixed-viewer-media').evaluate((viewport) => {
    const slide = viewport.querySelector('[data-carousel-active="true"]')
    return slide ? Math.abs(slide.getBoundingClientRect().left - viewport.getBoundingClientRect().left) : Number.POSITIVE_INFINITY
  })).toBeLessThan(2)
}

async function touchSwipeDown(page: import('@playwright/test').Page, selector: string, distance = 132) {
  const target = page.locator(selector)
  const box = await target.boundingBox()
  if (!box) throw new Error(`Missing swipe target: ${selector}`)
  const x = box.x + box.width / 2
  const fromY = box.y + box.height / 2
  if (page.context().browser()?.browserType().name() !== 'chromium') {
    await syntheticTouchPath(page, selector, [[{ x, y: fromY }], [{ x, y: fromY + distance / 3 }], [{ x, y: fromY + distance * 2 / 3 }], [{ x, y: fromY + distance }]])
    return
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY, id: 1 }] })
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: fromY + distance * step / 6, id: 1 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

async function syntheticTouchPath(page: import('@playwright/test').Page, selector: string, path: Array<Array<{ x: number; y: number }>>, cancelled = false) {
  await page.locator(selector).evaluate(async (element, { path, cancelled }) => {
    let active = path[0].map((point, identifier) => ({ identifier, target: element, clientX: point.x, clientY: point.y }))
    const dispatch = (type: string, touches: typeof active, changed = touches) => {
      const event = new TouchEvent(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { touches: { value: touches }, targetTouches: { value: touches }, changedTouches: { value: changed } })
      element.dispatchEvent(event)
    }
    dispatch('touchstart', active)
    for (const points of path.slice(1)) {
      active = points.map((point, identifier) => ({ identifier, target: element, clientX: point.x, clientY: point.y }))
      dispatch('touchmove', active)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    const ended = active
    dispatch(cancelled ? 'touchcancel' : 'touchend', [], ended)
  }, { path, cancelled })
}

async function syntheticTouchStep(page: import('@playwright/test').Page, selector: string, type: 'touchstart' | 'touchmove' | 'touchend', points: Array<{ identifier: number; x: number; y: number }>) {
  await page.locator(selector).evaluate((element, { type, points }) => {
    const touches = points.map((point) => ({ ...point, target: element, clientX: point.x, clientY: point.y }))
    const ended = type === 'touchend' ? [] : touches
    const event = new TouchEvent(type, { bubbles: true, cancelable: true })
    Object.defineProperties(event, { touches: { value: ended }, targetTouches: { value: ended }, changedTouches: { value: touches } })
    element.dispatchEvent(event)
  }, { type, points })
}

async function installProductionZoomPrevention(page: import('@playwright/test').Page) {
  await page.evaluate(async (modulePath) => {
    const { installAppZoomPrevention } = await import(modulePath) as typeof import('../src/platform/app-zoom')
    installAppZoomPrevention(document)
  }, '/src/platform/app-zoom.ts')
}

test('fullscreen mixed viewer follows the finger and keeps the adjacent photo visible before release', async ({ page }, testInfo) => {
  await page.goto('/e2e/fixed-carousel.harness.html?fullscreen-swipe')
  await installProductionZoomPrevention(page)

  const card = page.locator('.memory-card').nth(1)
  await card.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  const viewer = page.locator('[data-mixed-viewer]')
  const viewport = viewer.locator('.memoly-mixed-viewer-media')
  const currentPhoto = viewport.locator('[data-carousel-position="1"] img')
  const initialPhotoBounds = await currentPhoto.boundingBox()
  const bounds = await viewport.boundingBox()
  expect(bounds).not.toBeNull()
  expect(initialPhotoBounds).not.toBeNull()
  const x = bounds!.x + bounds!.width * 0.72
  const y = bounds!.y + bounds!.height / 2
  const chromium = page.context().browser()?.browserType().name() === 'chromium'
  const cdp = chromium ? await page.context().newCDPSession(page) : null
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', nextX: number) => {
    if (cdp) return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: nextX, y, id: 1 }] })
    const mapped = type === 'touchEnd' ? 'touchend' : type === 'touchStart' ? 'touchstart' : 'touchmove'
    await syntheticTouchStep(page, '.memoly-mixed-viewer-media', mapped, [{ identifier: 1, x: nextX, y }])
  }
  await touch('touchStart', x)
  await touch('touchMove', x - bounds!.width * 0.45)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  if (chromium) await page.screenshot({ path: testInfo.outputPath('mid-drag.png') })

  const draggedPhotoBounds = await currentPhoto.boundingBox()
  expect(draggedPhotoBounds).not.toBeNull()
  expect(draggedPhotoBounds!.x).toBeLessThan(initialPhotoBounds!.x - bounds!.width * 0.1)
  await expect(viewport.locator('[data-carousel-position]')).toHaveCount(3)
  for (const position of [1, 2]) {
    const slidePhoto = viewport.locator(`[data-carousel-position="${position}"] img`)
    await expect(slidePhoto).toBeVisible()
    const slideBounds = await slidePhoto.boundingBox()
    expect(slideBounds).not.toBeNull()
    const intersectsViewport = await slidePhoto.evaluate((image, clip) => {
      const rect = image.getBoundingClientRect()
      return Math.min(rect.right, clip.right) > Math.max(rect.left, clip.left)
        && Math.min(rect.bottom, clip.bottom) > Math.max(rect.top, clip.top)
    }, { left: bounds!.x, right: bounds!.x + bounds!.width, top: bounds!.y, bottom: bounds!.y + bounds!.height })
    expect(intersectsViewport, JSON.stringify({ position, slideBounds, viewport: bounds })).toBe(true)
  }
  const offset = await viewport.locator('.memoly-mixed-viewer-track').evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)
  expect(offset).toBeLessThan(-bounds!.width * 0.1)

  await touch('touchMove', x - bounds!.width * 0.14)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const reversedOffset = await viewport.locator('.memoly-mixed-viewer-track').evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)
  expect(reversedOffset).toBeGreaterThan(offset)
  await touch('touchEnd', x - bounds!.width * 0.14)
  await expect(viewer.locator('.memoly-viewer-count')).toHaveText('1 / 3')
  await expect.poll(() => viewport.locator('.memoly-mixed-viewer-track').evaluate((element) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(element).transform).m41))).toBeLessThan(1)

  const shortStart = x
  await touch('touchStart', shortStart)
  await touch('touchMove', shortStart - 12)
  await page.waitForTimeout(80)
  await touch('touchEnd', shortStart - 12)
  await expect(viewer.locator('.memoly-viewer-count')).toHaveText('1 / 3')
  await expect.poll(() => viewport.locator('.memoly-mixed-viewer-track').evaluate((element) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(element).transform).m41))).toBeLessThan(1)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'left')
  await expect(viewer.locator('.memoly-viewer-count')).toHaveText('2 / 3')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const reducedMotionOffset = await viewport.locator('.memoly-mixed-viewer-track').evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)
  expect(reducedMotionOffset).toBeCloseTo(-bounds!.width, 0)
  await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'right')
  await expect(viewer.locator('.memoly-viewer-count')).toHaveText('1 / 3')
  if (cdp) await cdp.detach()
})

test('fullscreen photo album and mixed viewer respond to direct single-finger swipes', async ({ page }) => {
  const videoFixture = await readFile(fileURLToPath(new URL('./fixtures/portrait-edges.mp4', import.meta.url)))
  await page.route('**/api/v1/families/*/media/playback-session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('**/media/videos/*/content', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: videoFixture, headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.goto('/e2e/fixed-carousel.harness.html?fullscreen-swipe')
  await installProductionZoomPrevention(page)

  const albumCard = page.locator('.memory-card').nth(1)
  await albumCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  const photoViewer = page.locator('[data-mixed-viewer]')
  await expect(photoViewer).toBeVisible()
  await expect(photoViewer).toHaveCSS('background-color', 'rgb(20, 25, 21)')
  await expect(photoViewer.locator('.memoly-viewer-thumbnails button')).toHaveCount(3)
  await page.keyboard.press('ArrowRight')
  await expect(photoViewer.getByText('2 / 3')).toBeVisible()
  await expect(photoViewer.locator('.memoly-viewer-thumbnails button').nth(1)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(photoViewer.getByText('3 / 3')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(photoViewer.getByText('3 / 3')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(photoViewer.getByText('2 / 3')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(albumCard.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-pressed', 'true')
  await albumCard.locator('[data-carousel-position="2"] button[aria-label="Открыть фото"]').click()
  await expect(photoViewer.getByText('2 / 3')).toBeVisible()
  await page.keyboard.press('Escape')

  const namedMixedCard = page.locator('.memory-card').nth(0)
  await namedMixedCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  const mixedViewer = page.locator('[data-mixed-viewer]')
  await expect(mixedViewer).toBeVisible()
  const photoBounds = await page.locator('.memoly-mixed-viewer-media [data-carousel-active="true"] img').boundingBox()
  expect(photoBounds).not.toBeNull()
  const center = { x: photoBounds!.x + photoBounds!.width / 2, y: photoBounds!.y + photoBounds!.height / 2 }
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x + 12, y: center.y + 8 }]])
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x + 8, y: center.y + 50 }], [{ x: center.x - 110, y: center.y + 52 }]])
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x + 5, y: center.y }], [{ x: center.x - 5, y: center.y }]], true)
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[{ x: center.x - 50, y: center.y }, { x: center.x + 50, y: center.y }], [{ x: center.x - 60, y: center.y }, { x: center.x + 60, y: center.y }]])
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await expect.poll(() => mixedViewer.locator('.memoly-mixed-viewer-media [data-carousel-active="true"] > div').evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeGreaterThan(1)
  const closeButton = mixedViewer.getByRole('button', { name: 'Закрыть просмотр' })
  const firstThumbnail = mixedViewer.locator('.memoly-viewer-thumbnails button').first()
  const isHitTestable = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return Boolean(hit && (hit === element || element.contains(hit)))
  }
  expect(await closeButton.evaluate(isHitTestable)).toBe(true)
  expect(await firstThumbnail.evaluate(isHitTestable)).toBe(true)
  await expect(mixedViewer.locator('.memoly-viewer-caption')).toBeVisible()
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x + 80, y: center.y + 20 }]])
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[{ x: center.x - 50, y: center.y }, { x: center.x + 50, y: center.y }], [{ x: center.x - 40, y: center.y }, { x: center.x + 40, y: center.y }]])
  await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'left')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
  await expect(mixedViewer.locator('video')).toBeVisible()
  const video = mixedViewer.locator('video')
  let videoHandle: Awaited<ReturnType<typeof video.elementHandle>> | null = null
  if (page.context().browser()?.browserType().name() === 'webkit') {
    // WebKit synthetic touch covers navigation; its synthetic video playback did not advance reliably.
    await mixedViewer.getByRole('button', { name: 'Далее' }).click()
    await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('3 / 3')
    await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'left')
    await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('3 / 3')
    await expectFullscreenSlideSettled(mixedViewer)
    await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'right')
    await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
  } else {
    videoHandle = await video.elementHandle()
    await mixedViewer.getByRole('button', { name: 'Воспроизвести видео' }).click()
    await expect(mixedViewer.getByRole('button', { name: 'Поставить видео на паузу' })).toBeVisible()
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1)
    const seek = mixedViewer.getByRole('slider', { name: 'Позиция видео' })
    const seekBeforeTouch = Number(await seek.inputValue())
    await touchSwipe(page, '.memoly-mixed-viewer-media input[aria-label="Позиция видео"]', 'right')
    await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
    await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThan(seekBeforeTouch)
    await touchSwipe(page, '.memoly-mixed-viewer-media button[aria-label="Поставить видео на паузу"]', 'left')
    await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
    await touchSwipe(page, '.memoly-mixed-viewer-media video', 'left')
  }
  if (page.context().browser()?.browserType().name() === 'webkit') await touchSwipe(page, '.memoly-mixed-viewer-media video', 'left')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('3 / 3')
  const finalPhoto = mixedViewer.locator('.memoly-mixed-viewer-media [data-carousel-active="true"] img')
  await expect(finalPhoto).toBeVisible()
  if (videoHandle) await expect.poll(() => videoHandle!.evaluate((element: HTMLVideoElement) => [element.paused, element.getAttribute('src'), element.networkState, element.buffered.length])).toEqual([true, null, 0, 0])
  await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'left')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('3 / 3')
  await expectFullscreenSlideSettled(mixedViewer)
  await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'right')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
  const reopenedVideo = mixedViewer.locator('video')
  await expectFullscreenSlideSettled(mixedViewer)
  await touchSwipe(page, '.memoly-mixed-viewer-media video', 'right', { x: 0.8, y: 0.2 })
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'right')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await expectFullscreenSlideSettled(mixedViewer)
  await touchSwipe(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', 'left')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
  await expect(reopenedVideo).toBeVisible()
  await mixedViewer.getByRole('button', { name: 'Назад' }).click()
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await mixedViewer.getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(mixedViewer).toHaveCount(0)
  await expect(namedMixedCard.locator('[data-carousel-dot="1"]')).toHaveAttribute('aria-pressed', 'true')
  await namedMixedCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  await expect(page.locator('[data-mixed-viewer] .memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await page.locator('[data-mixed-viewer]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-mixed-viewer] .memoly-mixed-viewer-bar')).toContainText('2 / 3')
  await page.locator('[data-mixed-viewer]').getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(namedMixedCard.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-pressed', 'true')
  await namedMixedCard.locator('[data-carousel-position="2"] .memoly-private-video-v2-play').click()
  await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
  await expect(namedMixedCard.locator('[data-carousel-position="2"] video')).toBeVisible()
})

test('mixed fullscreen photo swipe down closes intentionally and ignores guarded gestures', async ({ page }) => {
  await page.goto('/e2e/fixed-carousel.harness.html?fullscreen-swipe')

  const card = page.locator('.memory-card').nth(0)
  await card.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  const viewer = page.locator('[data-mixed-viewer]')
  await expect(viewer).toBeVisible()
  const bounds = await viewer.locator('.memoly-mixed-viewer-media [data-carousel-active="true"] img').boundingBox()
  expect(bounds).not.toBeNull()
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }

  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x, y: center.y + 50 }]])
  await expect(viewer).toBeVisible()
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x, y: center.y - 120 }]])
  await expect(viewer).toBeVisible()
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x + 130, y: center.y + 126 }]])
  await expect(viewer).toBeVisible()
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x, y: center.y + 18 }], [{ x: center.x, y: center.y + 118 }]], true)
  await expect(viewer).toBeVisible()
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[{ x: center.x - 50, y: center.y }, { x: center.x + 50, y: center.y }], [{ x: center.x - 100, y: center.y }, { x: center.x + 100, y: center.y }]])
  await expect(viewer).toBeVisible()

  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[center], [{ x: center.x + 70, y: center.y + 20 }]])
  await expect(viewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img', [[{ x: center.x - 100, y: center.y }, { x: center.x + 100, y: center.y }], [{ x: center.x - 50, y: center.y }, { x: center.x + 50, y: center.y }]])
  await expect(viewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')

  await viewer.getByRole('button', { name: 'Далее' }).click()
  await expect(viewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media video', [[center], [{ x: center.x, y: center.y + 130 }]])
  await expect(viewer).toBeVisible()
  await viewer.getByRole('button', { name: 'Назад' }).click()
  await expect(viewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')

  const opener = card.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]')
  const app = page.locator('.app')
  await app.evaluate((element) => { element.scrollTop = Math.min(96, element.scrollHeight) })
  const scrollBeforeClose = await app.evaluate((element) => element.scrollTop)
  await expectFullscreenSlideSettled(viewer)
  await touchSwipeDown(page, '.memoly-mixed-viewer-media [data-carousel-active="true"] img')
  await expect(viewer).toHaveCount(0)
  await expect(card.locator('[data-carousel-dot="1"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(opener).toBeFocused()
  await expect.poll(() => app.evaluate((element) => element.scrollTop)).toBe(scrollBeforeClose)
  await expect.poll(() => page.evaluate(() => window.history.state?.mixedMediaViewer ?? false)).toBe(false)
})
