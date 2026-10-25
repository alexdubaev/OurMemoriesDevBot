import { createHmac, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { expect, test, type Locator, type Page } from '@playwright/test'

test('album deletion confirmations work without native dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const initData = signedInitData()
  await page.addInitScript((data) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1', platform: 'android', ready() {} } })
  }, initData)
  const exchange = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.request().method() === 'POST')
  await page.goto('/')
  const auth = await (await exchange).json() as { accessToken: string }
  const headers = { Authorization: `Bearer ${auth.accessToken}` }
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await page.getByRole('button', { name: /Создать свою семью/ }).click()
  await expect(page.getByRole('heading', { name: 'Расскажите о ребёнке' })).toBeVisible()
  const home = await page.request.get('/api/v1/me/families', { headers })
  expect(home.status()).toBe(200)
  const familyId = ((await home.json()) as { ownFamilyId: string }).ownFamilyId
  expect(familyId).toBeTruthy()
  await page.evaluate(() => { window.confirm = () => false })
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Свободный альбом/ }).click()
  await page.getByLabel('Название альбома').fill('Архив путешествия')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Архив путешествия', exact: true })).toBeVisible()

  const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  for (const names of [['first-a.png', 'first-b.png'], ['second.png']]) {
    await page.getByRole('button', { name: 'Добавить историю', exact: true }).click()
    await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
    await page.locator('#photo-composer-files').setInputFiles(names.map((name) => ({ name, mimeType: 'image/png', buffer: photoBytes })))
    await page.getByRole('button', { name: `Добавить в альбом (${names.length})`, exact: true }).click()
    await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  }
  const catalog = await (await page.request.get(`/api/v1/families/${familyId}/albums`, { headers })).json() as { items: { id: string; version: number }[] }
  const album = catalog.items[0]
  const entriesPath = `/api/v1/families/${familyId}/albums/${album.id}/entries`
  const attached = await (await page.request.get(entriesPath, { headers })).json() as { items: { id: string; sources: { sourceId: string }[] }[] }
  expect(attached.items).toHaveLength(2)
  const [first, second] = attached.items
  expect(first.sources).toHaveLength(2)
  const detachedMediaId = first.sources[0].sourceId
  const retainedMediaId = first.sources[1].sourceId
  const secondMediaId = second.sources[0].sourceId

  await page.getByRole('button', { name: 'Открыть историю', exact: true }).first().click()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByRole('button', { name: 'Убрать материал 1', exact: true }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  const afterUnlink = await (await page.request.get(`${entriesPath}/${first.id}`, { headers })).json() as { entry: { sources: { sourceId: string }[] } }
  expect(afterUnlink.entry.sources.map((source) => source.sourceId)).toEqual([retainedMediaId])
  const detachedOriginal = await page.request.get(`/api/v1/families/${familyId}/media/${detachedMediaId}/content?variant=original`, { headers: { ...headers, 'X-Private-Media-Purpose': 'image' } })
  expect(detachedOriginal.status()).toBe(200)
  expect(await detachedOriginal.body()).toEqual(photoBytes)
  await page.getByRole('button', { name: 'Открыть историю', exact: true }).first().click()
  await page.getByRole('button', { name: 'Убрать из альбома', exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('Оригиналы сохранятся')
  await confirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  await page.getByRole('button', { name: 'Убрать из альбома', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: /Убрать историю/ }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await expect.poll(async () => ((await (await page.request.get(entriesPath, { headers })).json()) as { items: unknown[] }).items.length).toBe(1)

  const privateHeaders = { ...headers, 'X-Private-Media-Purpose': 'image' }
  for (const mediaId of [retainedMediaId, secondMediaId]) {
    const original = await page.request.get(`/api/v1/families/${familyId}/media/${mediaId}/content?variant=original`, { headers: privateHeaders })
    expect(original.status()).toBe(200)
    expect(await original.body()).toEqual(photoBytes)
  }

  await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click()
  await page.getByRole('button', { name: 'Удалить альбом', exact: true }).click()
  const albumConfirmation = page.getByRole('alertdialog')
  await expect(albumConfirmation).toContainText('Исходные материалы сохранятся')
  await albumConfirmation.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Удалить альбом', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Удалить альбом', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить альбом', exact: true }).click()
  await expect(page.locator('[data-albums-route="catalog"]')).toBeVisible()
  await expect.poll(async () => ((await (await page.request.get(`/api/v1/families/${familyId}/albums`, { headers })).json()) as { items: unknown[] }).items.length).toBe(0)
  await page.reload()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await expect(page.getByText('Архив путешествия', { exact: true })).toHaveCount(0)
  const retained = await page.request.get(`/api/v1/families/${familyId}/media/${secondMediaId}/content?variant=original`, { headers: privateHeaders })
  expect(retained.status()).toBe(200)
  expect(await retained.body()).toEqual(photoBytes)
})

test('MAX authenticated album cover choices save and complete the picker', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const initData = signedInitData()
  await page.addInitScript((data) => { Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1', platform: 'ios', ready() {} } }) }, initData)
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
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('status of 503 (Service Unavailable)')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Свободный альбом/ }).click()
  await page.getByLabel('Название альбома').fill('Обложка для проверки')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Обложка для проверки', exact: true })).toBeVisible()

  const photos = [
    { name: 'cover-first-red.png', bytes: solidPng(240, 24, 24) },
    { name: 'cover-second-blue.png', bytes: solidPng(24, 48, 240) },
  ]
  for (const photo of photos) {
    await page.getByRole('button', { name: 'Добавить историю', exact: true }).click()
    await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
    await page.locator('#photo-composer-files').setInputFiles({ name: photo.name, mimeType: 'image/png', buffer: photo.bytes })
    await page.getByRole('button', { name: 'Добавить в альбом (1)', exact: true }).click()
    await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  }

  const catalogPath = `/api/v1/families/${familyId}/albums`
  const initialCatalogResponse = await page.request.get(catalogPath, { headers })
  expect(initialCatalogResponse.status()).toBe(200)
  const initialCatalog = (await initialCatalogResponse.json()) as { items: { id: string; title: string; version: number; cover: { id: string } | null }[] }
  const album = initialCatalog.items.find((item) => item.title === 'Обложка для проверки')!
  const entriesResponse = await page.request.get(`/api/v1/families/${familyId}/albums/${album.id}/entries`, { headers })
  expect(entriesResponse.status()).toBe(200)
  const entries = (await entriesResponse.json()) as { items: { sources: { id: string; sourceId: string; available: boolean; kind: string }[] }[] }
  const sourceIds = entries.items.flatMap((entry) => entry.sources).filter((source) => source.available && source.kind === 'photo').map((source) => source.id)
  expect(sourceIds).toHaveLength(2)
  expect(sourceIds[0]).not.toBe(sourceIds[1])

  const capture = async (name: string) => {
    const directory = process.env.MEMOLY_ALBUM_COVER_EVIDENCE_DIR
    if (directory) await page.screenshot({ fullPage: false, path: `${directory}/${name}.png` })
  }
  await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click()
  await page.getByRole('button', { name: 'Выбрать обложку', exact: true }).click()
  await expect(page.locator('[data-albums-route="cover"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выбрать этот кадр обложкой', exact: true })).toHaveCount(2)
  await capture('picker-before-selection')
  let failNextCoverPatch = true
  await page.route(`**/api/v1/families/${familyId}/albums/${album.id}`, async (route) => {
    if (!failNextCoverPatch || route.request().method() !== 'PATCH') return route.continue()
    failNextCoverPatch = false
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Synthetic temporary failure', requestId: randomUUID() } }) })
  })
  const failedResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/v1/families/${familyId}/albums/${album.id}`) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Выбрать этот кадр обложкой', exact: true }).nth(1).click()
  const failedResponse = await failedResponsePromise
  const routeAfterFailedPatch = await page.locator('[data-albums-route]').getAttribute('data-albums-route')
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить альбомы.')
  await expect(page.locator('[data-albums-route="cover"]')).toBeVisible()
  await capture('picker-after-failed-patch')
  const manualResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/v1/families/${familyId}/albums/${album.id}`) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Выбрать этот кадр обложкой', exact: true }).nth(1).click()
  const manualResponse = await manualResponsePromise
  const manualPayload = await manualResponse.json() as { album?: { id: string; version: number; cover: { id: string } | null } }
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  const routeAfterManual = await page.locator('[data-albums-route]').getAttribute('data-albums-route')
  await capture('picker-after-manual-selection')
  const manualCatalogResponse = await page.request.get(catalogPath, { headers })
  const manualCatalog = (await manualCatalogResponse.json()) as { items: { id: string; version: number; cover: { id: string } | null }[] }
  const persistedManualCoverId = manualCatalog.items.find((item) => item.id === album.id)?.cover?.id ?? null
  await page.reload()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  let catalogCard = page.locator('.albums-card').filter({ hasText: 'Обложка для проверки' })
  await expect(catalogCard).toBeVisible()
  const manualCardPixel = await readImagePixel(catalogCard.locator('.albums-cover img'))
  expectDominantColor(manualCardPixel, 'blue')
  await capture('catalog-after-manual-reload')
  await catalogCard.click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await page.getByRole('button', { name: 'Настройки альбома', exact: true }).click()
  await page.getByRole('button', { name: 'Выбрать обложку', exact: true }).click()
  const autoResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/v1/families/${familyId}/albums/${album.id}`) && response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Автоматическая обложка', exact: true }).click()
  const autoResponse = await autoResponsePromise
  const autoPayload = await autoResponse.json() as { album?: { id: string; version: number; cover: { id: string } | null } }
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  const routeAfterAutomatic = await page.locator('[data-albums-route]').getAttribute('data-albums-route')
  await capture('picker-after-automatic-selection')
  const autoCatalogResponse = await page.request.get(catalogPath, { headers })
  const autoCatalog = (await autoCatalogResponse.json()) as { items: { id: string; version: number; cover: { id: string } | null }[] }
  const persistedAutomaticCoverId = autoCatalog.items.find((item) => item.id === album.id)?.cover?.id ?? null
  const automaticFallbackSourceId = sourceIds[0]
  await page.reload()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  catalogCard = page.locator('.albums-card').filter({ hasText: 'Обложка для проверки' })
  await expect(catalogCard).toBeVisible()
  const automaticCardPixel = await readImagePixel(catalogCard.locator('.albums-cover img'))
  expectDominantColor(automaticCardPixel, 'red')
  await capture('catalog-after-reload')

  console.log('ALBUM_COVER_EVIDENCE ' + JSON.stringify({
    failed: { status: failedResponse.status(), routeAfterResponse: routeAfterFailedPatch },
    manual: { status: manualResponse.status(), payloadCoverId: manualPayload.album?.cover?.id ?? null, persistedCoverId: persistedManualCoverId, selectedSourceId: sourceIds[1], routeAfterChoice: routeAfterManual, catalogPixelAfterReload: manualCardPixel },
    automatic: { status: autoResponse.status(), payloadCoverId: autoPayload.album?.cover?.id ?? null, persistedCoverId: persistedAutomaticCoverId, fallbackSourceId: automaticFallbackSourceId, routeAfterChoice: routeAfterAutomatic, catalogPixelAfterReload: automaticCardPixel },
    consoleErrors,
    pageErrors,
  }))
  expect(failedResponse.status()).toBe(503)
  expect(routeAfterFailedPatch).toBe('cover')
  expect(manualResponse.status()).toBe(200)
  expect(manualPayload.album?.cover?.id).toBe(sourceIds[1])
  expect(persistedManualCoverId).toBe(sourceIds[1])
  expect(autoResponse.status()).toBe(200)
  expect(autoPayload.album?.cover?.id).toBe(automaticFallbackSourceId)
  expect(persistedAutomaticCoverId).toBe(automaticFallbackSourceId)
  await expect(catalogCard.locator('.albums-cover img')).toBeVisible()
  expect(routeAfterManual).toBe('album')
  expect(routeAfterAutomatic).toBe('album')
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})

test('MAX authenticated albums persist year chapters and a text event through real API and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const initData = signedInitData()
  await page.addInitScript((data) => { Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1', platform: 'android', ready() {} } }) }, initData)
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
  // A family album is available before the child profile is completed.
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Создать альбом', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Свободный альбом/ }).click()
  await page.getByLabel('Название альбома').fill('Семейная поездка')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Семейная поездка', exact: true })).toBeVisible()
  const freePage = await page.request.get(`/api/v1/families/${familyId}/albums`, { headers })
  const freeAlbums = ((await freePage.json()) as { items: { id: string }[] }).items
  expect(freeAlbums).toHaveLength(1)
  const freeAlbumId = freeAlbums[0].id

  const publishedBeforeUpload = await page.request.get(`/api/v1/families/${familyId}/memories?limit=20`, { headers })
  expect(publishedBeforeUpload.status()).toBe(200)
  const publishedBeforeCount = ((await publishedBeforeUpload.json()) as { items: unknown[] }).items.length
  let memoryPosts = 0
  let uploadReservations = 0
  const albumAttachRequests: Array<{ key: string | undefined; body: unknown }> = []
  const memoryReads: string[] = []
  let loseFirstAttachResponse = true
  page.on('request', (request) => { if (request.method() === 'POST' && /\/api\/v1\/families\/[^/]+\/memories$/.test(new URL(request.url()).pathname)) memoryPosts += 1 })
  page.on('request', (request) => { if (request.method() === 'POST' && /\/api\/v1\/families\/[^/]+\/uploads$/.test(new URL(request.url()).pathname)) uploadReservations += 1 })
  page.on('request', (request) => { const url = new URL(request.url()); if (request.method() === 'GET' && /\/api\/v1\/families\/[^/]+\/memories(?:\/|$)/.test(url.pathname)) memoryReads.push(url.pathname) })
  await page.route('**/api/v1/families/*/albums/*/entries', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    albumAttachRequests.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() })
    if (loseFirstAttachResponse) {
      loseFirstAttachResponse = false
      const committed = await route.fetch()
      expect(committed.status()).toBe(201)
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Добавить историю', exact: true }).click()
  await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить фото в альбом' })).toBeVisible()
  await expect(page.locator('.memoly-add-page .memoly-add-caption')).toHaveCount(0)
  await expect(page.locator('.memoly-add-page .memoly-add-date')).toHaveCount(0)
  const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.locator('#photo-composer-files').setInputFiles({ name: 'album-photo.png', mimeType: 'image/png', buffer: photoBytes })
  await page.getByRole('button', { name: 'Добавить в альбом (1)', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Повторить только прикрепление', exact: true })).toBeVisible()
  expect(uploadReservations).toBe(1)
  expect(albumAttachRequests).toHaveLength(1)
  await page.getByRole('button', { name: 'Повторить только прикрепление', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  expect(memoryPosts).toBe(0)
  expect(uploadReservations).toBe(1)
  expect(albumAttachRequests).toHaveLength(2)
  expect(albumAttachRequests[0]?.key).toBe(albumAttachRequests[1]?.key)
  expect(albumAttachRequests[0]?.body).toEqual(albumAttachRequests[1]?.body)
  const publishedAfterUpload = await page.request.get(`/api/v1/families/${familyId}/memories?limit=20`, { headers })
  expect(((await publishedAfterUpload.json()) as { items: unknown[] }).items).toHaveLength(publishedBeforeCount)
  await page.reload()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: /Семейная поездка/ }).click()
  const attachedAlbum = await page.request.get(`/api/v1/families/${familyId}/albums/${freeAlbumId}/entries`, { headers })
  expect(attachedAlbum.status()).toBe(200)
  const attachedEntry = ((await attachedAlbum.json()) as { items: { sources: { memoryId: string | null; sourceKind: string; sourceId: string; kind: string; attachment: { id: string; source: string } | null }[] }[] }).items[0]
  expect(attachedEntry.sources).toHaveLength(1)
  expect(attachedEntry.sources[0]).toEqual(expect.objectContaining({ memoryId: null, sourceKind: 'private_storage', sourceId: expect.any(String), kind: 'photo', available: true, attachment: expect.objectContaining({ id: expect.any(String), source: 'private_storage' }) }))
  await page.getByRole('button', { name: 'Открыть историю', exact: true }).click()
  await expect(page.locator('.albums-entry-detail')).toBeVisible()
  if (process.env.MEMOLY_ALBUM_UPLOAD_SCREENSHOT) await page.screenshot({ fullPage: false, path: process.env.MEMOLY_ALBUM_UPLOAD_SCREENSHOT })
  const readsBeforeViewer = memoryReads.length
  await page.getByRole('button', { name: 'Открыть материал 1', exact: true }).click()
  await expect(page.locator('[data-mixed-viewer]')).toBeVisible()
  await expect(page.getByText('Фото в альбоме', { exact: true })).toBeVisible()
  await expect(page.getByText('Без даты', { exact: true })).toBeVisible()
  await expect.poll(() => page.locator('[data-mixed-viewer] img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  expect(memoryReads.slice(readsBeforeViewer)).toEqual([])
  const openMaterial = page.getByRole('button', { name: 'Открыть материал 1', exact: true })
  await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click()
  await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
  await expect(openMaterial).toBeFocused()
  await openMaterial.click()
  await expect(page.locator('[data-mixed-viewer]')).toBeVisible()
  await page.goBack()
  await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
  await openMaterial.click()
  await expect(page.locator('[data-mixed-viewer]')).toBeVisible()
  expect(memoryReads.slice(readsBeforeViewer)).toEqual([])
  expect(memoryPosts).toBe(0)

  const avatar = await uploadAvatar(page, headers, familyId)
  const childResponse = await page.request.put(`/api/v1/families/${familyId}/child`, { headers, data: { name: 'Альбомная Алиса', birthDate: '2024-01-02', sex: 'girl', avatarMediaId: avatar, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null } })
  expect(childResponse.status()).toBe(200)
  await page.reload()
  // The confirmed family remains selected across reload; continue in that
  // persisted scope after completing the child profile through the real API.
  await expect(page.getByTestId('bottom-navigation')).toBeVisible()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Первый год/ }).click()
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.locator('.albums-timeline .albums-entry-card')).toHaveCount(12)
  await expect(page.getByRole('button', { name: 'Нам 1 месяц', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Нам 2 месяца', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Все 12 месяцев', exact: true }).click()
  await expect(page.locator('.albums-month-overview .albums-entry-card')).toHaveCount(12)
  await page.getByRole('button', { name: 'Нам 7 месяцев', exact: true }).click()
  await page.getByLabel('История').fill('Синтетическая история седьмого месяца')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Синтетическая история седьмого месяца')).toBeVisible()
  await page.getByRole('button', { name: '‹ Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Первые открытия/ }).click()
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await page.getByRole('button', { name: '+ Первая улыбка', exact: true }).click()
  await page.getByLabel('История').fill('Текстовое событие без фотографии')
  await page.getByLabel('Когда это было').selectOption('month')
  await page.getByLabel('Месяц и год').fill('2024-03')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Текстовое событие без фотографии')).toBeVisible()
  await expect(page.getByText('Март 2024', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await expect(page.getByText('Текстовое событие без фотографии')).toBeVisible()
  const catalog = await (await page.request.get(`/api/v1/families/${familyId}/albums`, { headers })).json()
  const year = catalog.items.find((album: { kind: string }) => album.kind === 'year')
  const chapters = await (await page.request.get(`/api/v1/families/${familyId}/albums/${year.id}/entries`, { headers })).json()
  expect(chapters.items).toHaveLength(12)
  expect(chapters.items.find((entry: { monthNumber: number }) => entry.monthNumber === 7).caption).toBe('Синтетическая история седьмого месяца')
  const events = catalog.items.find((album: { kind: string }) => album.kind === 'events')
  const stories = await (await page.request.get(`/api/v1/families/${familyId}/albums/${events.id}/entries`, { headers })).json()
  expect(stories.items[0].date).toEqual({ precision: 'month', value: '2024-03' })
  expect(stories.items[0].sources).toEqual([])
})

test('MAX first-year mobile baseline: two-child catalog, empty and filled months, edit, viewer, and clear', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const initData = signedInitData()
  await page.addInitScript((data) => { Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1', platform: 'android', ready() {} } }) }, initData)
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

  const firstAvatar = await uploadAvatar(page, headers, familyId)
  const firstProfile = await page.request.put(`/api/v1/families/${familyId}/child`, { headers, data: { name: 'Лиля', birthDate: '2024-01-02', sex: 'girl', avatarMediaId: firstAvatar, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null } })
  expect(firstProfile.status()).toBe(200)
  const secondAvatar = await uploadAvatar(page, headers, familyId)
  const secondProfile = await page.request.post(`/api/v1/families/${familyId}/children`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { name: 'Миша', birthDate: '2025-03-04', sex: 'boy', avatarMediaId: secondAvatar, avatarCrop: { x: 0, y: 0, width: 1, height: 1 } } })
  expect(secondProfile.status()).toBe(201)
  const family = await (await page.request.get(`/api/v1/families/${familyId}`, { headers: { ...headers, 'X-Memoly-Children': '1' } })).json() as { children: Array<{ id: string; name: string }> }
  expect(family.children.map((child) => child.name)).toEqual(['Лиля', 'Миша'])
  const lilyaId = family.children[0]!.id
  const mishaId = family.children[1]!.id

  await page.reload()
  await expect.poll(async () => (await page.getByTestId('bottom-navigation').count()) > 0 || (await page.locator('.family-hub-card').count()) > 0).toBe(true)
  const familyHubCards = page.locator('.family-hub-card')
  if (await familyHubCards.count()) await familyHubCards.first().click()
  await expect(page.getByTestId('bottom-navigation')).toBeVisible()
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await page.getByRole('button', { name: 'Создать альбом', exact: true }).click()
  await page.getByRole('button', { name: /Первый год/ }).click()
  await page.getByLabel('Для кого этот альбом').selectOption(mishaId)
  await page.getByLabel('Название альбома').fill('Первый год Миши')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await expect(page.locator('.albums-timeline .albums-entry-card')).toHaveCount(12)
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const yearAlbum = ((await (await page.request.get(`/api/v1/families/${familyId}/albums`, { headers })).json()) as { items: Array<{ id: string; childId: string | null; kind: string }> }).items.find((album) => album.kind === 'year')!
  expect(yearAlbum.childId).toBe(mishaId)
  for (const album of [
    { kind: 'workshop', title: 'Мастерская Лили', childId: lilyaId },
    { kind: 'events', title: 'Первые открытия Лили', childId: lilyaId },
    { kind: 'free', title: 'Семейная поездка', childId: null },
  ]) {
    const created = await page.request.post(`/api/v1/families/${familyId}/albums`, { headers: { ...headers, 'Idempotency-Key': randomUUID() }, data: { ...album, description: null } })
    expect(created.status()).toBe(201)
  }

  const capture = async (name: string) => {
    const dir = process.env.MEMOLY_FIRST_YEAR_EVIDENCE_DIR
    if (!dir) return
    mkdirSync(dir, { recursive: true })
    if (name.startsWith('catalog-')) {
      for (const group of await page.locator('[data-albums-group]').all()) {
        await group.scrollIntoViewIfNeeded()
        await expect.poll(() => group.locator('img').evaluateAll((images) => images.every((element) => { const image = element as HTMLImageElement; return image.complete && image.naturalWidth > 0 }))).toBe(true)
      }
    }
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(() => page.locator('.albums-surface img').evaluateAll((images) => images.every((element) => { const image = element as HTMLImageElement; return image.complete && image.naturalWidth > 0 }))).toBe(true)
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const box = element.getBoundingClientRect()
        return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
      }
        return { width: innerWidth, height: innerHeight, scrollY, documentWidth: document.documentElement.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, fontsStatus: document.fonts.status, intro: rect('.albums-year-intro, .albums-intro'), cover: rect('.albums-year-cover'), progress: rect('.albums-year-progress progress'), modes: rect('.albums-year-modes'), catalog: rect('.albums-catalog'), card: rect('.albums-card'), chips: rect('.albums-chips'), firstRow: rect('.albums-entry-card') }
    })
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage: name.startsWith('catalog-'), animations: 'disabled' })
    appendFileSync(join(dir, 'geometry.jsonl'), `${JSON.stringify({ name, ...geometry })}\n`)
  }

  await page.getByRole('button', { name: '‹ Альбомы', exact: true }).click()
  await expect(page.locator('[data-albums-route="catalog"]')).toBeVisible()
  await expect(page.locator('[data-albums-group]')).toHaveCount(3)
  await capture('catalog-empty-cover-390')
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await capture(`catalog-empty-cover-${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.albums-card').filter({ hasText: 'Первый год Миши' }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await expect(page.locator('.albums-timeline .albums-entry-card')).toHaveCount(12)
  const yearIntro = page.locator('.albums-year-intro')
  await expect(yearIntro).toContainText('Миша')
  await expect(yearIntro).toContainText('Первый год Миши')
  await expect(yearIntro).toContainText('0 из 12 месяцев заполнено')
  await expect(yearIntro.locator('progress')).toHaveJSProperty('value', 0)
  await capture('year-empty-390')
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await capture(`year-empty-${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })

  await page.getByRole('button', { name: 'Нам 1 месяц', exact: true }).click()
  await expect(page.locator('[data-albums-route="edit-entry"]')).toBeVisible()
  await page.getByLabel('История').fill('Первый синтетический момент')
  await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить фото в альбом' })).toBeVisible()
  const photoBytes = solidPng(24, 48, 240)
  await page.locator('#photo-composer-files').setInputFiles({ name: 'first-year-blue.png', mimeType: 'image/png', buffer: photoBytes })
  await page.getByRole('button', { name: 'Добавить в альбом (1)', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await expect(page.locator('.albums-timeline .albums-entry-row.is-filled')).toHaveCount(1)

  await page.getByRole('button', { name: 'Настройки альбома' }).click()
  await page.getByRole('button', { name: 'Выбрать обложку', exact: true }).click()
  await expect(page.locator('[data-albums-route="cover"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выбрать этот кадр обложкой' })).toBeVisible()
  await page.getByRole('button', { name: 'Выбрать этот кадр обложкой' }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await expect(yearIntro).toContainText('1 из 12 месяцев заполнено')
  await expect(yearIntro.locator('progress')).toHaveJSProperty('value', 1)
  await expect(yearIntro.locator('.albums-year-cover img')).toBeVisible()
  await expect.poll(() => yearIntro.locator('.albums-year-cover img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await capture('year-filled-390')
  await page.getByRole('button', { name: 'Все 12 месяцев', exact: true }).click()
  await expect(page.locator('.albums-month-overview .albums-entry-card')).toHaveCount(12)
  await capture('year-overview-390')
  await page.getByRole('button', { name: 'Линия времени', exact: true }).click()
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await capture(`year-filled-${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '‹ Альбомы', exact: true }).click()
  await expect(page.locator('[data-albums-group]')).toHaveCount(3)
  await expect(page.locator(`[data-albums-group="${lilyaId}"]`)).toContainText('Мастерская Лили')
  await expect(page.locator(`[data-albums-group="${lilyaId}"]`)).toContainText('Первые открытия Лили')
  await expect(page.locator(`[data-albums-group="${mishaId}"]`)).toContainText('Первый год Миши')
  await expect(page.locator('[data-albums-group="family"]')).toContainText('Семейная поездка')
  await expect(page.locator('.albums-card')).toHaveCount(4)
  await capture('catalog-filled-cover-390')
  for (const width of [320, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await capture(`catalog-filled-cover-${width}`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const albumCard = page.locator('.albums-card').filter({ hasText: 'Первый год Миши' })
  await albumCard.click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await page.getByRole('button', { name: 'Настройки альбома' }).click()
  await page.getByLabel('Название альбома').fill('Первый год Миши: первые двенадцать месяцев нашей семейной истории')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await expect(yearIntro).toContainText('Первый год Миши: первые двенадцать месяцев нашей семейной истории')
  await page.setViewportSize({ width: 320, height: 844 })
  await page.evaluate(() => document.documentElement.style.setProperty('font-size', '32px', 'important'))
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await capture('year-long-title-320-text-200')
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Нам 1 месяц', exact: true }).click()
  await expect(page.locator('[data-albums-route="entry"]')).toBeVisible()
  await expect(page.locator('.albums-entry-detail')).toContainText('Первый синтетический момент')
  await page.getByRole('button', { name: '‹ Назад', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await page.getByRole('button', { name: 'Нам 1 месяц', exact: true }).click()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('История').fill('Отредактированный синтетический момент')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await page.getByRole('button', { name: 'Нам 1 месяц', exact: true }).click()
  await page.getByRole('button', { name: 'Открыть материал 1', exact: true }).click()
  await expect(page.locator('[data-mixed-viewer]')).toBeVisible()
  await expect.poll(() => page.locator('[data-mixed-viewer] img').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const openMaterial = page.getByRole('button', { name: 'Открыть материал 1', exact: true })
  await page.getByRole('button', { name: 'Закрыть просмотр', exact: true }).click()
  await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
  await expect(openMaterial).toBeFocused()
  await page.getByRole('button', { name: 'Очистить главу', exact: true }).click()
  const clearConfirmation = page.getByRole('alertdialog')
  await expect(clearConfirmation).toContainText('Номер месяца и оригиналы сохранятся')
  await clearConfirmation.getByRole('button', { name: 'Очистить главу', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await expect(page.locator('.albums-timeline .albums-entry-row.is-filled')).toHaveCount(0)
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})

test('album new upload opens photos directly and central Add keeps its chooser', async ({ page }) => {
  await openSynthetic(page, 'albums=24&delayedPublish')
  await page.getByRole('button', { name: /У бабушки/ }).click()
  await page.getByRole('button', { name: 'Добавить историю', exact: true }).click()
  await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить фото в альбом', exact: true })).toBeVisible()
  await expect(page.getByText('Выберите материал для альбома.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Добавить фото', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Загрузить новое', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить фото в альбом', exact: true })).toBeVisible()
  const photoBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.locator('#photo-composer-files').setInputFiles({ name: 'synthetic-draft.png', mimeType: 'image/png', buffer: photoBytes })
  let photoConfirmation = ''
  page.once('dialog', async (dialog) => { photoConfirmation = dialog.message(); await dialog.dismiss() })
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить фото в альбом', exact: true })).toBeVisible()
  expect(photoConfirmation).toContain('Удалить несохранённые изменения?')
  page.once('dialog', async (dialog) => { await dialog.accept() })
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Загрузить новое', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Загрузить новое', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить фото в альбом', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(page.locator('[data-albums-route="album"]')).toBeVisible()
  await page.getByRole('button', { name: 'Семья', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Добавить воспоминание', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Добавить фото и видео', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Добавить голос или видео', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить заметку', exact: true }).click()
  await page.getByLabel('Текст заметки').fill('Черновик с подтверждением отмены')
  let confirmation = ''
  page.once('dialog', async (dialog) => { confirmation = dialog.message(); await dialog.dismiss() })
  await page.evaluate(() => (window as unknown as { __albumsTriggerBack: () => void }).__albumsTriggerBack())
  await expect(page.getByLabel('Текст заметки')).toHaveValue('Черновик с подтверждением отмены')
  expect(confirmation).toContain('Отменить изменения?')
  page.once('dialog', async (dialog) => { await dialog.accept() })
  await page.evaluate(() => (window as unknown as { __albumsTriggerBack: () => void }).__albumsTriggerBack())
  await expect(page.getByLabel('Текст заметки')).toHaveCount(0)
  await expect(page.locator('[data-navigation-surface="family"]')).toBeVisible()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить заметку', exact: true }).click()
  await page.getByLabel('Текст заметки').fill('Проверка закрытия чека Back-кнопкой')
  await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Сохранено в семейную ленту' })).toBeVisible()
  await page.evaluate(() => (window as unknown as { __albumsTriggerBack: () => void }).__albumsTriggerBack())
  await expect(page.getByRole('heading', { name: 'Сохранено в семейную ленту' })).toHaveCount(0)
  await expect(page.locator('[data-navigation-surface="family"]')).toBeVisible()
})

test('2000 works page progressively with bounded DOM, stable zoom anchor and source viewer return', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  await openSynthetic(page, 'albums=2000')
  await page.getByRole('button', { name: /Мастерская/ }).click()
  await expect(page.locator('.albums-workshop-wall')).toHaveAttribute('data-columns', '5')
  expect(await page.evaluate(() => (window as unknown as { __albumsEvidence: { entries: Map<string, unknown[]>; albums: { kind: string; id: string }[] } }).__albumsEvidence.entries.get((window as unknown as { __albumsEvidence: { albums: { kind: string; id: string }[] } }).__albumsEvidence.albums.find((album) => album.kind === 'workshop')!.id)!.length)).toBe(2000)
  for (let index = 0; index < 2; index += 1) {
    const more = page.getByRole('button', { name: 'Ещё истории', exact: true })
    await expect.poll(() => page.locator('[data-album-tile]').count()).toBeGreaterThan(0)
    expect(await page.locator('[data-album-tile]').count()).toBeLessThanOrEqual(320)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await more.click().catch(() => undefined)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __albumsEvidence: { log: { path: string }[] } }).__albumsEvidence.log.filter((entry) => /\/entries\?/.test(entry.path)).length)).toBeGreaterThan(index + 1)
  }
  const requests = await page.evaluate(() => (window as unknown as { __albumsEvidence: { log: { path: string }[]; rawPaths: string[] } }).__albumsEvidence)
  expect(requests.log.filter((entry) => /\/entries\?/.test(entry.path)).length).toBeGreaterThanOrEqual(3)
  expect(requests.rawPaths.every((path) => path.includes('variant=preview'))).toBe(true)
  await page.evaluate(() => { const wall = document.querySelector('.albums-workshop-wall')!; window.scrollTo(0, wall.getBoundingClientRect().top + window.scrollY + (wall as HTMLElement).offsetHeight * .4) })
  await page.waitForTimeout(80)
  const anchor = await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-album-tile]')).sort((a, b) => Math.abs(a.getBoundingClientRect().top + a.clientHeight / 2 - innerHeight / 2) - Math.abs(b.getBoundingClientRect().top + b.clientHeight / 2 - innerHeight / 2))[0]
    return { id: target.dataset.albumTile!, top: target.getBoundingClientRect().top }
  })
  await page.getByRole('button', { name: 'Уменьшить работы', exact: true }).click()
  await expect(page.locator('.albums-workshop-wall')).toHaveAttribute('data-columns', '8')
  await page.getByRole('button', { name: 'Увеличить работы', exact: true }).click()
  await expect(page.locator('.albums-workshop-wall')).toHaveAttribute('data-columns', '5')
  await page.getByRole('button', { name: 'Увеличить работы', exact: true }).click()
  await expect(page.locator('.albums-workshop-wall')).toHaveAttribute('data-columns', '3')
  await expect(page.locator(`[data-album-tile="${anchor.id}"]`)).toBeAttached()
  expect(await page.locator('[data-album-tile]').count()).toBeLessThanOrEqual(320)
  const target = page.locator(`[data-album-tile="${anchor.id}"]`)
  const targetId = anchor.id
  const targetTop = await target.evaluate((element) => element.getBoundingClientRect().top)
  await target.click()
  await expect(page.locator('[data-albums-route="entry"]')).toBeVisible()
  await page.getByRole('button', { name: 'Открыть материал 1', exact: true }).click()
  await expect(page.locator('[data-mixed-viewer]')).toBeVisible()
  await page.evaluate(() => (window as unknown as { __selectedFamilyUpdateAvatar: (mediaId: string, crop: null) => void }).__selectedFamilyUpdateAvatar('aaa00000-0000-4000-8000-000000000012', null))
  await page.evaluate(() => (window as unknown as { __albumsTriggerBack: () => void }).__albumsTriggerBack())
  await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label'))).toBe('Открыть материал 1')
  await page.getByRole('button', { name: '‹ Назад', exact: true }).click()
  await expect(page.locator(`[data-album-tile="${targetId}"]`)).toBeAttached()
  await expect(page.locator('.albums-workshop-wall')).toHaveAttribute('data-columns', '3')
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.albumTile)).toBe(targetId)
  const restoredTop = await page.locator(`[data-album-tile="${targetId}"]`).evaluate((element) => element.getBoundingClientRect().top)
  expect(Math.abs(restoredTop - targetTop)).toBeLessThan(4)
  expect(errors).toEqual([])
})

