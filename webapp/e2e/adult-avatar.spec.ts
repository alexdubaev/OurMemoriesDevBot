import { expect, test } from '@playwright/test'

async function image(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __adultPng: string }).__adultPng)
}

async function calls(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __adultAvatarCalls: Array<{ path: string; options: { method?: string; body?: unknown } }> }).__adultAvatarCalls)
}

test('adult add keeps selection local until Done and finalizes crop with original upload', async ({ page }) => {
  await page.route('**/signed-avatar', (route) => route.fulfill({ status: 200 }))
  await page.goto('/e2e/adult-avatar.html')
  await expect.poll(async () => (await calls(page)).some((call) => call.path === '/api/uploads/avatar')).toBe(true)
  await page.evaluate(() => { (window as Window & { __adultAvatarCalls: unknown[] }).__adultAvatarCalls.length = 0 })
  await page.getByTestId('avatar-file-input').setInputFiles({ name: 'adult.png', mimeType: 'image/png', buffer: Buffer.from((await image(page)).split(',')[1]!, 'base64') })
  const editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor).toBeVisible()
  expect(await calls(page)).toHaveLength(0)
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor).toBeHidden()
  const saved = await calls(page)
  const reserve = saved.find((call) => call.path === '/api/uploads/avatar' && call.options.method === 'POST')
  const finalize = saved.find((call) => call.path.endsWith('/finalize'))
  expect(reserve).toBeTruthy()
  expect(finalize?.options.body).toMatchObject({ avatarCrop: { x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) } })
})

test('adult existing avatar uses the shared editor to recrop without selecting a file; replacement cancel is inert', async ({ page }) => {
  await page.goto('/e2e/adult-avatar.html?existing')
  const edit = page.getByRole('button', { name: 'Изменить кадрирование' })
  await expect(edit).toBeEnabled()
  await edit.click()
  let editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor.getByRole('slider', { name: 'Масштаб' })).toBeVisible()
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor).toBeHidden()
  const crop = (await calls(page)).find((call) => call.path === '/api/uploads/avatar/crop')
  const cropBody = crop?.options.body as { avatarCrop: { x: number; y: number; width: number; height: number } }
  expect(crop?.options.body).toMatchObject({ avatarId: '22222222-2222-4222-8222-222222222222', expectedUpdatedAt: '2026-10-02T10:00:00.000Z', avatarCrop: { x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) } })
  expect((await calls(page)).some((call) => call.path === '/api/uploads/avatar' && call.options.method === 'POST')).toBe(false)

  await page.getByRole('button', { name: 'Изменить кадрирование' }).click()
  editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await editor.getByRole('button', { name: 'Готово' }).click()
  const repeated = (await calls(page)).filter((call) => call.path === '/api/uploads/avatar/crop').at(-1)?.options.body as typeof cropBody
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(repeated.avatarCrop[key] - cropBody.avatarCrop[key])).toBeLessThan(0.002)

  await page.getByRole('button', { name: 'Заменить фотографию' }).click()
  await page.getByTestId('avatar-file-input').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from((await image(page)).split(',')[1]!, 'base64') })
  editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor).toBeVisible()
  await editor.getByRole('button', { name: 'Отмена' }).click()
  await expect(editor).toBeHidden()
  expect((await calls(page)).filter((call) => call.path === '/api/uploads/avatar' && call.options.method === 'POST')).toHaveLength(0)
})

test('adult failed finalize keeps the selected file and crop for retry', async ({ page }) => {
  await page.route('**/signed-avatar', (route) => route.fulfill({ status: 200 }))
  await page.goto('/e2e/adult-avatar.html?retry')
  await expect.poll(async () => (await calls(page)).some((call) => call.path === '/api/uploads/avatar')).toBe(true)
  await page.evaluate(() => { (window as Window & { __adultAvatarCalls: unknown[] }).__adultAvatarCalls.length = 0 })
  await page.getByTestId('avatar-file-input').setInputFiles({ name: 'adult.png', mimeType: 'image/png', buffer: Buffer.from((await image(page)).split(',')[1]!, 'base64') })
  const editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor.getByRole('alert')).toContainText('Synthetic finalize failure')
  await editor.getByRole('button', { name: 'Повторить' }).click()
  await expect(editor).toBeHidden()
  const saved = await calls(page)
  const finalizes = saved.filter((call) => call.path.endsWith('/finalize'))
  expect(finalizes).toHaveLength(2)
  expect(finalizes[0]?.options.body).toEqual(finalizes[1]?.options.body)
  expect(saved.filter((call) => call.path === '/api/uploads/avatar' && call.options.method === 'POST')).toHaveLength(2)
})

test('adult can remove own avatar through the existing action', async ({ page }) => {
  await page.goto('/e2e/adult-avatar.html?existing')
  await page.getByRole('button', { name: 'Удалить фотографию' }).click()
  await expect.poll(async () => (await calls(page)).some((call) => call.path === '/api/uploads/avatar' && call.options.method === 'DELETE')).toBe(true)
})
