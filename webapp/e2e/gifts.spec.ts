import { expect, test } from '@playwright/test'

type GiftEvidence = {
  metadataRequests: Array<{ familyId: string; url: string }>
  uploadReservations: Array<{ purpose: string; contentType: string; byteSize: number }>
  uploadBytes: Array<{ size: number; type: string; name: string }>
  finalizedUploads: string[]
  createBodies: Array<{ title: string; price?: string; photoMediaId: string }>
  updateBodies: Array<{ url?: string; photoMediaId?: string }>
}

test('gift editor stays open through dismissal attempts while save is pending', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?giftSaveDelay=1100')
  await startProductionFeed(page)

  await page.getByRole('button', { name: 'Вишлист', exact: true }).click()
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
  await expect(navigation.locator('button')).toHaveText(['Лента', 'Альбомы', 'Добавить', 'Вишлист', 'Семья'])
  await page.screenshot({ path: testInfo.outputPath('gifts-five-slot-nav-after-save.png'), fullPage: true })
})

test('opening gifts after family access is removed clears the stale private list and returns to the hub', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/selected-family-app.harness.html?giftAccessDenied')
  await startProductionFeed(page)

  await page.getByRole('button', { name: 'Вишлист', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(page.locator('[data-navigation-surface="gifts"]')).toHaveCount(0)
  await expect(page.getByText('Конструктор', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __selectedFamilyGiftCached?: () => unknown }).__selectedFamilyGiftCached?.())).toBeUndefined()
})

test('creating from a valid URL fills available metadata and uploads the private photo on save', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?giftMetadata=ready&giftMetadataDelay=500')
  await startProductionFeed(page)
  await page.getByRole('button', { name: 'Вишлист', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить подарок', exact: true }).click()

  const form = page.locator('[data-slot="gift-form"]')
  await form.getByLabel('Ссылка на товар').fill('https://www.wildberries.ru/catalog/123/detail.aspx')
  await expect(form.getByLabel('Название')).toHaveValue('Игрушка из магазина')
  await expect(form.getByLabel('Цена, по желанию')).toHaveValue('3490 ₽')
  await expect(form.locator('.gift-photo-preview img')).toBeVisible()
  await expect(form.getByText('Название и фото добавлены. Их можно изменить.')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('gift-create-autofill.png'), fullPage: true })

  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Подарок добавлен.' })).toBeVisible()
  await expect(page.locator('.gift-card').filter({ hasText: 'Игрушка из магазина' })).toBeVisible()
  const evidence = await page.evaluate(() => (window as typeof window & { __selectedFamilyGiftEvidence: GiftEvidence }).__selectedFamilyGiftEvidence)
  expect(evidence.metadataRequests.map(({ url }) => url)).toEqual(['https://www.wildberries.ru/catalog/123/detail.aspx'])
  expect(evidence.uploadReservations).toEqual([expect.objectContaining({ purpose: 'gift', contentType: 'image/webp' })])
  expect(evidence.uploadBytes[0]).toEqual(expect.objectContaining({ type: 'image/webp', name: 'gift-product.webp' }))
  expect(evidence.finalizedUploads).toHaveLength(1)
  expect(evidence.createBodies[0]).toEqual(expect.objectContaining({ title: 'Игрушка из магазина', price: '3490 ₽', photoMediaId: evidence.finalizedUploads[0] }))

  await page.getByRole('button', { name: 'Добавить подарок', exact: true }).click()
  const quickSaveForm = page.locator('[data-slot="gift-form"]')
  await quickSaveForm.getByLabel('Ссылка на товар').fill('https://www.wildberries.ru/catalog/456/detail.aspx')
  await quickSaveForm.getByRole('button', { name: 'Сохранить' }).click()
  await expect(quickSaveForm.getByRole('button', { name: 'Ищем данные товара…' })).toBeVisible()
  await expect(quickSaveForm).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Подарок добавлен.' })).toBeVisible()
  const quickSaveEvidence = await page.evaluate(() => (window as typeof window & { __selectedFamilyGiftEvidence: GiftEvidence }).__selectedFamilyGiftEvidence)
  expect(quickSaveEvidence.createBodies[1]).toEqual(expect.objectContaining({ title: 'Игрушка из магазина', price: '3490 ₽', photoMediaId: quickSaveEvidence.finalizedUploads[1] }))
})

