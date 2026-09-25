import type { Browser, BrowserContext, Page } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
  await expect(page.getByRole('heading', { name: 'Фотография ребёнка' })).toBeVisible()
  await expect(page.locator('[data-slot="child-photo-crop"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Использовать это фото' })).toBeVisible()
  await expect(page.locator('img[alt="Предпросмотр кадрирования"]')).toHaveJSProperty('complete', true)
  await expect(page.getByRole('button', { name: 'Использовать это фото' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Отменить кадрирование' })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить кадрирование' }).click()
  await page.getByRole('button', { name: 'Создать семейную ленту' }).click()
  await expect(page.getByText('Добавьте фотографию ребёнка.')).toBeVisible()
  await page.locator('#child-avatar').setInputFiles(pngImage)
  await page.locator('#avatar-crop').fill('1.2')
  await page.getByRole('button', { name: 'Сдвинуть вниз' }).click()
  await page.getByRole('button', { name: 'Использовать это фото' }).click()
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
  await page.getByRole('button', { name: 'Назад к профилю ребёнка' }).click()
  await expect(page.locator('[data-slot="child-profile"]')).toBeVisible()
  await page.locator('summary[aria-label="Дополнительные действия профиля ребёнка"]').click()
  await page.getByRole('button', { name: 'Сменить фото' }).click()
  await page.locator('#child-avatar').setInputFiles(pngImage)
  await expect(page.locator('[data-slot="child-photo-crop"]')).toBeVisible()
  await page.getByRole('button', { name: 'Использовать это фото' }).click()
  await page.getByRole('button', { name: 'Сохранить фото' }).click()
  await expect(page.getByText('Фото обновлено!', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Перейти в профиль' }).click()
  await expect(page.locator('[data-slot="child-profile"]')).toBeVisible()
  await page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(page.locator('[data-child-header-mode="family"]')).toBeVisible()

  // The buttons become busy synchronously; the network proves retry/double-click cannot mint
  // a second bootstrap family or child record.
  await expect.poll(() => familyCreations.length).toBe(1)
  await expect.poll(() => childCompletions.length).toBe(1)
  return { context: page.context(), page }
}

async function createInvite(page: Page, role: 'viewer' | 'full', alias: string, capture = false) {
  await page.getByRole('button', { name: 'Пригласить родственника' }).click()
  const inviteSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Пригласить родственника' }),
  })
  await inviteSection.getByLabel('Имя в семье').fill(alias)
  await inviteSection.locator(`#${role === 'full' ? 'simpleRoleFull' : 'simpleRoleView'}`).check()
  if (capture) for (const width of [320, 390, 430, 480]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: resolve(`e2e/.artifacts/invite-create-${width}.png`), animations: 'disabled' })
  }
  await inviteSection.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(page.getByRole('heading', { name: 'Приглашение готово!' })).toBeVisible()
  if (capture) for (const width of [320, 390, 430, 480]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: resolve(`e2e/.artifacts/invite-ready-${width}.png`), animations: 'disabled', mask: [page.getByLabel('Ссылка приглашения')] })
  }
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
  expect(await owner.page.locator('[data-slot="memoly-bottom-sheet"] > div:last-child').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThanOrEqual(32)
  await owner.page.screenshot({ path: resolve('e2e/.artifacts/full-ui-settings-390.png'), animations: 'disabled' })
  await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  await expect(owner.page.locator('[data-slot="memoly-settings-sheet"]')).toHaveCount(0)
  await owner.page.getByRole('button', { name: 'Настройки' }).click()
  await owner.page.getByRole('button', { name: 'Оформление' }).click()
  await expect(owner.page.locator('[data-theme-choice]')).toHaveCount(6)
  await owner.page.locator('[data-theme-choice="sky"]').click()
  await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', 'sky')
  await owner.page.getByRole('button', { name: 'Назад' }).click()
  await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  for (const [theme, label] of [
    ['mint', 'Мята'], ['rose', 'Роза'], ['sky', 'Небо'],
    ['lavender', 'Лаванда'], ['apricot', 'Абрикос'], ['sand', 'Песок'],
  ] as const) {
    await owner.page.setViewportSize({ width: 390, height: 844 })
    await owner.page.getByRole('button', { name: 'Настройки' }).click()
    await owner.page.getByRole('button', { name: 'Оформление' }).click()
    await owner.page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
    await owner.page.getByRole('button', { name: 'Назад' }).click()
    await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
    await owner.page.getByRole('button', { name: 'Пригласить родственника' }).click()
    await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
    await owner.page.screenshot({ path: resolve(`e2e/.artifacts/invite-create-${theme}-390.png`), animations: 'disabled' })
    await owner.page.locator('.invitation-back').click()
  }
  const startParam = await createInvite(owner.page, 'viewer', 'Тётя Ира', true)
  await owner.context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await owner.page.getByRole('button', { name: 'Скопировать' }).click()
  await expect(owner.page.getByRole('status')).toContainText('Ссылка скопирована')
  await owner.page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: () => Promise.reject(new Error('Synthetic clipboard denial')) },
  }))
  await owner.page.getByRole('button', { name: 'Скопировать' }).click()
  await expect(owner.page.getByRole('alert')).toContainText('Не удалось скопировать')

  const requests: RequestLog = { accepts: [], familyCreations: [], privateFamilyRequests: [] }
  const guest = await inviteePage(browser, 81000012, startParam, 'Приглашённая E2E', requests)

  await expect(guest.page.getByRole('heading', { name: 'Вас приглашают в семью' })).toBeVisible()
  await expect(guest.page.getByText('Наша семья')).toBeVisible()
  await expect(guest.page.getByText('Лиза', { exact: true })).toHaveCount(0)
  await expect(guest.page.getByRole('button', { name: 'Присоединиться' })).toBeVisible()
  await expect(guest.page.getByText('Можно смотреть воспоминания и ставить лайки.')).toBeVisible()
  for (const width of [320, 390, 430, 480]) {
    await guest.page.setViewportSize({ width, height: 844 })
    expect(await guest.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await guest.page.screenshot({ path: resolve(`e2e/.artifacts/invite-incoming-${width}.png`), animations: 'disabled' })
  }
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

  await guest.page.getByRole('button', { name: 'Выйти из семьи' }).click()
  await guest.page.getByRole('button', { name: 'Выйти из семьи', exact: true }).last().click()
  await expect(guest.page.getByRole('button', { name: 'Создать семью' })).toBeVisible()
  await expect(guest.page.getByText('Создайте семейную ленту, чтобы добавить профиль ребёнка.')).toBeVisible()

  // Leaving clears the active context.  It must not quietly bootstrap another family.
  await expect.poll(() => requests.familyCreations.length).toBe(0)
  await guest.context.close()
  await owner.context.close()
})

