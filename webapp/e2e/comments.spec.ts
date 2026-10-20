import { createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const maxBotToken = '987654:max-e2e-synthetic-token'
const themes = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'] as const
const widths = [320, 390, 430] as const

type FamilyResult = { family: { id: string } }
type ChildResult = { child: { id: string } }
type MemoryResult = { id: string }

function signedMaxInitData(userId: number) {
  const fields = new Map([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', `comments-${randomUUID()}`],
    ['start_param', ''],
    ['user', JSON.stringify({ id: userId, first_name: 'Comments E2E' })],
  ])
  const checkString = [...fields].sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'))
  return new URLSearchParams([...fields]).toString()
}

async function signInAndSeed(page: Page) {
  const maxUserId = 987_600_000 + Math.floor(Math.random() * 90_000)
  await page.addInitScript((initData) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData, version: '1', platform: 'web', ready() {} } })
  }, signedMaxInitData(maxUserId))
  const authPromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.ok())
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  const auth = await authPromise
  const token = (await auth.json() as { accessToken: string }).accessToken

  const familyResponse = await page.request.post('/api/v1/families', {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    data: { name: `Comments ${randomUUID().slice(0, 8)}`, timezone: 'Europe/Moscow' },
  })
  expect(familyResponse.status()).toBe(201)
  const familyId = (await familyResponse.json() as FamilyResult).family.id
  const avatarMediaId = await uploadPng(page, token, familyId)
  const childResponse = await page.request.put(`/api/v1/families/${familyId}/child`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: 'Синтетический ребёнок', birthDate: '2024-01-02', sex: 'girl', avatarMediaId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null },
  })
  expect(childResponse.status()).toBe(200)
  const childId = (await childResponse.json() as ChildResult).child.id
  const memoryResponse = await page.request.post(`/api/v1/families/${familyId}/memories`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    data: { kind: 'note', childId, body: `Synthetic comment target ${randomUUID()}`, occurredAt: '2026-10-18T10:00:00.000Z' },
  })
  expect(memoryResponse.status()).toBe(201)
  const memoryId = (await memoryResponse.json() as MemoryResult).id

  await page.reload()
  const familyButton = page.locator('.family-hub-card').first()
  await expect(familyButton).toBeVisible()
  await familyButton.click()
  await expect(page.locator(`[data-memory-id="${memoryId}"]`)).toBeVisible({ timeout: 20_000 })
  return { familyId, memoryId, token }
}

async function uploadPng(page: Page, token: string, familyId: string) {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const reserve = await page.request.post(`/api/v1/families/${familyId}/uploads`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { purpose: 'child_avatar', kind: 'photo', contentType: 'image/png', byteSize: bytes.byteLength },
  })
  expect(reserve.status()).toBe(201)
  const ticket = await reserve.json() as { assetId: string; upload: { uploadId: string; url: string; headers: Record<string, string> } }
  const signed = new URL(ticket.upload.url)
  const upload = await page.request.put(`${signed.origin}${signed.pathname}${signed.search}`, { headers: ticket.upload.headers, data: bytes })
  expect(upload.status()).toBe(200)
  const finalized = await page.request.post(`/api/v1/families/${familyId}/uploads/${ticket.upload.uploadId}/finalize`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(finalized.status()).toBe(200)
  return ticket.assetId
}

