import { createHmac, randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { albumEntryDiscussionSummarySchema, albumEntryPageSchema, albumPageSchema, albumResponseSchema, albumMutationSchema } from '@web-app-demo/contracts'
import { z } from 'zod'

declare global { interface Window { __albumNativeBack: () => void; __selectedFamilyChangeAccount: () => void } }
const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
function initData() {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: randomUUID(), user: JSON.stringify({ id: 8_000_000 + Math.floor(Math.random() * 1_000_000), first_name: 'Album social synthetic' }) })
  const check = [...fields].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('987654:max-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}
async function start(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((data) => {
    const handlers = new Set<() => void>()
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1', platform: 'web', ready() {}, BackButton: { show() {}, hide() {}, onClick(callback: () => void) { handlers.add(callback) }, offClick(callback: () => void) { handlers.delete(callback) } } } })
    window.__albumNativeBack = () => [...handlers].forEach((callback) => callback())
  }, initData())
  const exchange = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/max') && r.request().method() === 'POST')
  await page.goto('/')
  const { accessToken } = z.object({ accessToken: z.string() }).parse(await (await exchange).json())
  const headers = { Authorization: `Bearer ${accessToken}` }
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('button', { name: /Создать свою семью/ }).click()
  await expect(page.getByTestId('bottom-navigation')).toBeVisible()
  const home = await page.request.get('/api/v1/me/families', { headers })
  const familyId = z.object({ ownFamilyId: z.string() }).parse(await home.json()).ownFamilyId
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Свободный альбом/ }).click()
  await page.getByLabel('Название альбома').fill('Социальная история')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Социальная история', exact: true })).toBeVisible()
  const catalog = albumPageSchema.parse(await (await page.request.get(`/api/v1/families/${familyId}/albums`, { headers })).json())
  return { familyId, headers, albumId: catalog.items[0]!.id }
}

