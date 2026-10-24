import { expect, test } from '@playwright/test'

test('gift editor stays open through dismissal attempts while save is pending', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?giftSaveDelay=1100')
  await startProductionFeed(page)

  await page.getByRole('button', { name: 'Подарки', exact: true }).click()
  const gift = page.locator('.gift-card').filter({ hasText: 'Конструктор' })
  await expect(gift).toBeVisible()
  await gift.getByRole('button', { name: 'Изменить подарок «Конструктор»' }).click()
  const form = page.locator('[data-slot="gift-form"]')
  await expect(form).toBeVisible()
  await form.getByLabel('Название').fill('Новый конструктор')
  await form.getByRole('button', { name: 'Сохранить' }).click()
  await page.waitForFunction(() => Boolean((window as typeof window & { __selectedFamilyGiftSaveStarted?: boolean }).__selectedFamilyGiftSaveStarted))

  await expect(form.getByRole('button', { name: 'Отмена' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(form).toBeVisible()
  const overlay = page.locator('[data-slot="drawer-overlay"]')
  await overlay.click({ position: { x: 12, y: 12 } })
  await expect(form).toBeVisible()

  const bounds = await form.boundingBox()
  if (!bounds) throw new Error('Gift form is not laid out')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 18)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 170, { steps: 5 })
  await page.mouse.up()
  await expect(form).toBeVisible()

  await expect(page.getByRole('status').filter({ hasText: 'Изменения сохранены.' })).toBeVisible()
  await expect(form).toHaveCount(0)
  await expect(page.locator('.gift-card')).toContainText('Новый конструктор')
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(navigation.locator('button')).toHaveText(['Лента', 'Альбомы', 'Добавить', 'Подарки', 'Семья'])
  await page.screenshot({ path: testInfo.outputPath('gifts-five-slot-nav-after-save.png'), fullPage: true })
})

test('opening gifts after family access is removed clears the stale private list and returns to the hub', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/selected-family-app.harness.html?giftAccessDenied')
  await startProductionFeed(page)

  await page.getByRole('button', { name: 'Подарки', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(page.locator('[data-navigation-surface="gifts"]')).toHaveCount(0)
  await expect(page.getByText('Конструктор', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __selectedFamilyGiftCached?: () => unknown }).__selectedFamilyGiftCached?.())).toBeUndefined()
})

async function startProductionFeed(page: import('@playwright/test').Page) {
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const feed = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(welcome.or(feed).first()).toBeVisible()
  if (await welcome.isVisible()) await welcome.click()
  await expect(feed).toBeVisible()
}