test('COM-3 real MAX browser creates, retries, edits, cancels and deletes one comment', async ({ page }) => {
  const { familyId, memoryId, token } = await signInAndSeed(page)
  const commentPath = `/api/v1/families/${familyId}/memories/${memoryId}/comments`
  const listRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === commentPath && request.method() === 'GET') listRequests.push(request.url())
  })
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const entry = card.getByRole('button', { name: /Комментарии/ })
  await expect(entry).toBeVisible()
  const productionIcon = await page.request.get('/assets/icons/comments-default@2x.webp')
  expect(productionIcon.status()).toBe(200)
  const iconNames = ['comments-default@2x.webp', 'comments-default@3x.webp', 'comments-active@2x.webp', 'comments-active@3x.webp', 'comments-white@2x.webp', 'comments-white@3x.webp']
  for (const name of iconNames) {
    const source = await readFile(new URL(`../../assets/icons/${name}`, import.meta.url))
    const built = await readFile(resolve(fileURLToPath(new URL('../dist', import.meta.url)), 'assets', 'icons', name))
    const served = name === 'comments-default@2x.webp' ? await productionIcon.body() : Buffer.from(await (await page.request.get(`/assets/icons/${name}`)).body())
    expect(built).toEqual(source)
    expect(served).toEqual(source)
  }
  await expect.poll(() => listRequests.length).toBe(0)
  await entry.click()
  await expect(page.getByRole('dialog').getByText('Пока нет комментариев. Напишите первым')).toBeVisible()
  await expect.poll(() => listRequests.length).toBe(1)

  const firstKeys: string[] = []
  let firstPost = true
  await page.route(`**${commentPath}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    firstKeys.push((await route.request().allHeaders())['idempotency-key'] ?? '')
    if (firstPost) {
      firstPost = false
      const forwarded = await route.fetch()
      expect(forwarded.status()).toBe(201)
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  const textarea = page.getByRole('textbox', { name: 'Написать комментарий' })
  await textarea.fill('Синтетический комментарий для проверки')
  await page.getByRole('button', { name: 'Отправить' }).dblclick()
  await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeVisible()
  await expect(textarea).toHaveValue('Синтетический комментарий для проверки')
  await page.getByRole('button', { name: 'Повторить отправку' }).click()
  await expect(page.getByText('Синтетический комментарий для проверки', { exact: true })).toBeVisible()
  expect(firstKeys).toHaveLength(2)
  expect(firstKeys[0]).toMatch(/^[0-9a-f-]{36}$/i)
  expect(firstKeys[1]).toBe(firstKeys[0])

  const listed = await page.request.get(commentPath, { headers: { Authorization: `Bearer ${token}` } })
  expect(listed.status()).toBe(200)
  const listBody = await listed.json() as { items: Array<{ id: string; body: string; version: number; capabilities: { edit: boolean; delete: boolean } }> }
  expect(listBody.items.filter((item) => item.body === 'Синтетический комментарий для проверки')).toHaveLength(1)
  expect(listBody.items[0]?.capabilities).toMatchObject({ edit: true, delete: true })

  const item = page.locator('.comments-item').filter({ hasText: 'Синтетический комментарий для проверки' })
  await item.getByRole('button', { name: 'Изменить' }).click()
  const editField = page.getByRole('textbox', { name: 'Изменить комментарий' })
  await editField.fill('Исправленный синтетический комментарий')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Исправленный синтетический комментарий', { exact: true })).toBeVisible()
  await expect(item.getByText('изменено', { exact: true })).toBeVisible()

  await item.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('dialog').getByText('Удалить комментарий?')).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByText('Исправленный синтетический комментарий', { exact: true })).toBeVisible()
  await item.getByRole('button', { name: 'Удалить' }).click()
  await page.getByRole('button', { name: 'Удалить', exact: true }).last().click()
  await expect(page.getByText('Пока нет комментариев. Напишите первым')).toBeVisible()
})

test('initial comments 404 stays local and retry works; a later lost target closes only its panel', async ({ page }) => {
  const { familyId, memoryId } = await signInAndSeed(page)
  const commentPath = `/api/v1/families/${familyId}/memories/${memoryId}/comments`
  let listReads = 0
  await page.route(`**${commentPath}*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    listReads += 1
    if (listReads === 1 || listReads === 3) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'synthetic missing comment target' } }) })
      return
    }
    await route.continue()
  })
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const entry = card.getByRole('button', { name: /Комментарии/ })
  await entry.click()
  const panel = page.locator('.comments-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Повторить' })).toBeVisible()
  await expect(card).toBeVisible()
  await panel.getByRole('button', { name: 'Повторить' }).click()
  await expect(panel.getByText('Пока нет комментариев. Напишите первым')).toBeVisible()
  await panel.getByRole('button', { name: 'Обновить' }).click()
  await expect(panel).toBeHidden()
  await expect(card).toBeVisible()
  await expect(entry).toBeVisible()
})

test('COM-3 footer and open panel fit the frozen six themes at 320, 390 and 430 CSS pixels', async ({ page }, testInfo) => {
  const { memoryId } = await signInAndSeed(page)
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const entry = card.getByRole('button', { name: /Комментарии/ })
  const footer = page.getByTestId('bottom-navigation')
  await expect(entry).toBeVisible()
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 })
    for (const theme of themes) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.memolyTheme = nextTheme
        document.querySelector<HTMLElement>('.memoly-app-root')!.dataset.memolyTheme = nextTheme
      }, theme)
      await expect(entry).toBeVisible()
      const footerMeasure = await entry.evaluate((button) => {
        const box = button.getBoundingClientRect()
        const icon = button.querySelector('[data-slot="webp-icon"]')?.getBoundingClientRect()
        const documentWidth = document.documentElement.scrollWidth
        return { box: { width: box.width, height: box.height }, icon: icon ? { width: icon.width, height: icon.height } : null, documentWidth }
      })
      const navMeasure = await footer.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height, right: rect.right }
      })
      expect(footerMeasure.box.height).toBeGreaterThanOrEqual(44)
      expect(footerMeasure.icon?.width).toBe(22)
      expect(footerMeasure.documentWidth).toBeLessThanOrEqual(width)
      expect(navMeasure.height).toBeGreaterThanOrEqual(44)
      expect(navMeasure.right).toBeLessThanOrEqual(width + 1)
      await page.screenshot({ path: testInfo.outputPath(`comments-footer-${width}-${theme}.png`), fullPage: true })
      await entry.click()
      const panel = page.locator('.comments-panel')
      await expect(panel).toBeVisible()
      const panelMeasure = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const controls = [...element.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height)
        return { width: rect.width, right: rect.right, controls, documentWidth: document.documentElement.scrollWidth }
      })
      expect(panelMeasure.right).toBeLessThanOrEqual(width + 1)
      expect(panelMeasure.controls.every((height) => height >= 44)).toBe(true)
      expect(panelMeasure.documentWidth).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`comments-panel-${width}-${theme}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
      await expect(panel).toBeHidden()
    }
  }
})
