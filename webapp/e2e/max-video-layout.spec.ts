import { expect, test } from '@playwright/test'

test('standalone MAX video reserves its intrinsic frame in the v2 feed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/max-video-layout.harness.html')
  const frame = page.locator('[data-slot="max-video-frame"]')
  await expect(frame).toBeVisible()
  const geometry = await frame.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  expect(geometry.height).toBeGreaterThan(0)
  expect(geometry.width / geometry.height).toBeCloseTo(720 / 1280, 2)
  await expect(page.getByRole('button', { name: 'Смотреть видео' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Кадр видео' })).toBeVisible()
})