test('a valid URL saves with the store name and gift icon when metadata is unavailable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?giftMetadata=unavailable')
  await startProductionFeed(page)
  await page.getByRole('button', { name: 'Вишлист', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить подарок', exact: true }).click()

  const form = page.locator('[data-slot="gift-form"]')
  await form.getByLabel('Ссылка на товар').fill('https://market.yandex.ru/cc/BNpQaH')
  await expect(form.getByText('Не удалось получить данные магазина. Можно сохранить ссылку со значком подарка и изменить название позже.')).toBeVisible()
  await expect(form.getByLabel('Название')).toHaveValue('')
  await expect(form.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 1100 })
  await page.screenshot({ path: testInfo.outputPath('gift-create-fallback.png'), fullPage: true })

  await form.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Подарок добавлен.' })).toBeVisible()
  await expect(page.locator('.gift-card').filter({ hasText: 'Яндекс Маркет' })).toBeVisible()
  const evidence = await page.evaluate(() => (window as typeof window & { __selectedFamilyGiftEvidence: GiftEvidence }).__selectedFamilyGiftEvidence)
  expect(evidence.uploadReservations).toEqual([expect.objectContaining({ purpose: 'gift', contentType: 'image/webp' })])
  expect(evidence.uploadBytes[0]).toEqual(expect.objectContaining({ type: 'image/webp', name: 'gift-default.webp' }))
  expect(evidence.finalizedUploads).toHaveLength(1)
  expect(evidence.createBodies[0]).toEqual(expect.objectContaining({ title: 'Яндекс Маркет', photoMediaId: evidence.finalizedUploads[0] }))
  expect(evidence.createBodies[0].price).toBeUndefined()
})

test('manual values beat delayed metadata, stale lookups are ignored, and editing keeps its private photo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/selected-family-app.harness.html?giftMetadata=ready&giftMetadataDelay=650')
  await startProductionFeed(page)
  await page.getByRole('button', { name: 'Вишлист', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить подарок', exact: true }).click()

  const createForm = page.locator('[data-slot="gift-form"]')
  await createForm.getByLabel('Ссылка на товар').fill('https://www.wildberries.ru/stale/item')
  await expect(createForm.getByText('Ищем название и фото по ссылке…')).toBeVisible()
  await createForm.getByLabel('Ссылка на товар').fill('https://www.ozon.ru/current/item')
  await createForm.getByLabel('Название').fill('Мой выбор')
  await createForm.getByLabel('Цена, по желанию').fill('5290 ₽')
  await createForm.getByLabel('Цена, по желанию').fill('')
  await createForm.locator('input[type="file"]').setInputFiles('public/assets/icons/gift-default@3x.webp')
  await expect(createForm.locator('.gift-photo-preview img')).toBeVisible()
  await expect(createForm.getByText('Название и фото добавлены. Их можно изменить.')).toBeVisible()
  await expect(createForm.getByLabel('Название')).toHaveValue('Мой выбор')
  await expect(createForm.getByLabel('Цена, по желанию')).toHaveValue('')
  await createForm.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Подарок добавлен.' })).toBeVisible()
  const created = await page.evaluate(() => (window as typeof window & { __selectedFamilyGiftEvidence: GiftEvidence }).__selectedFamilyGiftEvidence.createBodies[0])
  expect(created).toEqual(expect.objectContaining({ title: 'Мой выбор' }))
  expect(created.price).toBeUndefined()
  const evidence = await page.evaluate(() => (window as typeof window & { __selectedFamilyGiftEvidence: GiftEvidence }).__selectedFamilyGiftEvidence)
  expect(evidence.metadataRequests.map(({ url }) => url)).toEqual(['https://www.wildberries.ru/stale/item', 'https://www.ozon.ru/current/item'])
  expect(evidence.uploadBytes[0]?.name).toBe('gift-default@3x.webp')

  await page.locator('.gift-card').filter({ hasText: 'Конструктор' }).getByRole('button', { name: 'Изменить подарок «Конструктор»' }).click()
  const editForm = page.locator('[data-slot="gift-form"]')
  await editForm.getByLabel('Ссылка на товар').fill('https://www.ozon.ru/product/changed-url/')
  await expect(editForm.getByLabel('Название')).toHaveValue('Конструктор')
  await expect(editForm.locator('.gift-photo-preview img')).toBeVisible()
  await editForm.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Изменения сохранены.' })).toBeVisible()
  const finalEvidence = await page.evaluate(() => (window as typeof window & { __selectedFamilyGiftEvidence: GiftEvidence }).__selectedFamilyGiftEvidence)
  expect(finalEvidence.metadataRequests).toHaveLength(2)
  expect(finalEvidence.uploadReservations).toHaveLength(1)
  expect(finalEvidence.updateBodies.at(-1)).toEqual(expect.objectContaining({ url: 'https://www.ozon.ru/product/changed-url/' }))
  expect(finalEvidence.updateBodies.at(-1)?.photoMediaId).toBeUndefined()
})

async function startProductionFeed(page: import('@playwright/test').Page) {
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const feed = page.locator('[data-navigation-surface="feed"] .ui-v2-child-header')
  await expect(welcome.or(feed).first()).toBeVisible()
  if (await welcome.isVisible()) await welcome.click()
  await expect(feed).toBeVisible()
}
