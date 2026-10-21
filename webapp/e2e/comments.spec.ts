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
  let seeded: { familyId: string; memoryId: string; childId: string; token: string } | null = null
  let familyPostIntercepted = false
  await page.route('**/api/v1/families', async (route) => {
    if (route.request().method() !== 'POST' || familyPostIntercepted) return route.continue()
    familyPostIntercepted = true
    const familyResponse = await route.fetch()
    expect(familyResponse.status()).toBe(201)
    const familyId = ((await familyResponse.json()) as FamilyResult).family.id
    const tokenFromRequest = (await route.request().allHeaders()).authorization?.replace(/^Bearer\s+/i, '') ?? token
    const avatarMediaId = await uploadPng(page, tokenFromRequest, familyId)
    const childResponse = await page.request.put(`/api/v1/families/${familyId}/child`, {
      headers: { Authorization: `Bearer ${tokenFromRequest}` },
      data: { name: 'Синтетический ребёнок', birthDate: '2024-01-02', sex: 'girl', avatarMediaId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null },
    })
    expect(childResponse.status()).toBe(200)
    const childId = (await childResponse.json() as ChildResult).child.id
    const memoryResponse = await page.request.post(`/api/v1/families/${familyId}/memories`, {
      headers: { Authorization: `Bearer ${tokenFromRequest}`, 'Idempotency-Key': randomUUID() },
      data: { kind: 'note', childId, body: `Synthetic comment target ${randomUUID()}`, occurredAt: '2026-10-18T10:00:00.000Z' },
    })
    expect(memoryResponse.status()).toBe(201)
    seeded = { familyId, memoryId: (await memoryResponse.json() as MemoryResult).id, childId, token: tokenFromRequest }
    await route.fulfill({ response: familyResponse })
  })
  await page.getByRole('button', { name: 'Создать свою семью' }).click()
  await expect.poll(() => seeded).not.toBeNull()
  const { familyId, memoryId } = seeded!
  await expect(page.locator(`[data-memory-id="${memoryId}"]`)).toBeVisible({ timeout: 20_000 })
  return { familyId, memoryId, childId: seeded!.childId, token: seeded!.token }
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

async function authenticateMax(page: Page, userId: number) {
  const response = await page.request.post('/api/v1/auth/max', {
    data: { initData: signedMaxInitData(userId) },
  })
  expect(response.status()).toBe(200)
  return (await response.json() as { accessToken: string }).accessToken
}

async function acceptRoleInvite(page: Page, familyId: string, ownerToken: string, memberToken: string, role: 'full' | 'viewer') {
  const invite = await page.request.post(`/api/v1/families/${familyId}/invites`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { role },
  })
  expect(invite.status()).toBe(201)
  const { rawToken } = await invite.json() as { rawToken: string }
  const accepted = await page.request.post('/api/v1/invites/accept', {
    headers: { Authorization: `Bearer ${memberToken}` },
    data: { token: rawToken },
  })
  expect(accepted.status()).toBe(200)
}

