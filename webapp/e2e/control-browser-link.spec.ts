import { createHmac, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const maxBotToken = '987654:control-e2e-synthetic'
const maxUserId = 987654321

function signedMaxInitData(startParam = '') {
  const fields = new Map([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', `control-e2e-${randomUUID()}`],
    ['start_param', startParam],
    ['user', JSON.stringify({ id: maxUserId, first_name: 'Control E2E Owner' })],
  ])
  const checkString = [...fields]
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'))
  return new URLSearchParams([...fields]).toString()
}

test('Control preserves its browser-link challenge across MAX and enforces the real owner gate', async ({ browser, page }) => {
  await page.goto('/control/')
  await expect(page.getByRole('heading', { name: 'Войдите через MAX' })).toBeVisible()

  const started = page.waitForResponse((response) => response.url().includes('/api/v1/auth/browser-link/start'))
  await page.getByRole('button', { name: 'Начать вход' }).click()
  const challengeResponse = await started
  expect(challengeResponse.status()).toBe(200)
  const challenge = await challengeResponse.json() as { challengeId: string; startParam: string }
  expect(challenge.startParam).toMatch(/^browser_\d{24}$/)
  await expect(page.getByText('Код подтверждения')).toBeVisible()

  // Clicking Open MAX changes browser visibility; the challenge must remain mounted on return.
  await page.context().route('https://max.ru/**', (route) => route.abort())
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Открыть MAX' }).click()
  const popup = await popupPromise
  await popup.close()
  await page.bringToFront()
  await expect(page.getByText('Код подтверждения')).toBeVisible()

  const apiOrigin = new URL(process.env.VITE_API_URL ?? 'http://127.0.0.1:56701').origin
  const maxContext = await browser.newContext()
  try {
    const maxLogin = await maxContext.request.post(`${apiOrigin}/api/v1/auth/max`, {
      headers: { Origin: new URL(page.url()).origin },
      data: { initData: signedMaxInitData() },
    })
    expect(maxLogin.status()).toBe(200)
    const maxSession = await maxLogin.json() as { accessToken: string }
    const approved = page.waitForResponse((response) => response.url().includes(`/browser-link/${challenge.challengeId}/status`))
    const approval = await maxContext.request.post(`${apiOrigin}/api/v1/auth/browser-link/${challenge.challengeId}/approve`, {
      headers: { Origin: new URL(page.url()).origin, Authorization: `Bearer ${maxSession.accessToken}` },
      data: { initData: signedMaxInitData(challenge.startParam), approved: true },
    })
    expect(approval.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible()
    expect((await approved).status()).toBe(200)
    await expect(page.getByText('Учётные записи', { exact: true })).toBeVisible()
    await mkdir('e2e/.artifacts', { recursive: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: 'e2e/.artifacts/control-owner-1440-light.png', fullPage: true })
    await page.getByText('Открыть таблицу значений').click()
    await expect(page.getByRole('columnheader', { name: 'Активность' })).toBeVisible()
    await expect(page.locator('.control-chart-table table tbody tr')).toHaveCount(7)
    await page.getByText('Открыть таблицу значений').click()

    await page.getByRole('button', { name: 'Семьи', exact: true }).click()
    const familySearch = page.getByPlaceholder('Поиск по названию семьи')
    await familySearch.fill('No matching synthetic family')
    await expect(page.getByText('Семьи не найдены.')).toBeVisible()
    await familySearch.fill('Control E2E Garden')
    const familyRow = page.getByRole('row').filter({ hasText: 'Control E2E Garden' })
    await expect(familyRow).toBeVisible()
    const statusSelect = page.getByRole('combobox', { name: 'Статус' })
    await statusSelect.click()
    await page.getByRole('option', { name: 'Активные' }).click()
    await expect(familyRow).toBeVisible()
    const exportDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Экспорт CSV' }).click()
    const download = await exportDownload
    expect(download.suggestedFilename()).toMatch(/^memoly-families-\d{4}-\d{2}-\d{2}\.csv$/)
    await expect(familyRow).toBeVisible()
    await familyRow.click()
    await expect(page.getByRole('heading', { name: 'Control E2E Garden' })).toBeVisible()
    const familyDetails = page.locator('.control-detail-sheet').first()
    await expect(familyDetails.locator('.control-detail-grid dd').nth(0)).toHaveText('Активна')
    const maxConnection = familyDetails.locator('.control-detail-grid > div').filter({ has: page.getByText('Подключение MAX', { exact: true }) })
    await expect(maxConnection.locator('dd')).toHaveText('Не настроен')
    const memberSection = familyDetails.locator('.control-detail-body > [data-slot="card"]').filter({ has: page.getByText('Участники', { exact: true }) })
    await expect(memberSection.locator('button.control-detail-row')).toHaveCount(25)
    await expect(page.getByRole('button', { name: 'Закрыть' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()
    await expect(page.getByRole('heading', { name: 'Control E2E Garden' })).toHaveCount(0)
    await familyRow.click()
    await expect(page.getByRole('heading', { name: 'Control E2E Garden' })).toBeVisible()
    const memberButton = memberSection.locator('button.control-detail-row').first()
    await memberButton.click()
    await expect(page.getByRole('heading', { name: /Control E2E (Owner|Member)/ })).toBeVisible()
    await expect(page.getByText('Членства')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Закрыть' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()
    await expect(page.getByRole('heading', { name: /Control E2E (Owner|Member)/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Control E2E Garden' })).toBeVisible()
    await memberSection.getByRole('button', { name: 'Далее' }).click()
    await expect(memberSection.locator('button.control-detail-row')).toHaveCount(2)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+k')
    const command = page.getByRole('dialog')
    await expect(command).toBeVisible()
    const commandSearch = command.getByRole('combobox', { name: 'Поиск семей и пользователей' })
    await commandSearch.fill('Control E2E Garden')
    const commandResult = command.getByRole('option', { name: /Control E2E Garden/ })
    await expect(commandResult).toBeVisible()
    await commandSearch.press('ArrowDown')
    await commandSearch.press('Enter')
    await expect(page.getByRole('heading', { name: 'Control E2E Garden' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.goto('/control/#/overview')
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Переключить тему' }).click()
    await expect(page.locator('.memoly-control-root')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Разделы' }).click()
    await expect(page.getByRole('button', { name: 'Закрыть' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()
    await page.screenshot({ path: 'e2e/.artifacts/control-owner-390-dark.png', fullPage: true })

    const ordinaryLogin = await maxContext.request.post(`${apiOrigin}/api/v1/auth/max`, {
      headers: { Origin: new URL(page.url()).origin },
      data: { initData: signedMaxInitDataFor(987654322) },
    })
    expect(ordinaryLogin.status()).toBe(200)
    const ordinary = await ordinaryLogin.json() as { accessToken: string }
    const denied = await maxContext.request.get(`${apiOrigin}/api/v1/control/me`, {
      headers: { Authorization: `Bearer ${ordinary.accessToken}` },
    })
    expect(denied.status()).toBe(403)
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible()

    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page.getByRole('heading', { name: 'Войдите через MAX' })).toBeVisible()
    await expect(page.getByText('Учётные записи', { exact: true })).toHaveCount(0)

    const nonOwnerContext = await browser.newContext()
    try {
      const nonOwnerPage = await nonOwnerContext.newPage()
      await nonOwnerPage.goto('/control/')
      await expect(nonOwnerPage.getByRole('heading', { name: 'Войдите через MAX' })).toBeVisible()
      const nonOwnerChallengePromise = nonOwnerPage.waitForResponse((response) => response.url().includes('/api/v1/auth/browser-link/start'))
      await nonOwnerPage.getByRole('button', { name: 'Начать вход' }).click()
      const nonOwnerChallenge = await (await nonOwnerChallengePromise).json() as { challengeId: string; startParam: string }
      const nonOwnerLogin = await maxContext.request.post(`${apiOrigin}/api/v1/auth/max`, {
        headers: { Origin: new URL(nonOwnerPage.url()).origin },
        data: { initData: signedMaxInitDataFor(987654322) },
      })
      expect(nonOwnerLogin.status()).toBe(200)
      const nonOwnerSession = await nonOwnerLogin.json() as { accessToken: string }
      const nonOwnerApproved = nonOwnerPage.waitForResponse((response) => response.url().includes(`/browser-link/${nonOwnerChallenge.challengeId}/status`))
      const nonOwnerApproval = await maxContext.request.post(`${apiOrigin}/api/v1/auth/browser-link/${nonOwnerChallenge.challengeId}/approve`, {
        headers: { Origin: new URL(nonOwnerPage.url()).origin, Authorization: `Bearer ${nonOwnerSession.accessToken}` },
        data: { initData: signedMaxInitDataFor(987654322, nonOwnerChallenge.startParam), approved: true },
      })
      expect(nonOwnerApproval.status()).toBe(200)
      expect((await nonOwnerApproved).status()).toBe(200)
      await expect(nonOwnerPage.getByRole('heading', { name: 'У этой учётной записи нет доступа' })).toBeVisible()
      await expect(nonOwnerPage.getByText('Учётные записи', { exact: true })).toHaveCount(0)
      await expect(nonOwnerPage.getByRole('heading', { name: 'Войдите через MAX' })).toHaveCount(0)
    } finally {
      await nonOwnerContext.close()
    }
  } finally {
    await maxContext.close()
  }
})

test('MAX Control owner does not enter the synthetic guide on startup, WebView return or reload', async ({ page }) => {
  await page.addInitScript((initData) => {
    Object.defineProperty(window, 'WebApp', { configurable: true, value: { initData, version: '1', platform: 'web', ready() {} } })
  }, signedMaxInitData())
  await page.goto('/')
  const continueWelcome = page.getByRole('button', { name: 'Продолжить' })
  const guide = page.getByRole('heading', { name: 'Пример семейного альбома' })
  const normalApp = page.locator('[data-slot="family-hub"]')
  await expect.poll(async () => await normalApp.isVisible() || await continueWelcome.isVisible()).toBe(true)
  if (await continueWelcome.isVisible().catch(() => false)) await continueWelcome.click()
  await expect(normalApp).toBeVisible()
  await expect(guide).toHaveCount(0)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(guide).toHaveCount(0)
  await page.reload()
  await expect.poll(async () => await normalApp.isVisible() || await continueWelcome.isVisible()).toBe(true)
  if (await continueWelcome.isVisible().catch(() => false)) await continueWelcome.click()
  await expect(normalApp).toBeVisible()
  await expect(guide).toHaveCount(0)
})

test('Control fails closed on access loss, restores an owner session, and revalidates BFCache returns', async ({ browser, page }) => {
  await authenticateOwner(page, browser)

  for (const width of [768, 320]) {
    await page.setViewportSize({ width, height: 850 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })

  let releaseStorageFailure: () => void = () => undefined
  const storageRequestGate = new Promise<void>((resolve) => { releaseStorageFailure = resolve })
  await page.route('**/api/v1/control/storage', async (route) => {
    await storageRequestGate
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE', message: 'Synthetic display failure' }) })
  })
  await page.getByRole('button', { name: 'Хранилище', exact: true }).click()
  await expect(page.getByLabel('Загрузка данных')).toBeVisible()
  releaseStorageFailure()
  await expect(page.getByText('Не удалось получить данные', { exact: true })).toBeVisible()
  await page.unroute('**/api/v1/control/storage')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { name: 'Хранилище' })).toBeVisible()

  await page.route('**/api/v1/control/sources', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'product_db', kind: 'product_db', status: 'stale', observedAt: null, lastAttemptAt: null, errorCode: null }]),
  }))
  await page.getByRole('button', { name: 'Подключения', exact: true }).click()
  await expect(page.getByText('Устарело', { exact: true })).toBeVisible()
  await page.unroute('**/api/v1/control/sources')

  await page.route('**/api/v1/control/families**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.continue()
  })
  await page.getByRole('button', { name: 'Семьи', exact: true }).click()
  await expect(page.locator('.control-table-scroll [data-slot="skeleton"]')).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Control E2E Garden' })).toBeVisible()
  await page.unroute('**/api/v1/control/families**')

  let releaseLateMe: () => void = () => undefined
  let markLateMeStarted: () => void = () => undefined
  let markLateMeSettled: () => void = () => undefined
  let releaseVisibleMe: () => void = () => undefined
  let markVisibleMeStarted: () => void = () => undefined
  let meRevalidationRequests = 0
  const lateMeGate = new Promise<void>((resolve) => { releaseLateMe = resolve })
  const lateMeStarted = new Promise<void>((resolve) => { markLateMeStarted = resolve })
  const lateMeSettled = new Promise<void>((resolve) => { markLateMeSettled = resolve })
  const visibleMeGate = new Promise<void>((resolve) => { releaseVisibleMe = resolve })
  const visibleMeStarted = new Promise<void>((resolve) => { markVisibleMeStarted = resolve })
  await page.route('**/api/v1/control/me', async (route) => {
    meRevalidationRequests += 1
    if (meRevalidationRequests === 1) {
      markLateMeStarted()
      await lateMeGate
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: true, serverNow: new Date().toISOString(), features: ['read', 'csv_export'] }) }) } catch { /* The hidden-page request may already be aborted. */ }
      finally { markLateMeSettled() }
      return
    }
    if (meRevalidationRequests === 2) {
      markVisibleMeStarted()
      await visibleMeGate
      await route.continue()
      return
    }
    await route.continue()
  })
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await lateMeStarted
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('Проверяем доступ к панели…')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Семьи' })).toHaveCount(0)
  await expect(page.getByText('Учётные записи', { exact: true })).toHaveCount(0)
  releaseLateMe()
  await lateMeSettled
  await expect(page.getByText('Проверяем доступ к панели…')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })
  await visibleMeStarted
  await expect(page.getByText('Проверяем доступ к панели…')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Семьи' })).toHaveCount(0)
  await expect(page.getByText('Учётные записи', { exact: true })).toHaveCount(0)
  const visibleMeResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/control/me') && response.status() === 200)
  releaseVisibleMe()
  expect((await visibleMeResponse).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Семьи' })).toBeVisible()
  await page.unroute('**/api/v1/control/me')

  await page.route('**/api/v1/control/me', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'FORBIDDEN', message: 'Synthetic owner access loss' }) }))
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(page.getByRole('heading', { name: 'У этой учётной записи нет доступа' })).toBeVisible()
  await expect(page.getByText('Учётные записи', { exact: true })).toHaveCount(0)
  await page.unroute('**/api/v1/control/me')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { name: 'Семьи' })).toBeVisible()

  await page.route('**/api/v1/control/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'Synthetic session expiry' }) }))
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(page.getByRole('heading', { name: 'Войдите через MAX' })).toBeVisible()
  await expect(page.getByText('Учётные записи', { exact: true })).toHaveCount(0)
})

