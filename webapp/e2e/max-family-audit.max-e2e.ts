import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

const maxBotToken = '987654:max-family-audit-synthetic'
type MaxAuditWindow = Window & { __openedLinks: string[]; WebApp: { initData: string } }
type ApiFamily = { family: { id: string } }
type ApiChild = { child: { id: string } }
type ApiMemory = { id: string }
type ApiFamilyMember = { userId: string; version: number; role: 'full' | 'viewer' }

test('real PWA browser-link screen pairs through signed MAX initData and opens the authenticated family hub', async ({ browser, page }, testInfo) => {
  const browserLinkStarts: string[] = []
  const browserLinkRedeems: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/browser-link/start')) browserLinkStarts.push(request.url())
    if (/\/api\/v1\/auth\/browser-link\/\d+\/redeem$/.test(request.url())) browserLinkRedeems.push(request.url())
  })

  const startResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/browser-link/start'))
  await page.goto('/')
  await expect(page.getByText('Вход через MAX', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть MAX' })).toBeVisible()
  await expect.poll(() => browserLinkStarts.length).toBe(1)
  const startResponse = await startResponsePromise
  const challenge = await startResponse.json() as { challengeId: string; startParam: string }
  expect(challenge.startParam).toBe(`browser_${challenge.challengeId}`)
  await expect(page.getByRole('link', { name: 'Открыть MAX' })).toHaveAttribute('href', new RegExp(`startapp=${challenge.startParam}`))

  const maxContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const maxPage = await maxContext.newPage()
  await maxContext.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', {
      configurable: true,
      value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} },
    })
  }, signedMaxInitData({ id: 740001, first_name: 'MAX PWA actor' }, randomUUID(), challenge.startParam))

  await maxPage.goto('/')
  await expect(maxPage.getByRole('heading', { name: 'Подтвердить вход' })).toBeVisible()
  await expect(maxPage.getByText(challenge.challengeId.slice(0, 6), { exact: true })).toBeVisible()
  const approvalResponsePromise = maxPage.waitForResponse((response) => response.url().includes(`/api/v1/auth/browser-link/${challenge.challengeId}/approve`))
  await maxPage.getByRole('button', { name: 'Подтвердить вход' }).click()
  const approvalResponse = await approvalResponsePromise
  if (!approvalResponse.ok()) throw new Error(`MAX browser-link approval failed ${approvalResponse.status()}: ${await approvalResponse.text()}`)
  expect(await approvalResponse.json()).toMatchObject({ approved: true })
  await expect(maxPage.getByText('Вход в браузере подтверждён.', { exact: false })).toBeVisible()
  await expect.poll(() => browserLinkRedeems.length).toBe(1)

  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: testInfo.outputPath('max-family-audit-pwa-authenticated-hub.png'), fullPage: true })
  await maxContext.close()
})