test('MAX album-only three-photo story shares durable comments, exact retries and one serialized reaction; another story stays separate', async ({ page }) => {
  const { familyId, albumId, headers } = await start(page)
  let memoryPosts = 0
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === `/api/v1/families/${familyId}/memories`) memoryPosts += 1 })
  await page.getByRole('button', { name: 'Добавить историю', exact: true }).click()
  await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
  await page.getByLabel('Выбрать фотографии с устройства').setInputFiles(['front', 'side', 'back'].map((name) => ({ name: `${name}.png`, mimeType: 'image/png', buffer: photoBytes })))
  await expect(page.getByRole('status').filter({ hasText: 'Выбрано: 3 · добавлено: 3' })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуться к альбому', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  const root = `/api/v1/families/${familyId}/albums/${albumId}`
  const entries = albumEntryPageSchema.parse(await (await page.request.get(`${root}/entries`, { headers })).json())
  const story = entries.items[0]!
  expect(story.sources).toHaveLength(3)
  expect(story.sources.every((source) => source.memoryId === null)).toBe(true)
  expect(memoryPosts).toBe(0)
  const path = `${root}/entries/${story.id}`
  await page.getByRole('button', { name: 'Открыть историю', exact: true }).click()
  await expect(page.locator('.albums-entry-social')).toHaveCount(1)
  await page.getByRole('button', { name: 'Комментарии · 0', exact: true }).click()
  const textarea = page.getByRole('textbox', { name: 'Написать комментарий' })
  const attempts: Array<{ key: string | undefined; body: unknown }> = []
  let loseResponse = true
  let failRefresh = false
  await page.route(`**${path}/comments*`, async (route) => {
    if (route.request().method() === 'GET') { if (failRefresh) return route.abort('failed'); return route.continue() }
    if (route.request().method() !== 'POST') return route.continue()
    attempts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() })
    if (loseResponse) { loseResponse = false; const saved = await route.fetch(); expect(saved.status()).toBe(201); await route.abort('failed'); return }
    await route.continue()
  })
  await textarea.fill('Первая строка')
  await textarea.press('End'); await textarea.press('Enter')
  await expect(textarea).toHaveValue('Первая строка\n')
  await textarea.fill('Три ракурса — одна история')
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await page.getByRole('button', { name: 'Повторить отправку', exact: true }).click()
  await expect(page.locator('.comments-item').getByText('Три ракурса — одна история', { exact: true })).toHaveCount(1)
  expect(attempts).toHaveLength(2)
  expect(attempts[0]).toEqual(attempts[1])
  failRefresh = true
  await textarea.fill('Подтверждено, даже если обновление недоступно')
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(textarea).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Повторить отправку', exact: true })).toHaveCount(0)
  await expect(page.locator('.comments-item')).toHaveCount(2)
  failRefresh = false
  const first = page.locator('.comments-item').filter({ hasText: 'Три ракурса — одна история' })
  await first.getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByRole('textbox', { name: 'Изменить комментарий' }).fill('Исправлено в обсуждении работы')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Исправлено в обсуждении работы', { exact: true })).toBeVisible()
  await textarea.fill('Несохранённый текст')
  await page.evaluate(() => window.__albumNativeBack())
  await expect(page.getByText('Черновик не сохранён', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить писать', exact: true }).click()
  await expect(textarea).toHaveValue('Несохранённый текст')
  await page.getByRole('button', { name: 'Закрыть комментарии', exact: true }).click()
  await page.getByRole('button', { name: 'Закрыть без сохранения', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Комментарии · 2', exact: true })).toBeFocused()

  let releaseFirst: () => void = () => undefined
  const held = new Promise<void>((resolve) => { releaseFirst = resolve })
  let seenFirst: () => void = () => undefined
  const firstSeen = new Promise<void>((resolve) => { seenFirst = resolve })
  let firstPut = true
  const reactionWrites: unknown[] = []
  await page.route(`**${path}/reaction`, async (route) => {
    reactionWrites.push(route.request().postDataJSON().reaction)
    if (firstPut) { firstPut = false; seenFirst(); await held }
    await route.continue()
  })
  const removed = page.waitForResponse((response) => response.url().endsWith(`${path}/reaction`) && response.request().method() === 'PUT' && response.request().postDataJSON().reaction === null)
  try {
    await page.locator('.albums-social-reaction').click()
    await page.getByRole('button', { name: 'Сердце', exact: true }).click()
    await firstSeen
    await page.locator('.albums-social-reaction').click()
    await expect(page.locator('.albums-social-reaction')).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 })
    await page.getByRole('button', { name: 'Аплодисменты', exact: true }).click()
    await page.locator('.albums-social-reaction').click()
    await page.getByRole('button', { name: 'Аплодисменты, выбрана', exact: true }).click()
  } finally { releaseFirst() }
  expect((await removed).status()).toBe(200)
  expect(reactionWrites).toEqual(['heart', null])
  await expect.poll(async () => albumEntryDiscussionSummarySchema.parse(await (await page.request.get(`${path}/discussion`, { headers })).json()).currentUserReaction).toBeNull()
  await expect.poll(async () => albumEntryDiscussionSummarySchema.parse(await (await page.request.get(`${path}/discussion`, { headers })).json()).reactionCounts).toEqual({})
  await page.locator('.albums-social-reaction').click()
  await page.getByRole('button', { name: 'Сердце', exact: true }).click()
  await expect.poll(async () => albumEntryDiscussionSummarySchema.parse(await (await page.request.get(`${path}/discussion`, { headers })).json()).reactionCounts).toEqual({ heart: 1 })

  await page.getByRole('button', { name: 'Открыть материал 2', exact: true }).click()
  await expect(page.locator('[data-mixed-viewer]')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть материал 2', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Комментарии · 2', exact: true })).toBeVisible()
  const album = albumResponseSchema.parse(await (await page.request.get(root, { headers })).json()).album
  const second = await page.request.post(`${root}/entries`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { expectedVersion: album.version, kind: 'work', title: 'Другая история', caption: 'То же фото, другой смысл', sources: story.sources.slice(0, 1).map(({ memoryId, sourceKind, sourceId }) => ({ memoryId, sourceKind, sourceId })) } })
  expect(second.status()).toBe(201)
  const secondId = z.object({ entry: z.object({ id: z.string() }) }).parse(await second.json()).entry.id
  const separate = albumEntryDiscussionSummarySchema.parse(await (await page.request.get(`${root}/entries/${secondId}/discussion`, { headers })).json())
  expect(separate.comments.count).toBe(0); expect(separate.reactionCounts).toEqual({})
  await page.reload()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: /Социальная история/ }).click()
  await page.getByRole('button', { name: 'Открыть историю', exact: true }).click()
  await page.getByRole('button', { name: 'Комментарии · 2', exact: true }).click()
  await expect(page.getByText('Исправлено в обсуждении работы', { exact: true })).toBeVisible()
  await expect(textarea).toHaveValue('')
  expect(memoryPosts).toBe(0)
})