test('app settings matches the six-theme appearance flow across mobile widths', async ({ browser, page }, testInfo) => {
  const owner = await createCompletedOwner(page, 81000051)
  const canonical = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
  const referenceUrl = pathToFileURL(resolve('../docs/memoly-final-functional-state-pack.html')).href
  for (const width of [320, 390, 430, 480]) {
    await owner.page.setViewportSize({ width, height: 844 })
    await canonical.setViewportSize({ width, height: 844 })
    await owner.page.getByRole('button', { name: 'Настройки' }).click()
    await expect(owner.page.locator('[data-slot="memoly-settings-sheet"][data-view="menu"]')).toBeVisible()
    await owner.page.screenshot({ path: testInfo.outputPath(`settings-menu-${width}.png`), animations: 'disabled' })
    await canonical.goto(`${referenceUrl}#settingsMenu`)
    await canonical.screenshot({ path: testInfo.outputPath(`canonical-settings-menu-${width}.png`), animations: 'disabled' })
    await owner.page.getByRole('button', { name: 'Оформление' }).click()
    await expect(owner.page.locator('[data-slot="memoly-settings-sheet"][data-view="appearance"]')).toBeVisible()
    await expect(owner.page.locator('[data-theme-choice]')).toHaveCount(6)
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await canonical.goto(`${referenceUrl}#appearanceSettings`)
    const referenceCard = await canonical.locator('#appearanceSettings .theme-option').first().boundingBox()
    const appCard = await owner.page.locator('[data-theme-choice]').first().boundingBox()
    expect(referenceCard).not.toBeNull()
    expect(appCard).not.toBeNull()
    expect(Math.abs(appCard!.x - referenceCard!.x)).toBeLessThanOrEqual(5)
    expect(Math.abs(appCard!.y - referenceCard!.y)).toBeLessThanOrEqual(18)
    expect(Math.abs(appCard!.width - referenceCard!.width)).toBeLessThanOrEqual(8)
    await canonical.screenshot({ path: testInfo.outputPath(`canonical-appearance-${width}.png`), animations: 'disabled' })
    await owner.page.screenshot({ path: testInfo.outputPath(`appearance-${width}.png`), animations: 'disabled' })
    await owner.page.getByRole('button', { name: 'Назад' }).click()
    await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  }
  await owner.page.getByRole('button', { name: 'Настройки' }).click()
  await owner.page.getByRole('button', { name: 'Оформление' }).click()
  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    await owner.page.locator(`[data-theme-choice="${theme}"]`).click()
    await expect(owner.page.locator(`[data-theme-choice="${theme}"]`)).toHaveAttribute('aria-pressed', 'true')
    await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
    await owner.page.screenshot({ path: testInfo.outputPath(`appearance-${theme}-390.png`), animations: 'disabled' })
    await canonical.locator(`#theme${theme[0].toUpperCase()}${theme.slice(1)}`).evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })) })
    await canonical.screenshot({ path: testInfo.outputPath(`canonical-appearance-${theme}-390.png`), animations: 'disabled' })
  }
  await owner.page.locator('[data-theme-choice="sky"]').focus()
  await expect(owner.page.locator('[data-theme-choice="sky"]')).toBeFocused()
  await owner.page.keyboard.press('Enter')
  await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', 'sky')
  await owner.page.locator('[data-theme-choice="sand"]').click()
  await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  await expect(owner.page.locator('[data-slot="memoly-settings-sheet"][data-view="menu"]')).toBeVisible()
  await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  await expect(owner.page.locator('[data-slot="memoly-settings-sheet"]')).toHaveCount(0)
  await owner.page.reload()
  await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', 'sand')
  await owner.page.getByRole('button', { name: 'Лента' }).click()
  await owner.page.screenshot({ path: testInfo.outputPath('regression-feed-sand.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  await expect(owner.page.locator('[data-slot="child-profile"]')).toBeVisible()
  await owner.page.screenshot({ path: testInfo.outputPath('regression-child-sand.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await owner.page.getByRole('button', { name: /Открыть участника:/ }).first().click()
  await expect(owner.page.getByRole('region', { name: 'Профиль владельца' })).toBeVisible()
  await owner.page.screenshot({ path: testInfo.outputPath('regression-member-sand.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await owner.page.getByRole('button', { name: 'Пригласить родственника' }).click()
  await owner.page.screenshot({ path: testInfo.outputPath('regression-invite-sand.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Назад' }).click()
  await owner.page.getByRole('button', { name: 'Добавить' }).click()
  await owner.page.screenshot({ path: testInfo.outputPath('regression-add-sand.png'), animations: 'disabled' })
  await canonical.close()
})

test('a full member can invite but cannot gain owner management rights, and revoked deep links stay safe', async ({ browser, page }) => {
  const owner = await createCompletedOwner(page, 81000021)
  const fullStartParam = await createInvite(owner.page, 'full', 'Дедушка Павел')
  const full = await inviteePage(browser, 81000022, fullStartParam, 'Полный E2E')
  await expect(full.page.getByText('Можно добавлять, редактировать и удалять воспоминания семьи.')).toBeVisible()
  await full.page.getByRole('button', { name: 'Присоединиться' }).click()
  await full.page.getByRole('button', { name: 'Семья' }).click()
  await expect(full.page.getByText('Дедушка Павел', { exact: true })).toBeVisible()
  await expect(full.page.locator('[data-slot="family-presentation"]')).toBeVisible()
  await expect(full.page.getByRole('button', { name: 'Пригласить родственника' })).toBeVisible()
  await expect(full.page.getByRole('button', { name: 'Удалить из семьи' })).toHaveCount(0)
  await expect(full.page.getByRole('button', { name: 'Владелец' })).toHaveCount(0)
  await full.page.getByRole('button', { name: 'Настройки' }).click()
  await expect(full.page.getByRole('button', { name: /Настройки семьи/ })).toHaveCount(0)
  await expect(full.page.getByRole('button', { name: /Семейный архив/ })).toBeVisible()
  await full.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  await createInvite(full.page, 'viewer', 'Внучка Нина')

  // The owner never gets self-demotion/removal controls, even after a full member joins.
  await owner.page.reload()
  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await owner.page.getByRole('button', { name: 'Открыть участника: Дедушка Павел' }).click()
  await expect(owner.page.getByRole('button', { name: 'Удалить из семьи' })).toHaveCount(1)
  const memberPatch = owner.page.waitForRequest((request) => request.method() === 'PATCH' && /\/members\/[^/]+$/.test(new URL(request.url()).pathname))
  await owner.page.getByRole('textbox', { name: 'Имя в семье' }).fill('Дедушка Петя')
  await owner.page.getByRole('button', { name: 'Сохранить изменения' }).click()
  const patchBody = (await memberPatch).postDataJSON() as { familyDisplayName?: string; expectedVersion?: number }
  expect(patchBody.familyDisplayName).toBe('Дедушка Петя')
  expect(patchBody.expectedVersion).toBeGreaterThan(0)
  await expect(owner.page.getByRole('heading', { name: 'Дедушка Петя' })).toBeVisible()
  await owner.page.getByRole('button', { name: 'Удалить из семьи' }).click()
  await expect(owner.page.getByRole('dialog', { name: 'Удалить участника из семьи?' })).toBeVisible()
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(owner.page.getByRole('dialog')).toHaveCount(0)
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(owner.page.getByRole('button', { name: 'Владелец' })).toHaveCount(0)

  const revokedStartParam = await createInvite(owner.page, 'viewer', 'Отозванный гость')
  await owner.page.getByRole('button', { name: 'Готово' }).click()
  await owner.page.getByRole('button', { name: 'Активные приглашения' }).click()
  await owner.page.locator('.family-management-invite-row').filter({ hasText: 'Отозванный гость' }).getByRole('button', { name: 'Отозвать' }).click()
  await owner.page.getByRole('button', { name: 'Отозвать', exact: true }).click()
  await expect(owner.page.getByRole('region', { name: 'Активные приглашения' })).toBeVisible()
  await expect(owner.page.locator('.family-management-invite-row').filter({ hasText: 'Отозванный гость' })).toHaveCount(0)
  await owner.page.getByRole('button', { name: 'Назад' }).click()
  await expect(owner.page.getByRole('button', { name: 'Открыть участника: Дедушка Петя' })).toBeVisible()
  const revoked = await inviteePage(browser, 81000023, revokedStartParam, 'Отозванный E2E')
  await expect(revoked.page.getByText('Это приглашение отозвано.')).toBeVisible()
  await revoked.page.setViewportSize({ width: 390, height: 844 })
  await revoked.page.screenshot({ path: resolve('e2e/.artifacts/invite-revoked-390.png'), animations: 'disabled' })
  await expect(revoked.page.locator('[data-child-header-mode="family"]')).toHaveCount(0)

  await revoked.context.close()
  await owner.page.getByRole('button', { name: 'Открыть участника: Дедушка Петя' }).click()
  await owner.page.getByRole('button', { name: 'Удалить из семьи' }).click()
  await owner.page.getByRole('dialog', { name: 'Удалить участника из семьи?' }).getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(owner.page.getByRole('button', { name: 'Открыть участника: Дедушка Петя' })).toHaveCount(0)
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
    await expect(settings.locator('.ml-sheet-row')).toHaveCount(5)
    await expect(settings.getByText('Оформление', { exact: true })).toBeVisible()
    await expect(settings.getByText('Помощь и приватность', { exact: true })).toBeVisible()
    await expect(settings.getByText('Семейный архив', { exact: true })).toBeVisible()
    await expect(settings.getByText('Настройки семьи', { exact: true })).toBeVisible()
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

  const navigation = owner.page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(navigation.getByRole('button', { name: 'Семья' })).toHaveAttribute('aria-current', 'page')
  await navigation.getByRole('button', { name: 'Добавить' }).click()
  await expect(owner.page.locator('[data-slot="memoly-add-sheet-panel"]')).toBeVisible()
  await owner.page.screenshot({ path: resolve('e2e/.artifacts/agent-h-family-add-480.png'), animations: 'disabled' })
  await owner.page.keyboard.press('Escape')
  await expect(owner.page.locator('[data-slot="memoly-add-sheet-panel"]')).toHaveCount(0)
  await expect(navigation.getByRole('button', { name: 'Лента' })).toHaveAttribute('aria-current', 'page')
  await navigation.getByRole('button', { name: 'Семья' }).click()
  await expect(navigation.getByRole('button', { name: 'Семья' })).toHaveAttribute('aria-current', 'page')

  await owner.context.close()
})

test('family management uses owner permissions, saves supported fields, and fits mobile themes', async ({ page }) => {
  const owner = await createCompletedOwner(page, 81000032)
  for (const width of [320, 390, 430, 480]) {
    await owner.page.setViewportSize({ width, height: 844 })
    await owner.page.getByRole('button', { name: 'Настройки' }).click()
    await owner.page.getByRole('button', { name: /Настройки семьи/ }).press('Enter')
    await expect(owner.page.locator('[data-slot="family-settings-page"]')).toBeVisible()
    const dimensions = await owner.page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }))
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport)
    await owner.page.screenshot({ path: resolve(`e2e/.artifacts/family-management-settings-${width}.png`), animations: 'disabled' })
    await owner.page.getByRole('button', { name: 'Назад' }).click()
    await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  }

  await owner.page.getByRole('button', { name: 'Настройки' }).click()
  await owner.page.getByRole('button', { name: /Настройки семьи/ }).press('Enter')
  const update = owner.page.waitForRequest((request) => request.method() === 'PATCH' && /\/families\/[^/]+$/.test(new URL(request.url()).pathname))
  await owner.page.getByRole('textbox', { name: 'Название семьи' }).fill('Семья E2E')
  await owner.page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect((await update).postDataJSON()).toEqual({ name: 'Семья E2E' })
  await expect(owner.page.getByRole('textbox', { name: 'Название семьи' })).toHaveValue('Семья E2E')
  await owner.page.getByRole('button', { name: 'Назад' }).click()
  await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())

  await owner.page.setViewportSize({ width: 390, height: 844 })
  await owner.page.getByRole('button', { name: 'Настройки' }).click()
  await owner.page.getByRole('button', { name: /Семейный архив/ }).click()
  await expect(owner.page.locator('[data-slot="family-archive-page"]')).toBeVisible()
  await owner.page.screenshot({ path: resolve('e2e/.artifacts/family-management-archive-390.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Назад' }).click()
  await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  await owner.page.getByRole('button', { name: 'Активные приглашения' }).click()
  await expect(owner.page.locator('[data-slot="family-invites-page"]')).toBeVisible()
  await owner.page.screenshot({ path: resolve('e2e/.artifacts/family-management-invites-empty-390.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Назад' }).click()
  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    await owner.page.getByRole('button', { name: 'Настройки' }).click()
    await owner.page.getByRole('button', { name: /Оформление/ }).click()
    await owner.page.locator(`[data-theme-choice="${theme}"]`).click()
    await owner.page.getByRole('button', { name: 'Назад' }).click()
    await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
    await owner.page.getByRole('button', { name: 'Настройки' }).click()
    await owner.page.getByRole('button', { name: /Настройки семьи/ }).press('Enter')
    await owner.page.screenshot({ path: resolve(`e2e/.artifacts/family-management-${theme}-390.png`), animations: 'disabled' })
    await owner.page.getByRole('button', { name: 'Назад' }).click()
    await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
  }
  await owner.context.close()
})

test('child profile editor preserves horizontal host insets at the mobile viewport', async ({ page }, testInfo) => {
  const owner = await createCompletedOwner(page, 81000024)
  await owner.page.setViewportSize({ width: 390, height: 844 })
  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  const profile = owner.page.locator('[data-slot="child-profile"]')
  await expect(profile).toBeVisible()
  await profile.getByRole('button', { name: 'Редактировать профиль' }).click()

  const editor = owner.page.locator('main.family-screen.child-screen.child-edit-v2-screen')
  await expect(editor).toBeVisible()
  const previousInsets = await editor.evaluate((element) => ({
    left: element.style.getPropertyValue('--host-inset-left'),
    right: element.style.getPropertyValue('--host-inset-right'),
  }))
  try {
    await editor.evaluate((element) => {
      element.style.setProperty('--host-inset-left', '12px')
      element.style.setProperty('--host-inset-right', '20px')
    })

    const layout = await editor.evaluate((element) => {
      const computed = getComputedStyle(element)
      const shell = getComputedStyle(element.querySelector('.child-edit-v2-shell')!)
      return {
        paddingLeft: `${parseFloat(computed.paddingLeft) + parseFloat(shell.paddingLeft)}px`,
        paddingRight: `${parseFloat(computed.paddingRight) + parseFloat(shell.paddingRight)}px`,
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        viewportWidth: window.innerWidth,
      }
    })
    expect(layout.paddingLeft).toBe('40px')
    expect(layout.paddingRight).toBe('48px')
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth)
    await owner.page.screenshot({ path: resolve('e2e/.artifacts/child-editor-390.png'), animations: 'disabled' })
  } finally {
    await editor.evaluate((element, values) => {
      if (values.left) element.style.setProperty('--host-inset-left', values.left)
      else element.style.removeProperty('--host-inset-left')
      if (values.right) element.style.setProperty('--host-inset-right', values.right)
      else element.style.removeProperty('--host-inset-right')
    }, previousInsets)
  }

  await editor.evaluate((element) => element.style.setProperty('--host-inset-top', '0px'))
  for (const width of [320, 390, 430, 480]) {
    await owner.page.setViewportSize({ width, height: 844 })
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await owner.page.screenshot({ path: testInfo.outputPath(`child-editor-${width}.png`), animations: 'disabled' })
  }
  await owner.page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    await owner.page.evaluate((value) => document.documentElement.setAttribute('data-memoly-theme', value), theme)
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await owner.page.screenshot({ path: testInfo.outputPath(`child-editor-${theme}.png`), animations: 'disabled' })
  }

  await owner.page.getByRole('button', { name: 'Назад к профилю ребёнка' }).click()
  await expect(profile).toBeVisible()
  await owner.context.close()
})

test('child profile keeps protected avatar, actions, and geometry at mobile widths', async ({ page }, testInfo) => {
  const owner = await createCompletedOwner(page, 81000041)
  const childUpdates: string[] = []
  owner.page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/api\/v1\/families\/[^/]+\/child$/.test(new URL(request.url()).pathname)) {
      childUpdates.push(request.url())
    }
  })
  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  const profile = owner.page.locator('[data-slot="child-profile"]')
  await expect(profile).toBeVisible()
  await expect(profile.locator('[data-slot="child-avatar-image"]')).toHaveAttribute('src', /^blob:/)
  await expect(profile).toContainText('Лиза')

  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await expect(owner.page.locator('[data-child-header-mode="family"]')).toBeVisible()
  await expect(profile).toHaveCount(0)

  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  await expect(profile).toHaveAttribute('aria-label', 'Профиль ребёнка')
  await profile.locator('summary[aria-label="Дополнительные действия профиля ребёнка"]').click()
  await profile.getByRole('button', { name: 'Возраст и дата рождения' }).click()
  await expect(profile).toContainText('Полных месяцев')

  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await expect(owner.page.locator('[data-child-header-mode="family"]')).toBeVisible()
  await expect(profile).toHaveCount(0)

  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  await expect(profile).toHaveAttribute('aria-label', 'Профиль ребёнка')
  await expect(profile).not.toContainText('Полных месяцев')

  for (const width of [320, 390, 430, 480]) {
    await owner.page.setViewportSize({ width, height: 844 })
    await owner.page.evaluate(() => window.scrollTo(0, 0))
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await owner.page.screenshot({ path: testInfo.outputPath(`child-profile-${width}.png`), animations: 'disabled' })
  }

  await profile.locator('summary[aria-label="Дополнительные действия профиля ребёнка"]').click()
  await profile.getByRole('button', { name: 'Сменить фото' }).click()
  await expect(owner.page.getByRole('button', { name: 'Заменить фотографию' })).toBeVisible()
  await owner.page.getByRole('button', { name: 'Отмена' }).click()
  await expect(profile).toBeVisible()
  expect(childUpdates).toHaveLength(0)
  await owner.context.close()
})