test('stale album detail and old account responses cannot replace the current route or scope', async ({ page }) => {
  await openSynthetic(page, 'albums=24&delayedAlbum')
  await page.getByRole('button', { name: /Первый год Алисы/ }).click()
  await page.getByRole('button', { name: '‹ Альбомы', exact: true }).click()
  await page.getByRole('button', { name: /Мастерская/ }).click()
  await page.waitForTimeout(1100)
  await expect(page.locator('.albums-intro h1')).toHaveText('Мастерская')
  await page.evaluate(() => (window as unknown as { __selectedFamilyChangeAccount: () => void }).__selectedFamilyChangeAccount())
  await expect(page.locator('[data-navigation-surface="feed"]')).toBeVisible()
  await expect(page.locator('[data-navigation-surface="albums"]')).toHaveCount(0)
})

test('album scope 404 revokes and clears private detail before a late read can settle', async ({ page }) => {
  await openSynthetic(page, 'albums=24')
  await page.getByRole('button', { name: /У бабушки/ }).click()
  await expect(page.getByRole('heading', { name: 'У бабушки', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'В саду', exact: true }).click()
  await expect(page.locator('.albums-entry-detail')).toContainText('Тёплый день у бабушки')
  await page.getByRole('button', { name: 'Открыть материал 1', exact: true }).click()
  await expect(page.locator('[data-mixed-viewer]')).toBeVisible()
  await page.evaluate(() => (window as unknown as { __albumsTriggerBack: () => void }).__albumsTriggerBack())
  await expect(page.locator('[data-mixed-viewer]')).toHaveCount(0)
  await page.getByRole('button', { name: '‹ Назад', exact: true }).click()

  await page.evaluate(() => (window as unknown as { __albumsRevokeOnNextRead: () => void }).__albumsRevokeOnNextRead())
  await page.getByRole('button', { name: 'Переместить историю 2 вверх', exact: true }).click()
  await expect(page.locator('[data-slot="family-hub"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Мои семьи', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Доступ к этой семье закрыт.')
  await expect(page.locator('[data-navigation-surface="albums"]')).toHaveCount(0)
  await expect(page.getByText('У бабушки', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Тёплый день у бабушки', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __albumsEvidence: { lateReadStarted: boolean } }).__albumsEvidence.lateReadStarted)).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __albumsEvidence: { lateReadCompleted: boolean } }).__albumsEvidence.lateReadCompleted), { timeout: 3000 }).toBe(true)
  await expect(page.locator('[data-navigation-surface="albums"]')).toHaveCount(0)
  await expect(page.getByText('Тёплый день у бабушки', { exact: true })).toHaveCount(0)
})

test('saved entry refresh scope loss returns home, while an ordinary source 404 stays recoverable', async ({ page }) => {
  await openSynthetic(page, 'albums=24')
  await page.getByRole('button', { name: /У бабушки/ }).click()
  await page.getByRole('button', { name: 'В саду', exact: true }).click()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('История').fill('Обновлённая запись перед потерей семейного доступа')
  await page.evaluate(() => (window as unknown as { __albumsRevokeOnNextRead: () => void }).__albumsRevokeOnNextRead())
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('[data-slot="family-hub"]')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Доступ к этой семье закрыт.')
  await expect(page.getByText('Обновлённая запись перед потерей семейного доступа', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __albumsEvidence: { lateReadCompleted: boolean } }).__albumsEvidence.lateReadCompleted), { timeout: 3000 }).toBe(true)

  await openSynthetic(page, 'albums=24')
  await page.getByRole('button', { name: /У бабушки/ }).click()
  await page.getByRole('button', { name: 'В саду', exact: true }).click()
  await page.getByRole('button', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('История').fill('Черновик должен сохраниться после ошибки каталога')
  await page.evaluate(() => (window as unknown as { __albumsFailNextPickerRead: () => void }).__albumsFailNextPickerRead())
  await page.getByRole('button', { name: 'Выбрать из воспоминаний', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить материалы. Выбор сохранён.')
  await expect(page.locator('.albums-picker')).toBeVisible()
  await expect(page.locator('[data-slot="family-hub"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Фото 1', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '‹ Назад', exact: true }).click()
  await expect(page.locator('.albums-editor')).toBeVisible()
  await expect(page.getByLabel('История')).toHaveValue('Черновик должен сохраниться после ошибки каталога')
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()
})

test('bottom navigation grows and wraps labels at 200% text without reducing touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/e2e/selected-family-app.harness.html?albums=24')
  const nav = page.getByTestId('bottom-navigation')
  await expect(nav).toBeVisible()
  const baseHeight = await nav.evaluate((element) => element.getBoundingClientRect().height)
  expect(baseHeight).toBe(50)
  await page.addStyleTag({ content: "nav[data-bottom-navigation-appearance='memoly'] [data-variant='memoryNav'] { font-size: 22px !important; line-height: 1.1 !important; }" })
  const dimensions = await nav.evaluate((element) => {
    const navRect = element.getBoundingClientRect()
    const buttons = [...element.querySelectorAll<HTMLElement>('[data-nav-position]')]
    const labels = buttons.map((button) => {
      const label = button.querySelector<HTMLElement>("[data-variant='memoryNav']")!
      const rect = label.getBoundingClientRect()
      return { text: label.textContent?.trim(), left: rect.left, right: rect.right, width: rect.width, scrollWidth: label.scrollWidth, buttonHeight: button.getBoundingClientRect().height }
    })
    return { navHeight: navRect.height, labels }
  })
  expect(dimensions.navHeight).toBeGreaterThan(baseHeight)
  expect(dimensions.labels).toHaveLength(5)
  expect(dimensions.labels.map((label) => label.text)).toEqual(['Лента', 'Альбомы', 'Добавить', 'Вишлист', 'Семья'])
  expect(dimensions.labels.every((label) => label.scrollWidth <= label.width + 1 && label.buttonHeight >= 44)).toBe(true)
  for (let index = 1; index < dimensions.labels.length; index += 1) expect(dimensions.labels[index - 1].right).toBeLessThanOrEqual(dimensions.labels[index].left + 1)
})

async function openSynthetic(page: Page, query: string) {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/e2e/selected-family-app.harness.html?${query}`)
  await page.getByRole('button', { name: 'Альбомы', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Альбомы', exact: true })).toBeVisible()
}

async function readImagePixel(image: Locator) {
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element) => {
    const imageElement = element as HTMLImageElement
    return imageElement.complete && imageElement.naturalWidth > 0
  })).toBe(true)
  return image.evaluate((element) => {
    const imageElement = element as HTMLImageElement
    const canvas = document.createElement('canvas')
    canvas.width = imageElement.naturalWidth
    canvas.height = imageElement.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(imageElement, 0, 0)
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
  })
}

function expectDominantColor(pixel: number[], color: 'red' | 'blue') {
  const dominantChannel = color === 'red' ? 0 : 2
  expect(pixel[dominantChannel]).toBeGreaterThan(200)
  pixel.forEach((channel, index) => { if (index !== dominantChannel) expect(channel).toBeLessThan(80) })
}

function solidPng(red: number, green: number, blue: number) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 2
  const imageData = Buffer.from([0, red, green, blue])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(imageData)), pngChunk('IEND', Buffer.alloc(0))])
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type, 'ascii')
  const checksumInput = Buffer.concat([name, data])
  let checksum = 0xffffffff
  for (const byte of checksumInput) {
    checksum ^= byte
    for (let bit = 0; bit < 8; bit += 1) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0)
  }
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  name.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE((checksum ^ 0xffffffff) >>> 0, 8 + data.length)
  return chunk
}

function signedInitData() {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: randomUUID(), user: JSON.stringify({ id: 8_000_000 + Math.floor(Math.random() * 1_000_000), first_name: 'Albums synthetic owner' }) })
  const check = [...fields].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('987654:max-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}

async function uploadAvatar(page: Page, headers: Record<string, string>, familyId: string) {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const reserve = await page.request.post(`/api/v1/families/${familyId}/uploads`, { headers, data: { purpose: 'child_avatar', kind: 'photo', contentType: 'image/png', byteSize: bytes.byteLength } })
  expect(reserve.status()).toBe(201)
  const ticket = await reserve.json()
  const upload = await page.request.put(ticket.upload.url, { headers: ticket.upload.headers, data: bytes }); expect(upload.status()).toBe(200)
  const finalized = await page.request.post(`/api/v1/families/${familyId}/uploads/${ticket.upload.uploadId}/finalize`, { headers }); expect(finalized.status()).toBe(200)
  return ticket.assetId as string
}