test('MAX invited viewer sees existing note, photo album and voice history after join', async ({ browser, page }, testInfo) => {
  const ownerId = 7_400_000 + Math.floor(Math.random() * 100_000)
  let ownerToken = ''
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/v1/auth/max') && response.ok()) ownerToken = (await response.json()).accessToken
  })
  await page.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} } })
  }, signedMaxInitData({ id: ownerId, first_name: 'Feed owner' }, randomUUID(), ''))
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => ownerToken).not.toBe('')

  const familyResponse = await page.request.post('/api/v1/families', {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { name: 'MAX prejoin feed', timezone: 'Europe/Moscow' },
  })
  expect(familyResponse.status()).toBe(201)
  const family = await familyResponse.json() as ApiFamily
  const avatarAsset = await uploadPng(page, ownerToken, family.family.id, 'child_avatar')
  const childResponse = await page.request.put(`/api/v1/families/${family.family.id}/child`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { name: 'Feed child', birthDate: '2024-01-02', sex: 'girl', avatarMediaId: avatarAsset, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null },
  })
  expect(childResponse.status()).toBe(200)
  const childId = ((await childResponse.json()) as ApiChild).child.id
  const photoIds = [await uploadPng(page, ownerToken, family.family.id, 'memory'), await uploadPng(page, ownerToken, family.family.id, 'memory')]
  const note = await page.request.post(`/api/v1/families/${family.family.id}/memories`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { kind: 'note', childId, body: 'Prejoin feed note', occurredAt: '2026-01-02T10:00:00.000Z' },
  })
  expect(note.status()).toBe(201)
  const album = await page.request.post(`/api/v1/families/${family.family.id}/memories`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { kind: 'photo', childId, body: 'Prejoin photo album', occurredAt: '2026-01-01T10:00:00.000Z', mediaIds: photoIds },
  })
  expect(album.status()).toBe(201)
  const voiceAsset = await uploadMedia(page, ownerToken, family.family.id, 'voice', 'audio/ogg', createOggVoiceFixture())
  const voice = await page.request.post(`/api/v1/families/${family.family.id}/memories`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { kind: 'voice', childId, body: 'Prejoin voice memo', occurredAt: '2026-01-03T10:00:00.000Z', mediaIds: [voiceAsset] },
  })
  expect(voice.status()).toBe(201)

  const invite = await page.request.post(`/api/v1/families/${family.family.id}/invites`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() }, data: { role: 'viewer' },
  })
  expect(invite.status()).toBe(201)
  const rawInvite = (await invite.json() as { rawToken: string }).rawToken
  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  const guestId = ownerId + 1
  await guestContext.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} } })
  }, signedMaxInitData({ id: guestId, first_name: 'Feed viewer' }, randomUUID(), `invite_${rawInvite}`))
  const guestAuthPromise = guestPage.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.ok())
  await guestPage.goto('/')
  await guestPage.getByRole('button', { name: 'Продолжить' }).click()
  await expect(guestPage.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible({ timeout: 15_000 })
  const guestAuth = await guestAuthPromise
  const guestToken = ((await guestAuth.json()) as { accessToken: string }).accessToken
  const unpublished = await guestPage.request.get(`/api/v1/families/${family.family.id}/memories`, { headers: { Authorization: `Bearer ${guestToken}` } })
  expect(unpublished.status()).toBe(404)
  await guestPage.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(guestPage.getByText('Prejoin feed note')).toBeVisible({ timeout: 15_000 })
  await expect(guestPage.getByText('Prejoin photo album')).toBeVisible()
  await expect(guestPage.getByText('Prejoin voice memo')).toBeVisible()
  const albumCard = guestPage.locator(`[data-memory-id="${(await album.json() as ApiMemory).id}"]`)
  await expect(albumCard.locator('[data-carousel-position]')).toHaveCount(2)
  await expect(guestPage.locator('[data-slot="voice-player"]')).toBeVisible()
  await expect(guestPage.getByRole('button', { name: 'Воспроизвести голосовое' })).toBeVisible()
  await expect(guestPage.locator('[data-slot="child-avatar-image"]')).toBeVisible()
  const feed = await guestPage.request.get(`/api/v1/families/${family.family.id}/memories`, { headers: { Authorization: `Bearer ${guestToken}` } })
  expect(feed.status()).toBe(200)
  expect((await feed.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(expect.arrayContaining([
    (await note.json() as ApiMemory).id, (await album.json() as ApiMemory).id, (await voice.json() as ApiMemory).id,
  ]))
  await guestPage.screenshot({ path: testInfo.outputPath('max-family-audit-invited-feed-media.png'), fullPage: true })
  await guestContext.close()
})

test('MAX owner retries a lost invite response with one idempotency key and invited viewer sees pre-join history', async ({ browser, page }, testInfo) => {
  const ownerMaxId = 7_500_000 + Math.floor(Math.random() * 100_000)
  const ownerInitData = signedMaxInitData({ id: ownerMaxId, first_name: 'Audit owner' }, randomUUID(), '')
  let ownerToken = ''
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/v1/auth/max') && response.ok()) ownerToken = (await response.json()).accessToken
  })
  await page.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} } })
  }, ownerInitData)
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => ownerToken).not.toBe('')

  const familyResponse = await page.request.post('/api/v1/families', {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { name: 'MAX audit family', timezone: 'Europe/Moscow' },
  })
  expect(familyResponse.status()).toBe(201)
  const family = await familyResponse.json() as ApiFamily
  const avatarAsset = await uploadPng(page, ownerToken, family.family.id, 'child_avatar')
  const childResponse = await page.request.put(`/api/v1/families/${family.family.id}/child`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { name: 'Audit child', birthDate: '2024-01-02', sex: 'girl', avatarMediaId: avatarAsset, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null },
  })
  expect(childResponse.status()).toBe(200)
  const completedFamily = await childResponse.json() as ApiChild
  const childId = completedFamily.child.id as string
  const photoAsset = await uploadPng(page, ownerToken, family.family.id, 'memory')
  const noteResponse = await page.request.post(`/api/v1/families/${family.family.id}/memories`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { kind: 'note', childId, body: 'MAX pre-join note', occurredAt: '2026-01-02T10:00:00.000Z' },
  })
  expect(noteResponse.status()).toBe(201)
  const photoResponse = await page.request.post(`/api/v1/families/${family.family.id}/memories`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { kind: 'photo', childId, body: '', occurredAt: '2026-01-01T10:00:00.000Z', mediaIds: [photoAsset] },
  })
  expect(photoResponse.status()).toBe(201)

  // Reauthenticate after the simulated restart with fresh signed MAX initData.
  await page.evaluate((data) => { (window as unknown as MaxAuditWindow).WebApp.initData = data }, signedMaxInitData({ id: ownerMaxId, first_name: 'Audit owner' }, randomUUID(), ''))
  await page.reload()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('button', { name: /MAX audit family/ })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /MAX audit family/ }).click()
  await page.getByRole('button', { name: 'Семья' }).click()
  await expect(page.getByRole('button', { name: 'Пригласить родственника' })).toBeVisible()
  await page.getByRole('button', { name: 'Пригласить родственника' }).click()

  const keys: string[] = []
  let committedInvite: { rawToken: string } | undefined
  let failFirstResponse = true
  let inviteCommitted!: () => void
  let releaseInvite!: () => void
  const inviteRequestCommitted = new Promise<void>((resolve) => { inviteCommitted = resolve })
  const holdInviteResponse = new Promise<void>((resolve) => { releaseInvite = resolve })
  await page.route(`**/api/v1/families/${family.family.id}/invites`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    keys.push(route.request().headers()['idempotency-key'] ?? '')
    const committed = await route.fetch()
    const payload = await committed.json()
    if (failFirstResponse) {
      failFirstResponse = false
      committedInvite = payload
      inviteCommitted()
      await holdInviteResponse
      await route.abort('connectionreset')
      return
    }
    await route.fulfill({ response: committed, json: payload })
  })
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  await inviteRequestCommitted
  await expect(page.getByRole('button', { name: 'Назад' })).toBeDisabled()
  releaseInvite()
  await expect(page.getByRole('alert').getByText('Не удалось создать приглашение. Попробуйте ещё раз.')).toBeVisible()
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(page.getByRole('heading', { name: 'Ссылка готова' })).toBeVisible()
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBeTruthy()
  expect(keys[1]).toBe(keys[0])
  expect(committedInvite?.rawToken).toBeTruthy()
  const committedRawToken = committedInvite?.rawToken
  if (!committedRawToken) throw new Error('Committed invite token is absent after the successful retry')
  const countAfterRetry = await page.request.get(`/api/v1/families/${family.family.id}/invites`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  expect((await countAfterRetry.json() as { items: unknown[] }).items).toHaveLength(1)

  await page.getByRole('button', { name: 'Назад' }).click()
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(page.getByRole('heading', { name: 'Ссылка готова' })).toBeVisible()
  expect(keys).toHaveLength(3)
  expect(keys[2]).not.toBe(keys[1])
  const countAfterNewOperation = await page.request.get(`/api/v1/families/${family.family.id}/invites`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  expect((await countAfterNewOperation.json() as { items: unknown[] }).items).toHaveLength(2)

  await page.getByRole('button', { name: 'Назад' }).click()
  let failInviteRefresh = true
  await page.route(`**/api/v1/families/${family.family.id}`, async (route) => {
    if (route.request().method() === 'GET' && failInviteRefresh) {
      failInviteRefresh = false
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY_FAILURE', message: 'synthetic post-invite read failure' } }) })
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(page.getByRole('heading', { name: 'Ссылка готова' })).toBeVisible()
  await expect(page.getByLabel('Ссылка приглашения')).toHaveValue(/https?:\/\//)
  const postsBeforeReadRetry = keys.length
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByText('Изменение сохранено, но данные семьи не удалось обновить. Повторите только обновление данных.')).toBeVisible()
  await page.getByRole('button', { name: 'Обновить данные' }).click()
  await expect(page.getByText('Изменение сохранено, но данные семьи не удалось обновить. Повторите только обновление данных.')).toHaveCount(0)
  expect(keys).toHaveLength(postsBeforeReadRetry)

  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.getByRole('button', { name: /Настройки семьи/ }).click()
  const settingsName = page.getByLabel('Название семьи')
  await settingsName.fill('MAX audit family updated')
  let familyPatches = 0
  let failFamilyRead = true
  await page.route(`**/api/v1/families/${family.family.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      familyPatches += 1
      return route.continue()
    }
    if (route.request().method() === 'GET' && failFamilyRead) {
      failFamilyRead = false
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY_FAILURE', message: 'synthetic post-save read failure' } }) })
      return
    }
    return route.continue()
  })
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByText('Изменение сохранено, но данные семьи не удалось обновить. Повторите только обновление данных.')).toBeVisible()
  await expect(page.getByText('Не удалось сохранить настройки семьи. Обновите данные и попробуйте снова.')).toHaveCount(0)
  expect(familyPatches).toBe(1)
  await page.screenshot({ path: testInfo.outputPath('max-family-audit-saved-refresh-failed.png'), fullPage: true })
  await page.getByRole('button', { name: 'Обновить данные' }).click()
  await expect(page.getByText('Изменение сохранено, но данные семьи не удалось обновить. Повторите только обновление данных.')).toHaveCount(0)
  expect(familyPatches).toBe(1)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page.locator('.family-overview-body .family-error')).toHaveCount(0)

  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  await guestContext.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} } })
  }, signedMaxInitData({ id: ownerMaxId + 1, first_name: 'MAX invited viewer' }, randomUUID(), `invite_${committedRawToken}`))
  const guestAuthResponsePromise = guestPage.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.ok())
  await guestPage.goto('/')
  await guestPage.getByRole('button', { name: 'Продолжить' }).click()
  await expect(guestPage.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible({ timeout: 15_000 })
  await expect(guestPage.getByText(/До вступления семейные фотографии/)).toBeVisible()
  const authResponse = await guestAuthResponsePromise
  const guestToken = (await authResponse.json()).accessToken
  const prejoinFeed = await guestPage.request.get(`/api/v1/families/${family.family.id}/memories`, { headers: { Authorization: `Bearer ${guestToken}` } })
  expect(prejoinFeed.status()).toBe(404)
  await guestPage.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(guestPage.getByText('MAX pre-join note')).toBeVisible({ timeout: 15_000 })
  await expect(guestPage.locator('[data-navigation-surface="feed"]')).toBeVisible()
  const guestFeed = await guestPage.request.get(`/api/v1/families/${family.family.id}/memories`, { headers: { Authorization: `Bearer ${guestToken}` } })
  expect(guestFeed.status()).toBe(200)
  expect((await guestFeed.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toContain((await noteResponse.json() as ApiMemory).id)
  await expect(guestPage.getByText('MAX pre-join note')).toBeVisible()
  await guestPage.getByRole('button', { name: 'Семья' }).click()
  await expect(guestPage.locator('[data-slot="family-presentation"]')).toBeVisible()
  await expect(guestPage.getByRole('button', { name: 'Пригласить родственника' })).toHaveCount(0)
  const ownerMembers = await page.request.get(`/api/v1/families/${family.family.id}/members`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  const guestMe = await guestPage.request.get('/api/v1/me', { headers: { Authorization: `Bearer ${guestToken}` } })
  const guestUserId = (await guestMe.json() as { user: { id: string } }).user.id
  const guestMember = (await ownerMembers.json() as { items: ApiFamilyMember[] }).items.find((item) => item.userId === guestUserId)
  if (!guestMember) throw new Error('Joined viewer is absent from the owner member list')
  const promote = await page.request.patch(`/api/v1/families/${family.family.id}/members/${guestMember.userId}`, {
    headers: { Authorization: `Bearer ${ownerToken}` }, data: { role: 'full', expectedVersion: guestMember.version },
  })
  expect(promote.status()).toBe(200)
  expect(promote.status()).toBe(200)
  const promotionHome = guestPage.waitForResponse((response) => response.url().endsWith('/api/v1/me/families') && response.ok())
  const promotionMembers = guestPage.waitForResponse((response) => response.url().endsWith(`/api/v1/families/${family.family.id}/members`) && response.ok())
  await guestPage.evaluate(() => window.dispatchEvent(new Event('online')))
  const promotionHomeResponse = await promotionHome
  const promotionHomeSnapshot = (await promotionHomeResponse.json() as { items: Array<{ familyId: string; role: string; membershipEpoch: number }> }).items.find((item) => item.familyId === family.family.id)
  if (!promotionHomeSnapshot) throw new Error('Promoted family is absent from the viewer home list')
  expect(promotionHomeSnapshot.role).toBe('full')
  const startingMembershipEpoch = promotionHomeSnapshot.membershipEpoch
  await promotionMembers
  await expect(guestPage.getByRole('button', { name: 'Добавить', exact: true })).toBeVisible()
  await guestPage.getByRole('button', { name: new RegExp(`Открыть участника: MAX invited viewer`) }).click()
  await guestPage.getByLabel('Имя в семье').fill('Новая версия участника')
  await guestPage.getByRole('button', { name: 'Сохранить изменения' }).click()
  await expect(guestPage.getByText('Новая версия участника')).toBeVisible()
  const currentMembers = await page.request.get(`/api/v1/families/${family.family.id}/members`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  const currentGuestMember = (await currentMembers.json() as { items: ApiFamilyMember[] }).items.find((item) => item.userId === guestMember.userId)
  if (!currentGuestMember) throw new Error('Promoted viewer is absent from the owner member list')
  const demotion = await page.request.patch(`/api/v1/families/${family.family.id}/members/${guestMember.userId}`, {
    headers: { Authorization: `Bearer ${ownerToken}` }, data: { role: 'viewer', expectedVersion: currentGuestMember.version },
  })
  expect(demotion.status()).toBe(200)
  const demotionHome = guestPage.waitForResponse((response) => response.url().endsWith('/api/v1/me/families') && response.ok())
  const demotionMembers = guestPage.waitForResponse((response) => response.url().endsWith(`/api/v1/families/${family.family.id}/members`) && response.ok())
  await guestPage.evaluate(() => window.dispatchEvent(new Event('online')))
  const demotionHomeResponse = await demotionHome
  const demotionHomeSnapshot = (await demotionHomeResponse.json() as { items: Array<{ familyId: string; role: string; membershipEpoch: number }> }).items.find((item) => item.familyId === family.family.id)
  if (!demotionHomeSnapshot) throw new Error('Demoted family is absent from the viewer home list')
  expect(demotionHomeSnapshot.role).toBe('viewer')
  expect(demotionHomeSnapshot.membershipEpoch).toBe(startingMembershipEpoch)
  const demotionMembersResponse = await demotionMembers
  expect((await demotionMembersResponse.json() as { items: ApiFamilyMember[] }).items.find((item) => item.userId === guestMember.userId)?.role).toBe('viewer')
  await expect(guestPage.getByRole('button', { name: 'Добавить', exact: true })).toHaveCount(0)
  await guestPage.screenshot({ path: testInfo.outputPath('max-family-audit-invited-viewer-feed.png'), fullPage: true })
  await guestContext.close()
})

test('MAX voice handoff opens the supported MAX bot through hostBridge', async ({ page }, testInfo) => {
  const maxId = 7_600_000 + Math.floor(Math.random() * 100_000)
  const openedLinks: string[] = []
  const unsupportedRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/^(?:t\.me|telegram\.me|api\.telegram\.org)$/i.test(url.hostname) || /\/api\/auth(?:\/|$)/.test(url.pathname)) unsupportedRequests.push(request.url())
  })
  const initData = signedMaxInitData({ id: maxId, first_name: 'MAX voice handoff' }, randomUUID(), '')
  await page.addInitScript((data: string) => {
    const testWindow = window as unknown as Window & { __openedLinks: string[] }
    testWindow.__openedLinks = []
    Object.defineProperty(testWindow, 'WebApp', { configurable: true, value: {
      initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {},
      openLink(url: string) { testWindow.__openedLinks.push(url) },
      initDataUnsafe: {},
    } })
  }, initData)
  const authResponsePromise = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max') && response.ok())
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible({ timeout: 15_000 })
  const authResponse = await authResponsePromise
  const ownerToken = (await authResponse.json() as { accessToken: string }).accessToken
  const familyResponse = await page.request.post('/api/v1/families', {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() },
    data: { name: 'MAX voice handoff family', timezone: 'Europe/Moscow' },
  })
  expect(familyResponse.status()).toBe(201)
  const family = await familyResponse.json() as ApiFamily
  const avatarAsset = await uploadPng(page, ownerToken, family.family.id, 'child_avatar')
  const childResponse = await page.request.put(`/api/v1/families/${family.family.id}/child`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { name: 'Audit child', birthDate: '2024-01-02', sex: 'girl', avatarMediaId: avatarAsset,
      avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null },
  })
  expect(childResponse.status()).toBe(200)

  await page.evaluate((data) => { (window as unknown as MaxAuditWindow).WebApp.initData = data }, signedMaxInitData({ id: maxId, first_name: 'MAX voice handoff' }, randomUUID(), ''))
  await page.reload()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await page.getByRole('button', { name: /MAX voice handoff family/ }).click()
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить голос или видео' }).click()
  await expect(page.getByRole('button', { name: 'Открыть MAX' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть бота' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('max-family-audit-voice-handoff.png'), fullPage: true })
  await page.getByRole('button', { name: 'Открыть MAX' }).click()
  openedLinks.push(...await page.evaluate(() => (window as unknown as MaxAuditWindow).__openedLinks))
  expect(openedLinks).toEqual(['https://max.ru/OurMemoriesMaxBot'])
  expect(unsupportedRequests).toEqual([])
})

test('MAX user can leave a terminal unavailable invitation and continue to My Families without accepting it', async ({ page }) => {
  const maxId = 7_700_000 + Math.floor(Math.random() * 100_000)
  let acceptRequests = 0
  await page.route('**/api/v1/invites/accept', async (route) => { acceptRequests += 1; await route.continue() })
  await page.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} } })
  }, signedMaxInitData({ id: maxId, first_name: 'MAX terminal invite' }, randomUUID(), `invite_${'x'.repeat(43)}`))
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('heading', { name: 'Приглашение недоступно' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Мои семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible()
  expect(acceptRequests).toBe(0)
})

test('MAX documented invite launch authenticates current identity and opens the invited family despite its incomplete own family', async ({ browser, page }) => {
  const recipientId = 7_750_000 + Math.floor(Math.random() * 100_000)
  const inviterId = recipientId + 200_000
  const recipientContext = await browser.newContext()
  const recipientPage = await recipientContext.newPage()
  const recipientToken = await signInMax(recipientPage, { id: recipientId, first_name: 'Invite recipient' })
  const ownFamilyResponse = await recipientPage.request.post('/api/v1/families', {
    headers: { Authorization: `Bearer ${recipientToken}`, 'Idempotency-Key': randomUUID() },
    data: { name: 'Recipient incomplete family', timezone: 'Europe/Moscow' },
  })
  expect(ownFamilyResponse.status()).toBe(201)

  const inviterToken = await signInMax(page, { id: inviterId, first_name: 'Invite owner' })
  const invitedFamily = await createAuditFamily(page, inviterToken, 'Exact invited family', 'Invited child', 'Invited family history')
  const inviteResponse = await page.request.post(`/api/v1/families/${invitedFamily.id}/invites`, {
    headers: { Authorization: `Bearer ${inviterToken}`, 'Idempotency-Key': randomUUID() }, data: { role: 'viewer' },
  })
  expect(inviteResponse.status()).toBe(201)
  const rawInvite = (await inviteResponse.json() as { rawToken: string }).rawToken
  const recipientState = await recipientContext.storageState()

  const launchContext = await browser.newContext({ storageState: recipientState })
  await launchContext.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', {
      configurable: true,
      value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} },
    })
  }, signedMaxInitData({ id: recipientId, first_name: 'Invite recipient' }, randomUUID(), null))
  const launchPage = await launchContext.newPage()
  const authRequests: string[] = []
  const previewRequests: string[] = []
  let failFirstPreview = true
  launchPage.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/max')) authRequests.push(request.url())
    if (request.url().endsWith('/api/v1/invites/preview')) previewRequests.push(request.url())
  })
  await launchPage.route('**/api/v1/invites/preview', async (route) => {
    if (!failFirstPreview) return route.continue()
    failFirstPreview = false
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
      error: { code: 'INTERNAL_ERROR', message: 'synthetic preview failure', requestId: randomUUID() },
    }) })
  })
  await launchPage.goto(`/?WebAppStartParam=invite_${rawInvite}`)

  await expect(launchPage.getByRole('heading', { name: 'Приглашение недоступно' })).toBeVisible({ timeout: 15_000 })
  await expect(launchPage.getByText('Recipient incomplete family')).toHaveCount(0)
  await expect(launchPage.getByRole('button', { name: 'Создать свою семью' })).toHaveCount(0)
  expect(authRequests).toHaveLength(1)
  expect(previewRequests).toHaveLength(1)
  await launchPage.getByRole('button', { name: 'Повторить' }).click()
  await expect(launchPage.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible({ timeout: 15_000 })
  expect(previewRequests).toHaveLength(2)
  await launchPage.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(launchPage.getByText('Invited family history', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(launchPage.getByText('Recipient incomplete family')).toHaveCount(0)

  await launchContext.close()
  await recipientContext.close()
})

test('MAX malformed invite intent stays on the invitation issue flow instead of own-family creation', async ({ page }) => {
  const maxId = 7_760_000 + Math.floor(Math.random() * 100_000)
  let familyCreates = 0
  await page.route('**/api/v1/families', async (route) => {
    if (route.request().method() === 'POST') familyCreates += 1
    await route.continue()
  })
  await page.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} } })
  }, signedMaxInitData({ id: maxId, first_name: 'MAX malformed invite' }, randomUUID(), null))
  await page.goto('/?WebAppStartParam=invite_short')
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('heading', { name: 'Приглашение недоступно' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Создать свою семью' })).toHaveCount(0)
  expect(familyCreates).toBe(0)
})

test('MAX-FULL: owner switches family data while an older feed response is pending', async ({ browser, page }, testInfo) => {
  const actorId = 7_800_000 + Math.floor(Math.random() * 100_000)
  const hostId = actorId + 200_000
  const actorToken = await signInMax(page, { id: actorId, first_name: 'MAX family owner' })
  const familyA = await createAuditFamily(page, actorToken, 'Same name family', 'Family A child', 'A-only history')

  const hostContext = await browser.newContext()
  const hostPage = await hostContext.newPage()
  const hostToken = await signInMax(hostPage, { id: hostId, first_name: 'MAX B owner' })
  const familyB = await createAuditFamily(hostPage, hostToken, 'Same name family', 'Family B child', 'B-only history')
  const inviteResponse = await hostPage.request.post(`/api/v1/families/${familyB.id}/invites`, {
    headers: { Authorization: `Bearer ${hostToken}`, 'Idempotency-Key': randomUUID() }, data: { role: 'viewer' },
  })
  expect(inviteResponse.status()).toBe(201)
  const rawInvite = (await inviteResponse.json() as { rawToken: string }).rawToken

  const inviteContext = await browser.newContext()
  const invitePage = await inviteContext.newPage()
  await signInMax(invitePage, { id: actorId, first_name: 'MAX family owner' }, `invite_${rawInvite}`)
  await expect(invitePage.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible({ timeout: 15_000 })
  await invitePage.getByRole('button', { name: 'Присоединиться' }).click()
  await selectFamilyFeed(invitePage, 'Family B child', 'B-only history')
  await expect(invitePage.getByText('A-only history')).toHaveCount(0)
  await invitePage.screenshot({ path: testInfo.outputPath('max-family-audit-same-name-family-b.png'), fullPage: true })
  await expect(invitePage.locator('[data-navigation-surface="feed"]')).toBeVisible()
  await invitePage.locator('[data-child-header-mode="feed"] .ui-v2-child-identity').click()
  await expect(invitePage.locator('[data-navigation-surface="feed"]')).toBeVisible()
  await expect(invitePage.getByRole('button', { name: 'Мои семьи' })).toBeVisible()
  await invitePage.getByRole('button', { name: 'Мои семьи' }).click()
  await expect(invitePage.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 15_000 })
  await expect(invitePage.getByText('Цифра рядом — новые воспоминания для вас')).toHaveCount(0)
  await expect(invitePage.getByText('Близкие рядом, даже на расстоянии')).toHaveCount(0)

  await openFamilyChooser(invitePage)
  const familyACard = invitePage.getByRole('button', { name: /Family A child.*Владелец/ })
  const familyBCard = invitePage.getByRole('button', { name: /Family B child.*Просмотр/ })
  await expect(familyACard).toBeVisible()
  await expect(familyBCard).toBeVisible()
  await selectFamilyFeed(invitePage, 'Family A child', 'A-only history')
  await expect(invitePage.getByText('B-only history')).toHaveCount(0)

  let holdNextFamilyBFeed = true
  let responseHeld!: () => void
  let releaseResponse!: () => void
  const held = new Promise<void>((resolve) => { responseHeld = resolve })
  const release = new Promise<void>((resolve) => { releaseResponse = resolve })
  await invitePage.route(`**/api/v1/families/${familyB.id}/memories*`, async (route) => {
    if (holdNextFamilyBFeed && route.request().method() === 'GET') {
      holdNextFamilyBFeed = false
      const response = await route.fetch()
      responseHeld()
      await release
      await route.fulfill({ response })
      return
    }
    await route.continue()
  })
  const deliveredFamilyBFeed = invitePage.waitForResponse((response) => response.url().includes(`/api/v1/families/${familyB.id}/memories`) && response.request().method() === 'GET' && response.ok())
  try {
    await openFamilyChooser(invitePage)
    await familyBCard.click()
    await held
    await selectFamilyFeed(invitePage, 'Family A child', 'A-only history')
  } finally {
    releaseResponse()
  }
  await deliveredFamilyBFeed
  await expect(invitePage.getByText('A-only history')).toBeVisible()
  await expect(invitePage.getByText('B-only history')).toHaveCount(0)
  await invitePage.screenshot({ path: testInfo.outputPath('max-family-audit-family-a-after-pending-b-feed.png'), fullPage: true })

  await invitePage.getByRole('button', { name: 'Семья' }).click()
  await invitePage.getByRole('button', { name: 'Настройки' }).click()
  await invitePage.getByRole('button', { name: /Настройки семьи/ }).click()
  await invitePage.getByLabel('Название семьи').fill('Same name family updated')
  let patchCommitted!: () => void
  let releasePatch!: () => void
  let patchResponseSent!: () => void
  const committed = new Promise<void>((resolve) => { patchCommitted = resolve })
  const holdPatch = new Promise<void>((resolve) => { releasePatch = resolve })
  const patchSettled = new Promise<void>((resolve) => { patchResponseSent = resolve })
  let familyAReads = 0
  await invitePage.route(`**/api/v1/families/${familyA.id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      const response = await route.fetch()
      patchCommitted()
      await holdPatch
      await route.fulfill({ response })
      patchResponseSent()
      return
    }
    if (route.request().method() === 'GET') familyAReads += 1
    await route.continue()
  })
  try {
    await invitePage.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await committed
    await invitePage.getByRole('button', { name: 'Назад' }).click()
    await invitePage.keyboard.press('Escape')
    await selectFamilyFeed(invitePage, 'Family B child', 'B-only history')
    releasePatch()
    await patchSettled
    await expect(invitePage.getByText('B-only history')).toBeVisible()
    await expect(invitePage.getByText('A-only history')).toHaveCount(0)
    expect(familyAReads).toBe(0)
    await invitePage.screenshot({ path: testInfo.outputPath('max-family-audit-family-b-after-stale-family-save.png'), fullPage: true })
  } finally {
    releasePatch()
  }
  await inviteContext.close()
  await hostContext.close()
})

test('MAX-FULL: revoked viewer loses family access and rejoins with retained history', async ({ browser, page }, testInfo) => {
  const viewerId = 7_900_000 + Math.floor(Math.random() * 80_000)
  const ownerId = viewerId + 100_000
  const ownerToken = await signInMax(page, { id: ownerId, first_name: 'MAX revocation owner' })
  const familyB = await createAuditFamily(page, ownerToken, 'Revoked B family', 'B child', 'B retained history', true)
  await page.evaluate((data) => { (window as unknown as MaxAuditWindow).WebApp.initData = data }, signedMaxInitData({ id: ownerId, first_name: 'MAX revocation owner' }, randomUUID(), ''))
  const retainedHomeResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/me/families') && response.ok())
  await page.reload()
  const retainedHome = await retainedHomeResponse
  const retainedHomeSnapshot = await retainedHome.json() as { items: Array<{ familyId: string }> }
  expect(retainedHomeSnapshot.items.some((item) => item.familyId === familyB.id)).toBe(true)
  await expect(page.getByRole('button', { name: /Revoked B family/ })).toBeVisible()
  await selectFamilyFeed(page, 'B child', 'B retained history')
  await page.getByRole('button', { name: 'Семья' }).click()
  await page.getByRole('button', { name: 'Редактировать профиль ребёнка: B child' }).click()
  await expect(page.locator('[data-slot="child-profile-editor"]')).toBeVisible()
  await expect(page.getByLabel('Имя ребёнка')).toHaveValue('B child')
  await page.getByLabel('Имя ребёнка').fill('B child updated')
  await page.getByLabel('Дата рождения').fill('2022-07-06')
  await page.getByRole('radio', { name: /Мальчик/ }).check()
  const childSave = page.waitForResponse((response) => response.url().endsWith(`/api/v1/families/${familyB.id}/child`) && response.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Сохранить профиль' }).click()
  const childSaveResponse = await childSave
  expect(childSaveResponse.status()).toBe(200)
  expect(await childSaveResponse.json()).toMatchObject({ child: { name: 'B child updated', birthDate: '2022-07-06', sex: 'boy' } })
  await expect(page.getByRole('button', { name: 'Редактировать профиль ребёнка: B child updated' })).toBeVisible()
  const initialInviteResponse = await page.request.post(`/api/v1/families/${familyB.id}/invites`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() }, data: { role: 'viewer' },
  })
  expect(initialInviteResponse.status()).toBe(201)
  const initialInvite = (await initialInviteResponse.json() as { rawToken: string }).rawToken

  const viewerSetupContext = await browser.newContext()
  const viewerSetupPage = await viewerSetupContext.newPage()
  const viewerSetupToken = await signInMax(viewerSetupPage, { id: viewerId, first_name: 'MAX revocation viewer' })
  const familyA = await createAuditFamily(viewerSetupPage, viewerSetupToken, 'Unaffected A family', 'A child', 'A remains available')
  await viewerSetupContext.close()
  const viewerContext = await browser.newContext()
  const viewerPage = await viewerContext.newPage()
  const viewerToken = await signInMax(viewerPage, { id: viewerId, first_name: 'MAX revocation viewer' }, `invite_${initialInvite}`)
  await expect(viewerPage.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible({ timeout: 15_000 })
  await viewerPage.getByRole('button', { name: 'Присоединиться' }).click()
  await selectFamilyFeed(viewerPage, 'B child updated', 'B retained history')
  await viewerPage.getByRole('button', { name: 'Семья' }).click()
  await expect(viewerPage.getByRole('button', { name: /Редактировать профиль ребёнка/ })).toHaveCount(0)
  const childProfile = viewerPage.getByRole('region', { name: 'Профиль ребёнка' })
  await expect(childProfile).toBeVisible()
  await expect(childProfile.getByText('B child updated')).toBeVisible()
  await viewerPage.getByRole('button', { name: 'Лента' }).click()
  await expect(viewerPage.getByText('Synthetic retained photo')).toBeVisible()
  await expect(viewerPage.locator('[data-slot="voice-player"]')).toBeVisible()
  const bNote = viewerPage.locator(`[data-memory-id="${familyB.noteId}"]`)
  await expect(bNote).toBeVisible()
  const reactionResponse = viewerPage.waitForResponse((response) => response.url().endsWith(`/api/v1/families/${familyB.id}/memories/${familyB.noteId}/reaction`) && response.request().method() === 'PUT')
  await bNote.focus()
  await bNote.press('Shift+F10')
  const heartChoice = viewerPage.getByRole('button', { name: 'Сердце' })
  await expect(heartChoice).toBeVisible()
  await heartChoice.press('Enter')
  const reaction = await reactionResponse
  expect(reaction.status()).toBe(200)
  expect(await reaction.json()).toMatchObject({ currentUserReaction: 'heart', reactionCounts: { heart: 1 } })
  await expect(bNote.getByLabel('Реакции: Сердце 1, ваша реакция')).toBeVisible()
  await expect(bNote).toBeVisible()
  const activeHomeResponse = await viewerPage.request.get('/api/v1/me/families', { headers: { Authorization: `Bearer ${viewerToken}` } })
  expect(activeHomeResponse.status()).toBe(200)
  const activeHome = await activeHomeResponse.json() as { items: Array<{ familyId: string; membershipEpoch: number }> }
  const previousBMembership = activeHome.items.find((item) => item.familyId === familyB.id)
  expect(previousBMembership).toBeTruthy()
  await viewerContext.setOffline(true)

  const membersResponse = await page.request.get(`/api/v1/families/${familyB.id}/members`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  expect(membersResponse.status()).toBe(200)
  const viewerMember = (await membersResponse.json() as { items: ApiFamilyMember[] }).items.find((member) => member.role === 'viewer')
  if (!viewerMember) throw new Error('Joined viewer is absent from the owner member list')
  const remove = await page.request.delete(`/api/v1/families/${familyB.id}/members/${viewerMember.userId}`, {
    headers: { Authorization: `Bearer ${ownerToken}` }, data: { expectedVersion: viewerMember.version },
  })
  expect(remove.status()).toBe(204)
  const revokedRead = await viewerPage.request.get(`/api/v1/families/${familyB.id}/memories`, { headers: { Authorization: `Bearer ${viewerToken}` } })
  expect(revokedRead.status()).toBe(404)

  await expect(viewerPage.getByText('B retained history')).toBeVisible()
  const resumeHome = viewerPage.waitForResponse((response) => response.url().endsWith('/api/v1/me/families') && response.ok())
  await viewerContext.setOffline(false)
  const homeResponse = await resumeHome
  const homeSnapshot = await homeResponse.json() as { items: Array<{ familyId: string; membershipEpoch: number }> }
  const retainedA = homeSnapshot.items.find((item) => item.familyId === familyA.id)
  expect(retainedA).toBeTruthy()
  expect(homeSnapshot.items.some((item) => item.familyId === familyB.id)).toBe(false)
  await expect(viewerPage.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 15_000 })
  await expect(viewerPage.getByRole('button', { name: /Revoked B family/ })).toHaveCount(0)

  const usedInviteContext = await browser.newContext()
  const usedInvitePage = await usedInviteContext.newPage()
  await signInMax(usedInvitePage, { id: viewerId, first_name: 'MAX revocation viewer' }, `invite_${initialInvite}`)
  await expect(usedInvitePage.getByRole('heading', { name: 'Приглашение недоступно' })).toBeVisible({ timeout: 15_000 })

  const nextInviteResponse = await page.request.post(`/api/v1/families/${familyB.id}/invites`, {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Idempotency-Key': randomUUID() }, data: { role: 'viewer' },
  })
  expect(nextInviteResponse.status()).toBe(201)
  const nextInvite = (await nextInviteResponse.json() as { rawToken: string }).rawToken
  const rejoinContext = await browser.newContext()
  const rejoinPage = await rejoinContext.newPage()
  const rejoinToken = await signInMax(rejoinPage, { id: viewerId, first_name: 'MAX revocation viewer' }, `invite_${nextInvite}`)
  await expect(rejoinPage.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible({ timeout: 15_000 })
  await rejoinPage.getByRole('button', { name: 'Присоединиться' }).click()
  await selectFamilyFeed(rejoinPage, 'B child updated', 'B retained history')
  const rejoinedHome = await rejoinPage.request.get('/api/v1/me/families', { headers: { Authorization: `Bearer ${rejoinToken}` } })
  expect(rejoinedHome.status()).toBe(200)
  const rejoined = (await rejoinedHome.json() as { items: Array<{ familyId: string; membershipEpoch: number }> }).items.find((item) => item.familyId === familyB.id)
  expect(rejoined).toBeTruthy()
  expect(rejoined!.membershipEpoch).toBe(previousBMembership!.membershipEpoch + 1)
  const unaffectedARead = await rejoinPage.request.get(`/api/v1/families/${familyA.id}/memories`, { headers: { Authorization: `Bearer ${rejoinToken}` } })
  expect(unaffectedARead.status()).toBe(200)
  await rejoinPage.screenshot({ path: testInfo.outputPath('max-family-audit-rejoined-history.png'), fullPage: true })
  await rejoinContext.close()
  await viewerContext.close()
  await usedInviteContext.close()
})

async function signInMax(page: import('@playwright/test').Page, user: { id: number; first_name: string }, startParam = '') {
  await page.addInitScript((data: string) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData: data, version: '1.0', platform: 'android', colorScheme: 'light', ready() {}, initDataUnsafe: {} } })
  }, signedMaxInitData(user, randomUUID(), startParam))
  const authResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/max'))
  await page.goto('/')
  const continueButton = page.getByRole('button', { name: 'Продолжить' })
  const ready = await Promise.race([
    authResponse.then((response) => ({ response })),
    continueButton.waitFor({ state: 'visible' }).then(() => ({ continue: true as const })),
  ])
  const response = 'response' in ready ? ready.response : await (async () => {
    await continueButton.click()
    return authResponse
  })()
  expect(response.ok(), `MAX auth failed with HTTP ${response.status()}`).toBe(true)
  const token = (await response.json() as { accessToken: string }).accessToken
  return token
}

