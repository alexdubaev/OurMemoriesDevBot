import { expect, test } from '@playwright/test'

function syntheticWav() {
  const sampleRate = 8_000, sampleCount = sampleRate * 5, data = Buffer.alloc(44 + sampleCount * 2)
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVE', 8); data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(sampleCount * 2, 40)
  for (let index = 0; index < sampleCount; index += 1) data.writeInt16LE(Math.sin(index * Math.PI * 2 * 440 / sampleRate) * 6_000, 44 + index * 2)
  return data
}

test('production voice player controls playback, seek, replay, and switches audio owners', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await page.route('**/api/v1/families/*/media/playback-session', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/families/*/media/voices/*/content', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: syntheticWav() }))
  await page.setViewportSize({ width: 430, height: 844 })
  await page.goto('/e2e/fixed-carousel.harness.html?voice=1')
  const cards = page.locator('.memory-card').filter({ hasText: 'Synthetic voice recording' })
  const first = cards.nth(0), second = cards.nth(1)
  const play = first.getByRole('button', { name: 'Воспроизвести голосовое' })
  const audio = first.locator('audio')
  await expect(play).toBeVisible()
  await expect(play).toBeEnabled()
  const initialHeight = await first.locator('.memoly-voice-player').evaluate((node) => node.getBoundingClientRect().height)
  await play.click()
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.duration)).toBeGreaterThan(4.5)
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => !node.paused)).toBe(true)
  await expect(first.getByRole('button', { name: 'Приостановить голосовое' })).toBeVisible()
  await first.getByRole('button', { name: 'Приостановить голосовое' }).click()
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
  await expect.poll(() => first.locator('.memoly-voice-player').evaluate((node) => node.getBoundingClientRect().height)).toBe(initialHeight)
  await first.getByRole('button', { name: 'Воспроизвести голосовое' }).click()
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => !node.paused)).toBe(true)
  const seek = first.getByRole('slider', { name: 'Позиция голосового сообщения' })
  const seekBounds = await seek.boundingBox()
  if (!seekBounds) throw new Error('Voice seek slider has no visible hit target')
  await seek.click({ position: { x: seekBounds.width / 2, y: seekBounds.height / 2 } })
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(1)
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeLessThan(4)
  await expect.poll(() => first.locator('[data-waveform-played="true"]').count()).toBeGreaterThan(15)
  await seek.press('End')
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(4.5)
  await expect(first.locator('[data-waveform-played="true"]')).toHaveCount(48)
  await expect(first.getByText('0:05 / 0:05')).toBeVisible()
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.ended)).toBe(true)
  await expect(first.getByRole('button', { name: 'Воспроизвести голосовое' })).toBeVisible()
  await first.getByRole('button', { name: 'Воспроизвести голосовое' }).click()
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => !node.paused && !node.ended)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('voice-player-430.png') })
  await second.getByRole('button', { name: 'Воспроизвести голосовое' }).click()
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true)
  await expect.poll(() => second.locator('audio').evaluate((node: HTMLAudioElement) => !node.paused)).toBe(true)
  expect(browserErrors).toEqual([])
})

test('voice controls fit narrow cards in supported theme under light and dark system color schemes', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await page.route('**/api/v1/families/*/media/playback-session', (route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/families/*/media/voices/*/content', (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body: syntheticWav() }))
  await page.goto('/e2e/fixed-carousel.harness.html?voice=1')
  const card = page.locator('.memory-card').filter({ hasText: 'Synthetic voice recording' }).first()
  const maxVoiceCard = page.locator('.memory-card').filter({ hasText: 'Synthetic MAX voice' })
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await expect(maxVoiceCard.locator('[data-waveform-peak]')).toHaveCount(48)
      const layout = await card.evaluate((node) => {
        const bounds = node.getBoundingClientRect(), player = node.querySelector('.memoly-voice-player')!, audio = node.querySelector('.ml-audio')!, button = node.querySelector('.memoly-voice-play')!.getBoundingClientRect(), seek = node.querySelector('[data-slot="voice-waveform"]')!.getBoundingClientRect(), time = node.querySelector('.memoly-voice-time')!.getBoundingClientRect()
        const playerBounds = player.getBoundingClientRect(), audioBounds = audio.getBoundingClientRect()
        return { left: bounds.left, right: bounds.right, playerRight: playerBounds.right, audioRight: audioBounds.right, audioHeight: audioBounds.height, buttonLeft: button.left, buttonRight: button.right, buttonWidth: button.width, buttonHeight: button.height, buttonCenterY: button.top + button.height / 2, seekLeft: seek.left, seekCenterY: seek.top + seek.height / 2, seekRight: seek.right, timeTop: time.top, seekBottom: seek.bottom, documentWidth: document.documentElement.scrollWidth }
      })
      expect(layout.buttonWidth).toBeGreaterThanOrEqual(44)
      expect(layout.buttonHeight).toBeGreaterThanOrEqual(44)
      expect(Math.abs(layout.buttonCenterY - layout.seekCenterY)).toBeLessThanOrEqual(1)
      expect(layout.buttonRight).toBeLessThanOrEqual(layout.seekLeft)
      expect(layout.timeTop).toBeGreaterThanOrEqual(layout.seekBottom)
      expect(layout.playerRight).toBeLessThanOrEqual(layout.right)
      expect(layout.audioRight).toBeLessThanOrEqual(layout.right)
      expect(layout.audioHeight).toBeLessThanOrEqual(100)
      expect(layout.seekRight).toBeLessThanOrEqual(layout.right)
      expect(layout.documentWidth).toBeLessThanOrEqual(width)
      if ((width === 320 && colorScheme === 'light') || (width === 430 && colorScheme === 'dark')) await card.screenshot({ path: testInfo.outputPath(`voice-player-${width}-${colorScheme}.png`) })
    }
  }
  expect(browserErrors).toEqual([])
})