test('COM-4 real API roles, family isolation, cursor pages and 50-memory batch through the browser transport', async ({ page }) => {
  const owner = await signInAndSeed(page)
  const fullToken = await authenticateMax(page, 987_700_001)
  const viewerToken = await authenticateMax(page, 987_700_002)
  const otherPage = await page.context().newPage()
  const otherFamily = await signInAndSeed(otherPage)
  await acceptRoleInvite(page, owner.familyId, owner.token, fullToken, 'full')
  await acceptRoleInvite(page, owner.familyId, owner.token, viewerToken, 'viewer')

  const commentPath = `/api/v1/families/${owner.familyId}/memories/${owner.memoryId}/comments`
  const identities = [owner.token, fullToken, viewerToken]
  const writes = await Promise.all(identities.map((token, index) => page.request.post(commentPath, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    data: { body: `COM-4 role ${index}` },
  })))
  expect(writes.map((response) => response.status())).toEqual([201, 201, 201])
  const foreignRead = await page.request.get(`/api/v1/families/${otherFamily.familyId}/memories/${otherFamily.memoryId}/comments`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  })
  expect(foreignRead.status()).toBe(404)
  await otherPage.close()

  const pageRows = await Promise.all(Array.from({ length: 62 }, (_, index) =>
    page.request.post(commentPath, {
      headers: { Authorization: `Bearer ${owner.token}`, 'Idempotency-Key': randomUUID() },
      data: { body: `COM-4 page ${index}` },
    })))
  expect(pageRows.every((response) => response.status() === 201)).toBe(true)
  const first = await page.request.get(`${commentPath}?limit=50`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  })
  expect(first.status()).toBe(200)
  const firstBody = await first.json() as { items: Array<{ id: string }>; nextCursor: string | null }
  expect(firstBody.items).toHaveLength(50)
  expect(firstBody.nextCursor).toBeTruthy()
  const second = await page.request.get(`${commentPath}?limit=50&cursor=${encodeURIComponent(firstBody.nextCursor!)}`, {
    headers: { Authorization: `Bearer ${fullToken}` },
  })
  expect(second.status()).toBe(200)
  const secondBody = await second.json() as { items: Array<{ id: string }>; nextCursor: string | null }
  expect(secondBody.items.length).toBeGreaterThan(0)
  expect(new Set([...firstBody.items, ...secondBody.items].map((row) => row.id)).size)
    .toBe(firstBody.items.length + secondBody.items.length)

  const memoryIds = [owner.memoryId]
  for (let index = 0; index < 49; index += 1) {
    const response = await page.request.post(`/api/v1/families/${owner.familyId}/memories`, {
      headers: { Authorization: `Bearer ${owner.token}`, 'Idempotency-Key': randomUUID() },
      data: { kind: 'note', childId: owner.childId, body: `COM-4 batch ${index}`, occurredAt: new Date().toISOString() },
    })
    expect(response.status()).toBe(201)
    memoryIds.push((await response.json() as { id: string }).id)
  }
  const batch = await page.request.post(`/api/v1/families/${owner.familyId}/memories/comment-summaries`, {
    headers: { Authorization: `Bearer ${viewerToken}` },
    data: { memoryIds },
  })
  expect(batch.status()).toBe(200)
  const summary = await batch.json() as { items: Array<{ memoryId: string; count: number }> }
  expect(summary.items).toHaveLength(50)
  expect(summary.items.find((item) => item.memoryId === owner.memoryId)?.count).toBeGreaterThanOrEqual(65)
})

