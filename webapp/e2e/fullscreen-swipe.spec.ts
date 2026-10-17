import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

async function touchSwipe(page: import('@playwright/test').Page, selector: string, direction: 'left' | 'right') {
  const target = page.locator(selector)
  const box = await target.boundingBox()
  if (!box) throw new Error(`Missing swipe target: ${selector}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const fromX = direction === 'left' ? x + Math.min(145, box.width * 0.38) : x - Math.min(145, box.width * 0.38)
  const toX = direction === 'left' ? x - Math.min(145, box.width * 0.38) : x + Math.min(145, box.width * 0.38)
  if (page.context().browser()?.browserType().name() !== 'chromium') {
    await target.evaluate((element, { fromX, toX, y }) => {
      const dispatch = (type: string, points: Array<{ identifier: number; clientX: number; clientY: number }>, changed = points) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        const touches = points.map((point) => ({ ...point, target: element }))
        Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changed.map((point) => ({ ...point, target: element })) } })
        element.dispatchEvent(event)
      }
      dispatch('touchstart', [{ identifier: 1, clientX: fromX, clientY: y }])
      for (let step = 1; step <= 6; step++) dispatch('touchmove', [{ identifier: 1, clientX: fromX + (toX - fromX) * step / 6, clientY: y }])
      dispatch('touchend', [], [{ identifier: 1, clientX: toX, clientY: y }])
    }, { fromX, toX, y })
    await page.waitForTimeout(400)
    return
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y, id: 1 }] })
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * step / 6, y, id: 1 }] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  await page.waitForTimeout(400)
}

async function syntheticTouchPath(page: import('@playwright/test').Page, selector: string, path: Array<Array<{ x: number; y: number }>>, cancelled = false) {
  await page.locator(selector).evaluate((element, { path, cancelled }) => {
    let active = path[0].map((point, identifier) => ({ identifier, clientX: point.x, clientY: point.y, target: element }))
    const dispatch = (type: string, touches: typeof active, changed = touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changed } })
      element.dispatchEvent(event)
    }
    dispatch('touchstart', active)
    for (const points of path.slice(1)) {
      active = points.map((point, identifier) => ({ identifier, clientX: point.x, clientY: point.y, target: element }))
      dispatch('touchmove', active)
    }
    const ended = active
    dispatch(cancelled ? 'touchcancel' : 'touchend', [], ended)
  }, { path, cancelled })
}

test('fullscreen photo album and mixed viewer respond to direct single-finger swipes', async ({ page }, testInfo) => {
  const videoFixture = await readFile(fileURLToPath(new URL('./fixtures/portrait-edges.mp4', import.meta.url)))
  await page.route('**/api/v1/families/*/media/playback-session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('**/media/videos/*/content', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: videoFixture, headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/fixed-carousel.harness.html?fullscreen-swipe')

  const albumCard = page.locator('.memory-card').filter({ hasText: 'Synthetic photo album' })
  await albumCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  const photoViewer = page.locator('.pswp')
  await expect(photoViewer).toBeVisible()
  if (page.context().browser()?.browserType().name() === 'chromium') {
    console.log('PhotoSwipe initial CDP touch counter:', await photoViewer.locator('.pswp__counter').innerText())
    await touchSwipe(page, '.pswp__scroll-wrap', 'right')
    await expect(photoViewer.locator('.pswp__counter')).toContainText('1 / 3')
    await touchSwipe(page, '.pswp__scroll-wrap', 'left')
    await expect(photoViewer.locator('.pswp__counter')).toContainText('2 / 3')
    console.log('PhotoSwipe after CDP touch swipe:', await photoViewer.locator('.pswp__counter').innerText())
    await touchSwipe(page, '.pswp__scroll-wrap', 'left')
    await expect(photoViewer.locator('.pswp__counter')).toContainText('3 / 3')
    await touchSwipe(page, '.pswp__scroll-wrap', 'left')
    await expect(photoViewer.locator('.pswp__counter')).toContainText('3 / 3')
    console.log('PhotoSwipe after trusted CDP touch at final boundary:', await photoViewer.locator('.pswp__counter').innerText())
    await touchSwipe(page, '.pswp__scroll-wrap', 'right')
    await expect(photoViewer.locator('.pswp__counter')).toContainText('2 / 3')
  } else {
    await page.keyboard.press('ArrowRight')
    await expect(photoViewer.locator('.pswp__counter')).toContainText('2 / 3')
  }
  await page.keyboard.press('Escape')
  await expect(albumCard.locator('[data-carousel-dot="2"]')).toHaveClass(/active/)
  await albumCard.locator('[data-carousel-position="2"] button[aria-label="Открыть фото"]').click()
  await expect(page.locator('.pswp .pswp__counter')).toContainText('2 / 3')
  await page.keyboard.press('Escape')

  const namedMixedCard = page.locator('.memory-card').filter({ hasText: 'Synthetic fullscreen swipe' })
  await namedMixedCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  const mixedViewer = page.locator('[data-mixed-viewer]')
  await expect(mixedViewer).toBeVisible()
  const photoBounds = await page.locator('.memoly-mixed-viewer-media img').boundingBox()
  expect(photoBounds).not.toBeNull()
  const center = { x: photoBounds!.x + photoBounds!.width / 2, y: photoBounds!.y + photoBounds!.height / 2 }
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media img', [[center], [{ x: center.x + 12, y: center.y + 8 }]])
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media img', [[center], [{ x: center.x + 8, y: center.y + 50 }], [{ x: center.x - 110, y: center.y + 52 }]])
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media img', [[center], [{ x: center.x + 5, y: center.y }], [{ x: center.x - 5, y: center.y }]], true)
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await syntheticTouchPath(page, '.memoly-mixed-viewer-media img', [[center], [{ x: center.x + 10, y: center.y }, { x: center.x + 20, y: center.y }], [{ x: center.x - 110, y: center.y }, { x: center.x + 20, y: center.y }]])
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await touchSwipe(page, '.memoly-mixed-viewer-media img', 'left')
  await page.waitForTimeout(250)
  const counter = await mixedViewer.locator('.memoly-mixed-viewer-bar').innerText()
  console.log(`Mixed viewer after ${page.context().browser()?.browserType().name() === 'chromium' ? 'CDP' : 'synthetic'} touch swipe:`, counter)
  expect(counter).toContain('2 / 3')
  await expect(mixedViewer.locator('video')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mixed-viewer-video.png') })
  const video = mixedViewer.locator('video')
  let videoHandle: Awaited<ReturnType<typeof video.elementHandle>> | null = null
  if (page.context().browser()?.browserType().name() === 'webkit') {
    // WebKit synthetic touch covers navigation; its synthetic video playback did not advance reliably.
    await mixedViewer.getByRole('button', { name: 'Далее' }).click()
    await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('3 / 3')
    await touchSwipe(page, '.memoly-mixed-viewer-media img', 'left')
    await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('3 / 3')
    await touchSwipe(page, '.memoly-mixed-viewer-media img', 'right')
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
  const finalPhoto = mixedViewer.locator('.memoly-mixed-viewer-media img')
  await expect(finalPhoto).toBeVisible()
  await expect(finalPhoto).toHaveCSS('object-fit', 'contain')
  await page.screenshot({ path: testInfo.outputPath('mixed-viewer-photo-3.png') })
  if (videoHandle) await expect.poll(() => videoHandle!.evaluate((element: HTMLVideoElement) => [element.paused, element.getAttribute('src'), element.networkState, element.buffered.length])).toEqual([true, null, 0, 0])
  await touchSwipe(page, '.memoly-mixed-viewer-media img', 'left')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('3 / 3')
  await touchSwipe(page, '.memoly-mixed-viewer-media img', 'right')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
  const reopenedVideo = mixedViewer.locator('video')
  await touchSwipe(page, '.memoly-mixed-viewer-media video', 'right')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await touchSwipe(page, '.memoly-mixed-viewer-media img', 'right')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await touchSwipe(page, '.memoly-mixed-viewer-media img', 'left')
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('2 / 3')
  await expect(reopenedVideo).toBeVisible()
  await mixedViewer.getByRole('button', { name: 'Назад' }).click()
  await expect(mixedViewer.locator('.memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await mixedViewer.getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(mixedViewer).toHaveCount(0)
  await expect(namedMixedCard.locator('[data-carousel-dot="1"]')).toHaveClass(/active/)
  await namedMixedCard.locator('[data-carousel-position="1"] button[aria-label="Открыть фото"]').click()
  await expect(page.locator('[data-mixed-viewer] .memoly-mixed-viewer-bar')).toContainText('1 / 3')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-mixed-viewer] .memoly-mixed-viewer-bar')).toContainText('2 / 3')
  await page.locator('[data-mixed-viewer]').getByRole('button', { name: 'Закрыть просмотр' }).click()
  await expect(namedMixedCard.locator('[data-carousel-dot="2"]')).toHaveClass(/active/)
  await namedMixedCard.locator('[data-carousel-position="2"] button[aria-label^="Открыть видео"]').click()
  await expect(page.locator('[data-mixed-viewer] .memoly-mixed-viewer-bar')).toContainText('2 / 3')
})
