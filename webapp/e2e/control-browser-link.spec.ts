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
    await expect(page.getByText('Уникальные учётные записи')).toBeVisible()
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
    await expect(familyDetails.locator('.control-detail-grid dd').nth(6)).toHaveText('Не настроен')
    const memberSection = page.locator('.control-detail-sheet').first().locator('.control-detail-body > [data-slot="card"]').first()
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
    await expect(page.getByText('Уникальные учётные записи')).toHaveCount(0)

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
      await expect(nonOwnerPage.getByText('Уникальные учётные записи')).toHaveCount(0)
      await expect(nonOwnerPage.getByRole('heading', { name: 'Войдите через MAX' })).toHaveCount(0)
    } finally {
      await nonOwnerContext.close()
    }
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

function signedMaxInitDataFor(userId: number, startParam = '') {
  const fields = new Map([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', `control-e2e-${randomUUID()}`],
    ['start_param', startParam],
    ['user', JSON.stringify({ id: userId, first_name: 'Control E2E Viewer' })],
  ])
  const checkString = [...fields]
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'))
  return new URLSearchParams([...fields]).toString()
}
