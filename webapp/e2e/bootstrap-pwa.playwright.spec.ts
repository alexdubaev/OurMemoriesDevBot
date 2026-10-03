import { expect, test, type Page } from '@playwright/test'

const user = {
  id: '019c0000-0000-7000-8000-000000000001',
  email: null,
  displayName: 'PWA test user',
  role: 'user',
  createdAt: '2026-09-09T00:00:00.000Z',
}
const home = {
  version: 1,
  ownFamilyId: null,
  ownFamilyStatus: null,
  canCreateOwnFamily: true,
  items: [],
  nextCursor: null,
}
const welcome = { showWelcome: false }
const me = { user, externalIdentityProvider: 'max' }
const refresh = { accessToken: 'synthetic-access-token' }

test('cold PWA cookie restore reaches the family screen', async ({ page }) => {
  await mockPwaSession(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click({ timeout: 8_000 })
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
  await page.screenshot({ path: 'e2e/.artifacts/ios-bootstrap-pwa-family.png', fullPage: true })
})

test('warm PWA restart restores the existing session and family screen', async ({ page }) => {
  await mockPwaSession(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click({ timeout: 8_000 })
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
  await page.reload()
  await page.getByRole('button', { name: 'Продолжить' }).click({ timeout: 8_000 })
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
})

test('failed current-user restore has retry recovery without leaving a loader', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    const originalMatchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => query === '(prefers-reduced-motion: reduce)'
      ? { ...originalMatchMedia(query), matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList
      : originalMatchMedia(query)
  })
  let meCalls = 0
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') return route.fulfill({ json: refresh })
    if (path === '/api/v1/auth/me') {
      meCalls += 1
      if (meCalls <= 2) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'temporary', requestId: 'synthetic-request-id' } } })
      return route.fulfill({ json: me })
    }
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: welcome })
    if (path === '/api/v1/me/families') return route.fulfill({ json: home })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found', requestId: 'synthetic-request-id' } } })
  })
  await page.goto('/')
  await expect(page.getByText('Не удалось восстановить вход')).toBeVisible({ timeout: 8_000 })
  await page.screenshot({ path: 'e2e/.artifacts/ios-bootstrap-recoverable-error.png', fullPage: true })
  await page.getByRole('button', { name: 'Повторить' }).click()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
})

test('a never-settling cookie refresh reaches a recoverable state and retry restores Family', async ({ page }) => {
  await mockPwaSession(page)
  let refreshCalls = 0
  await page.unroute('**/api/v1/**')
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') {
      refreshCalls += 1
      if (refreshCalls === 1) await new Promise((resolve) => setTimeout(resolve, 17_000))
      return route.fulfill({ json: refresh })
    }
    if (path === '/api/v1/auth/me') return route.fulfill({ json: me })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: welcome })
    if (path === '/api/v1/me/families') return route.fulfill({ json: home })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found', requestId: 'synthetic-request-id' } } })
  })
  await page.goto('/')
  await expect(page.getByText('Не удалось восстановить вход')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('status').filter({ hasText: 'Загрузка memoLy…' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
})

test('an aborted cookie refresh reaches recoverable state and retry restores Family', async ({ page }) => {
  await mockPwaSession(page)
  let refreshCalls = 0
  await page.unroute('**/api/v1/**')
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') {
      refreshCalls += 1
      if (refreshCalls === 1) return route.abort('failed')
      return route.fulfill({ json: refresh })
    }
    if (path === '/api/v1/auth/me') return route.fulfill({ json: me })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: welcome })
    if (path === '/api/v1/me/families') return route.fulfill({ json: home })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found', requestId: 'synthetic-request-id' } } })
  })
  await page.goto('/')
  await expect(page.getByText('Не удалось восстановить вход')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByRole('status').filter({ hasText: 'Загрузка memoLy…' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
})

test('retry after cookie and MAX exchange failures starts a fresh MAX authentication attempt', async ({ page }) => {
  await page.route('https://st.max.ru/js/max-web-app.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.WebApp={initData:"synthetic-init-data",ready(){}}',
  }))
  let refreshCalls = 0
  let maxCalls = 0
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') {
      refreshCalls += 1
      if (refreshCalls === 1) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'temporary', requestId: 'synthetic-request-id' } } })
      return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'signed out', requestId: 'synthetic-request-id' } } })
    }
    if (path === '/api/v1/auth/max') {
      maxCalls += 1
      if (maxCalls === 1) return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR', message: 'temporary', requestId: 'synthetic-request-id' } } })
      return route.fulfill({ json: { accessToken: 'synthetic-access-token', user } })
    }
    if (path === '/api/v1/auth/me') return route.fulfill({ json: me })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: welcome })
    if (path === '/api/v1/me/families') return route.fulfill({ json: home })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found', requestId: 'synthetic-request-id' } } })
  })
  await page.goto('/#WebAppData=synthetic', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Не удалось восстановить вход')).toBeVisible({ timeout: 8_000 })
  expect(maxCalls).toBe(1)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await page.getByRole('button', { name: 'Продолжить' }).click({ timeout: 8_000 })
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible({ timeout: 8_000 })
  expect(maxCalls).toBe(2)
})