test('COM-3 real MAX browser creates, retries, edits, cancels and deletes one comment', async ({ page }, testInfo) => {
  const { familyId, memoryId, token } = await signInAndSeed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const commentPath = `/api/v1/families/${familyId}/memories/${memoryId}/comments`
  const listRequests: string[] = []
  const listResponses: number[] = []
  const failedListRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === commentPath && request.method() === 'GET') listRequests.push(request.url())
  })
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === commentPath && response.request().method() === 'GET') listResponses.push(response.status())
  })
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === commentPath && request.method() === 'GET') failedListRequests.push(request.failure()?.errorText ?? 'failed')
  })
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const entry = card.locator('.comments-entry')
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
  await expect.poll(() => listResponses.filter((status) => status === 200).length).toBe(1)
  const commentsServerMode = testInfo.project.metadata.commentsServerMode
  if (commentsServerMode === 'preview') {
    expect(listRequests).toHaveLength(1)
    expect(failedListRequests).toHaveLength(0)
  } else {
    expect(commentsServerMode).toBe('dev-strict')
    await expect.poll(() => failedListRequests.length + listResponses.length).toBe(listRequests.length)
    expect(listRequests.length).toBeLessThanOrEqual(2)
    expect(failedListRequests.length).toBeLessThanOrEqual(1)
    expect(listResponses).toEqual([200])
  }

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
  await textarea.fill('Первая строка')
  await textarea.press('End')
  await textarea.press('Enter')
  await expect(textarea).toHaveValue('Первая строка\n')
  expect(firstKeys).toHaveLength(0)
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

  let item = page.locator('.comments-item').filter({ hasText: 'Синтетический комментарий для проверки' })
  await item.getByRole('button', { name: 'Изменить' }).click()
  const editField = page.getByRole('textbox', { name: 'Изменить комментарий' })
  await editField.fill('Исправленный синтетический комментарий')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Исправленный синтетический комментарий', { exact: true })).toBeVisible()
  item = page.locator('.comments-item').filter({ hasText: 'Исправленный синтетический комментарий' })
  await expect(item.getByText('изменено', { exact: true })).toBeVisible()
  const panel = page.locator('.comments-panel')
  const title = panel.getByRole('heading', { name: 'Комментарии' })
  await expect(title).toBeVisible()
  const titleFontSize = await title.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  expect(titleFontSize).toBeGreaterThanOrEqual(18)
  const closeGlyph = page.getByRole('button', { name: 'Закрыть комментарии' }).locator('[data-slot="typography"]')
  const closeGlyphFontSize = await closeGlyph.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
  expect(closeGlyphFontSize).toBeGreaterThanOrEqual(24)
  await page.screenshot({ path: testInfo.outputPath('comments-panel-confirmed-edited.png'), fullPage: false })
  await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
  await expect(panel).toBeHidden()
  await expect(entry).toBeFocused()
  await expect(entry).toHaveAttribute('aria-label', 'Открыть комментарии, 1')
  await page.screenshot({ path: testInfo.outputPath('comments-footer-positive-count.png'), fullPage: false })
  await entry.click()
  await expect(page.getByText('Исправленный синтетический комментарий', { exact: true })).toBeVisible()

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
  let readPhase: 'initial-missing' | 'readable' | 'lost' = 'initial-missing'
  await page.route(`**${commentPath}*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (readPhase === 'initial-missing' || readPhase === 'lost') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'synthetic missing comment target' } }) })
      return
    }
    await route.continue()
  })
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const entry = card.locator('.comments-entry')
  await entry.click()
  const panel = page.locator('.comments-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Повторить' })).toBeVisible()
  await expect(card).toBeVisible()
  readPhase = 'readable'
  await panel.getByRole('button', { name: 'Повторить' }).click()
  await expect(panel.getByText('Пока нет комментариев. Напишите первым')).toBeVisible()
  readPhase = 'lost'
  await panel.getByRole('button', { name: 'Обновить' }).click()
  await expect(panel).toBeHidden()
  await expect(card).toBeVisible()
  await expect(entry).toBeVisible()
})

test('COM-3 footer and open panel fit the frozen six themes at 320, 390 and 430 CSS pixels', async ({ page }, testInfo) => {
  const { memoryId } = await signInAndSeed(page)
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const entry = card.locator('.comments-entry')
  const footer = page.locator('[data-memoly-feed="true"] [data-testid="bottom-navigation"]')
  await expect(entry).toBeVisible()
  for (const theme of themes) {
    await page.locator('[data-memoly-feed="true"] .ui-v2-settings').click()
    await page.getByRole('button', { name: 'Оформление шапки профиля' }).click()
    await page.locator(`[data-theme-choice="${theme}"]`).click()
    await expect(page.locator('.memoly-app-root')).toHaveAttribute('data-memoly-theme', theme)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('.ml-settings-sheet')).toHaveCount(0)
    await page.getByRole('button', { name: 'Лента' }).click()
    await expect(entry).toBeVisible()
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 })
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
      const composer = panel.locator('.comments-composer')
      const textarea = composer.getByRole('textbox', { name: 'Написать комментарий' })
      const fontSize = await textarea.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      expect(fontSize).toBeGreaterThanOrEqual(16)
      const panelMeasure = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const controls = [...element.querySelectorAll('button')].map((button) => button.getBoundingClientRect().height)
        return { width: rect.width, right: rect.right, controls, documentWidth: document.documentElement.scrollWidth }
      })
      expect(panelMeasure.right).toBeLessThanOrEqual(width + 1)
      expect(panelMeasure.controls.every((height) => height >= 44)).toBe(true)
      expect(panelMeasure.documentWidth).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`comments-panel-${width}-${theme}.png`), fullPage: true })
      await page.setViewportSize({ width, height: 420 })
      const composerBottom = await composer.evaluate((element) => element.getBoundingClientRect().bottom)
      expect(composerBottom).toBeLessThanOrEqual(420)
      await page.setViewportSize({ width, height: 844 })
      await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
      await expect(panel).toBeHidden()
      await expect(entry).toBeFocused()
    }
  }
})
