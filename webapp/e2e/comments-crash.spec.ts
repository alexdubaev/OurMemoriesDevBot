import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

type Variant = 'A' | 'B' | 'C' | 'D'
type Probe = { feedCalls: number; feedFamilies: string[]; summaryCalls: number; summaryBatchSizes: number[]; commentCalls: number; commentWrites: number; pageErrors: Array<{ name: string; stack: string | null; componentStack: string | null }>; variant: Variant }
declare global { interface Window { __commentsCrash: Probe } }

for (const variant of ['A', 'B', 'C', 'D'] as const) {
  test(`production FeedPage comments crash isolation ${variant}`, async ({ page }) => {
    const videoFixture = await readFile(fileURLToPath(new URL('./fixtures/landscape-edges.mp4', import.meta.url)))
    await page.route('**/api/v1/families/*/media/playback-session', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await page.context().route((url) => url.pathname.includes('/media/videos/') && url.pathname.endsWith('/content'), async (route) => {
      const range = route.request().headers().range
      if (!range) return route.fulfill({ status: 200, contentType: 'video/mp4', body: videoFixture, headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': String(videoFixture.byteLength) } })
      const match = /^bytes=(\d+)-(\d*)$/.exec(range)
      if (!match) return route.fulfill({ status: 416, headers: { 'Content-Range': 'bytes */' + videoFixture.byteLength } })
      const start = Number(match[1])
      const end = match[2] ? Math.min(Number(match[2]), videoFixture.byteLength - 1) : videoFixture.byteLength - 1
      const chunk = videoFixture.subarray(start, end + 1)
      return route.fulfill({ status: 206, body: chunk, headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4', 'Content-Range': 'bytes ' + start + '-' + end + '/' + videoFixture.byteLength, 'Content-Length': String(chunk.byteLength) } })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/comments-crash.harness.html?variant=${variant}`)
    const firstCard = page.locator('.memory-card').first()
    await expect(firstCard).toBeVisible()
    const carousel = firstCard.locator('.memoly-mixed-viewport')
    await expect(carousel).toBeVisible()
    const carouselRect = await carousel.boundingBox()
    const carouselY = carouselRect!.y + carouselRect!.height / 2
    await page.mouse.move(carouselRect!.x + carouselRect!.width - 20, carouselY)
    await page.mouse.down()
    await page.mouse.move(carouselRect!.x + 20, carouselY, { steps: 8 })
    await page.mouse.up()
    await expect(firstCard.locator('[data-carousel-dot="2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(firstCard.locator('[data-carousel-position="2"] .memoly-mixed-slide-poster[data-poster-ready="true"] img[alt="Кадр видео"]')).toBeVisible()
    await firstCard.locator('[data-carousel-position="2"] .memoly-private-video-v2-play').click()
    const mediaViewer = page.locator('[data-mixed-viewer]')
    await expect(mediaViewer).toHaveCount(0)
    const mediaVideo = firstCard.locator('[data-carousel-position="2"] video')
    await expect.poll(() => mediaVideo.evaluate((video: HTMLVideoElement) => video.videoWidth / video.videoHeight)).toBeCloseTo(16 / 9, 2)
    await expect.poll(() => mediaVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1)
    await expect.poll(() => page.evaluate(() => window.__commentsCrash.feedCalls)).toBeGreaterThan(0)
    const sentinel = page.locator('[data-testid="feed-load-more-sentinel"]')
    for (let round = 0; round < 10; round++) {
      const calls = await page.evaluate(() => window.__commentsCrash.feedCalls)
      if (calls >= 7) break
      await page.evaluate(() => {
        for (const element of document.querySelectorAll<HTMLElement>('*')) if (element.scrollHeight > element.clientHeight + 80) element.scrollTop = 0
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(50)
      await sentinel.scrollIntoViewIfNeeded()
      await page.waitForTimeout(200)
    }
    await expect.poll(() => page.evaluate(() => window.__commentsCrash.feedCalls)).toBeGreaterThanOrEqual(7)
    await expect.poll(() => page.evaluate(() => window.__commentsCrashControl?.feedMemoryCount())).toBe(130)
    if (variant === 'A' || variant === 'C') {
      await expect.poll(() => page.evaluate(() => window.__commentsCrash.summaryBatchSizes.length)).toBeGreaterThanOrEqual(3)
      expect(await page.evaluate(() => window.__commentsCrash.summaryBatchSizes.every((size) => size > 0 && size <= 50))).toBe(true)
    } else expect(await page.evaluate(() => window.__commentsCrash.summaryCalls)).toBe(0)

    if (variant === 'A' || variant === 'B') {
      const commentButton = page.locator('.comments-entry').first()
      await commentButton.scrollIntoViewIfNeeded()
      await commentButton.click()
      await expect(page.getByRole('dialog', { name: 'Комментарии' })).toBeVisible()
      await expect(page.locator('.comments-item').first()).toBeVisible()
      await page.getByRole('textbox', { name: 'Написать комментарий' }).fill('Synthetic test comment')
      await page.getByRole('button', { name: 'Отправить' }).click()
      await expect.poll(() => page.evaluate(() => window.__commentsCrash.commentWrites)).toBeGreaterThan(0)
      await page.context().setOffline(true)
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
      await page.context().setOffline(false)
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
      await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
      await commentButton.click()
      await expect(page.getByRole('dialog', { name: 'Комментарии' })).toBeVisible()
      await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
      expect(await page.evaluate(() => window.__commentsCrash.commentCalls)).toBeGreaterThan(0)
    } else if (variant === 'C') {
      const commentButton = page.locator('.comments-entry').first()
      await expect(commentButton).toBeVisible()
      await commentButton.click()
      await expect(page.getByRole('dialog', { name: 'Комментарии' })).toHaveCount(0)
      expect(await page.evaluate(() => window.__commentsCrash.commentCalls)).toBe(0)
    } else {
      await expect(page.locator('.comments-entry')).toHaveCount(0)
      expect(await page.evaluate(() => window.__commentsCrash.commentCalls)).toBe(0)
    }
    const priorFeedCalls = await page.evaluate(() => window.__commentsCrash.feedCalls)
    await page.evaluate(() => window.__commentsCrashControl?.toggleActive())
    await page.waitForTimeout(80)
    await page.evaluate(() => window.__commentsCrashControl?.toggleActive())
    await page.evaluate(() => window.__commentsCrashControl?.reorderFeed())
    expect(await page.evaluate(() => window.__commentsCrashControl?.removeQueries())).toBe(0)
    await page.evaluate(() => window.__commentsCrashControl?.toggleActive())
    await page.waitForTimeout(80)
    await page.evaluate(() => window.__commentsCrashControl?.toggleActive())
    await expect.poll(() => page.evaluate(() => window.__commentsCrash.feedCalls)).toBeGreaterThan(priorFeedCalls)
    const priorClearFeedCalls = await page.evaluate(() => window.__commentsCrash.feedCalls)
    expect(await page.evaluate(() => window.__commentsCrashControl?.clearCache())).toBe(0)
    await page.evaluate(() => window.__commentsCrashControl?.toggleActive())
    await page.waitForTimeout(80)
    await page.evaluate(() => window.__commentsCrashControl?.toggleActive())
    await expect.poll(() => page.evaluate(() => window.__commentsCrash.feedCalls)).toBeGreaterThan(priorClearFeedCalls)
    const previousScopeFeedCalls = await page.evaluate(() => window.__commentsCrash.feedCalls)
    const previousScopeSummaryCalls = await page.evaluate(() => window.__commentsCrash.summaryCalls)
    await page.evaluate(() => window.__commentsCrashControl?.switchScope())
    await expect.poll(() => page.evaluate(() => window.__commentsCrash.feedCalls)).toBeGreaterThan(previousScopeFeedCalls)
    if (variant === 'A' || variant === 'C') await expect.poll(() => page.evaluate(() => window.__commentsCrash.summaryCalls)).toBeGreaterThan(previousScopeSummaryCalls)
    await expect.poll(() => page.evaluate(() => window.__commentsCrash.feedFamilies.at(-1))).toBe('22222222-2222-4222-8222-222222222222')
    await expect(page.locator('.memory-card').first()).toBeVisible()
    const errors = await page.evaluate(() => window.__commentsCrash.pageErrors)
    expect(errors, JSON.stringify(errors)).toEqual([])
  })
}

test('StartupBoundary records sanitized React error without breaking its fallback', async ({ page }) => {
  await page.goto('/e2e/comments-crash.harness.html?variant=A&boundary=1')
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть приложение')
  const report = await page.evaluate(() => {
    const diagnostics = window.__MEMOLY_DIAGNOSTICS__ as { report: () => string } | undefined
    return diagnostics?.report() ?? ''
  })
  const snapshot = JSON.parse(report)
  expect(snapshot.current.error.errorClass).toBe('TypeError')
  expect(snapshot.current.error.frames[0]).toEqual({ asset: 'index-Boundary123.js', line: 7, column: 9 })
  expect(report).not.toContain('PRIVATE_REACT_FAILURE')
  expect(report).not.toContain('private-comment-canary')
})

test('StartupBoundary still renders fallback when diagnostic callback throws', async ({ page }) => {
  await page.goto('/e2e/comments-crash.harness.html?variant=A&boundary=diagnostic-throws')
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть приложение')
  const snapshot = await page.evaluate(() => JSON.parse(window.__MEMOLY_DIAGNOSTICS__!.report()))
  expect(snapshot.current.lastFailure.kind).toBe('react-boundary')
  expect(JSON.stringify(snapshot)).not.toContain('private diagnostic failure')
})