async function openFamilyChooser(page: import('@playwright/test').Page) {
  const heading = page.getByRole('heading', { name: 'Мои семьи' })
  if (await heading.isVisible().catch(() => false)) return
  await page.getByRole('button', { name: /^(Мои семьи|Сменить семью)$/ }).click()
  await expect(heading).toBeVisible()
}

async function selectFamilyFeed(page: import('@playwright/test').Page, childName: string, memoryBody: string) {
  await openFamilyChooser(page)
  const family = page.getByRole('button', { name: new RegExp(childName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
  await expect(family).toBeVisible()
  await family.click()
  await expect(page.getByText(memoryBody, { exact: true })).toBeVisible({ timeout: 15_000 })
}

async function createAuditFamily(page: import('@playwright/test').Page, token: string, name: string, childName: string, noteBody: string, withMedia = false) {
  const familyResponse = await page.request.post('/api/v1/families', {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() }, data: { name, timezone: 'Europe/Moscow' },
  })
  expect(familyResponse.status()).toBe(201)
  const family = (await familyResponse.json() as ApiFamily).family
  const avatarMediaId = await uploadPng(page, token, family.id, 'child_avatar')
  const childResponse = await page.request.put(`/api/v1/families/${family.id}/child`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: childName, birthDate: '2024-01-02', sex: 'girl', avatarMediaId, avatarCrop: { x: 0, y: 0, width: 1, height: 1 }, expectedVersion: null },
  })
  expect(childResponse.status()).toBe(200)
  const childId = (await childResponse.json() as ApiChild).child.id
  const noteResponse = await page.request.post(`/api/v1/families/${family.id}/memories`, {
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    data: { kind: 'note', childId, body: noteBody, occurredAt: '2026-01-02T10:00:00.000Z' },
  })
  expect(noteResponse.status()).toBe(201)
  let photoId: string | null = null
  if (withMedia) {
    const photoAsset = await uploadPng(page, token, family.id, 'memory')
    const photoResponse = await page.request.post(`/api/v1/families/${family.id}/memories`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
      data: { kind: 'photo', childId, body: 'Synthetic retained photo', occurredAt: '2026-01-02T11:00:00.000Z', mediaIds: [photoAsset] },
    })
    expect(photoResponse.status()).toBe(201)
    photoId = (await photoResponse.json() as ApiMemory).id
    const voiceAsset = await uploadMedia(page, token, family.id, 'voice', 'audio/ogg', createOggVoiceFixture())
    const voiceResponse = await page.request.post(`/api/v1/families/${family.id}/memories`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
      data: { kind: 'voice', childId, body: 'Synthetic retained voice memo', occurredAt: '2026-01-03T10:00:00.000Z', mediaIds: [voiceAsset] },
    })
    expect(voiceResponse.status()).toBe(201)
  }
  return { id: family.id, noteId: (await noteResponse.json() as ApiMemory).id, photoId }
}

