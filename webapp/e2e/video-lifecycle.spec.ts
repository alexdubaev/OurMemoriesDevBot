import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('production feed releases private video sources after scroll and remains bounded across 60 cards', async ({ page }, testInfo) => {
  const clip = await readFile(fileURLToPath(new URL('./fixtures/portrait-edges.mp4', import.meta.url)))
  let sessions = 0
  let delayFirstSession = true
  await page.addInitScript(() => {
    const state = { playEvents: 0, maxAttached: 0, rejectNextVideoPlay: false }
    Object.assign(window, { __videoLifecycleProbe: state })
    const nativePlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function() {
      if (this instanceof HTMLVideoElement && state.rejectNextVideoPlay) {
        state.rejectNextVideoPlay = false
        return Promise.reject(new DOMException('Playback requires a user gesture', 'NotAllowedError'))
      }
      return nativePlay.call(this)
    }
    const observer = new MutationObserver(() => {
      const attached = document.querySelectorAll('video[src]').length
      state.maxAttached = Math.max(state.maxAttached, attached)
    })
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
    document.addEventListener('play', () => { state.playEvents += 1 }, true)
    const activeLifecycleObservers = new Set<object>()
    const NativeObserver = window.IntersectionObserver
    window.IntersectionObserver = class extends NativeObserver {
      private tracked: boolean
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options)
        this.tracked = !options?.rootMargin || options.rootMargin === '0px'
        if (this.tracked) activeLifecycleObservers.add(this)
      }
      disconnect() { super.disconnect(); activeLifecycleObservers.delete(this) }
    }
    const subscriptions = new Map<string, number>()
    const key = (target: EventTarget, type: string) => `${target === document ? 'document' : target === window ? 'window' : 'other'}:${type}`
    const add = EventTarget.prototype.addEventListener
    const remove = EventTarget.prototype.removeEventListener
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (!listener) return
      if (this === document || this === window) { const eventKey = key(this, type); subscriptions.set(eventKey, (subscriptions.get(eventKey) ?? 0) + 1) }
      return add.call(this, type, listener, options)
    }
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (!listener) return
      if (this === document || this === window) { const eventKey = key(this, type); subscriptions.set(eventKey, Math.max(0, (subscriptions.get(eventKey) ?? 0) - 1)) }
      return remove.call(this, type, listener, options)
    }
    Object.assign(state, { activeLifecycleObservers, subscriptions })
  })
  await page.route('**/api/v1/families/*/media/playback-session', async (route) => { sessions += 1; if (delayFirstSession) { delayFirstSession = false; await new Promise((resolve) => setTimeout(resolve, 500)) }; await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => undefined) })
  await page.route('**/media/**/content', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: clip, headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/fixed-carousel.harness.html?lifecycle=1')
  const card = page.locator('.memory-card').nth(3)
  const play = card.getByRole('button', { name: 'Воспроизвести видео' })
  await expect(play).toBeVisible()
  expect(sessions).toBe(0)
  const idleSubscriptions = await page.evaluate(() => {
    const probe = (window as typeof window & { __videoLifecycleProbe: { subscriptions: Map<string, number>; activeLifecycleObservers: Set<object> } }).__videoLifecycleProbe
    return { listeners: Object.fromEntries([...probe.subscriptions].filter(([key]) => /:(visibilitychange|pagehide|memoly:feed-inactive)$/.test(key))), observers: probe.activeLifecycleObservers.size }
  })
  await play.click()
  const video = card.locator('video')
  await expect.poll(() => sessions).toBe(1)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(600)
  await expect(video).not.toHaveAttribute('src', /.+/)
  await card.scrollIntoViewIfNeeded()
  await page.evaluate(() => { (window as typeof window & { __videoLifecycleProbe: { rejectNextVideoPlay: boolean } }).__videoLifecycleProbe.rejectNextVideoPlay = true })
  const sessionsBeforeReturn = sessions
  await card.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect.poll(() => sessions).toBeGreaterThan(sessionsBeforeReturn)
  expect(sessions).toBeLessThanOrEqual(sessionsBeforeReturn + 2)
  await expect(video).toHaveAttribute('src', /.+/)
  await expect(card.getByRole('button', { name: 'Воспроизвести видео' })).toBeVisible()
  const sessionsAfterPrepared = sessions
  await card.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1)
  expect(sessions).toBe(sessionsAfterPrepared)
  const commentsEntry = card.locator('.comments-entry')
  await expect(commentsEntry).toBeVisible()
  await commentsEntry.click()
  const commentsPanel = page.locator('.comments-panel')
  await expect(commentsPanel).toBeVisible()
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)
  await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
  await expect(commentsPanel).toBeHidden()
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(600)
  expect(sessions).toBeLessThanOrEqual(2)
  await expect(video).not.toHaveAttribute('src', /.+/)
  await expect(card.getByRole('button', { name: 'Воспроизвести видео' })).toBeVisible()
  await card.scrollIntoViewIfNeeded()
  const sessionsBeforeReplay = sessions
  await card.getByRole('button', { name: 'Воспроизвести видео' }).click()
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1)
  expect(sessions).toBeGreaterThan(sessionsBeforeReplay)
  expect(sessions).toBeLessThanOrEqual(sessionsBeforeReplay + 2)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)
  await expect.poll(() => video.getAttribute('src')).toBeNull()
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => ({ networkState: node.networkState, buffered: node.buffered.length }))).toEqual({ networkState: 0, buffered: 0 })
  const releasedSubscriptions = await page.evaluate(() => {
    const probe = (window as typeof window & { __videoLifecycleProbe: { subscriptions: Map<string, number>; activeLifecycleObservers: Set<object> } }).__videoLifecycleProbe
    return { listeners: Object.fromEntries([...probe.subscriptions].filter(([key]) => /:(visibilitychange|pagehide|memoly:feed-inactive)$/.test(key))), observers: probe.activeLifecycleObservers.size }
  })
  expect(releasedSubscriptions).toEqual(idleSubscriptions)
  await page.evaluate(() => { (window as typeof window & { __videoLifecycleProbe: { playEvents: number } }).__videoLifecycleProbe.playEvents = 0 })
  let previousCheck: (() => Promise<void>) | null = null
  for (let index = 3; index < 63; index += 1) {
    const currentCard = page.locator('.memory-card').nth(index)
    await currentCard.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' }))
    if (index > 3) {
      const previousCard = page.locator('.memory-card').nth(index - 1)
      await expect.poll(() => previousCard.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0)
    }
    if (previousCheck) await previousCheck()
    const sessionsBeforeClick = sessions
    await currentCard.getByRole('button', { name: 'Воспроизвести видео' }).click()
    const currentVideo = currentCard.locator('video')
    await expect.poll(() => currentVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.05)
    expect(sessions).toBeGreaterThan(sessionsBeforeClick)
    expect(sessions).toBeLessThanOrEqual(sessionsBeforeClick + 2)
    previousCheck = async () => {
      await expect.poll(() => currentVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)
      await expect(currentVideo).not.toHaveAttribute('src', /.+/)
      await expect.poll(() => currentVideo.evaluate((node: HTMLVideoElement) => node.buffered.length)).toBe(0)
    }
    await expect.poll(async () => page.evaluate(() => document.querySelectorAll('video[src]').length)).toBeLessThanOrEqual(1)
  }
  const maxCard = page.locator('.memory-card').nth(63)
  await page.addStyleTag({ content: 'body { padding-bottom: 300px !important; }' })
  await maxCard.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' }))
  await expect.poll(() => page.locator('.memory-card').nth(62).evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0)
  if (previousCheck) await previousCheck()
  await expect(maxCard.getByRole('button', { name: 'Смотреть видео' })).toBeVisible()
  const sessionsBeforeMaxClick = sessions
  await page.evaluate(() => { (window as typeof window & { __videoLifecycleProbe: { rejectNextVideoPlay: boolean } }).__videoLifecycleProbe.rejectNextVideoPlay = true })
  await maxCard.getByRole('button', { name: 'Смотреть видео' }).click()
  const maxVideo = maxCard.locator('video')
  await expect.poll(() => sessions).toBeGreaterThan(sessionsBeforeMaxClick)
  expect(sessions).toBeLessThanOrEqual(sessionsBeforeMaxClick + 2)
  await expect(maxVideo).toHaveAttribute('src', /.+/)
  await expect(maxCard.getByRole('button', { name: 'Смотреть видео' })).toBeVisible()
  const sessionsAfterMaxSource = sessions
  await maxCard.getByRole('button', { name: 'Смотреть видео' }).click()
  await expect.poll(() => maxVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.1)
  expect(sessions).toBe(sessionsAfterMaxSource)
  await page.evaluate(() => document.dispatchEvent(new Event('memoly:feed-inactive')))
  await expect.poll(() => maxVideo.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true)
  await expect.poll(() => maxVideo.evaluate((node: HTMLVideoElement) => ({ networkState: node.networkState, buffered: node.buffered.length }))).toEqual({ networkState: 0, buffered: 0 })
  await page.screenshot({ path: testInfo.outputPath('video-lifecycle-long-feed.png'), fullPage: false })
  const stats = await page.evaluate(() => (window as typeof window & { __videoLifecycleProbe: { maxAttached: number; playEvents: number } }).__videoLifecycleProbe)
  expect(stats.maxAttached).toBeLessThanOrEqual(1)
  expect(stats.playEvents).toBeGreaterThanOrEqual(61)
  expect(stats.playEvents).toBeLessThanOrEqual(62)
  expect(await page.locator('video').evaluateAll((videos) => videos.filter((node) => !(node as HTMLVideoElement).paused).length)).toBe(0)
  expect(await page.locator('video[src]').count()).toBe(0)
})