test('album text story removes old drafts and cached discussion on account switch', async ({ page }) => {
  await page.goto('/e2e/selected-family-app.harness.html?albums=24')
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Первые открытия 2 историй', exact: true }).click()
  await page.getByRole('button', { name: 'Первая улыбка', exact: true }).click()
  await page.getByRole('button', { name: 'Комментарии · 0', exact: true }).click()
  await page.getByRole('textbox', { name: 'Написать комментарий' }).fill('Черновик прежнего аккаунта')
  await page.evaluate(() => window.__selectedFamilyChangeAccount())
  await expect(page.locator('.comments-panel')).toHaveCount(0)
  await expect(page.getByText('Черновик прежнего аккаунта')).toHaveCount(0)
  await expect(page.locator('.albums-entry-detail')).toHaveCount(0)
})

test('a cleared and refilled text-only month discards the old discussion and draft', async ({ page }) => {
  const { familyId, headers } = await start(page)
  const familyPath = `/api/v1/families/${familyId}`
  const reserve = await page.request.post(`${familyPath}/uploads`, { headers, data: { purpose: 'child_avatar', kind: 'photo', contentType: 'image/png', byteSize: photoBytes.byteLength } })
  expect(reserve.status()).toBe(201)
  const ticket = z.object({ assetId: z.string(), upload: z.object({ uploadId: z.string(), url: z.string(), headers: z.record(z.string(), z.string()) }) }).parse(await reserve.json())
  expect((await page.request.put(ticket.upload.url, { headers: ticket.upload.headers, data: photoBytes })).status()).toBe(200)
  expect((await page.request.post(`${familyPath}/uploads/${ticket.upload.uploadId}/finalize`, { headers })).status()).toBe(200)
  expect((await page.request.put(`${familyPath}/child`, { headers, data: { name: 'Синтетическая Алиса', birthDate: '2024-01-02', sex: 'girl', avatarMediaId: ticket.assetId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null } })).status()).toBe(200)
  const family = z.object({ children: z.array(z.object({ id: z.string() })) }).parse(await (await page.request.get(familyPath, { headers: { ...headers, 'X-Memoly-Children': '1' } })).json())
  const yearResponse = await page.request.post(`${familyPath}/albums`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { kind: 'year', title: 'Первый год синтетической Алисы', childId: family.children[0]!.id } })
  expect(yearResponse.status()).toBe(201)
  const year = albumMutationSchema.parse(await yearResponse.json()).album
  const root = `${familyPath}/albums/${year.id}`
  const chapter = albumEntryPageSchema.parse(await (await page.request.get(`${root}/entries`, { headers })).json()).items[0]!
  const path = `${root}/entries/${chapter.id}`
  expect((await page.request.patch(path, { headers, data: { expectedVersion: year.version, caption: 'Первая история главы без фотографии' } })).status()).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: /Первый год синтетической Алисы/ }).click()
  await page.getByRole('button', { name: 'Нам 1 месяц', exact: true }).click()
  await page.getByRole('button', { name: 'Комментарии · 0', exact: true }).click()
  const textarea = page.getByRole('textbox', { name: 'Написать комментарий' })
  await textarea.fill('Комментарий старого поколения')
  await page.getByRole('button', { name: 'Отправить', exact: true }).click()
  await expect(page.getByText('Комментарий старого поколения', { exact: true })).toBeVisible()
  await textarea.fill('Этот черновик нельзя переносить')
  const before = albumEntryDiscussionSummarySchema.parse(await (await page.request.get(`${path}/discussion`, { headers })).json())
  let album = albumResponseSchema.parse(await (await page.request.get(root, { headers })).json()).album
  expect((await page.request.post(`${path}/clear`, { headers, data: { expectedVersion: album.version } })).status()).toBe(200)
  album = albumResponseSchema.parse(await (await page.request.get(root, { headers })).json()).album
  expect((await page.request.patch(path, { headers, data: { expectedVersion: album.version, caption: 'Новая глава после очистки' } })).status()).toBe(200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.comments-panel')).toHaveCount(0)
  await expect(page.locator('.albums-entry-detail')).toHaveCount(0)
  await expect(page.getByText('Этот черновик нельзя переносить')).toHaveCount(0)
  await page.getByRole('button', { name: 'Нам 1 месяц', exact: true }).click()
  await expect(page.getByText('Новая глава после очистки', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Комментарии · 0', exact: true }).click()
  await expect(textarea).toHaveValue('')
  await expect(page.getByText('Комментарий старого поколения', { exact: true })).toHaveCount(0)
  const after = albumEntryDiscussionSummarySchema.parse(await (await page.request.get(`${path}/discussion`, { headers })).json())
  expect(after.discussionGeneration).toBe(before.discussionGeneration + 1)
  expect(after.comments.count).toBe(0)
})
