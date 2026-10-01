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

test('account welcome runs once across browser contexts and restores family navigation', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installHost(page, 81000101)
  let firstContextClaims = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/me/welcome/claim') firstContextClaims += 1
  })
  await page.goto('/')
  const welcome = page.locator('[data-slot="welcome-splash"]')
  await expect(welcome).toBeVisible()
  await expect(welcome.locator('.continue-button')).toBeDisabled()
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  await installHost(secondPage, 81000101)
  await secondPage.goto('/')
  await expect(secondPage.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(secondPage.locator('[data-slot="welcome-splash"]')).toHaveCount(0)
  await expect(welcome.locator('img')).toHaveCount(14)
  expect(await welcome.locator('.logo-wrap').evaluate((element) => Number.parseFloat(getComputedStyle(element).top))).toBeGreaterThanOrEqual(38)
  expect(await welcome.locator('.copy').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThanOrEqual(32)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  for (const [width, height] of [[320, 568], [390, 844], [402, 874], [430, 932], [768, 1024]] as const) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height)
    const button = welcome.locator('.continue-button')
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height)
  }
  await page.setViewportSize({ width: 320, height: 568 })
  await page.screenshot({ path: 'e2e/.artifacts/welcome-320x568.png', fullPage: true })
  await expect(welcome).toBeVisible()
  await expect(welcome.locator('.continue-button')).toBeEnabled({ timeout: 6_000 })
  await welcome.locator('.continue-button').click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible()
  await expect(welcome).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  expect(firstContextClaims).toBe(1)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(welcome).toHaveCount(0)
  expect(firstContextClaims).toBe(2)

  await page.getByRole('button', { name: 'Создать свою семью' }).click()
  await expect(page.getByRole('heading', { name: 'Расскажите о ребёнке' })).toBeVisible()
  expect(firstContextClaims).toBe(2)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(welcome).toHaveCount(0)
  expect(firstContextClaims).toBe(3)
  await secondContext.close()
})

test('reduced motion shows the static welcome and waits for explicit continuation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installHost(page, 81000102)
  await page.goto('/')
  const welcome = page.locator('[data-slot="welcome-splash"]')
  await expect(welcome).toBeVisible()
  expect(await welcome.locator('.footer').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  const button = welcome.locator('.continue-button')
  await expect(button).toBeEnabled({ timeout: 2_500 })
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toHaveCount(0)
  await button.click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(welcome).toHaveCount(0)
})

test('failed claim stays retryable and never guesses that Welcome is due', async ({ page }) => {
  await installHost(page, 81000103)
  let failed = false
  await page.route('**/api/v1/me/welcome/claim', async (route) => {
    if (!failed) {
      failed = true
      await route.abort('failed')
    } else await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Повторить/ })).toBeVisible()
  await expect(page.locator('[data-slot="welcome-splash"]')).toHaveCount(0)
  await page.getByRole('button', { name: /Повторить/ }).click()
  await expect(page.locator('[data-slot="welcome-splash"]')).toBeVisible()
  await expect(page.locator('[data-slot="welcome-splash"] .continue-button')).toBeDisabled()
  await page.locator('[data-slot="welcome-splash"] .continue-button').click({ timeout: 8_000 })
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
})
