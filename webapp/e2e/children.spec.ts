import { createHmac, randomUUID } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { createPrisma } from '../../backend/src/db'
import { jpegImage, pngImage } from './helpers/images'

/**
 * A family with two children, synthetic data only: the owner signs in through MAX initData,
 * the family, children, albums and memories are created through the real API, and the journey
 * then runs through the real UI (filters, add from a child's page, per-photo tags, albums).
 */

const screenshotDir = 'test-results/children-tags'
const crop = { x: 0, y: 0, width: 1, height: 1 }

test('a family with two children: filters, add from a child, tags on one photo, a tag conflict, albums by child', async ({ page }) => {
  const seeded = await startFamily(page)
  const { familyId, headers } = seeded
  const lilya = seeded.children[0]!
  const misha = seeded.children[1]!

  const lilyaNote = await createNote(page, seeded, 'Заметка про Лилю', [lilya.id])
  const sharedNote = await createNote(page, seeded, 'Общая заметка без отметки', [])
  const pair = await createPhotoMemory(page, seeded, 'Две фотографии', [lilya.id])
  expect(pair.attachments).toHaveLength(2)

  await page.reload()
  await expect(page.getByTestId('bottom-navigation')).toBeVisible()
  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  await expect(page.locator('[data-memoly-feed]').first()).toBeVisible()

  await test.step('the family header and the filters appear for two children', async () => {
    await expect(page.locator('[data-family-header="true"][data-child-header-mode="feed"]')).toBeVisible()
    const chips = page.getByRole('group', { name: 'Чьи воспоминания показать' })
    await expect(chips.getByRole('button')).toHaveText(['Все', 'Лиля', 'Миша', 'Без отметки'])
    await expect(card(page, lilyaNote)).toBeVisible()
    await expect(card(page, sharedNote)).toBeVisible()
    await page.screenshot({ path: `${screenshotDir}/family-all-feed-390.png` })
    await chip(page, 'Лиля').click()
    await expect(card(page, lilyaNote)).toBeVisible()
    await expect(card(page, pair.id)).toBeVisible()
    await expect(card(page, sharedNote)).toHaveCount(0)
    await page.screenshot({ path: `${screenshotDir}/selected-child-page-390.png` })
    await chip(page, 'Без отметки').click()
    await expect(card(page, sharedNote)).toBeVisible()
    await expect(card(page, lilyaNote)).toHaveCount(0)
    await chip(page, 'Миша').click()
    await expect(page.locator('.memory-card')).toHaveCount(0)
  })

  const mishaNote = await test.step('adding from a child starts with that child chosen', async () => {
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить заметку' }).click()
    await expect(page.getByRole('button', { name: 'Миша', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Лиля', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('textbox', { name: 'Текст заметки' }).fill('Заметка про Мишу')
    const published = page.waitForResponse((response) => response.request().method() === 'POST' && /\/memories$/.test(new URL(response.url()).pathname))
    await page.getByRole('button', { name: 'Опубликовать' }).click()
    const response = await published
    expect(response.status()).toBe(201)
    expect((response.request().postDataJSON() as { childIds?: string[] }).childIds).toEqual([misha.id])
    const created = await response.json() as { id: string }
    await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
    await expect(card(page, created.id)).toBeVisible()
    return created.id
  })

  await test.step('«Все» shows everything again, including the new note', async () => {
    await chip(page, 'Все').click()
    for (const id of [mishaNote, lilyaNote, sharedNote, pair.id]) await expect(card(page, id)).toBeVisible()
  })

  await test.step('a child can be ticked on one photo of two', async () => {
    await openChildTags(page, pair.id)
    const slots = page.locator('[data-tag-slot]')
    await expect(slots).toHaveCount(2)
    await expect(slots.nth(0).getByRole('button', { name: 'Лиля', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(slots.nth(0).getByRole('button', { name: 'Миша', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await slots.nth(0).getByRole('button', { name: 'Миша', exact: true }).click()
    await expect(slots.nth(0).getByRole('button', { name: 'Миша', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(slots.nth(1).getByRole('button', { name: 'Миша', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.screenshot({ path: `${screenshotDir}/tag-editor-390.png` })
    // The network drops once: the choice stays and the same save can be repeated.
    let dropped = false
    await page.route('**/child-tags', async (route) => {
      if (!dropped) { dropped = true; await route.abort('connectionreset'); return }
      await route.continue()
    })
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Не удалось сохранить отметки')
    await expect(slots.nth(0).getByRole('button', { name: 'Миша', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.locator('[data-tag-editor]')).toHaveCount(0)
    await page.unroute('**/child-tags')
    const saved = await (await page.request.get(`/api/v1/families/${familyId}/memories/${pair.id}`, { headers: { ...headers, 'X-Memoly-Children': '1' } })).json() as { childTags: Array<{ childId: string; attachmentId: string | null }>; childTagsVersion: number }
    expect(saved.childTags).toContainEqual({ childId: lilya.id, attachmentId: null })
    expect(saved.childTags).toContainEqual({ childId: misha.id, attachmentId: pair.attachments[0]!.id })
    expect(saved.childTags.filter((tag) => tag.childId === misha.id)).toHaveLength(1)
  })

  await test.step('the whole publication, both photos, is on the second child\'s page at once', async () => {
    await chip(page, 'Миша').click()
    await expect(card(page, pair.id)).toBeVisible()
    await expect(card(page, mishaNote)).toBeVisible()
    await expect(card(page, lilyaNote)).toHaveCount(0)
    await expect(card(page, pair.id).getByLabel('Медиа воспоминания, 2 элементов')).toBeVisible()
  })

  await test.step('a second editor saving first shows a conflict with the fresh tags', async () => {
    await chip(page, 'Все').click()
    await openChildTags(page, pair.id)
    const current = await (await page.request.get(`/api/v1/families/${familyId}/memories/${pair.id}`, { headers: { ...headers, 'X-Memoly-Children': '1' } })).json() as { childTagsVersion: number }
    const other = await page.request.put(`/api/v1/families/${familyId}/memories/${pair.id}/child-tags`, { headers, data: { tags: [{ childId: misha.id, attachmentId: null }], expectedChildTagsVersion: current.childTagsVersion } })
    expect(other.status()).toBe(200)
    const slots = page.locator('[data-tag-slot]')
    await slots.nth(1).getByRole('button', { name: 'Миша', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Отметки уже изменили, обновите')
    // The fresh tags (only Миша, on the whole publication) replace the stale choice.
    await expect(slots.nth(0).getByRole('button', { name: 'Миша', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(slots.nth(0).getByRole('button', { name: 'Лиля', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page.locator('[data-tag-editor]')).toHaveCount(0)
  })

  await test.step('albums are grouped by child, then the family ones', async () => {
    const yearAlbum = await page.request.post(`/api/v1/families/${familyId}/albums`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { kind: 'year', title: 'Первый год · Лиля', description: null, childId: lilya.id } })
    expect(yearAlbum.status()).toBe(201)
    const freeAlbum = await page.request.post(`/api/v1/families/${familyId}/albums`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { kind: 'free', title: 'Семейная поездка', description: null, childId: null } })
    expect(freeAlbum.status()).toBe(201)
    await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
    await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
    await page.getByRole('button', { name: /Мастерская/ }).click()
    // New album: the child is chosen in the form, the first child by default.
    const owner = page.getByLabel('Для кого этот альбом')
    await expect(owner).toHaveValue(lilya.id)
    await owner.selectOption(misha.id)
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Мастерская', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '‹ Альбомы', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Альбомы', exact: true })).toBeVisible()
    await expect(page.locator('[data-albums-group]')).toHaveCount(3)
    await expect(page.locator('.albums-group-title')).toHaveText(['Лиля', 'Миша', 'Семейные'])
    await expect(page.locator('[data-albums-group]').nth(0)).toContainText('Первый год · Лиля')
    await expect(page.locator('[data-albums-group]').nth(1)).toContainText('Мастерская')
    await expect(page.locator('[data-albums-group]').nth(2)).toContainText('Семейная поездка')
    await page.screenshot({ path: `${screenshotDir}/albums-grouped-by-child.png` })
    const created = (await (await page.request.get(`/api/v1/families/${familyId}/albums?childId=${misha.id}`, { headers })).json() as { items: Array<{ kind: string; childId: string | null }> }).items
    expect(created.map((album) => [album.kind, album.childId])).toEqual([['workshop', misha.id]])
  })
})

test('a viewer sees the filters but cannot mark children or open «Без отметки»', async ({ browser, page }) => {
  const seeded = await startFamily(page)
  const sharedNote = await createNote(page, seeded, 'Заметка без отметки', [])
  const tagged = await createNote(page, seeded, 'Заметка про Лилю', [seeded.children[0]!.id])
  const viewerPage = await enterAsViewer(browser, seeded.familyId)
  try {
    await expect(card(viewerPage, sharedNote)).toBeVisible()
    await expect(viewerPage.getByRole('group', { name: 'Чьи воспоминания показать' }).getByRole('button')).toHaveText(['Все', 'Лиля', 'Миша'])
    await card(viewerPage, tagged).getByRole('button', { name: 'Действия с воспоминанием' }).click()
    const actions = viewerPage.locator(`[data-memory-actions-for="${tagged}"]`)
    await expect(actions.getByRole('button', { name: 'Подробнее' })).toBeVisible()
    await expect(actions.getByRole('button', { name: /Отметить детей/ })).toHaveCount(0)
    await expect(actions.getByRole('button', { name: 'Редактировать' })).toHaveCount(0)
  } finally { await viewerPage.context().close() }
})

test('a one-child family keeps the plain feed: no filters, no child choice, no marking, albums as before', async ({ page }) => {
  const seeded = await startFamily(page, 1)
  const lilya = seeded.children[0]!
  const first = await createNote(page, seeded, 'Первая заметка', undefined)
  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  await expect(card(page, first)).toBeVisible()
  await expect(page.locator('[data-family-header="true"][data-child-header-mode="feed"]')).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Чьи воспоминания показать' })).toHaveCount(0)
  await card(page, first).getByRole('button', { name: 'Действия с воспоминанием' }).click()
  const actions = page.locator(`[data-memory-actions-for="${first}"]`)
  await expect(actions.getByRole('button', { name: 'Редактировать' })).toBeVisible()
  await expect(actions.getByRole('button', { name: /Отметить детей/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить заметку' }).click()
  await expect(page.getByText('Кто на этом воспоминании')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Текст заметки' }).fill('Вторая заметка')
  const published = page.waitForResponse((response) => response.request().method() === 'POST' && /\/memories$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  const response = await published
  expect(response.status()).toBe(201)
  expect((response.request().postDataJSON() as { childIds?: string[] }).childIds).toBeUndefined()
  const created = await response.json() as { id: string }
  // The server's default rule tags the only child.
  const stored = await (await page.request.get(`/api/v1/families/${seeded.familyId}/memories/${created.id}`, { headers: { ...seeded.headers, 'X-Memoly-Children': '1' } })).json() as { childTags: Array<{ childId: string; attachmentId: string | null }> }
  expect(stored.childTags).toEqual([{ childId: lilya.id, attachmentId: null }])
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  await expect(card(page, created.id)).toBeVisible()

  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Первый год/ }).click()
  await expect(page.getByLabel('Для кого этот альбом')).toHaveCount(0)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.locator('.albums-timeline .albums-entry-card')).toHaveCount(12)
  await page.getByRole('button', { name: '‹ Альбомы', exact: true }).click()
  await expect(page.locator('.albums-card')).toHaveCount(1)
  await expect(page.locator('[data-albums-group]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await expect(page.locator('[data-slot="family-children"]')).toContainText('Добавить ребёнка')
  await expect(page.locator('[data-slot="family-children"] .family-child-row')).toHaveCount(0)
})

test('a child deleted on another device: an open or saved filter on it falls back to «Все» and keeps the family open', async ({ page }) => {
  const seeded = await startFamily(page)
  const { familyId } = seeded
  const shared = await createNote(page, seeded, 'Заметка для всех', [])
  const vanya = await addChild(page, seeded, 'Ваня', '2024-06-07')
  const petya = await addChild(page, seeded, 'Петя', '2025-01-02')
  await page.reload()
  await expect(page.getByTestId('bottom-navigation')).toBeVisible()
  await page.getByRole('button', { name: 'Лента', exact: true }).click()

  await test.step('an open filter: the background check meets the removed child', async () => {
    await chip(page, 'Ваня').click()
    await expect(chip(page, 'Ваня')).toHaveAttribute('aria-pressed', 'true')
    await removeChild(page, seeded, vanya)
    const stale = page.waitForResponse((response) => response.url().includes(`childId=${vanya.id}`))
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    expect((await stale).status()).toBe(404)
    await expectAllFeed(page, shared, 'Ваня')
  })

  await test.step('a saved filter: the app restarts on a child removed meanwhile', async () => {
    await chip(page, 'Петя').click()
    await expect(chip(page, 'Петя')).toHaveAttribute('aria-pressed', 'true')
    // Let the saved presentation (family with Петя + the Петя filter) reach the private cache.
    await page.waitForTimeout(1_500)
    await removeChild(page, seeded, petya)
    let releaseFamily: () => void = () => undefined
    const familyReleased = new Promise<void>((resolve) => { releaseFamily = resolve })
    const staleSeen = page.waitForResponse((response) => response.url().includes(`childId=${petya.id}`))
    let held = false
    await page.route(`**/api/v1/families/${familyId}`, async (route) => {
      if (route.request().method() !== 'GET' || held) return route.continue()
      held = true
      await familyReleased
      await route.continue()
    })
    try {
      const reload = page.reload({ waitUntil: 'domcontentloaded' })
      const staleResponse = await staleSeen
      expect(staleResponse.status()).toBe(404)
      releaseFamily()
      await reload
    } finally {
      releaseFamily()
    }
    await expectAllFeed(page, shared, 'Петя')
    await page.unroute(`**/api/v1/families/${familyId}`)
  })
})

test('a removed child albums 404 falls back to the family feed', async ({ page }) => {
  const seeded = await startFamily(page)
  const shared = await createNote(page, seeded, 'Общая заметка после удаления', [])
  const child = await addChild(page, seeded, 'Ваня', '2024-06-07')
  await page.reload()
  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  let releaseAlbums: () => void = () => undefined
  let albumRequestStarted: () => void = () => undefined
  const albumRequestHeld = new Promise<void>((resolve) => { releaseAlbums = resolve })
  const albumRequestReached = new Promise<void>((resolve) => { albumRequestStarted = resolve })
  const albums404 = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/albums') && url.searchParams.get('childId') === child.id
  })
  const childFeed = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/memories') && url.searchParams.get('childId') === child.id
  })
  await page.route(`**/api/v1/families/${seeded.familyId}/albums?*`, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.searchParams.get('childId') === child.id) {
      albumRequestStarted()
      await albumRequestHeld
    }
    await route.continue()
  })
  try {
    await chip(page, 'Ваня').click()
    await expect(chip(page, 'Ваня')).toHaveAttribute('aria-pressed', 'true')
    expect((await childFeed).status()).toBe(200)
    await albumRequestReached
    await removeChild(page, seeded, child)
    releaseAlbums()
    expect((await albums404).status()).toBe(404)
    await expectAllFeed(page, shared, 'Ваня')
  } finally {
    releaseAlbums()
    await page.unroute(`**/api/v1/families/${seeded.familyId}/albums?*`)
  }
})

test('a filtered child 404 followed by family access 404 returns to the family hub', async ({ page }) => {
  const seeded = await startFamily(page)
  const child = seeded.children[0]!
  await page.getByRole('button', { name: 'Лента', exact: true }).click()
  await page.route(`**/api/v1/families/${seeded.familyId}/memories?*`, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('childId') === child.id) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Не найдено', requestId: randomUUID() } }),
      })
      return
    }
    await route.continue()
  })
  await page.route(`**/api/v1/families/${seeded.familyId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Не найдено', requestId: randomUUID() } }),
      })
      return
    }
    await route.continue()
  })
  const filtered404 = page.waitForResponse((response) => response.url().includes(`childId=${child.id}`) && response.status() === 404)
  const family404 = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === `/api/v1/families/${seeded.familyId}` && response.request().method() === 'GET' && response.status() === 404
  })
  await chip(page, child.name).click()
  await Promise.all([filtered404, family404])
  await expect(page.getByText('Доступ к этой семье закрыт.')).toBeVisible()
  await expect(page.locator('.family-hub-card')).toBeVisible()
  await expect(page.locator('[data-memoly-feed]')).toHaveCount(0)
})

async function addChild(page: Page, seeded: SeededFamily, name: string, birthDate: string) {
  const avatar = await uploadImage(page, seeded.headers, seeded.familyId, 'child_avatar', pngImage.buffer, 'image/png')
  const added = await page.request.post(`/api/v1/families/${seeded.familyId}/children`, { headers: { ...seeded.headers, 'Idempotency-Key': randomUUID() }, data: { name, birthDate, sex: 'boy', avatarMediaId: avatar, avatarCrop: crop } })
  expect(added.status()).toBe(201)
  return (await added.json() as { child: { id: string; version: number } }).child
}

async function removeChild(page: Page, seeded: SeededFamily, child: { id: string; version: number }) {
  const removed = await page.request.delete(`/api/v1/families/${seeded.familyId}/children/${child.id}`, { headers: { ...seeded.headers, 'If-Match': String(child.version) } })
  expect(removed.status()).toBe(204)
}

async function expectAllFeed(page: Page, sharedNote: string, removedName: string) {
  await expect(card(page, sharedNote)).toBeVisible()
  await expect(chip(page, 'Все')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, removedName)).toHaveCount(0)
  await expect(page.getByText('Доступ к этой семье закрыт.')).toHaveCount(0)
  await expect(page.locator('.family-hub-card')).toHaveCount(0)
}

type SeededFamily = { familyId: string; headers: Record<string, string>; children: Array<{ id: string; name: string }> }

function card(page: Page, memoryId: string) { return page.locator(`.memory-card[data-memory-id="${memoryId}"]`) }
function chip(page: Page, name: string) { return page.getByRole('group', { name: 'Чьи воспоминания показать' }).getByRole('button', { name, exact: true }) }

async function openChildTags(page: Page, memoryId: string) {
  await card(page, memoryId).getByRole('button', { name: 'Действия с воспоминанием' }).click()
  await page.locator(`[data-memory-actions-for="${memoryId}"]`).getByRole('button', { name: /Отметить детей/ }).click()
  await expect(page.locator('[data-tag-editor]')).toBeVisible()
}

async function startFamily(page: Page, childCount: 1 | 2 = 2): Promise<SeededFamily> {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((data) => { Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1', platform: 'android', ready() {} } }) }, signedInitData('Children synthetic owner'))
  const exchange = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.request().method() === 'POST')
  await page.goto('/')
  const auth = await (await exchange).json() as { accessToken: string }
  const headers = { Authorization: `Bearer ${auth.accessToken}` }
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  let familyId = ''
  await page.route('**/api/v1/families', async (route) => {
    if (route.request().method() !== 'POST' || familyId) return route.continue()
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    familyId = ((await response.json()) as { family: { id: string } }).family.id
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: /Создать свою семью/ }).click()
  await expect.poll(() => familyId).not.toBe('')
  await expect(page.getByTestId('bottom-navigation')).toBeVisible()
  const firstAvatar = await uploadImage(page, headers, familyId, 'child_avatar', pngImage.buffer, 'image/png')
  const first = await page.request.put(`/api/v1/families/${familyId}/child`, { headers, data: { name: 'Лиля', birthDate: '2021-02-03', sex: 'girl', avatarMediaId: firstAvatar, avatarCrop: crop, expectedVersion: null } })
  expect(first.status()).toBe(200)
  if (childCount === 2) {
    const secondAvatar = await uploadImage(page, headers, familyId, 'child_avatar', jpegImage.buffer, 'image/jpeg')
    const second = await page.request.post(`/api/v1/families/${familyId}/children`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { name: 'Миша', birthDate: '2023-04-05', sex: 'boy', avatarMediaId: secondAvatar, avatarCrop: crop } })
    expect(second.status()).toBe(201)
  }
  const family = await (await page.request.get(`/api/v1/families/${familyId}`, { headers: { ...headers, 'X-Memoly-Children': '1' } })).json() as { family: { name: string }; children: Array<{ id: string; name: string }> }
  expect(family.children.map((child) => child.name)).toEqual(childCount === 2 ? ['Лиля', 'Миша'] : ['Лиля'])
  // This setup tests family behavior, not whether the debounced presentation cache flushed before reload.
  await page.reload()
  const bottomNavigation = page.getByTestId('bottom-navigation')
  const seededFamilyCard = page.locator('.family-hub-card').filter({ has: page.getByText(family.family.name, { exact: true }) })
  await expect(bottomNavigation.or(seededFamilyCard).first()).toBeVisible()
  if (await seededFamilyCard.isVisible()) await seededFamilyCard.click()
  await expect(bottomNavigation).toBeVisible()
  return { familyId, headers, children: family.children }
}

async function createNote(page: Page, seeded: SeededFamily, body: string, childIds: string[] | undefined) {
  const response = await page.request.post(`/api/v1/families/${seeded.familyId}/memories`, { headers: { ...seeded.headers, 'Idempotency-Key': randomUUID() }, data: { kind: 'note', ...(childIds ? { childIds } : { childId: seeded.children[0]!.id }), body, occurredAt: new Date().toISOString() } })
  expect(response.status()).toBe(201)
  return (await response.json() as { id: string }).id
}

async function createPhotoMemory(page: Page, seeded: SeededFamily, body: string, childIds: string[]) {
  const first = await uploadImage(page, seeded.headers, seeded.familyId, 'memory', pngImage.buffer, 'image/png')
  const second = await uploadImage(page, seeded.headers, seeded.familyId, 'memory', jpegImage.buffer, 'image/jpeg')
  const response = await page.request.post(`/api/v1/families/${seeded.familyId}/memories`, { headers: { ...seeded.headers, 'Idempotency-Key': randomUUID(), 'X-Memoly-Children': '1' }, data: { kind: 'photo', childIds, body, occurredAt: new Date().toISOString(), mediaIds: [first, second] } })
  expect(response.status()).toBe(201)
  return await response.json() as { id: string; attachments: Array<{ id: string }> }
}

async function uploadImage(page: Page, headers: Record<string, string>, familyId: string, purpose: 'child_avatar' | 'memory', bytes: Buffer, contentType: string) {
  const reserve = await page.request.post(`/api/v1/families/${familyId}/uploads`, { headers, data: { purpose, kind: 'photo', contentType, byteSize: bytes.byteLength } })
  expect(reserve.status()).toBe(201)
  const ticket = await reserve.json() as { assetId: string; upload: { url: string; headers: Record<string, string>; uploadId: string } }
  const upload = await page.request.put(ticket.upload.url, { headers: ticket.upload.headers, data: bytes })
  expect(upload.status()).toBe(200)
  const finalized = await page.request.post(`/api/v1/families/${familyId}/uploads/${ticket.upload.uploadId}/finalize`, { headers })
  expect(finalized.status()).toBe(200)
  return ticket.assetId
}

async function enterAsViewer(browser: Browser, familyId: string) {
  const subject = String(8_100_000 + Math.floor(Math.random() * 900_000))
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    const user = await prisma.user.create({ data: { displayName: 'Children synthetic viewer' } })
    await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject } })
    await prisma.pilotAdmission.createMany({ data: [{ provider: 'max', subject }], skipDuplicates: true })
    await prisma.familyMember.create({ data: { familyId, userId: user.id, role: 'viewer' } })
  } finally { await prisma.$disconnect() }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const viewer = await context.newPage()
  await viewer.addInitScript((data) => { Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1', platform: 'android', ready() {} } }) }, signedInitData('Children synthetic viewer', Number(subject)))
  const exchange = viewer.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.request().method() === 'POST')
  await viewer.goto('/')
  expect((await exchange).status()).toBe(200)
  const welcome = viewer.getByRole('button', { name: 'Продолжить', exact: true })
  const hubCard = viewer.locator('.family-hub-card')
  const feed = viewer.locator('[data-memoly-feed]').first()
  await expect(welcome.or(hubCard).or(feed).first()).toBeVisible()
  if (await welcome.isVisible()) await welcome.click()
  await expect(hubCard.or(feed).first()).toBeVisible()
  if (await hubCard.isVisible()) await hubCard.click()
  await expect(feed).toBeVisible()
  return viewer
}

function signedInitData(name: string, id = 8_000_000 + Math.floor(Math.random() * 1_000_000)) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: randomUUID(), user: JSON.stringify({ id, first_name: name }) })
  const check = [...fields].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('987654:max-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}
