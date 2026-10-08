import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { MemoryDto } from '@web-app-demo/contracts'

const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), '.artifacts')
const videoPath = join(artifacts, 'private-video-poster-synthetic.mp4')
const portraitVideoPath = join(artifacts, 'private-video-poster-portrait-synthetic.mp4')
const posterPath = join(artifacts, 'private-video-poster-synthetic.png')
const portraitPosterPath = join(artifacts, 'private-video-poster-portrait-synthetic.png')
const audioPath = join(artifacts, 'private-video-poster-audio-synthetic.wav')
const familyId = '22222222-2222-4222-8222-222222222222'
const memories = fixtureMemories()

async function expectCarouselSlideSettled(carousel: Locator, position: number) {
  await expect.poll(() => carousel.evaluate(async (element, expectedPosition) => {
    const viewport = element.querySelector<HTMLElement>('.memoly-mixed-viewport')
    const track = element.querySelector<HTMLElement>('.memoly-mixed-track')
    const slide = element.querySelector<HTMLElement>(`[data-carousel-position="${expectedPosition}"]`)
    if (!viewport || !track || !slide || slide.dataset.carouselActive !== 'true') return false

    const initialTransform = getComputedStyle(track).transform
    const initialLeft = slide.getBoundingClientRect().left
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

    const viewportLeft = viewport.getBoundingClientRect().left
    const settledRect = slide.getBoundingClientRect()
    return getComputedStyle(track).transform === initialTransform
      && Math.abs(settledRect.left - initialLeft) < 0.01
      && Math.round(settledRect.left) === Math.round(viewportLeft)
  }, position)).toBe(true)
}