test('expired PWA session reaches the existing MAX login flow', async ({ page }) => {
  let meCalls = 0
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Session expired', requestId: 'synthetic-request-id' } } })
    if (path === '/api/v1/auth/me') meCalls += 1
    return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Session expired', requestId: 'synthetic-request-id' } } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Вход через MAX' })).toBeVisible({ timeout: 8_000 })
  expect(meCalls).toBe(0)
  await expect(page.getByRole('status').filter({ hasText: 'Загрузка memoLy…' })).toHaveCount(0)
})

test('family hub selection opens the family setup view and returns to the hub', async ({ page }) => {
  const familyId = '019c0000-0000-7000-8000-000000000002'
  const family = { id: familyId, name: 'Наша семья', timezone: 'Europe/Moscow', ownerUserId: user.id }
  const item = {
    familyId, name: family.name, displaySubtitle: null, childAvatarMediaId: null,
    isOwner: true, role: 'full', setupStatus: 'needs_child',
    capabilities: { canCreateInvite: true, canManageMembers: true, canEditChild: true, canPublishNote: false, canPublishPhoto: false, canPublishVoice: false, canPublishVideo: false, canUploadChildAvatar: true },
    unreadCount: null, unreadState: 'not_enabled', membershipEpoch: 1,
  }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => query === '(prefers-reduced-motion: reduce)'
      ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }
      : original(query)
  })
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') return route.fulfill({ json: refresh })
    if (path === '/api/v1/auth/me') return route.fulfill({ json: me })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: welcome })
    if (path === '/api/v1/me/families') return route.fulfill({ json: { ...home, ownFamilyId: familyId, ownFamilyStatus: 'active', canCreateOwnFamily: false, items: [item] } })
    if (path === `/api/v1/families/${familyId}`) return route.fulfill({ json: { family, child: null } })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found', requestId: 'synthetic-request-id' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click({ timeout: 8_000 })
  await page.getByRole('button', { name: /Наша семья/ }).click()
  await expect(page.getByText('Расскажите о ребёнке')).toBeVisible()
  await page.getByRole('button', { name: 'Все семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
})

test('Family and Feed navigation remains available after a warm PWA bootstrap', async ({ page }) => {
  const familyId = '019c0000-0000-7000-8000-000000000002'
  const childId = '019c0000-0000-7000-8000-000000000003'
  const family = { id: familyId, name: 'Наша семья', timezone: 'Europe/Moscow', ownerUserId: user.id }
  const capabilities = { canCreateInvite: true, canManageMembers: true, canEditChild: true, canPublishNote: true, canPublishPhoto: true, canPublishVoice: true, canPublishVideo: true, canUploadChildAvatar: true }
  const item = { familyId, name: family.name, displaySubtitle: 'Тестовый ребёнок', childAvatarMediaId: null, isOwner: true, role: 'full', setupStatus: 'ready', capabilities, unreadCount: null, unreadState: 'not_enabled', membershipEpoch: 1 }
  const familyResponse = { family, child: { id: childId, name: 'Тестовый ребёнок', birthDate: null, sex: null, avatarMediaId: null, avatarCrop: null, version: 1, isComplete: true } }
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => query === '(prefers-reduced-motion: reduce)'
      ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }
      : original(query)
  })
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') return route.fulfill({ json: refresh })
    if (path === '/api/v1/auth/me') return route.fulfill({ json: me })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: welcome })
    if (path === '/api/v1/me/families') return route.fulfill({ json: { ...home, ownFamilyId: familyId, ownFamilyStatus: 'active', canCreateOwnFamily: false, items: [item] } })
    if (path === `/api/v1/families/${familyId}`) return route.fulfill({ json: familyResponse })
    if (path === `/api/v1/families/${familyId}/members`) return route.fulfill({ json: { items: [{ userId: user.id, avatarPath: null, displayName: user.displayName, familyDisplayName: null, role: 'full', isOwner: true, joinedAt: user.createdAt, version: 1 }] } })
    if (path === `/api/v1/families/${familyId}/invites`) return route.fulfill({ json: { items: [] } })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found', requestId: 'synthetic-request-id' } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Продолжить' }).click({ timeout: 8_000 })
  await page.getByRole('button', { name: /Наша семья/ }).click()
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })
  await navigation.getByRole('button', { name: 'Семья' }).click()
  await expect(navigation.getByRole('button', { name: 'Семья' })).toHaveAttribute('aria-current', 'page')
  await navigation.getByRole('button', { name: 'Лента' }).click()
  await expect(navigation.getByRole('button', { name: 'Лента' })).toHaveAttribute('aria-current', 'page')
})

async function mockPwaSession(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    const originalMatchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => query === '(prefers-reduced-motion: reduce)'
      ? { ...originalMatchMedia(query), matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList
      : originalMatchMedia(query)
  })
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/refresh') return route.fulfill({ json: refresh })
    if (path === '/api/v1/auth/me') return route.fulfill({ json: me })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: welcome })
    if (path === '/api/v1/me/families') return route.fulfill({ json: home })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'not found', requestId: 'synthetic-request-id' } } })
  })
}
