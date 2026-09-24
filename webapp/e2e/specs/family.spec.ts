import type { Browser, BrowserContext, Page } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

import { pngImage } from '../helpers/images'
import { expect, test } from '../helpers/test'

type Owner = { context: BrowserContext; page: Page }

/**
 * These specs run the Mini App through the real browser host adapter.  The test host supplies
 * only Telegram's `initData`; sign-in still happens through the ordinary web session so the
 * browser, API, database, upload path, and family guards all participate in the journey.
 */
function signedInitData(subject: number, name: string, startParam?: string) {
  const fields = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1_000)),
    query_id: randomUUID(),
    user: JSON.stringify({ id: subject, first_name: name }),
  })
  if (startParam) fields.set('start_param', startParam)
  const dataCheckString = [...fields.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return fields.toString()
}

async function installTelegramHost(page: Page, initData: string) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((value) => {
    const backHandlers = new Set<() => void>()
    ;(window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack = () => backHandlers.forEach((handler) => handler())
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: {
        WebApp: {
          initData: value,
          version: '8.0',
          platform: 'tdesktop',
          safeAreaInset: { top: 24, bottom: 18 },
          contentSafeAreaInset: { top: 24, bottom: 18 },
          BackButton: {
            show() {},
            hide() {},
            onClick(handler: () => void) { backHandlers.add(handler) },
            offClick(handler: () => void) { backHandlers.delete(handler) },
          },
          ready() {},
        },
      },
    })
  }, initData)
}