test('Control retries cookie refresh after a startup network failure', async ({ page }) => {
  let refreshAttempts = 0
  await page.route('**/api/v1/auth/refresh', async (route) => {
    refreshAttempts += 1
    if (refreshAttempts === 1) await route.abort('failed')
    else await route.continue()
  })
  await page.goto('/control/')
  await expect(page.getByRole('heading', { name: 'Не удалось проверить доступ' })).toBeVisible()
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('heading', { name: 'Войдите через MAX' })).toBeVisible()
  expect(refreshAttempts).toBeGreaterThanOrEqual(2)
})

test('Control owner trashes and restores a synthetic account, then confirms only a separate family purge', async ({ browser, page, browserName }) => {
  await authenticateOwner(page, browser)
  const apiOrigin = new URL(process.env.VITE_API_URL ?? 'http://127.0.0.1:56701').origin
  const maxContext = await browser.newContext()
  const targetSubject = 1_000_000_000 + Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 10), 16)
  const targetName = `Control Delete Target ${browserName} ${targetSubject}`
  const familyName = `${targetName} Family`
  try {
    const targetLogin = await maxContext.request.post(`${apiOrigin}/api/v1/auth/max`, {
      headers: { Origin: new URL(page.url()).origin },
      data: { initData: signedMaxInitDataFor(targetSubject, '', targetName) },
    })
    expect(targetLogin.status()).toBe(200)
    const targetSession = await targetLogin.json() as { accessToken: string }
    const targetFamily = await maxContext.request.post(`${apiOrigin}/api/v1/families`, {
      headers: { Origin: new URL(page.url()).origin, Authorization: `Bearer ${targetSession.accessToken}`, 'idempotency-key': randomUUID() },
      data: { name: familyName, timezone: 'UTC' },
    })
    expect(targetFamily.status()).toBe(201)
    expect((await maxContext.request.get(`${apiOrigin}/api/v1/me/families`, { headers: { Authorization: `Bearer ${targetSession.accessToken}` } })).status()).toBe(200)

    await page.getByRole('button', { name: 'Пользователи', exact: true }).click()
    const usersSearch = page.getByPlaceholder('Поиск по имени')
    await usersSearch.fill(targetName)
    const targetRow = page.getByRole('row').filter({ hasText: targetName })
    await expect(targetRow).toBeVisible()
    await targetRow.click()
    await expect(page.getByRole('heading', { name: targetName })).toBeVisible()
    await page.getByRole('button', { name: 'Удалить пользователя' }).click()
    const trashDialog = page.getByRole('dialog', { name: 'Удалить пользователя', exact: true })
    await expect(trashDialog.getByText('Доступ участников изменится сразу')).toBeVisible()
    await trashDialog.getByLabel('Введите УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ').fill('УДАЛИТЬ ПОЛЬЗОВАТЕЛЯ')
    await mkdir('e2e/.artifacts', { recursive: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(trashDialog.getByRole('button', { name: 'Переместить в корзину' })).toBeEnabled()
    await page.screenshot({ path: `e2e/.artifacts/control-deletion-${browserName}-desktop-light.png`, fullPage: false })
    await trashDialog.getByRole('button', { name: 'Переместить в корзину' }).click()
    await expect(page.getByText(/В корзине до/)).toBeVisible()
    expect((await maxContext.request.get(`${apiOrigin}/api/v1/me/families`, { headers: { Authorization: `Bearer ${targetSession.accessToken}` } })).status()).toBe(401)
    await page.getByRole('button', { name: 'Восстановить', exact: true }).click()
    await page.getByRole('dialog', { name: 'Восстановить пользователя', exact: true }).getByRole('button', { name: 'Восстановить', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Удалить пользователя' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()

    await page.getByRole('button', { name: 'Семьи', exact: true }).click()
    const familiesSearch = page.getByPlaceholder('Поиск по названию семьи')
    await familiesSearch.fill(familyName)
    const familyRow = page.getByRole('row').filter({ hasText: familyName })
    await expect(familyRow).toBeVisible()
    await familyRow.click()
    await expect(page.getByRole('heading', { name: familyName })).toBeVisible()
    await page.getByRole('button', { name: 'Удалить семью навсегда' }).click()
    const purgeDialog = page.getByRole('dialog', { name: 'Удалить семью навсегда', exact: true })
    await expect(purgeDialog.getByText('Действие необратимо')).toBeVisible()
    await purgeDialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(purgeDialog).toHaveCount(0)
    await page.getByRole('button', { name: 'Закрыть' }).click()

    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Переключить тему' }).click()
    await expect(page.locator('.memoly-control-root')).toHaveAttribute('data-theme', 'dark')
    await familyRow.click()
    await expect(page.getByRole('heading', { name: familyName })).toBeVisible()
    await page.getByRole('button', { name: 'Удалить семью навсегда' }).click()
    const confirmedPurgeDialog = page.getByRole('dialog', { name: 'Удалить семью навсегда', exact: true })
    await confirmedPurgeDialog.getByLabel('Введите УДАЛИТЬ НАВСЕГДА').fill('УДАЛИТЬ НАВСЕГДА')
    await expect(confirmedPurgeDialog.getByRole('button', { name: 'Удалить навсегда' })).toBeEnabled()
    await page.screenshot({ path: `e2e/.artifacts/control-deletion-${browserName}-mobile-dark.png`, fullPage: false })
    await confirmedPurgeDialog.getByRole('button', { name: 'Удалить навсегда' }).click()
    await expect(page.getByText('Доступ уже закрыт; физическая очистка продолжается.')).toBeVisible()
  } finally {
    await maxContext.close()
  }
})

test('Control static entry stays standalone and includes its no-JavaScript message', async ({ request }) => {
  const entry = await request.get('/control/')
  expect(entry.status()).toBe(200)
  expect(entry.headers()['content-type']).toContain('text/html')
  const html = await entry.text()
  expect(html).toContain('id="memoly-control-root"')
  expect(html).toContain('<title>memoLy · Панель владельца</title>')


  expect(html).toContain('Для работы панели требуется JavaScript.')
})

async function authenticateOwner(page: import('@playwright/test').Page, browser: import('@playwright/test').Browser): Promise<string> {
  await page.goto('/control/')
  await expect(page.getByRole('heading', { name: 'Войдите через MAX' })).toBeVisible()
  const started = page.waitForResponse((response) => response.url().includes('/api/v1/auth/browser-link/start'))
  await page.getByRole('button', { name: 'Начать вход' }).click()
  const challenge = await (await started).json() as { challengeId: string; startParam: string }
  const maxContext = await browser.newContext()
  try {
    const apiOrigin = new URL(process.env.VITE_API_URL ?? 'http://127.0.0.1:56701').origin
    const login = await maxContext.request.post(`${apiOrigin}/api/v1/auth/max`, {
      headers: { Origin: new URL(page.url()).origin },
      data: { initData: signedMaxInitData() },
    })
    expect(login.status()).toBe(200)
    const session = await login.json() as { accessToken: string }
    const status = page.waitForResponse((response) => response.url().includes(`/browser-link/${challenge.challengeId}/status`))
    const approval = await maxContext.request.post(`${apiOrigin}/api/v1/auth/browser-link/${challenge.challengeId}/approve`, {
      headers: { Origin: new URL(page.url()).origin, Authorization: `Bearer ${session.accessToken}` },
      data: { initData: signedMaxInitData(challenge.startParam), approved: true },
    })
    expect(approval.status()).toBe(200)
    expect((await status).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible()
    return session.accessToken
  } finally {
    await maxContext.close()
  }
}

function signedMaxInitDataFor(userId: number, startParam = '', firstName = 'Control E2E Viewer') {
  const fields = new Map([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', `control-e2e-${randomUUID()}`],
    ['start_param', startParam],
    ['user', JSON.stringify({ id: userId, first_name: firstName })],
  ])
  const checkString = [...fields]
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'))
  return new URLSearchParams([...fields]).toString()
}
