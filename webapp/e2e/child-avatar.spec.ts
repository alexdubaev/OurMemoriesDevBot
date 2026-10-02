import { expect, test } from '@playwright/test'

async function editExisting(page: import('@playwright/test').Page) {
  await expect(page.getByRole('button', { name: 'Изменить кадрирование' })).toBeVisible()
  await page.getByRole('button', { name: 'Изменить кадрирование' }).click()
  const editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Готово' })).toBeEnabled()
  return editor
}
async function savedCalls(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __childAvatarCalls: Array<{ path: string; options: { method?: string; body?: unknown } }> }).__childAvatarCalls)
}

test('child profile edit recrops the displayed staged replacement instead of restoring the old server image', async ({ page }) => {
  await page.goto('/e2e/child-avatar.html?profile')
  const replacement = await page.evaluate(() => (window as Window & { __childReplacementPng: string }).__childReplacementPng)
  await page.getByTestId('child-avatar-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(replacement.split(',')[1]!, 'base64') })
  let editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await editor.getByRole('slider', { name: 'Масштаб' }).fill('1.6')
  await editor.getByRole('button', { name: 'Готово' }).click()
  const displayedPreview = page.locator('img[alt="Предпросмотр аватара ребёнка"]')
  await expect(displayedPreview).toBeVisible()
  const stagedSource = await displayedPreview.getAttribute('src')
  await page.getByRole('button', { name: 'Изменить кадрирование' }).click()
  editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor).toBeVisible()
  expect(await editor.locator('.reactEasyCrop_Image').getAttribute('src')).toBe(stagedSource)
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(displayedPreview).toHaveAttribute('src', stagedSource!)
  await expect(page.getByRole('button', { name: 'Сохранить профиль' })).toBeEnabled()
})

test('existing child photo recrops without a new file and saves the current profile version', async ({ page }) => {
  await page.goto('/e2e/child-avatar.html')
  const editor = await editExisting(page)
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor).toBeHidden()
  const patch = (await savedCalls(page)).find((call) => call.options.method === 'PATCH')
  expect(patch?.options.body).toMatchObject({ child: { avatarMediaId: '22222222-2222-4222-8222-222222222222', avatarCrop: { x: 0.2, y: 0.1, width: 0.6, height: 0.6 }, expectedVersion: 7 } })
  expect((await savedCalls(page)).filter((call) => call.path.endsWith('/uploads'))).toHaveLength(0)
})

test('child VERSION_CONFLICT is shown in the editor and disables unsafe retry', async ({ page }) => {
  await page.goto('/e2e/child-avatar.html?failure=conflict')
  const editor = await editExisting(page)
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor.getByRole('alert')).toContainText('Профиль ребёнка уже изменился')
  await expect(editor.getByRole('button', { name: 'Готово' })).toBeDisabled()
  expect(await savedCalls(page)).toHaveLength(1)
  await editor.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByText('Профиль ребёнка уже изменился. Отмените смену фото, вернитесь в профиль и откройте её снова.')).toBeVisible()
})

test('failed child recrop retries with the same crop and expected version', async ({ page }) => {
  await page.goto('/e2e/child-avatar.html?failure=retry')
  const editor = await editExisting(page)
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor.getByRole('alert')).toContainText('Synthetic network failure')
  await editor.getByRole('button', { name: 'Повторить' }).click()
  await expect(editor).toBeHidden()
  const patches = (await savedCalls(page)).filter((call) => call.options.method === 'PATCH')
  expect(patches).toHaveLength(2)
  expect(patches[0]?.options.body).toEqual(patches[1]?.options.body)
})

test('child replacement can be cancelled with no upload reservation or profile update', async ({ page }) => {
  await page.goto('/e2e/child-avatar.html')
  await expect(page.getByRole('button', { name: 'Изменить кадрирование' })).toBeVisible()
  await page.getByTestId('child-avatar-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
  const editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Отмена' }).click()
  expect(await savedCalls(page)).toHaveLength(0)
})

test('child replacement uploads only after Done and keeps original bytes through retryable save flow', async ({ page }) => {
  await page.route('**/signed-put', (route) => route.fulfill({ status: 200 }))
  await page.goto('/e2e/child-avatar.html')
  await expect(page.getByRole('button', { name: 'Изменить кадрирование' })).toBeVisible()
  await page.getByTestId('child-avatar-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
  const editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor).toBeVisible()
  expect(await savedCalls(page)).toHaveLength(0)
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor).toBeHidden()
  const calls = await savedCalls(page)
  expect(calls.some((call) => call.path.endsWith('/uploads'))).toBe(true)
  expect(calls.find((call) => call.path.endsWith('/uploads') && call.options.method === 'POST')).toBeTruthy()
  const patch = calls.find((call) => call.options.method === 'PATCH')
  expect(patch?.options.body).toMatchObject({ child: { expectedVersion: 7, avatarMediaId: '44444444-4444-4444-8444-444444444444' } })
})