function signedMaxInitData(user: { id: number; first_name: string }, queryId: string, startParam: string | null) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: queryId,
    user: JSON.stringify(user),
  })
  if (startParam !== null) params.set('start_param', startParam)
  const dataCheck = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  params.set('hash', createHmac('sha256', secret).update(dataCheck).digest('hex'))
  return params.toString()
}

async function uploadPng(page: import('@playwright/test').Page, token: string, familyId: string, purpose: 'child_avatar' | 'memory') {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const reserve = await page.request.post(`/api/v1/families/${familyId}/uploads`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { purpose, kind: 'photo', contentType: 'image/png', byteSize: bytes.byteLength },
  })
  expect(reserve.status()).toBe(201)
  const ticket = await reserve.json()
  const signed = new URL(ticket.upload.url)
  const upload = await page.request.put(`${signed.origin}${signed.pathname}${signed.search}`, { headers: ticket.upload.headers, data: bytes })
  expect(upload.status()).toBe(200)
  const finalize = await page.request.post(`/api/v1/families/${familyId}/uploads/${ticket.upload.uploadId}/finalize`, { headers: { Authorization: `Bearer ${token}` } })
  expect(finalize.status()).toBe(200)
  return ticket.assetId as string
}

async function uploadMedia(page: import('@playwright/test').Page, token: string, familyId: string, kind: 'voice', contentType: 'audio/ogg', bytes: Buffer) {
  const reserve = await page.request.post(`/api/v1/families/${familyId}/uploads`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { purpose: 'memory', kind, contentType, byteSize: bytes.byteLength },
  })
  expect(reserve.status()).toBe(201)
  const ticket = await reserve.json() as { assetId: string; upload: { uploadId: string; url: string; headers: Record<string, string> } }
  const signed = new URL(ticket.upload.url)
  const upload = await page.request.put(`${signed.origin}${signed.pathname}${signed.search}`, { headers: ticket.upload.headers, data: bytes })
  expect(upload.status()).toBe(200)
  const finalize = await page.request.post(`/api/v1/families/${familyId}/uploads/${ticket.upload.uploadId}/finalize`, { headers: { Authorization: `Bearer ${token}` } })
  if (finalize.status() !== 200) throw new Error(`voice media finalize failed ${finalize.status()}: ${await finalize.text()}`)
  return ticket.assetId
}

function createOggVoiceFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'max-family-audit-voice-'))
  const output = join(directory, 'voice.ogg')
  try {
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-nostdin', '-v', 'error', '-threads', '1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'libopus', '-y', output,
    ])
    return readFileSync(output)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
