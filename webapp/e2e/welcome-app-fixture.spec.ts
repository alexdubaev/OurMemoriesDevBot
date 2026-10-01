import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const fixtureUser = {
  id: 'welcome-app-fixture-user',
  email: null,
  displayName: 'Welcome Fixture',
  role: 'user',
  theme: 'mint',
  createdAt: '2026-09-01T00:00:00.000Z',
}

async function installAppMocks(page: Page, invite = false, showWelcome = true, withFamily = false) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((withInvite) => {
    const fields = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1_000)),
      query_id: 'welcome-fixture-query',
      user: JSON.stringify({ id: 82000101, first_name: 'Welcome Fixture' }),
    })
    if (withInvite) fields.set('start_param', 'invite_abcdefghijklmnopqrstuvwxyzABCDEF')
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: { WebApp: {
        initData: fields.toString(), version: '8.0', platform: 'tdesktop',
        safeAreaInset: { top: 24, bottom: 18 }, contentSafeAreaInset: { top: 24, bottom: 18 },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, ready() {},
      } },
    })
  }, invite)
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/api/v1/auth/telegram') return route.fulfill({ json: { user: fixtureUser, accessToken: 'fixture-access-token' } })
    if (path === '/api/v1/auth/refresh') return route.fulfill({ json: { accessToken: 'fixture-access-token' } })
    if (path === '/api/v1/auth/me') return route.fulfill({ json: { user: fixtureUser, externalIdentityProvider: 'telegram' } })
    if (path === '/api/v1/me/welcome/claim') return route.fulfill({ json: { showWelcome } })
    if (path === '/api/v1/me/families') return route.fulfill({ json: withFamily ? {
      version: 1,
      ownFamilyId: '44444444-4444-4444-8444-444444444444',
      ownFamilyStatus: 'active',
      canCreateOwnFamily: true,
      items: [{ familyId: '44444444-4444-4444-8444-444444444444', name: 'Наша семья', displaySubtitle: null, childAvatarMediaId: null, isOwner: true, role: 'full', setupStatus: 'needs_child', capabilities: { canCreateInvite: true, canManageMembers: true, canEditChild: true, canPublishNote: true, canPublishPhoto: true, canPublishVoice: true, canPublishVideo: true, canUploadChildAvatar: true }, unreadCount: 0, unreadState: 'ready', membershipEpoch: 1 }],
      nextCursor: null,
    } : { version: 1, ownFamilyId: null, ownFamilyStatus: null, canCreateOwnFamily: true, items: [], nextCursor: null } })
    if (path === '/api/v1/families/44444444-4444-4444-8444-444444444444') return route.fulfill({ json: { family: { id: '44444444-4444-4444-8444-444444444444', name: 'Наша семья', timezone: 'UTC', ownerUserId: '82000101-0000-4000-8000-000000000001' }, child: null } })
    if (path === '/api/v1/invites/preview') return route.fulfill({ json: { family: { id: '44444444-4444-4444-8444-444444444444', name: 'Наша семья' }, role: 'viewer', expiresAt: '2026-10-02T00:00:00.000Z' } })
    throw new Error(`Unexpected API request in welcome fixture: ${request.method()} ${path}`)
  })
}

test('ordinary family home stays behind the App welcome gate until the button is tapped', async ({ page }) => {
  await installAppMocks(page)
  let familyRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/me/families') familyRequests += 1
  })
  await page.goto('/')
  const splash = page.locator('[data-slot="welcome-splash"]')
  await expect(splash).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toHaveCount(0)
  await expect(page.locator('.continue-button')).toBeEnabled({ timeout: 6_000 })
  await page.waitForTimeout(4_700)
  await expect(splash).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toHaveCount(0)
  expect(familyRequests).toBe(0)
  await page.locator('.continue-button').click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  expect(familyRequests).toBeGreaterThan(0)
})

test('invite preview stays behind the App welcome gate until the button is tapped', async ({ page }) => {
  await installAppMocks(page, true)
  let inviteRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/invites/preview') inviteRequests += 1
  })
  await page.goto('/')
  const splash = page.locator('[data-slot="welcome-splash"]')
  await expect(splash).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вас приглашают в семью' })).toHaveCount(0)
  await expect(page.locator('.continue-button')).toBeEnabled({ timeout: 6_000 })
  await page.waitForTimeout(4_700)
  await expect(splash).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вас приглашают в семью' })).toHaveCount(0)
  expect(inviteRequests).toBe(0)
  await page.locator('.continue-button').click()
  await expect(page.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible()
  expect(inviteRequests).toBe(1)
})

test('ordinary launch shows the temporary splash when the server claim is already consumed', async ({ page }) => {
  await installAppMocks(page, false, false, true)
  await page.goto('/')
  const splash = page.locator('[data-slot="welcome-splash"]')
  await expect(splash).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toHaveCount(0)
  await expect(page.locator('.continue-button')).toBeEnabled({ timeout: 6_000 })
  await page.waitForTimeout(4_700)
  await expect(splash).toBeVisible()
  await page.locator('.continue-button').click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await page.locator('[data-slot="family-hub"] .family-hub-card').click()
  await expect(page.getByRole('heading', { name: 'Расскажите о ребёнке' })).toBeVisible()
  await expect(page.locator('[data-slot="welcome-splash"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Все семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await expect(page.locator('[data-slot="welcome-splash"]')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-slot="welcome-splash"]')).toBeVisible()
})

test('invite navigation does not repeat the splash in one mount, while reload shows it again', async ({ page }) => {
  await installAppMocks(page, true, false)
  await page.goto('/')
  await expect(page.locator('[data-slot="welcome-splash"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вас приглашают в семью' })).toHaveCount(0)
  await expect(page.locator('.continue-button')).toBeEnabled({ timeout: 6_000 })
  await page.locator('.continue-button').click()
  await expect(page.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible()
  await expect(page.locator('[data-slot="welcome-splash"]')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-slot="welcome-splash"]')).toBeVisible()
})