test('changing the child photo uses a focused confirmation flow and preserves profile details', async ({ page }, testInfo) => {
  const childUpdates: Array<{ method: string; body: Record<string, unknown> }> = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if ((request.method() === 'PUT' && /\/api\/v1\/families\/[^/]+\/child$/.test(path))
      || (request.method() === 'PATCH' && /\/api\/v1\/families\/[^/]+$/.test(path))) {
      childUpdates.push({ method: request.method(), body: request.postDataJSON() as Record<string, unknown> })
    }
  })
  const owner = await createCompletedOwner(page, 81000014)
  const previousPhotoUpdate = childUpdates.findLast((update) => update.method === 'PATCH')
  expect(previousPhotoUpdate).toBeDefined()
  const previousChild = previousPhotoUpdate!.body.child as Record<string, unknown>
  const initialAvatarMediaId = previousChild.avatarMediaId
  const expectedVersion = Number(previousChild.expectedVersion) + 1
  const updatesBeforePhotoChange = childUpdates.length

  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  const originalAvatarUrl = await owner.page.locator('[data-slot="child-avatar-image"]').getAttribute('src')
  await owner.page.locator('summary[aria-label="Дополнительные действия профиля ребёнка"]').click()
  await owner.page.getByRole('button', { name: 'Сменить фото' }).click()
  await expect(owner.page.getByRole('heading', { name: 'Сменить фото ребёнка' })).toBeVisible()
  await expect(owner.page.locator('#child-name')).toHaveCount(0)
  await expect(owner.page.locator('#child-birth-date')).toHaveCount(0)
  await expect(owner.page.getByRole('button', { name: 'Сохранить фото' })).toBeDisabled()

  await expect.poll(() => childUpdates.length).toBe(updatesBeforePhotoChange)
  await owner.page.locator('#child-avatar').setInputFiles(pngImage)
  await expect(owner.page.getByRole('button', { name: 'Использовать это фото' })).toBeEnabled()
  const cropScreen = owner.page.locator('main.child-photo-v2-screen')
  await expect(cropScreen.locator('.child-crop-v2-ring')).toBeVisible()
  await expect(cropScreen.getByText('Выбрать другое фото')).toBeVisible()
  await cropScreen.evaluate((element) => element.style.setProperty('--host-inset-top', '0px'))
  for (const width of [320, 390, 430, 480]) {
    await owner.page.setViewportSize({ width, height: 844 })
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(cropScreen.getByRole('button', { name: 'Использовать это фото' })).toBeInViewport()
    await owner.page.screenshot({ path: testInfo.outputPath(`child-photo-crop-${width}.png`), animations: 'disabled' })
  }
  await owner.page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    await owner.page.evaluate((value) => document.documentElement.setAttribute('data-memoly-theme', value), theme)
    expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await owner.page.screenshot({ path: testInfo.outputPath(`child-photo-crop-${theme}.png`), animations: 'disabled' })
  }
  await owner.page.evaluate(() => document.documentElement.setAttribute('data-memoly-theme', 'mint'))
  const preview = cropScreen.getByRole('img', { name: 'Предпросмотр кадрирования' })
  const originalTransform = await preview.evaluate((image) => image.style.transform)
  await cropScreen.getByRole('slider', { name: 'Масштаб' }).fill('1.2')
  expect(await preview.evaluate((image) => image.style.transform)).not.toBe(originalTransform)
  await cropScreen.getByRole('slider', { name: 'Масштаб' }).fill('1')
  await owner.page.getByRole('button', { name: 'Использовать это фото' }).click()
  await expect(owner.page.getByRole('button', { name: 'Сохранить фото' })).toBeEnabled()
  await owner.page.getByRole('button', { name: 'Сохранить фото' }).click()

  await expect(owner.page.getByText('Фото обновлено!', { exact: true })).toBeVisible()
  await owner.page.screenshot({ path: testInfo.outputPath('child-photo-saved-390.png'), animations: 'disabled' })
  await owner.page.getByRole('button', { name: 'Перейти в профиль' }).click()
  await expect(owner.page.locator('[data-slot="child-profile"]')).toBeVisible()
  await expect.poll(() => childUpdates.length).toBe(updatesBeforePhotoChange + 1)
  expect(childUpdates.at(-1)?.method).toBe('PATCH')
  const patchChild = childUpdates.at(-1)!.body.child as Record<string, unknown>
  expect(Object.keys(patchChild).sort()).toEqual(['avatarCrop', 'avatarMediaId', 'expectedVersion'])
  expect(patchChild.avatarMediaId).toEqual(expect.any(String))
  expect(patchChild.avatarMediaId).not.toBe(initialAvatarMediaId)
  expect(patchChild.avatarCrop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  expect(patchChild.expectedVersion).toBe(expectedVersion)
  await expect(owner.page.locator('[data-slot="child-profile"]')).toContainText('Лиза')
  const updatedAvatar = owner.page.locator('[data-slot="child-avatar-image"]')
  await expect(updatedAvatar).toHaveAttribute('src', /^blob:/)
  expect(await updatedAvatar.getAttribute('src')).not.toBe(originalAvatarUrl)
  await owner.context.close()
})
