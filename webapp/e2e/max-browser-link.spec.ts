import { createHmac, randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

const maxBotToken = '987654:max-e2e-synthetic-token'

function signedMaxInitData(startParam: string) {
  const fields = new Map([
    ['auth_date', String(Math.floor(Date.now() / 1000))],
    ['query_id', `e2e-${randomUUID()}`],
    ['start_param', startParam],
    ['user', JSON.stringify({ id: 987654321, first_name: 'MAX E2E User' })],
  ])
  const checkString = [...fields]
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(maxBotToken).digest()
  const hash = createHmac('sha256', secret).update(checkString).digest('hex')
  fields.set('hash', hash)
  return new URLSearchParams([...fields]).toString()
}

test('MAX browser-link approval redeems a browser challenge into an HttpOnly session', async ({ browser, page }) => {
  const startResponse = page.waitForResponse((response) =>
    response.url().includes('/api/v1/auth/browser-link/start') && response.request().method() === 'POST',
  )
  await page.goto('/')
  await expect(page.getByText('Вход через MAX')).toBeVisible()
  const challengeResponse = await startResponse
  expect(challengeResponse.ok()).toBe(true)
  const challenge = await challengeResponse.json() as { challengeId: string; startParam: string }
  expect(challenge.startParam).toMatch(/^browser_\d{24}$/)

  const maxContext = await browser.newContext({ baseURL: page.url() })
  const maxPage = await maxContext.newPage()
  await maxPage.addInitScript((initData) => {
    Object.defineProperty(window, 'WebApp', {
      configurable: true,
      value: { initData, version: '1', platform: 'web', ready() {} },
    })
  }, signedMaxInitData(challenge.startParam))
  await maxPage.goto('/')
  await expect(maxPage.getByRole('heading', { name: 'Подтвердить вход' })).toBeVisible()

  const redeemResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/v1/auth/browser-link/${challenge.challengeId}/redeem`)
      && response.request().method() === 'POST',
  )
  await maxPage.getByRole('button', { name: 'Подтвердить вход' }).click()
  const redeemed = await redeemResponse
  expect(redeemed.status()).toBe(200)
  const cookies = await page.context().cookies()
  expect(cookies.some((cookie) => cookie.name === 'web_app_demo_refresh' && cookie.httpOnly)).toBe(true)
  const restored = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/me'))
  await page.reload()
  expect((await restored).status()).toBe(200)

  await maxContext.close()
})

test('MAX Mini App signs in with verified initData and loads the current session', async ({ page }) => {
  await page.addInitScript((initData) => {
    Object.defineProperty(window, 'WebApp', {
      configurable: true,
      value: { initData, version: '1', platform: 'web', ready() {} },
    })
  }, signedMaxInitData(''))
  const exchange = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/auth/max') && response.request().method() === 'POST',
  )
  const currentUser = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/me'))
  await page.goto('/')
  expect((await exchange).status()).toBe(200)
  expect((await currentUser).status()).toBe(200)
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'web_app_demo_refresh' && cookie.httpOnly)).toBe(true)
})