async function createCompletedOwner(page: Page, subject: number): Promise<Owner> {
  const familyCreations: string[] = []
  const childCompletions: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && path === '/api/v1/families') familyCreations.push(path)
    if (request.method() === 'PUT' && /\/api\/v1\/families\/[^/]+\/child$/.test(path)) childCompletions.push(path)
  })

  await installTelegramHost(page, signedInitData(subject, 'Организатор E2E'))
  const telegramExchange = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/telegram'))
  await page.goto('/')
  expect((await telegramExchange).status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Создать семью' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать семью' }).click()
  await expect(page.getByRole('heading', { name: 'Расскажите о ребёнке' })).toBeVisible()

  // A completed profile is intentionally stricter than the old optional-child bootstrap.
  await page.getByRole('button', { name: 'Создать семейную ленту' }).click()
  await expect(page.getByText('Добавьте фотографию ребёнка.')).toBeVisible()
  await expect(page.getByText('Укажите имя ребёнка.')).toBeVisible()
  await expect(page.getByText('Укажите корректную дату рождения.')).toBeVisible()
  await expect(page.getByText('Выберите вариант.')).toBeVisible()

  await page.locator('#child-avatar').setInputFiles(pngImage)
  await expect(page.getByRole('button', { name: 'Использовать фото' })).toBeVisible()
  await expect(page.locator('img[alt="Предпросмотр кадрирования"]')).toHaveJSProperty('complete', true)
  await expect(page.getByRole('button', { name: 'Использовать фото' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await page.getByRole('button', { name: 'Создать семейную ленту' }).click()
  await expect(page.getByText('Добавьте фотографию ребёнка.')).toBeVisible()
  await page.locator('#child-avatar').setInputFiles(pngImage)
  await page.locator('#avatar-crop').fill('1.2')
  await page.getByRole('button', { name: 'Сдвинуть вниз' }).click()
  await page.getByRole('button', { name: 'Использовать фото' }).click()
  await page.locator('#child-name').fill('Лиза')
  await page.locator('#child-birth-date').fill('2024-02-29')
  await page.getByRole('button', { name: 'Девочка' }).click()
  await page.getByRole('button', { name: 'Создать семейную ленту' }).dblclick()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await page.getByRole('button', { name: 'Семья' }).click()
  await expect(page.locator('[data-child-header-mode="family"]')).toBeVisible()
  await expect(page.locator('[data-slot="family-presentation"]')).toBeVisible()
  await expect(page.locator('[data-slot="family-presentation"] .family-section-head')).toContainText('Наша семья')
  await expect(page.locator('[data-slot="family-presentation"] .family-list')).toBeVisible()
  await expect(page.getByText('Семейный архив', { exact: true })).toBeVisible()
  await expect(page.getByText('Делитесь моментами с самыми близкими', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  await expect(page.locator('[data-slot="child-profile"]')).toBeVisible()
  await page.getByRole('button', { name: 'Редактировать профиль' }).click()
  await expect(page.getByRole('img', { name: 'Текущий аватар ребёнка' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.locator('[data-slot="child-profile"]')).toBeVisible()
  await page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(page.locator('[data-child-header-mode="family"]')).toBeVisible()

  // The buttons become busy synchronously; the network proves retry/double-click cannot mint
  // a second bootstrap family or child record.
  await expect.poll(() => familyCreations.length).toBe(1)
  await expect.poll(() => childCompletions.length).toBe(1)
  return { context: page.context(), page }
}

async function createInvite(page: Page, role: 'viewer' | 'full', alias: string) {
  await page.getByRole('button', { name: 'Пригласить родственника' }).click()
  const inviteSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Пригласить в семью' }),
  })
  await inviteSection.getByLabel('Имя в семье (необязательно)').fill(alias)
  await inviteSection.locator(`label[for="${role === 'full' ? 'simpleRoleFull' : 'simpleRoleView'}"]`).click()
  await inviteSection.getByRole('button', { name: 'Создать ссылку' }).click()
  await expect(page.getByRole('heading', { name: 'Приглашение готово!' })).toBeVisible()
  const link = await page.getByLabel('Ссылка приглашения').inputValue()
  const startParam = new URL(link).searchParams.get('startapp')
  expect(startParam).toMatch(/^invite_[A-Za-z0-9_-]{32,57}$/)
  return startParam!
}

type RequestLog = { accepts: string[]; familyCreations: string[]; privateFamilyRequests: string[] }

async function inviteePage(
  browser: Browser,
  subject: number,
  startParam: string,
  label: string,
  requests?: RequestLog,
) {
  const context = await browser.newContext()
  const page = await context.newPage()
  if (requests) page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && path === '/api/v1/families') {
      requests.familyCreations.push(path)
    }
    if (request.method() === 'POST' && path === '/api/v1/invites/accept') {
      requests.accepts.push(path)
    }
    if (path.startsWith('/api/v1/families/')) requests.privateFamilyRequests.push(path)
  })
  await installTelegramHost(page, signedInitData(subject, label, startParam))
  await page.goto('/')
  return { context, page }
}

test('onboards a child and accepts a viewer invite only after explicit bot-start confirmation', async ({ browser, page }) => {
  const owner = await createCompletedOwner(page, 81000011)
  await owner.page.setViewportSize({ width: 390, height: 844 })
  await owner.page.evaluate(() => window.scrollTo(0, 0))
  await expect(owner.page.locator('[data-child-header-mode="family"]')).toBeVisible()
  expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await owner.page.screenshot({ path: resolve('e2e/.artifacts/full-ui-family-390.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Настройки' }).click()
  await expect(owner.page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
  expect(await owner.page.locator('[data-slot="memoly-bottom-sheet"] > div:last-child').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThanOrEqual(38)
  await owner.page.screenshot({ path: resolve('e2e/.artifacts/full-ui-settings-390.png'), animations: 'disabled' })
  await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  await expect(owner.page.locator('[data-slot="memoly-settings-sheet"]')).toHaveCount(0)
  await owner.page.getByRole('button', { name: 'Настройки' }).click()
  await owner.page.getByRole('button', { name: 'Оформление' }).click()
  await expect(owner.page.getByRole('option', { name: /^Тема:/ })).toHaveCount(6)
  await owner.page.getByRole('option', { name: 'Тема: Небо' }).click()
  await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', 'sky')
  await owner.page.getByRole('button', { name: 'Закрыть' }).click()
  const startParam = await createInvite(owner.page, 'viewer', 'Тётя Ира')

  const requests: RequestLog = { accepts: [], familyCreations: [], privateFamilyRequests: [] }
  const guest = await inviteePage(browser, 81000012, startParam, 'Приглашённая E2E', requests)

  await expect(guest.page.getByRole('heading', { name: 'Приглашение в семью' })).toBeVisible()
  await expect(guest.page.getByText('Наша семья')).toBeVisible()
  await expect(guest.page.getByText('Лиза', { exact: true })).toHaveCount(0)
  await expect(guest.page.getByRole('button', { name: 'Присоединиться' })).toBeVisible()
  await expect.poll(() => requests.privateFamilyRequests).toEqual([])

  // Reloading a preview preserves invite intent and never performs an implicit accept.
  await guest.page.reload()
  await expect(guest.page.getByRole('button', { name: 'Присоединиться' })).toBeVisible()
  await expect.poll(() => requests.privateFamilyRequests).toEqual([])

  await guest.page.getByRole('button', { name: 'Присоединиться' }).dblclick()
  await expect(guest.page.getByRole('button', { name: 'Семья' })).toBeVisible()
  await guest.page.getByRole('button', { name: 'Семья' }).click()
  await expect(guest.page.getByText('Тётя Ира', { exact: true })).toBeVisible()
  await expect(guest.page.getByRole('button', { name: 'Пригласить родственника' })).toHaveCount(0)
  await expect(guest.page.getByRole('button', { name: 'Удалить участника' })).toHaveCount(0)
  await expect(guest.page.getByRole('img', { name: 'Режим просмотра' })).toBeVisible()
  await guest.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  await expect(guest.page.locator('[data-slot="child-profile"]')).toBeVisible()
  await expect(guest.page.getByRole('button', { name: 'Редактировать профиль' })).toHaveCount(0)
  await expect(guest.page.getByRole('button', { name: 'Сменить фото' })).toHaveCount(0)
  await guest.page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect.poll(() => requests.accepts.length).toBe(1)

  await guest.page.reload()
  await guest.page.getByRole('button', { name: 'Семья' }).click()
  await expect(guest.page.locator('[data-child-header-mode="family"]')).toBeVisible()
  await expect(guest.page.getByText('Тётя Ира', { exact: true })).toBeVisible()
  await expect(guest.page.getByText('Это приглашение уже использовано.')).toHaveCount(0)
  await expect.poll(() => requests.accepts.length).toBe(1)

  await owner.page.getByRole('button', { name: 'Готово' }).click()
  const alreadyMemberStartParam = await createInvite(owner.page, 'full', 'Не менять существующее имя')
  const alreadyMemberRequests: RequestLog = {
    accepts: [], familyCreations: [], privateFamilyRequests: [],
  }
  const alreadyMember = await inviteePage(
    browser,
    81000012,
    alreadyMemberStartParam,
    'Приглашённая E2E',
    alreadyMemberRequests,
  )
  await alreadyMember.page.getByRole('button', { name: 'Семья' }).click()
  await expect(alreadyMember.page.locator('[data-child-header-mode="family"]')).toBeVisible()
  await expect(alreadyMember.page.getByText('Тётя Ира', { exact: true })).toBeVisible()
  await expect(alreadyMember.page.getByText('Это приглашение уже использовано.')).toHaveCount(0)
  await expect.poll(() => alreadyMemberRequests.accepts.length).toBe(0)
  await alreadyMember.context.close()

  guest.page.once('dialog', (dialog) => dialog.accept())
  await guest.page.getByRole('button', { name: 'Выйти из семьи' }).click()
  await expect(guest.page.getByRole('button', { name: 'Создать семью' })).toBeVisible()
  await expect(guest.page.getByText('Создайте семейную ленту, чтобы добавить профиль ребёнка.')).toBeVisible()

  // Leaving clears the active context.  It must not quietly bootstrap another family.
  await expect.poll(() => requests.familyCreations.length).toBe(0)
  await guest.context.close()
  await owner.context.close()
})

test('a full member can invite but cannot gain owner management rights, and revoked deep links stay safe', async ({ browser, page }) => {
  const owner = await createCompletedOwner(page, 81000021)
  const fullStartParam = await createInvite(owner.page, 'full', 'Дедушка Павел')
  const full = await inviteePage(browser, 81000022, fullStartParam, 'Полный E2E')
  await full.page.getByRole('button', { name: 'Присоединиться' }).click()
  await full.page.getByRole('button', { name: 'Семья' }).click()
  await expect(full.page.getByText('Дедушка Павел', { exact: true })).toBeVisible()
  await expect(full.page.locator('[data-slot="family-presentation"]')).toBeVisible()
  await expect(full.page.getByRole('button', { name: 'Пригласить родственника' })).toBeVisible()
  await expect(full.page.getByRole('button', { name: 'Удалить участника' })).toHaveCount(0)
  await expect(full.page.getByRole('button', { name: 'Владелец' })).toHaveCount(0)
  await createInvite(full.page, 'viewer', 'Внучка Нина')

  // The owner never gets self-demotion/removal controls, even after a full member joins.
  await owner.page.reload()
  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await owner.page.getByRole('button', { name: 'Открыть участника: Дедушка Павел' }).click()
  await expect(owner.page.getByRole('button', { name: 'Удалить участника' })).toHaveCount(1)
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(owner.page.getByRole('button', { name: 'Владелец' })).toHaveCount(0)

  const revokedStartParam = await createInvite(owner.page, 'viewer', 'Отозванный гость')
  await owner.page.getByRole('button', { name: 'Готово' }).click()
  await owner.page.getByRole('button', { name: 'Отозвать' }).first().click()
  const revoked = await inviteePage(browser, 81000023, revokedStartParam, 'Отозванный E2E')
  await expect(revoked.page.getByText('Это приглашение отозвано.')).toBeVisible()
  await expect(revoked.page.locator('[data-child-header-mode="family"]')).toHaveCount(0)

  await revoked.context.close()
  await full.context.close()
  await owner.context.close()
})

test('keeps Family and Settings within the viewport at supported mobile widths', async ({ page }) => {
  const owner = await createCompletedOwner(page, 81000031)
  const widths = [320, 390, 430, 480] as const

  for (const width of widths) {
    await owner.page.setViewportSize({ width, height: 844 })
    await owner.page.evaluate(() => window.scrollTo(0, 0))

    const family = owner.page.locator('[data-slot="family-presentation"]')
    await expect(family).toBeVisible()
    await expect(family.locator('.family-section-head')).toBeVisible()
    await expect(family.getByRole('button', { name: 'Пригласить родственника' })).toBeVisible()
    await expect(owner.page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()

    const familyLayout = await owner.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    expect(familyLayout.viewportWidth).toBe(width)
    expect(familyLayout.scrollWidth).toBeLessThanOrEqual(width)
    await owner.page.screenshot({
      path: resolve(`e2e/.artifacts/full-ui-family-${width}.png`),
      animations: 'disabled',
    })

    await owner.page.getByRole('button', { name: 'Настройки' }).click()
    const settings = owner.page.locator('[data-slot="memoly-settings-sheet"]')
    const sheet = owner.page.locator('[data-slot="memoly-bottom-sheet"]')
    await expect(settings).toBeVisible()
    await expect(settings.locator('.ml-sheet-row')).toHaveCount(3)
    await expect(settings.getByText('Оформление', { exact: true })).toBeVisible()
    await expect(settings.getByText('Помощь и приватность', { exact: true })).toBeVisible()
    await expect(settings.getByText('О memoLy', { exact: true })).toBeVisible()

    const sheetBounds = await sheet.boundingBox()
    expect(sheetBounds).not.toBeNull()
    expect(sheetBounds!.x).toBeGreaterThanOrEqual(-1)
    expect(sheetBounds!.width).toBeLessThanOrEqual(width + 1)
    expect(sheetBounds!.y).toBeGreaterThanOrEqual(0)
    const settingsLayout = await owner.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    expect(settingsLayout.viewportWidth).toBe(width)
    expect(settingsLayout.scrollWidth).toBeLessThanOrEqual(width)
    await owner.page.screenshot({
      path: resolve(`e2e/.artifacts/full-ui-settings-${width}.png`),
      animations: 'disabled',
    })

    await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
    await expect(settings).toHaveCount(0)
  }

  await owner.context.close()
})

test('child profile keeps protected avatar, actions, and geometry at mobile widths', async ({ page }, testInfo) => {
  const owner = await createCompletedOwner(page, 81000041)
  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  const profile = owner.page.locator('[data-slot="child-profile"]')
  await expect(profile).toBeVisible()
  await expect(profile.locator('[data-slot="child-avatar-image"]')).toHaveAttribute('src', /^blob:/)
  await expect(profile).toContainText('Лиза')
  await profile.getByRole('button', { name: 'Возраст и дата рождения' }).click()
  await expect(profile).toContainText('Полных месяцев')
  await profile.getByRole('button', { name: 'Назад к профилю ребёнка' }).click()

  for (const width of [320, 390, 430, 480]) {
    await owner.page.setViewportSize({ width, height: 844 })
    await owner.page.evaluate(() => window.scrollTo(0, 0))
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await owner.page.screenshot({ path: testInfo.outputPath(`child-profile-${width}.png`), animations: 'disabled' })
  }

  await profile.getByRole('button', { name: 'Сменить фото' }).click()
  await expect(owner.page.getByRole('button', { name: 'Заменить фотографию' })).toBeVisible()
  await owner.page.getByRole('button', { name: 'Отмена' }).click()
  await expect(profile).toBeVisible()
  await owner.context.close()
})
