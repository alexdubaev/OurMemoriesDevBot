import { expect, test } from '@playwright/test'

test('optional font stylesheet cannot hold the app at the pre-React loader', async ({ page }) => {
  const startupRequests: string[] = []
  let releaseStylesheet!: () => void
  const stylesheetHeld = new Promise<void>((resolve) => {
    releaseStylesheet = resolve
  })
  await page.route('https://rsms.me/inter/inter.css', async (route) => {
    await stylesheetHeld
    await route.fulfill({ status: 200, contentType: 'text/css', body: '/* synthetic held font stylesheet */' })
  })
  await page.route('**/api/v1/**', (route) => {
    startupRequests.push(new URL(route.request().url()).pathname)
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }),
    })
  })

  try {
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.getByRole('status').filter({ hasText: 'Загрузка memoLy…' })).toBeHidden({ timeout: 4_000 })
    await expect(page.getByText('Вход через MAX')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => startupRequests).toContain('/api/v1/auth/refresh')
  } finally {
    releaseStylesheet()
  }
})

test('a failed application module shows a retryable startup error', async ({ page }) => {
  await page.route('**/src/main.tsx', (route) => route.fulfill({ status: 503, body: 'synthetic module failure' }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Не удалось открыть приложение')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
})

test('a selected MAX SDK that never finishes reaches a retryable startup error', async ({ page }) => {
  await page.route('https://st.max.ru/js/max-web-app.js', () => new Promise<void>(() => undefined))
  const apiRequests: string[] = []
  await page.route('**/api/v1/**', (route) => { apiRequests.push(new URL(route.request().url()).pathname); return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Unauthenticated', requestId: 'synthetic' } } }) })
  await page.goto('/#WebAppData=synthetic', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Не удалось открыть приложение')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible()
  expect(apiRequests).toEqual([])
})

test('delayed selected MAX SDK initializes its host before authenticated app startup', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => query === '(prefers-reduced-motion: reduce)'
      ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }
      : original(query)
  })
  await page.route('https://st.max.ru/js/max-web-app.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({ contentType: 'text/javascript', body: 'window.WebApp={initData:"synthetic-init-data",ready(){}}' })
  })
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/max') return route.fulfill({ json: { accessToken: 'synthetic-access-token', user: { id: '019c0000-0000-7000-8000-000000000001', email: null, displayName: 'MAX test user', role: 'user', createdAt: '2026-09-09T00:00:00.000Z' } } })
    if (path === '/api/v1/auth/refresh') return route.fulfill({ json: { accessToken: 'synthetic-access-token' } })
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: { id: '019c0000-0000-7000-8000-000000000001', email: null, displayName: 'MAX test user', role: 'user', createdAt: '2026-09-09T00:00:00.000Z' }, externalIdentityProvider: 'max' } })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: { showWelcome: false } })
    if (path === '/api/v1/me/families') return route.fulfill({ json: { version: 1, ownFamilyId: null, ownFamilyStatus: null, canCreateOwnFamily: true, items: [], nextCursor: null } })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'synthetic' } } })
  })
  await page.goto('/#WebAppData=synthetic', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Продолжить' }).click({ timeout: 8_000 })
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
})