test.beforeAll(() => {
  mkdirSync(artifacts, { recursive: true })
  const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg'
  for (const [path, poster, size] of [[videoPath, posterPath, '320x180'], [portraitVideoPath, portraitPosterPath, '180x320']] as const) {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x7862db:s=${size}:r=12:d=30`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', path], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`Unable to create synthetic H.264 video: ${result.stderr}`)
    const frame = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path, '-frames:v', '1', '-y', poster], { encoding: 'utf8' })
    if (frame.status !== 0) throw new Error(`Unable to create synthetic video poster: ${frame.stderr}`)
  }
  const sampleRate = 8_000
  const sampleCount = sampleRate * 2
  const wav = Buffer.alloc(44 + sampleCount * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8)
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(sampleCount * 2, 40)
  for (let index = 0; index < sampleCount; index += 1) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 3_000), 44 + index * 2)
  writeFileSync(audioPath, wav)
  writeFileSync(join(artifacts, 'private-video-poster-memories.json'), JSON.stringify(memories))
})

test('audio pause events delivered after a newer play preserve the actual playing state', async ({ page }) => {
  await page.goto('/e2e/private-video-poster.fixture.html')
  const card = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777776"]')
  await card.scrollIntoViewIfNeeded()
  const audio = card.locator('audio')
  // Keep playback active during the controlled event-order sequence.
  await audio.evaluate((element: HTMLAudioElement) => { element.loop = true })

  await card.getByRole('button', { name: 'Слушать' }).click()
  await expect(audio).toHaveJSProperty('paused', false)
  await expect(card.getByRole('button', { name: 'Пауза' })).toBeVisible()
  await card.getByRole('button', { name: 'Пауза' }).click()
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(card.getByRole('button', { name: 'Слушать' })).toBeVisible()
  await card.getByRole('button', { name: 'Слушать' }).click()
  await expect(audio).toHaveJSProperty('paused', false)
  await expect(card.getByRole('button', { name: 'Пауза' })).toBeVisible()

  await audio.evaluate((element) => {
    const target = element as HTMLAudioElement & { __delayedPause?: Event; __delayedPauseCount?: number }
    target.__delayedPauseCount = 0
    target.addEventListener('pause', (event) => {
      if (target.__delayedPause) return
      target.__delayedPause = event
      target.__delayedPauseCount = (target.__delayedPauseCount ?? 0) + 1
      event.stopImmediatePropagation()
    }, { capture: true })
  })
  await card.getByRole('button', { name: 'Пауза' }).click()
  await expect(audio).toHaveJSProperty('paused', true)
  await expect.poll(() => audio.evaluate((element) => (element as HTMLAudioElement & { __delayedPauseCount?: number }).__delayedPauseCount)).toBe(1)
  await card.getByRole('button', { name: 'Слушать' }).click()
  await expect(audio).toHaveJSProperty('paused', false)
  await expect(card.getByRole('button', { name: 'Пауза' })).toBeVisible()

  // Controlled event re-delivery after a newer play reproduces stale delivery ordering;
  // browsers do not spontaneously produce this exact ordering in every run.
  await audio.evaluate((element) => {
    const target = element as HTMLAudioElement & { __delayedPause?: Event }
    if (!target.__delayedPause) throw new Error('No native pause event was captured')
    target.dispatchEvent(new Event('pause'))
  })
  await expect(audio).toHaveJSProperty('paused', false)
  await expect(card.getByRole('button', { name: 'Пауза' })).toBeVisible()
})

test('a queued ended event cannot overwrite playback after restarting the same audio', async ({ page }) => {
  await page.goto('/e2e/private-video-poster.fixture.html')
  const card = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777776"]')
  await card.scrollIntoViewIfNeeded()
  const audio = card.locator('audio')
  const endedEvent = audio.evaluate((element) => new Promise<void>((resolve) => {
    const target = element as HTMLAudioElement & { __queuedEnded?: Event }
    target.addEventListener('ended', (event) => {
      event.stopImmediatePropagation()
      target.__queuedEnded = event
      resolve()
    }, { capture: true, once: true })
  }))

  await card.getByRole('button', { name: 'Слушать' }).click()
  await endedEvent
  await expect(audio).toHaveJSProperty('ended', true)
  await expect(audio).toHaveJSProperty('paused', true)
  await expect(card.getByRole('button', { name: 'Слушать' })).toBeVisible()
  await audio.evaluate((element) => {
    const target = element as HTMLAudioElement & { __queuedEnded?: Event }
    if (!target.__queuedEnded) throw new Error('The actual ended event was not retained')
    target.dispatchEvent(target.__queuedEnded)
  })
  await expect(card.getByRole('button', { name: 'Слушать' })).toBeVisible()
  await expect(card.locator('.ml-audio')).toContainText('0:02 / 0:02')

  await audio.evaluate((element) => { (element as HTMLAudioElement).loop = true })
  await card.getByRole('button', { name: 'Слушать' }).click()
  await expect(audio).toHaveJSProperty('ended', false)
  await expect(audio).toHaveJSProperty('paused', false)
  await expect(card.getByRole('button', { name: 'Пауза' })).toBeVisible()
  await audio.evaluate((element) => {
    const target = element as HTMLAudioElement & { __queuedEnded?: Event }
    if (!target.__queuedEnded) throw new Error('The actual ended event was not retained')
    target.dispatchEvent(target.__queuedEnded)
  })

  await expect(audio).toHaveJSProperty('paused', false)
  await expect(card.getByRole('button', { name: 'Пауза' })).toBeVisible()
  await expect(card.locator('.ml-audio')).not.toContainText('0:02 / 0:02')
})

test('private storage posters render and native playback stays usable across feed shapes', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.request.post('/__fixture__/poster-reset')
  await page.goto('/e2e/private-video-poster.fixture.html')

  const card = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777771"]')
  await card.scrollIntoViewIfNeeded()
  await expect(card.locator('[data-video-poster-state="ready"]')).toBeVisible({ timeout: 15_000 })
  const poster = card.locator('[data-slot="private-video-poster"] img')
  await expect(poster).toBeVisible()
  await expect.poll(() => poster.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await expect(card.getByRole('button', { name: 'Воспроизвести видео' }).first()).toBeVisible()
  await expect(card.getByText('0:30', { exact: true }).first()).toBeVisible()
  const durationBounds = await card.locator('.memoly-private-video-v2-duration').boundingBox()
  expect(durationBounds).not.toBeNull()
  expect(durationBounds!.y + durationBounds!.height).toBeLessThanOrEqual(844)
  await expect(card.locator('video')).toHaveJSProperty('paused', true)
  await expect(card.locator('.memoly-private-video-v2-frame')).toHaveScreenshot('private-video-landscape-preview.png')
  await expect(card.locator('[data-slot="video-playback-controls"]')).toHaveCount(0)
  await expect(card.locator('video')).not.toHaveAttribute('controls', '')
  await card.screenshot({ path: join(artifacts, `${testInfo.project.name}-private-video-single.png`) })

  const mixedCarousel = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777772"] .memoly-mixed-carousel')
  await mixedCarousel.getByRole('button', { name: 'Следующий элемент' }).click()
  await expect(mixedCarousel.locator('[data-carousel-active="true"] [data-video-poster-state="ready"]')).toBeVisible()
  const mixedPortrait = mixedCarousel.locator('[data-carousel-active="true"] .memoly-private-video-v2')
  await expect(mixedPortrait.locator('.memoly-private-video-v2-frame')).toHaveCSS('background-color', 'rgb(21, 19, 21)')
  await expect(mixedPortrait.locator('.memoly-private-video-v2-frame')).toHaveScreenshot('private-video-mixed-portrait-preview.png')
  await mixedPortrait.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect(mixedPortrait.locator('[data-slot="video-playback-controls"]')).toHaveCount(1)
  await expect(mixedPortrait.locator('.memoly-private-video-v2-frame')).toHaveScreenshot('private-video-mixed-portrait-playing.png', { maxDiffPixelRatio: 0.02 })
  const mixedPortraitVideo = await mixedPortrait.locator('video').elementHandle()
  expect(mixedPortraitVideo).not.toBeNull()
  await mixedCarousel.getByRole('button', { name: 'Предыдущий элемент' }).click()
  await expect.poll(() => mixedPortraitVideo!.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)

  const fourVideoCard = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777773"]')
  await expect(fourVideoCard.locator('[data-carousel-position]')).toHaveCount(4)
  const carousel = fourVideoCard.locator('.memoly-mixed-carousel')
  for (const position of ['1', '2', '3', '4']) {
    await expect(carousel.locator(`[data-carousel-position="${position}"]`)).toBeAttached()
  }
  for (let index = 1; index < 4; index += 1) {
    await carousel.getByRole('button', { name: 'Следующий элемент' }).click()
    await expect(carousel.locator('[data-carousel-active="true"] [data-video-poster-state="ready"]')).toBeVisible()
  }
  await carousel.getByRole('button', { name: 'Предыдущий элемент' }).click()
  await expect(carousel.locator('[data-carousel-active="true"] [data-video-poster-state="ready"]')).toBeVisible()
  await carousel.getByRole('button', { name: 'Предыдущий элемент' }).click()
  const fourPortraitSlide = carousel.locator('[data-carousel-position="2"]')
  await expect(fourPortraitSlide).toHaveAttribute('data-carousel-active', 'true')
  const fourPortrait = fourPortraitSlide.locator('.memoly-private-video-v2')
  const fourPortraitFrame = fourPortrait.locator('.memoly-private-video-v2-frame')
  await expect(fourPortraitFrame).toHaveAttribute('data-video-poster-state', 'ready')
  const fourPortraitPoster = fourPortrait.locator('[data-slot="private-video-poster"] img')
  await expect(fourPortraitPoster).toBeVisible()
  await expect.poll(() => fourPortraitPoster.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await expectCarouselSlideSettled(carousel, 2)
  await expect(fourPortraitFrame).toHaveCSS('background-color', 'rgb(21, 19, 21)')
  await expect(fourPortraitFrame).toHaveScreenshot('private-video-four-portrait-preview.png')
  await fourPortrait.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect(fourPortrait.locator('[data-slot="video-playback-controls"]')).toHaveCount(1)
  const fourPortraitVideo = await fourPortrait.locator('video').elementHandle()
  expect(fourPortraitVideo).not.toBeNull()
  await carousel.getByRole('button', { name: 'Следующий элемент' }).click()
  await expect.poll(() => fourPortraitVideo!.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await fourVideoCard.screenshot({ path: join(artifacts, `${testInfo.project.name}-private-video-four.png`) })
  await expect(page.locator('[data-memory-id="77777777-7777-4777-8777-777777777774"] [data-carousel-position]')).toHaveCount(2)
  const twoVideoCarousel = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777774"] .memoly-mixed-carousel')
  await twoVideoCarousel.getByRole('button', { name: 'Следующий элемент' }).click()
  await expect(twoVideoCarousel.locator('[data-carousel-active="true"] [data-video-poster-state="ready"]')).toBeVisible()
  await twoVideoCarousel.getByRole('button', { name: 'Предыдущий элемент' }).click()
  await expect(twoVideoCarousel.locator('[data-carousel-active="true"] [data-video-poster-state="ready"]')).toBeVisible()
  await twoVideoCarousel.screenshot({ path: join(artifacts, `${testInfo.project.name}-private-video-two.png`) })
  await expect(twoVideoCarousel.locator('[data-carousel-active="true"] .memoly-private-video-v2-frame')).toHaveScreenshot('private-video-carousel-preview.png')

  const portraitCard = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777775"]')
  await portraitCard.scrollIntoViewIfNeeded()
  await expect(portraitCard.locator('[data-video-poster-state="ready"]')).toBeVisible({ timeout: 15_000 })
  await expect(portraitCard.locator('.memoly-private-video-v2-frame')).toHaveCSS('background-color', 'rgb(21, 19, 21)')
  await expect(portraitCard.locator('.memoly-private-video-v2-frame')).toHaveScreenshot('private-video-portrait-preview.png')
  await portraitCard.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect(portraitCard.locator('[data-slot="video-playback-controls"]')).toHaveCount(1)
  await expect(portraitCard.locator('.memoly-private-video-v2-frame')).toHaveScreenshot('private-video-portrait-playing.png', { maxDiffPixelRatio: 0.02 })

  const maxViewer = page.getByTestId('max-video-direct-fixture').locator('.memoly-video-viewer-v2')
  const maxVideo = maxViewer.locator('video')
  await expect(maxViewer.locator('video')).not.toHaveAttribute('controls', '')
  await expect(maxViewer.getByRole('button', { name: 'Смотреть видео' })).toBeVisible()
  await expect(maxViewer.getByText('0:30', { exact: true })).toBeVisible()
  await maxViewer.getByRole('button', { name: 'Смотреть видео' }).click()
  await expect(maxViewer).toHaveAttribute('data-video-started', 'true')
  await expect(maxViewer.locator('[data-slot="video-playback-controls"]')).toBeVisible()
  await expect(maxViewer.locator('[data-slot="video-playback-controls"]')).toHaveCSS('z-index', '30')
  await maxVideo.evaluate((element: HTMLVideoElement) => element.pause())

  const play = card.getByRole('button', { name: 'Воспроизвести видео' }).first()
  await play.click()
  const video = card.locator('video')
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0)
  await expect.poll(async () => (await (await page.request.get('/__fixture__/range-status')).json()).rangedPlaybackRequests).toBeGreaterThan(0)
  await expect(card.locator('[data-slot="private-video-poster"]')).toHaveCount(0)
  await expect(card.locator('[data-slot="video-playback-controls"]')).toHaveCount(1)
  await expect(card.locator('.memoly-private-video-v2-duration')).toHaveCount(0)
  await expect.poll(() => card.locator('[data-slot="video-playback-controls"]').evaluate((element) => getComputedStyle(element).backgroundImage)).toBe('none')
  await expect(card.locator('.memoly-private-video-v2-frame')).toHaveScreenshot('private-video-landscape-playing.png', { maxDiffPixelRatio: 0.02 })
  await video.evaluate((element: HTMLVideoElement) => element.pause())
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true)
  await expect(card.locator('[data-slot="video-playback-controls"]')).toHaveCount(1)
  await expect(card.locator('.memoly-private-video-v2-frame')).toHaveScreenshot('private-video-landscape-paused.png', { maxDiffPixelRatio: 0.02 })
  const fullscreenButton = card.getByRole('button', { name: 'На весь экран' })
  await page.evaluate(() => {
    const requestFullscreen = Element.prototype.requestFullscreen
    if (!requestFullscreen) return
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: function (this: Element, ...args: Parameters<typeof requestFullscreen>) {
        const originalPromise = requestFullscreen.apply(this, args)
        const outcome = originalPromise.then(
          () => ({ status: 'entered', name: '', message: '' }),
          (error: unknown) => ({ status: 'rejected', name: error instanceof DOMException ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) }),
        )
        Object.assign(window, { __videoFullscreenOutcome: outcome })
        return originalPromise
      },
    })
  })
  const fullscreenEnabled = await page.evaluate(() => document.fullscreenEnabled)
  if (await fullscreenButton.isEnabled()) {
    await fullscreenButton.click()
    const result = await page.waitForFunction(() => (window as Window & { __videoFullscreenOutcome?: Promise<{ status: string; name: string; message: string }> }).__videoFullscreenOutcome, undefined, { timeout: 1_500 }).then((handle) => handle.jsonValue())
    if (!result) throw new Error('Fullscreen outcome was not recorded')
    const outcome = { fullscreenEnabled, ...result }
    testInfo.annotations.push({ type: 'video-fullscreen', description: JSON.stringify(outcome) })
    console.info('Video fullscreen capability:', JSON.stringify(outcome))
    expect(result.status).toBe('entered')
    expect(await page.evaluate(() => document.fullscreenElement?.classList.contains('memoly-private-video-v2-frame') ?? false)).toBe(true)
    expect(await page.evaluate(() => Boolean(document.fullscreenElement?.querySelector('[data-slot="video-playback-controls"]')))).toBe(true)
    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null)
  } else {
    const outcome = { fullscreenEnabled, reason: 'button disabled because fullscreen capability is unavailable' }
    testInfo.annotations.push({ type: 'video-fullscreen', description: JSON.stringify(outcome) })
    console.info('Video fullscreen capability:', JSON.stringify(outcome))
  }
  await page.screenshot({ path: join(artifacts, `${testInfo.project.name}-private-video-playing.png`), fullPage: true })

  await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  await page.getByRole('button', { name: /Подробнее/ }).click()
  await expect(page.getByRole('heading', { name: 'Воспоминание' })).toBeVisible()
  const detailPoster = page.locator('.memoly-detail-surface [data-slot="private-video-poster"] img')
  await expect(detailPoster).toBeVisible()
  await expect.poll(() => detailPoster.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await expect(card.locator('[data-video-poster-state="ready"]')).toBeVisible()

  await page.goto('about:blank')
  await page.goBack()
  const returnedCard = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777771"]')
  await expect(returnedCard.locator('[data-video-poster-state="ready"]')).toBeVisible({ timeout: 15_000 })
  await expect(returnedCard.locator('[data-slot="private-video-poster"] img')).toBeVisible()
  await expect(returnedCard.locator('video')).toHaveJSProperty('paused', true)

  await page.reload()
  const reopenedCard = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777771"]')
  await expect(reopenedCard.locator('[data-video-poster-state="ready"]')).toBeVisible({ timeout: 15_000 })
  await expect(reopenedCard.locator('video')).toHaveJSProperty('paused', true)
})

test('a private poster becoming ready refreshes in place without a page reload', async ({ page }, testInfo) => {
  await page.request.post('/__fixture__/poster-reset?poster-processing=1')
  let mainFrameNavigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) mainFrameNavigations += 1 })
  await page.goto('/e2e/private-video-poster.fixture.html?poster-processing=1')
  const card = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777771"]')
  const frame = card.locator('.memoly-private-video-v2-frame')
  await expect(frame).toHaveAttribute('data-video-poster-state', 'pending')
  await expect(card.locator('[data-slot="private-video-poster"] img')).toHaveCount(0)
  await expect.poll(() => frame.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(21, 19, 21)')
  await card.screenshot({ path: join(artifacts, `${testInfo.project.name}-private-video-poster-pending.png`) })

  await page.request.post('/__fixture__/poster-ready')
  await expect(frame).toHaveAttribute('data-video-poster-state', 'ready', { timeout: 12_000 })
  await expect(card.locator('[data-slot="private-video-poster"] img')).toBeVisible()
  expect(mainFrameNavigations).toBe(1)
  await card.screenshot({ path: join(artifacts, `${testInfo.project.name}-private-video-poster-ready.png`) })
})

test('a failed private video keeps polling for its poster and shows it under readable error feedback', async ({ page }) => {
  await page.request.post('/__fixture__/poster-reset?playback-failed=1')
  let mainFrameNavigations = 0
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) mainFrameNavigations += 1 })
  await page.goto('/e2e/private-video-poster.fixture.html?playback-failed=1')
  const card = page.locator('[data-memory-id="77777777-7777-4777-8777-777777777771"]')
  await card.scrollIntoViewIfNeeded()
  const frame = card.locator('.memoly-private-video-v2-frame')
  await expect(card.locator('[data-video-viewer-state="error"]')).toBeVisible()
  await expect(frame).toHaveAttribute('data-video-poster-state', 'pending')
  await expect(card.locator('[data-slot="private-video-poster"] img')).toHaveCount(0)
  await expect(card.getByRole('alert')).toContainText('Не удалось загрузить видео')
  await expect(card.locator('.memoly-private-video-v2-play')).toHaveCount(0)
  await expect(card.locator('.memoly-private-video-v2-duration')).toContainText('0:30')
  await expect(card.locator('[data-slot="video-playback-controls"]')).toHaveCount(0)

  await page.request.post('/__fixture__/poster-ready')
  const poster = card.locator('[data-slot="private-video-poster"] img')
  await expect(frame).toHaveAttribute('data-video-poster-state', 'ready', { timeout: 15_000 })
  await expect(poster).toBeVisible()
  await expect.poll(() => poster.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await expect(card.locator('[data-video-viewer-state="error"]')).toBeVisible()
  await expect(card.getByRole('alert')).toContainText('Не удалось загрузить видео')
  await expect(card.locator('.memoly-private-video-v2-play')).toHaveCount(0)
  await expect(card.locator('.memoly-private-video-v2-duration')).toContainText('0:30')
  await expect(card.locator('[data-slot="video-playback-controls"]')).toHaveCount(0)
  expect(mainFrameNavigations).toBe(1)
})

function fixtureMemories(): MemoryDto[] {
  const path = (id: string, variant: string) => `/api/v1/families/${familyId}/media/${id}/content?variant=${variant}`
  const video = (id: string, portrait = false) => ({ id, source: 'private_storage' as const, kind: 'video' as const, width: portrait ? 180 : 320, height: portrait ? 320 : 180, durationMs: 30_000, renditionStatus: 'ready' as const, previewPath: path(id, 'preview'), displayPath: null, playbackPath: path(id, 'playback'), originalDownloadPath: path(id, 'original'), waveform: null })
  const photo = (id: string) => ({ id, source: 'private_storage' as const, kind: 'photo' as const, width: 320, height: 180, durationMs: null, renditionStatus: 'ready' as const, previewPath: path(id, 'preview'), displayPath: path(id, 'display'), playbackPath: null, originalDownloadPath: path(id, 'original'), waveform: null })
  const familyChild = '33333333-3333-4333-8333-333333333333'
  const author = '44444444-4444-4444-8444-444444444444'
  const videoA = video('55555555-5555-4555-8555-555555555551')
  const videoB = video('55555555-5555-4555-8555-555555555552', true)
  const videoC = video('55555555-5555-4555-8555-555555555553')
const videoD = video('55555555-5555-4555-8555-555555555554')
  const videoPortrait = video('55555555-5555-4555-8555-555555555555', true)
  const photoA = photo('66666666-6666-4666-8666-666666666661')
  const create = (id: number, kind: MemoryDto['kind'], attachments: MemoryDto['attachments']): MemoryDto => ({ id: `77777777-7777-4777-8777-77777777777${id}`, familyId, childId: familyChild, author: { id: author, name: 'Анна', avatarPath: null, avatarCrop: null }, kind, body: `Synthetic memory ${id}`, occurredAt: `2026-10-03T10:0${id}:00.000Z`, firstPublishedAt: null, sourcePublishedAt: null, createdAt: '2026-10-03T10:00:00.000Z', version: 1, status: 'published', attachments, reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true } })
  return [
    create(1, 'video', [videoA]),
    create(2, 'media', [photoA, videoPortrait]),
    create(3, 'media', [videoA, videoB, videoC, videoD]),
    create(4, 'media', [videoA, videoB]),
    create(5, 'video', [videoPortrait]),
  ]
}
