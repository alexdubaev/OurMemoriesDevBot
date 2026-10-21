import { createHmac, randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

const maxBotToken = '987654:max-e2e-synthetic-token'
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

async function signInAndSeed(page: Page, mediaAttachmentCount = 0) {
  const maxUserId = 987_600_000 + Math.floor(Math.random() * 90_000)
  await page.addInitScript((initData) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData, version: '1', platform: 'web', ready() {} } })
  }, signedMaxInitData(maxUserId))
  const authPromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.ok())
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  const auth = await authPromise
  const token = (await auth.json() as { accessToken: string }).accessToken
  let seeded: { familyId: string; memoryId: string; token: string } | null = null
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
    const mediaIds = await Promise.all(Array.from({ length: mediaAttachmentCount }, () => uploadPng(page, tokenFromRequest, familyId, 'memory')))
    const memoryResponse = await page.request.post(`/api/v1/families/${familyId}/memories`, {
      headers: { Authorization: `Bearer ${tokenFromRequest}`, 'Idempotency-Key': randomUUID() },
      data: mediaAttachmentCount
        ? { kind: 'photo', childId, body: `Synthetic comment target ${randomUUID()}`, occurredAt: '2026-10-18T10:00:00.000Z', mediaIds }
        : { kind: 'note', childId, body: `Synthetic comment target ${randomUUID()}`, occurredAt: '2026-10-18T10:00:00.000Z' },
    })
    expect(memoryResponse.status()).toBe(201)
    seeded = { familyId, memoryId: (await memoryResponse.json() as MemoryResult).id, token: tokenFromRequest }
    await route.fulfill({ response: familyResponse })
  })
  await page.getByRole('button', { name: 'Создать свою семью' }).click()
  await expect.poll(() => seeded).not.toBeNull()
  const { familyId, memoryId } = seeded!
  await expect(page.locator(`[data-memory-id="${memoryId}"]`)).toBeVisible({ timeout: 20_000 })
  return { familyId, memoryId, token: seeded!.token }
}

async function uploadPng(page: Page, token: string, familyId: string, purpose: 'child_avatar' | 'memory' = 'child_avatar') {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const reserve = await page.request.post(`/api/v1/families/${familyId}/uploads`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { purpose, kind: 'photo', contentType: 'image/png', byteSize: bytes.byteLength },
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

test('MAX user can retry an uncertain create, edit it, cancel deletion, then delete it', async ({ page }) => {
  const { familyId, memoryId, token } = await signInAndSeed(page)
  await page.setViewportSize({ width: 320, height: 540 })
  await page.bringToFront()
  const commentPath = `/api/v1/families/${familyId}/memories/${memoryId}/comments`
  const listResponses: number[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === commentPath && response.request().method() === 'GET') listResponses.push(response.status())
  })
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const entry = card.locator('.comments-entry')
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => listResponses.some((status) => status === 200)).toBe(true)

  let firstPost = true
  await page.route(`**${commentPath}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
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
  await textarea.fill('Синтетический комментарий для проверки')
  await page.getByRole('button', { name: 'Отправить' }).dblclick()
  await expect(page.getByRole('button', { name: 'Повторить отправку' })).toBeVisible()
  await expect(textarea).toHaveValue('Синтетический комментарий для проверки')
  await page.getByRole('button', { name: 'Повторить отправку' }).click()
  await expect(page.locator('.comments-item').getByText('Синтетический комментарий для проверки', { exact: true })).toBeVisible()
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
  const panel = page.locator('.comments-panel')
  await expect(panel.getByRole('heading')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
  await expect(panel).toBeHidden()
  await expect(entry).toBeFocused()
  await expect(entry).toBeVisible()
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

test('initial comments 404 stays local and retry works; a later lost target closes only its panel', async ({ page, context }) => {
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
  const backgroundTab = await context.newPage()
  await backgroundTab.goto('about:blank')
  await page.bringToFront()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await backgroundTab.close()
  await expect(panel).toBeHidden()
  await expect(card).toBeVisible()
  await expect(entry).toBeVisible()
})

test('comment actions remain available from the memory menu and comments panel opens', async ({ page }) => {
  const { memoryId } = await signInAndSeed(page)
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  await expect(card.locator('.ui-v2-reaction-button')).toHaveCount(0)
  await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  await page.getByRole('button', { name: 'Выбрать или изменить реакцию' }).click()
  await expect(page.getByRole('group', { name: 'Реакции' })).toBeVisible()
  await page.keyboard.press('Escape')
  await card.locator('.comments-entry').click()
  const panel = page.locator('.comments-panel')
  await expect(panel).toHaveAccessibleName('Комментарии')
  await expect(panel.getByRole('button', { name: 'Закрыть комментарии' })).toBeFocused()
})

test('comments sheet leaves the third feed attachment in place and preserves the guarded draft', async ({ page }) => {
  const { familyId, memoryId } = await signInAndSeed(page, 3)
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const feedCarousel = card.locator('.memoly-mixed-carousel')
  const thirdAttachment = feedCarousel.getByRole('button', { name: /Показать вложение 3/, includeHidden: true })
  await thirdAttachment.click()
  await expect(thirdAttachment).toHaveAttribute('aria-pressed', 'true')
  let commentReads = 0
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/v1/families/${familyId}/memories/${memoryId}/comments`) commentReads += 1
  })
  await card.locator('.comments-entry').click()
  const panel = page.locator('.comments-panel')
  await expect(panel.locator('.memoly-mixed-carousel, [data-comments-media], [data-context-only]')).toHaveCount(0)
  await expect(thirdAttachment).toHaveAttribute('aria-pressed', 'true')
  const draft = panel.getByRole('textbox', { name: 'Написать комментарий' })
  await expect(panel.getByText('Пока нет комментариев. Напишите первым')).toBeVisible()
  await draft.fill('Сохраняю черновик при смене вложения')
  await expect(draft).toHaveValue('Сохраняю черновик при смене вложения')
  expect(commentReads).toBeGreaterThan(0)
  await panel.getByRole('button', { name: 'Закрыть комментарии' }).click()
  await expect(page.getByRole('dialog', { name: 'Черновик не сохранён' })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить писать' }).click()
  await expect(draft).toHaveValue('Сохраняю черновик при смене вложения')
  await panel.getByRole('button', { name: 'Закрыть комментарии' }).click()
  await page.getByRole('button', { name: 'Закрыть без сохранения' }).click()
  await expect(panel).toBeHidden()
  await expect(thirdAttachment).toHaveAttribute('aria-pressed', 'true')
})
