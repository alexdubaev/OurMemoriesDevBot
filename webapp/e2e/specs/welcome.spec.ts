import { createHmac, randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'

import { expect, test } from '../helpers/test'

function signedInitData(subject: number) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1_000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: subject, first_name: 'Welcome E2E' }),
  })
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}

async function installHost(page: Page, subject: number) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((initData) => {
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: { WebApp: {
        initData, version: '8.0', platform: 'tdesktop',
        safeAreaInset: { top: 24, bottom: 18 }, contentSafeAreaInset: { top: 24, bottom: 18 },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, ready() {},
      } },
    })
  }, signedInitData(subject))
}

test('zero-family welcome runs without a click and restores normal family navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installHost(page, 81000101)
  await page.goto('/')
  const welcome = page.locator('[data-slot="welcome-splash"]')
  await expect(welcome).toBeVisible()
  await expect(welcome.locator('button')).toHaveCount(0)
  await expect(welcome.locator('img')).toHaveCount(14)
  expect(await welcome.locator('.logo-wrap').evaluate((element) => Number.parseFloat(getComputedStyle(element).top))).toBeGreaterThanOrEqual(38)
  expect(await welcome.locator('.copy').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThanOrEqual(32)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  for (const [width, height] of [[320, 568], [390, 844], [402, 874], [430, 932], [768, 1024]] as const) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height)
  }
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible()
  await expect(welcome).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')

  await page.getByRole('button', { name: 'Создать свою семью' }).click()
  await expect(page.getByRole('heading', { name: 'Расскажите о ребёнке' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(welcome).toHaveCount(0)
})

test('reduced motion shows the static welcome briefly before continuing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHost(page, 81000102)
  await page.goto('/')
  const welcome = page.locator('[data-slot="welcome-splash"]')
  await expect(welcome).toBeVisible()
  expect(await welcome.locator('.footer').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 2_500 })
  await expect(welcome).toHaveCount(0)
})
