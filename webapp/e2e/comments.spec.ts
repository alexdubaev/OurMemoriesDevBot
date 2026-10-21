import { createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import { commentSummariesResponseSchema } from '@web-app-demo/contracts'

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

async function acceptRoleInvite(page: Page, familyId: string, ownerToken: string, memberToken: string, role: 'full' | 'viewer') {
  const invite = await page.request.post(`/api/v1/families/${familyId}/invites`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
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

test('COM-4 real API ACL, family isolation, pagination, batch and conflict retain the owner draft', async ({ page }) => {
  page.setDefaultTimeout(10_000)
  const owner = await signInAndSeed(page)
  const browser = page.context().browser()!
  const baseURL = new URL(page.url()).origin
  const fullContext = await browser.newContext({ baseURL })
  const viewerContext = await browser.newContext({ baseURL })
  const fullPage = await fullContext.newPage()
  const viewerPage = await viewerContext.newPage()
  try {
    const full = await signInAndSeed(fullPage)
    const viewer = await signInAndSeed(viewerPage)
    await acceptRoleInvite(page, owner.familyId, owner.token, full.token, 'full')
    await acceptRoleInvite(page, owner.familyId, owner.token, viewer.token, 'viewer')

    const commentPath = `/api/v1/families/${owner.familyId}/memories/${owner.memoryId}/comments`
    const actors: Array<{ page: Page; token: string }> = [
      { page, token: owner.token }, { page: fullPage, token: full.token }, { page: viewerPage, token: viewer.token },
    ]
    const writes = await Promise.all(actors.map(({ page: actorPage, token }, index) => actorPage.request.post(commentPath, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
      data: { body: `COM-4 role ${index}` },
    })))
    expect(writes.map((response) => response.status())).toEqual([201, 201, 201])
    const ownerCommentId = ((await writes[0]!.json()) as { comment: { id: string } }).comment.id
    const fullCommentId = ((await writes[1]!.json()) as { comment: { id: string } }).comment.id
    const foreignRead = await page.request.get(`/api/v1/families/${full.familyId}/memories/${full.memoryId}/comments`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    })
    expect(foreignRead.status()).toBe(404)

    const pageRows = await Promise.all(Array.from({ length: 38 }, (_, index) =>
      page.request.post(commentPath, {
        headers: { Authorization: `Bearer ${owner.token}`, 'Idempotency-Key': randomUUID() },
        data: { body: `COM-4 page ${index}` },
      })))
    expect(pageRows.every((response) => response.status() === 201)).toBe(true)
    const first = await page.request.get(`${commentPath}?limit=20`, {
      headers: { Authorization: `Bearer ${owner.token}` },
    })
    expect(first.status()).toBe(200)
    const firstBody = await first.json() as { items: Array<{ id: string }>; nextCursor: string | null }
    expect(firstBody.items).toHaveLength(20)
    expect(firstBody.nextCursor).toBeTruthy()
    const second = await page.request.get(`${commentPath}?limit=50&cursor=${encodeURIComponent(firstBody.nextCursor!)}`, {
      headers: { Authorization: `Bearer ${full.token}` },
    })
    expect(second.status()).toBe(200)
    const secondBody = await second.json() as { items: Array<{ id: string }>; nextCursor: string | null }
    expect(secondBody.items.length).toBeGreaterThan(0)
    expect(new Set([...firstBody.items, ...secondBody.items].map((row) => row.id)).size)
      .toBe(firstBody.items.length + secondBody.items.length)

    const batch = await page.request.post(`/api/v1/families/${owner.familyId}/memories/comment-summaries`, {
      headers: { Authorization: `Bearer ${viewer.token}` },
      data: { memoryIds: [owner.memoryId] },
    })
    expect(batch.status()).toBe(200)
    const summary = commentSummariesResponseSchema.parse(await batch.json())
    expect(summary.items).toEqual([{ memoryId: owner.memoryId, count: 41, capabilities: { read: true, create: true } }])

    const panelListRequests: string[] = []
    const panelListResponses: Array<{ url: string; ids: string[] }> = []
    page.on('request', (request) => { if (new URL(request.url()).pathname === commentPath && request.method() === 'GET') panelListRequests.push(request.url()) })
    page.on('response', (response) => {
      if (new URL(response.url()).pathname !== commentPath || response.request().method() !== 'GET' || !response.ok()) return
      void response.json().then((body: { items?: Array<{ id: string }> }) => panelListResponses.push({ url: response.url(), ids: (body.items ?? []).map((item) => item.id) })).catch(() => undefined)
    })
    const entry = page.locator(`[data-memory-id="${owner.memoryId}"] .comments-entry`)
    await page.bringToFront()
    await page.context().setOffline(true)
    await entry.click()
    const panel = page.locator('.comments-panel')
    await expect(panel).toHaveAccessibleName('Комментарии')
    await expect(panel.getByRole('status')).toContainText('Нет подключения')
    await expect(panel).not.toContainText('Пока нет комментариев')
    expect(panelListRequests).toHaveLength(0)
    await page.context().setOffline(false)
    const commentItems = panel.locator('.comments-item')
    await expect(commentItems).toHaveCount(20)
    await page.clock.install()
    const initialReads = panelListRequests.length
    await page.context().setOffline(true)
    await page.clock.fastForward(90_000)
    expect(panelListRequests).toHaveLength(initialReads)
    await page.context().setOffline(false)
    await page.clock.fastForward(1)
    await expect.poll(() => panelListRequests.length).toBeGreaterThan(initialReads)
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
    const hiddenReads = panelListRequests.length
    await page.clock.fastForward(90_000)
    expect(panelListRequests).toHaveLength(hiddenReads)
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
    await page.clock.fastForward(1)
    await expect.poll(() => panelListRequests.length).toBeGreaterThan(hiddenReads)
    const commentsList = panel.locator('.comments-list')
    await commentsList.evaluate((list) => { list.scrollTop = 80 })
    const anchorId = await commentsList.evaluate((list) => {
      const top = list.getBoundingClientRect().top
      return [...list.querySelectorAll<HTMLElement>('[data-comment-id]')].find((row) => row.getBoundingClientRect().bottom > top)?.dataset.commentId ?? null
    })
    expect(anchorId).toBeTruthy()
    const anchorItem = panel.locator(`[data-comment-id="${anchorId}"]`)
    const beforeY = await anchorItem.evaluate((element) => element.getBoundingClientRect().y)
    const burst: APIResponse[] = []
    for (let index = 0; index < 25; index += 1) {
      burst.push(await fullPage.request.post(commentPath, {
        headers: { Authorization: `Bearer ${full.token}`, 'Idempotency-Key': randomUUID() },
        data: { body: `COM-4 burst ${index}` },
      }))
    }
    expect(burst.every((response) => response.status() === 201)).toBe(true)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(commentItems).toHaveCount(45)
    await expect(panel.getByRole('button', { name: 'Новые комментарии · 25' })).toBeVisible()
    await expect(entry).toHaveAttribute('aria-label', 'Открыть комментарии, 66')
    const afterY = await anchorItem.evaluate((element) => element.getBoundingClientRect().y)
    expect(Math.abs(afterY - beforeY)).toBeLessThan(2)
    const burstBodies = await commentItems.locator('.comments-item-body > p').allTextContents()
    for (let index = 0; index < 25; index += 1) expect(burstBodies).toContain(`COM-4 burst ${index}`)
    await panel.getByRole('button', { name: 'Новые комментарии · 25' }).click()
    await expect(panel.getByRole('button', { name: /Новые комментарии/ })).toHaveCount(0)
    const older = panel.getByRole('button', { name: 'Показать более ранние' })
    while (await older.count()) {
      await older.scrollIntoViewIfNeeded()
      const visibleAnchorId = await commentsList.evaluate((list) => {
        const top = list.getBoundingClientRect().top
        return [...list.querySelectorAll<HTMLElement>('[data-comment-id]')].find((row) => row.getBoundingClientRect().bottom > top)?.dataset.commentId ?? null
      })
      expect(visibleAnchorId).toBeTruthy()
      const visibleAnchor = panel.locator(`[data-comment-id="${visibleAnchorId}"]`)
      const beforeOlderY = await visibleAnchor.evaluate((element) => element.getBoundingClientRect().y)
      const previousCount = await commentItems.count()
      await older.click()
      await expect.poll(() => commentItems.count()).toBeGreaterThan(previousCount)
      const afterOlderY = await visibleAnchor.evaluate((element) => element.getBoundingClientRect().y)
      expect(Math.abs(afterOlderY - beforeOlderY)).toBeLessThan(2)
    }
    await expect(commentItems).toHaveCount(66)
    expect(await commentItems.allInnerTexts()).toHaveLength(66)
    const commentBodies = await commentItems.locator('.comments-item-body > p').allTextContents()
    expect(commentBodies).toHaveLength(66)
    expect(new Set(commentBodies).size).toBe(66)

    const olderFullComment = commentItems.filter({ hasText: 'COM-4 role 1' })
    await olderFullComment.scrollIntoViewIfNeeded()
    const visibleIdsBeforeRefresh = await commentsList.evaluate((list) => {
      const bounds = list.getBoundingClientRect()
      return [...list.querySelectorAll<HTMLElement>('[data-comment-id]')].filter((row) => {
        const rowBounds = row.getBoundingClientRect()
        return rowBounds.bottom > bounds.top && rowBounds.top < bounds.bottom
      }).map((row) => row.dataset.commentId)
    })
    expect(visibleIdsBeforeRefresh).toContain(fullCommentId)
    const draft = panel.getByRole('textbox', { name: 'Написать комментарий' })
    await draft.fill('COM-4 draft across older refresh')
    const olderReadsBeforeEdit = panelListRequests.filter((url) => new URL(url).searchParams.has('cursor')).length
    const olderResponsesBeforeEdit = panelListResponses.length
    const externalOldEdit = await fullPage.request.patch(`${commentPath}/${fullCommentId}`, {
      headers: { Authorization: `Bearer ${full.token}` },
      data: { body: 'COM-4 external older edit', expectedVersion: 1 },
    })
    expect(externalOldEdit.status()).toBe(200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => panelListRequests.filter((url) => new URL(url).searchParams.has('cursor')).length).toBeGreaterThan(olderReadsBeforeEdit)
    await expect.poll(() => panelListResponses.slice(olderResponsesBeforeEdit).some((response) => new URL(response.url).searchParams.has('cursor') && response.ids.includes(fullCommentId))).toBe(true)
    await expect(commentItems.filter({ hasText: 'COM-4 external older edit' })).toHaveCount(1)
    await expect(draft).toHaveValue('COM-4 draft across older refresh')
    await expect(entry).toHaveAttribute('aria-label', 'Открыть комментарии, 66')

    const olderReadsBeforeDelete = panelListRequests.filter((url) => new URL(url).searchParams.has('cursor')).length
    const olderResponsesBeforeDelete = panelListResponses.length
    const externalOldDelete = await fullPage.request.delete(`${commentPath}/${fullCommentId}`, {
      headers: { Authorization: `Bearer ${full.token}`, 'If-Match': '2' },
    })
    expect(externalOldDelete.status()).toBe(200)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => panelListRequests.filter((url) => new URL(url).searchParams.has('cursor')).length).toBeGreaterThan(olderReadsBeforeDelete)
    await expect.poll(() => panelListResponses.slice(olderResponsesBeforeDelete).some((response) => new URL(response.url).searchParams.has('cursor') && !response.ids.includes(fullCommentId))).toBe(true)
    await expect(commentItems.filter({ hasText: 'COM-4 external older edit' })).toHaveCount(0)
    await expect(draft).toHaveValue('COM-4 draft across older refresh')
    await expect(entry).toHaveAttribute('aria-label', 'Открыть комментарии, 65')
    await draft.fill('')

    const ownerComment = commentItems.filter({ hasText: 'COM-4 role 0' })
    await ownerComment.getByRole('button', { name: 'Изменить' }).click()
    const editField = panel.getByRole('textbox', { name: 'Изменить комментарий' })
    await editField.fill('Owner local draft after competing update')
    const externalUpdate = await fullPage.request.patch(`${commentPath}/${ownerCommentId}`, {
      headers: { Authorization: `Bearer ${owner.token}` },
      data: { body: 'Concurrent owner update', expectedVersion: 1 },
    })
    expect(externalUpdate.status()).toBe(200)
    await panel.getByRole('button', { name: 'Сохранить' }).click()
    await expect(panel.getByRole('alert')).toContainText('Черновик сохранён')
    await expect(editField).toHaveValue('Owner local draft after competing update')
    await expect(panel.getByText('Concurrent owner update', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Сохранить' }).click()
    await expect(panel.getByText('Owner local draft after competing update', { exact: true })).toBeVisible()
    const farOldComment = commentItems.filter({ hasText: 'COM-4 role 2' })
    await expect(farOldComment).toBeVisible()
    await farOldComment.getByRole('button', { name: 'Удалить' }).click()
    await page.getByRole('dialog', { name: 'Удалить комментарий?' }).getByRole('button', { name: 'Удалить' }).click()
    await expect(commentItems.filter({ hasText: 'COM-4 role 2' })).toHaveCount(0)
    const readsBeforeClose = panelListRequests.length
    await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
    await page.clock.fastForward(90_000)
    expect(panelListRequests).toHaveLength(readsBeforeClose)
    // Bulk setup shares the verification server's normal IP write budget with later
    // journeys. Honour its real reset boundary instead of raising/disabling limits.
    const resetAt = Number(burst.at(-1)?.headers()['ratelimit-reset'] ?? externalUpdate.headers()['ratelimit-reset'])
    expect(Number.isSafeInteger(resetAt)).toBe(true)
    const resetWaitMs = Math.max(0, resetAt * 1_000 - Date.now() + 100)
    expect(resetWaitMs).toBeLessThanOrEqual(61_000)
    await new Promise((resolve) => setTimeout(resolve, resetWaitMs))
  } finally {
    await fullContext.close()
    await viewerContext.close()
  }
})

test('COM-3 real MAX browser creates, retries, edits, cancels and deletes one comment', async ({ page }, testInfo) => {
  const { familyId, memoryId, token } = await signInAndSeed(page)
  await page.setViewportSize({ width: 320, height: 540 })
  await page.bringToFront()
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
  const uncertainComposer = page.locator('.comments-composer')
  const composerWidth = await uncertainComposer.evaluate((element) => element.getBoundingClientRect().width)
  const retryBox = await page.getByRole('button', { name: 'Повторить отправку' }).boundingBox()
  const textareaBox = await textarea.boundingBox()
  expect(textareaBox?.width).toBeGreaterThan(100)
  expect(retryBox && textareaBox && retryBox.x + retryBox.width <= composerWidth + (await uncertainComposer.evaluate((element) => element.getBoundingClientRect().x)) + 1).toBe(true)
  await expect(textarea).toHaveValue('Синтетический комментарий для проверки')
  await page.getByRole('button', { name: 'Повторить отправку' }).click()
  await expect(page.locator('.comments-item').getByText('Синтетический комментарий для проверки', { exact: true })).toBeVisible()
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

test('comments stay compact at short viewport and reactions remain available in memory actions', async ({ page }) => {
  const { memoryId } = await signInAndSeed(page)
  await page.setViewportSize({ width: 320, height: 420 })
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  await expect(card.locator('.ui-v2-reaction-button')).toHaveCount(0)
  await card.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  await page.getByRole('button', { name: 'Выбрать или изменить реакцию' }).click()
  await expect(page.getByRole('group', { name: 'Реакции' })).toBeVisible()
  await page.keyboard.press('Escape')
  await card.locator('.comments-entry').click()
  const panel = page.locator('.comments-panel')
  const composer = panel.locator('.comments-composer')
  await expect(panel).toHaveAccessibleName('Комментарии')
  await expect(panel).not.toHaveAttribute('aria-describedby')
  await expect(panel.getByRole('button', { name: 'Закрыть комментарии' })).toBeFocused()
  await expect(composer.getByRole('textbox', { name: 'Написать комментарий' })).not.toBeFocused()
  await expect(composer.getByRole('button', { name: 'Отправить' })).toBeVisible()
  const geometry = await page.evaluate(() => {
    const dialog = document.querySelector('.comments-panel')!.getBoundingClientRect()
    const send = document.querySelector('.comments-composer button[type="submit"]')!.getBoundingClientRect()
    return { dialogHeight: dialog.height, sendBottom: send.bottom }
  })
  expect(geometry.dialogHeight).toBeLessThan(420)
  expect(geometry.sendBottom).toBeLessThanOrEqual(420)
})

test('discussion opens on the third mixed attachment and returns to the last selected attachment', async ({ page }) => {
  const { familyId, memoryId } = await signInAndSeed(page, 3)
  const card = page.locator(`[data-memory-id="${memoryId}"]`)
  const feedCarousel = card.locator('.memoly-mixed-carousel')
  await feedCarousel.getByRole('button', { name: 'Показать вложение 3 из 3' }).click()
  await expect(feedCarousel).toHaveAttribute('data-seen-active-index', '2')
  let commentReads = 0
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/v1/families/${familyId}/memories/${memoryId}/comments`) commentReads += 1
  })
  await card.locator('.comments-entry').click()
  const panel = page.locator('.comments-panel')
  const context = panel.locator('.comments-mixed-carousel')
  await expect(context.locator('.memoly-mixed-count')).toHaveText('3 / 3')
  const draft = panel.getByRole('textbox', { name: 'Написать комментарий' })
  await expect(panel.getByText('Пока нет комментариев. Напишите первым')).toBeVisible()
  const readsBeforeSlide = commentReads
  await draft.fill('Сохраняю черновик при смене вложения')
  await context.press('ArrowLeft')
  await expect(context.locator('.memoly-mixed-count')).toHaveText('2 / 3')
  await expect(draft).toHaveValue('Сохраняю черновик при смене вложения')
  expect(commentReads).toBe(readsBeforeSlide)
  await panel.getByRole('button', { name: 'Закрыть комментарии' }).click()
  await page.getByRole('button', { name: 'Закрыть без сохранения' }).click()
  await expect(panel).toBeHidden()
  await expect(feedCarousel).toHaveAttribute('data-seen-active-index', '1')
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
      expect(footerMeasure.icon?.width).toBe(18)
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
