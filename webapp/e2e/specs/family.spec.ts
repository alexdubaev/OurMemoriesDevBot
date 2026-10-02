import type { Browser, BrowserContext, Page } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPrisma } from '../../../backend/src/db'
import { Prisma } from '../../../backend/src/generated/prisma/client'

import { jpegImage, pngImage } from '../helpers/images'
import { expect, test } from '../helpers/test'

type Owner = { context: BrowserContext; page: Page }

async function confirmAvatarEditor(page: Page, zoom?: string) {
  const editor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor).toBeVisible()
  if (zoom) await editor.getByRole('slider', { name: 'Масштаб' }).fill(zoom)
  await expect(editor.getByRole('button', { name: 'Готово' })).toBeEnabled()
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(editor).toBeHidden()
}

type HeaderGeometry = {
  avatar: { x: number; y: number; width: number; height: number }
  copy: { x: number; y: number; width: number; height: number }
  gap: string
  age: string
}

async function assertFamilyHeader(page: Page, label: string, compareTo?: HeaderGeometry, mode: 'feed' | 'family' = 'feed', childName = 'Лиза', hasPhoto = true) {
  const header = page.locator(`[data-child-header-mode="${mode}"]`)
  const avatar = header.locator('.child-avatar-wrap')
  const image = header.locator('[data-slot="child-avatar-image"]')
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(header).toBeVisible()
  await expect(header.getByText(childName, { exact: true })).toBeVisible()
  const age = (await header.locator('.child-age').innerText()).trim()
  expect(age).not.toBe('')
  if (hasPhoto) {
    await expect(image).toHaveAttribute('alt', `Аватар ${childName}`)
    await expect(image).toHaveAttribute('src', /^blob:/)
    await expect(image).toHaveJSProperty('complete', true)
    expect(await image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  } else {
    await expect(image).toHaveCount(0)
    await expect(avatar.locator('[data-slot="avatar-letter"]')).toBeVisible()
  }
  const geometry = await page.evaluate((headerMode) => {
    const root = document.querySelector(`[data-child-header-mode="${headerMode}"]`)!
    const avatarElement = root.querySelector('.child-avatar-wrap')!
    const copyElement = root.querySelector('.child-copy')!
    const box = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    return {
      avatar: box(avatarElement),
      copy: box(copyElement),
      gap: getComputedStyle(root.querySelector('.profile-row')!).columnGap,
    }
  }, mode)
  expect(geometry.avatar.width).toBe(76)
  expect(geometry.avatar.height).toBe(76)
  expect(geometry.copy.x - geometry.avatar.x - geometry.avatar.width).toBeGreaterThanOrEqual(9.5)
  const snapshot: HeaderGeometry = { ...geometry, age }
  if (compareTo) expect(snapshot).toEqual(compareTo)
  const state = hasPhoto ? childName === 'Лиза' ? 'photo' : 'long-name' : 'fallback'
  await page.screenshot({ path: resolve(`e2e/.artifacts/family-header-${mode}-${label}-${state}-${page.viewportSize()!.width}.png`), animations: 'disabled' })
  return snapshot
}

async function openFeedForMember(page: Page) {
  const card = page.locator('[data-slot="family-hub"] .family-hub-card')
  await expect(card).toHaveCount(1)
  await expect(card).toBeEnabled()
  await card.click()
  await expect(page.locator('[data-child-header-mode="feed"]')).toBeVisible()
}

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
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать свою семью' }).click()
  await expect(page.getByRole('heading', { name: 'Расскажите о ребёнке' })).toBeVisible()

  // A completed profile is intentionally stricter than the old optional-child bootstrap.
  await page.getByRole('button', { name: 'Создать семейную ленту' }).click()
  await expect(page.getByText('Добавьте фотографию ребёнка.')).toBeVisible()
  await expect(page.getByText('Укажите имя ребёнка.')).toBeVisible()
  await expect(page.getByText('Укажите корректную дату рождения.')).toBeVisible()
  await expect(page.getByText('Выберите вариант.')).toBeVisible()

  await page.getByTestId('child-avatar-file').setInputFiles(pngImage)
  const firstEditor = page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(firstEditor).toBeVisible()
  await expect(firstEditor.getByRole('slider', { name: 'Масштаб' })).toBeVisible()
  await firstEditor.getByRole('button', { name: 'Отмена' }).click()
  expect(childCompletions).toHaveLength(0)
  await page.getByTestId('child-avatar-file').setInputFiles(pngImage)
  await confirmAvatarEditor(page, '1.4')
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
  await page.getByTestId('child-avatar-file').setInputFiles(pngImage)
  await expect(page.getByRole('dialog', { name: 'Редактирование фотографии' })).toBeVisible()
  await confirmAvatarEditor(page)
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
  const continueWelcome = page.getByRole('button', { name: 'Продолжить' })
  await continueWelcome.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
  if (await continueWelcome.isVisible().catch(() => false)) await continueWelcome.click()
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
  expect(await owner.page.locator('[data-memoly-bottom-sheet="true"] > .memoly-bottom-sheet-body').evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingBottom))).toBeGreaterThanOrEqual(32)
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

  await expect(guest.page.locator('[data-slot="welcome-splash"]')).toBeVisible()
  await expect(guest.page.locator('[data-slot="welcome-splash"] .continue-button')).toBeVisible()
  await expect(guest.page.getByRole('heading', { name: 'Вас приглашают в семью' })).toHaveCount(0)
  await expect(guest.page.getByRole('button', { name: 'Присоединиться' })).toHaveCount(0)
  await guest.page.locator('[data-slot="welcome-splash"] .continue-button').click({ timeout: 8_000 })
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
  await expect(guest.page.locator('[data-slot="welcome-splash"]')).toHaveCount(0)
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
  await expect(guest.page.getByRole('button', { name: 'Создать свою семью' })).toBeVisible()
  await expect(guest.page.getByText('Пока здесь нет семей')).toBeVisible()

  // Leaving clears the active context.  It must not quietly bootstrap another family.
  await expect.poll(() => requests.familyCreations.length).toBe(0)
  await guest.context.close()
  await owner.context.close()
})

test('Feed child header uses the same photo and geometry for own, viewer, and full families', async ({ browser, page }) => {
  const ownerSubject = 82_000_000 + Math.floor(Math.random() * 10_000_000)
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  await prisma.pilotAdmission.create({ data: { provider: 'telegram', subject: String(ownerSubject) } })
  const childPhotoRequests: Record<'owner' | 'viewer' | 'full', string[]> = { owner: [], viewer: [], full: [] }
  const recordChildPhotoRequest = (role: keyof typeof childPhotoRequests, expectedPath: string) => (request: import('@playwright/test').Request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path === expectedPath) childPhotoRequests[role].push(path)
  }
  const owner = await createCompletedOwner(page, ownerSubject)
  const ownerGeometry = new Map<number, HeaderGeometry>()
  const identity = await prisma.externalIdentity.findUniqueOrThrow({
    where: { provider_subject: { provider: 'telegram', subject: String(ownerSubject) } },
    include: { user: { include: { ownedFamilies: { include: { children: true } } } } },
  })
  const ownFamily = identity.user.ownedFamilies[0]!
  const childAvatarMediaId = ownFamily.children[0]!.avatarMediaId!
  const expectedChildPhotoPath = `/api/v1/families/${ownFamily.id}/media/${childAvatarMediaId}/content`
  const ownerPhotoListener = recordChildPhotoRequest('owner', expectedChildPhotoPath)
  page.on('request', ownerPhotoListener)
  await owner.page.getByRole('button', { name: 'Лента' }).click()
  for (const width of [320, 390, 430]) {
    await owner.page.setViewportSize({ width, height: 844 })
    ownerGeometry.set(width, await assertFamilyHeader(owner.page, 'owner'))
  }

  await owner.page.getByRole('button', { name: 'Семья' }).click()
  const viewerStartParam = await createInvite(owner.page, 'viewer', 'Бабушка Viewer')
  const viewer = await inviteePage(browser, ownerSubject + 1, viewerStartParam, 'Viewer Header E2E')
  const viewerPhotoListener = recordChildPhotoRequest('viewer', expectedChildPhotoPath)
  viewer.page.on('request', viewerPhotoListener)
  await viewer.page.getByRole('button', { name: 'Присоединиться' }).click()
  await viewer.page.getByRole('button', { name: 'Лента' }).click()
  for (const width of [320, 390, 430]) {
    await viewer.page.setViewportSize({ width, height: 844 })
    await assertFamilyHeader(viewer.page, 'viewer', ownerGeometry.get(width))
  }
  await owner.page.getByRole('button', { name: 'Готово' }).click()

  await owner.page.getByRole('button', { name: 'Семья' }).click()
  const fullStartParam = await createInvite(owner.page, 'full', 'Дядя Full')
  const full = await inviteePage(browser, ownerSubject + 2, fullStartParam, 'Full Header E2E')
  const fullPhotoListener = recordChildPhotoRequest('full', expectedChildPhotoPath)
  full.page.on('request', fullPhotoListener)
  await full.page.getByRole('button', { name: 'Присоединиться' }).click()
  await full.page.getByRole('button', { name: 'Лента' }).click()
  for (const width of [320, 390, 430]) {
    await full.page.setViewportSize({ width, height: 844 })
    await assertFamilyHeader(full.page, 'full', ownerGeometry.get(width))
  }
  await owner.page.getByRole('button', { name: 'Готово' }).click()
  const child = ownFamily.children[0]!
  const longName = 'Александра Константиновна Длинная Фамилия'
  await prisma.child.update({ where: { id: child.id }, data: { displayName: longName } })
  const refreshedViewer = await inviteePage(browser, ownerSubject + 1, '', 'Viewer Header Reload')
  const refreshedFull = await inviteePage(browser, ownerSubject + 2, '', 'Full Header Reload')
  const refreshedSessions = [
    ['owner', owner], ['viewer', refreshedViewer], ['full', refreshedFull],
  ] as const
  await owner.page.reload()
  await openFeedForMember(owner.page)
  for (const [label, session] of refreshedSessions.slice(1)) {
    if (label !== 'owner') await openFeedForMember(session.page)
  }
  for (const [label, session] of refreshedSessions) {
    for (const width of [320, 390, 430]) {
      await session.page.setViewportSize({ width, height: 844 })
      await assertFamilyHeader(session.page, label, ownerGeometry.get(width), 'feed', longName)
    }
  }
  await prisma.child.update({ where: { id: child.id }, data: { avatarMediaId: null, avatarCrop: Prisma.DbNull } })
  for (const [label, session] of refreshedSessions) {
    await session.page.reload()
    await openFeedForMember(session.page)
    for (const width of [320, 390, 430]) {
      await session.page.setViewportSize({ width, height: 844 })
      await assertFamilyHeader(session.page, label, ownerGeometry.get(width), 'feed', longName, false)
    }
  }
  await prisma.$disconnect()
  await viewer.context.close()
  for (const role of ['owner', 'viewer', 'full'] as const) {
    expect(childPhotoRequests[role].length).toBeGreaterThan(0)
    expect(childPhotoRequests[role].every((path) => path === expectedChildPhotoPath)).toBe(true)
  }
  owner.page.off('request', ownerPhotoListener)
  viewer.page.off('request', viewerPhotoListener)
  full.page.off('request', fullPhotoListener)
  await full.context.close()
  await refreshedViewer.context.close()
  await refreshedFull.context.close()
  await owner.context.close()
})

test('ordinary reload and list retry preserve explicit family selection', async ({ page }) => {
  await createCompletedOwner(page, 81000013)
  await page.getByRole('button', { name: '‹ Все семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  await page.locator('[data-slot="family-hub"] .family-hub-card').click()
  await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
  await page.getByRole('button', { name: '‹ Все семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()

  let failHome = true
  await page.route('**/api/v1/me/families', (route) => {
    if (failHome) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
    return route.continue()
  })
  await page.reload()
  await expect(page.getByText('Не удалось загрузить семьи')).toBeVisible()
  failHome = false
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('[data-slot="family-hub"] .family-hub-card')).toHaveCount(1)
  await page.locator('[data-slot="family-hub"] .family-hub-card').click()
  await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
  await expect(page.locator('.family-context-title')).toHaveText('Наша семья')
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
    await expect(owner.page.locator('.ml-settings-sheet[data-view="menu"] [data-settings-row]').first()).toHaveAttribute('data-settings-row', 'palette')
    await expect(owner.page.locator('[data-settings-row]')).toHaveCount(5)
    expect(await owner.page.locator('[data-settings-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-settings-row')))).toEqual(['palette', 'help-circle', 'archive-box', 'pencil', 'circle-info'])
    await expect(owner.page.locator('[data-slot="memoly-bottom-sheet-handle"]')).toHaveCount(1)
    await expect(owner.page.locator('[data-slot="drawer-handle"]')).toHaveCount(0)
    await owner.page.screenshot({ path: testInfo.outputPath(`settings-menu-${width}.png`), animations: 'disabled' })
    await canonical.goto(`${referenceUrl}#settingsMenu`)
    const hostBottomInset = await owner.page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--host-inset-bottom')) || 0)
    await canonical.locator('#settingsMenu .ml-sheet-panel').evaluate((panel, inset) => panel.setAttribute('style', `padding-bottom: calc(14px + ${inset}px) !important`), hostBottomInset)
    await canonical.screenshot({ path: testInfo.outputPath(`canonical-settings-menu-${width}.png`), animations: 'disabled' })
    if (width === 390) {
      const metrics = await Promise.all([
        owner.page.locator('[data-memoly-bottom-sheet="true"]'),
        canonical.locator('#settingsMenu .ml-sheet-panel'),
      ].map((locator) => locator.evaluate((panel) => {
        const row = panel.querySelector('.ml-sheet-row')
        const rect = panel.getBoundingClientRect()
        const rowRect = row?.getBoundingClientRect()
        const handle = panel.querySelector('[data-slot="memoly-bottom-sheet-handle"]') ?? panel.querySelector('.ml-sheet-handle')
        const handleRect = handle?.getBoundingClientRect()
        return { panelTop: rect.top, panelHeight: rect.height, firstRowTop: rowRect?.top, firstRowHeight: rowRect?.height, handleTop: handleRect?.top, handleHeight: handleRect?.height }
      })))
      for (const key of ['panelTop', 'panelHeight', 'firstRowTop', 'firstRowHeight', 'handleTop', 'handleHeight'] as const) {
        expect(Math.abs((metrics[0]![key] ?? 0) - (metrics[1]![key] ?? 0))).toBeLessThanOrEqual(3)
      }
    }
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
    await owner.page.getByRole('button', { name: 'Назад' }).click()
    await expect(owner.page.locator('[data-settings-row]')).toHaveCount(5)
    await owner.page.screenshot({ path: testInfo.outputPath(`settings-menu-${theme}-390.png`), animations: 'disabled' })
    await canonical.goto(`${referenceUrl}#settingsMenu`)
    const hostBottomInset = await owner.page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--host-inset-bottom')) || 0)
    await canonical.locator('#settingsMenu .ml-sheet-panel').evaluate((panel, inset) => panel.setAttribute('style', `padding-bottom: calc(14px + ${inset}px) !important`), hostBottomInset)
    await canonical.locator(`#theme${theme[0].toUpperCase()}${theme.slice(1)}`).evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })) })
    await canonical.screenshot({ path: testInfo.outputPath(`canonical-settings-menu-${theme}-390.png`), animations: 'disabled' })
    await owner.page.getByRole('button', { name: 'Оформление' }).click()
  }
  await owner.page.locator('[data-theme-choice="sky"]').focus()
  await expect(owner.page.locator('[data-theme-choice="sky"]')).toBeFocused()
  await owner.page.keyboard.press('Enter')
  await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', 'sky')
  const sandSaved = owner.page.waitForResponse((response) => response.url().endsWith('/api/users/me') && response.request().method() === 'PATCH')
  await owner.page.locator('[data-theme-choice="sand"]').click()
  await sandSaved
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
  await expect(owner.page.getByRole('textbox', { name: 'Имя профиля' })).toHaveCount(0)
  await expect(owner.page.getByRole('button', { name: /фото/i })).toHaveCount(0)
  const memberPatch = owner.page.waitForRequest((request) => request.method() === 'PATCH' && /\/members\/[^/]+$/.test(new URL(request.url()).pathname))
  await owner.page.getByRole('textbox', { name: 'Имя в семье' }).fill('Дедушка Петя')
  await owner.page.getByRole('button', { name: 'Сохранить изменения' }).click()
  const patchBody = (await memberPatch).postDataJSON() as { familyDisplayName?: string; expectedVersion?: number }
  expect(patchBody.familyDisplayName).toBe('Дедушка Петя')
  expect(patchBody.expectedVersion).toBeGreaterThan(0)
  await expect(owner.page.getByRole('heading', { name: 'Дедушка Петя' })).toBeVisible()
  await owner.page.getByRole('button', { name: 'Удалить из семьи' }).click()
  await expect(owner.page.getByRole('dialog', { name: 'Удалить участника из семьи?' })).toBeVisible()
  await owner.page.setViewportSize({ width: 390, height: 844 })
  await owner.page.evaluate(() => document.fonts.ready)
  const removeRect = await owner.page.locator('.member-remove-modal').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, height: rect.height, left: rect.left, width: rect.width }
  })
  expect(Math.abs((removeRect.top + removeRect.bottom) / 2 - 422)).toBeLessThanOrEqual(3)
  expect(removeRect.left).toBeGreaterThanOrEqual(13)
  expect(removeRect.left).toBeLessThanOrEqual(15)
  expect(removeRect.width).toBeGreaterThanOrEqual(360)
  expect(removeRect.width).toBeLessThanOrEqual(364)
  const removeIcon = owner.page.locator('.member-remove-icon img')
  await expect(removeIcon).toHaveAttribute('src', '/assets/icons/trash-active@2x.webp')
  await expect(removeIcon).toHaveAttribute('srcset', '/assets/icons/trash-active@2x.webp 2x, /assets/icons/trash-active@3x.webp 3x')
  await expect(removeIcon).toHaveJSProperty('complete', true)
  expect(await removeIcon.evaluate((icon: HTMLImageElement) => icon.naturalWidth)).toBeGreaterThan(0)
  for (const width of [320, 390, 430, 480]) {
    await owner.page.setViewportSize({ width, height: 844 })
    const layout = await owner.page.locator('.member-remove-modal').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, centerY: (rect.top + rect.bottom) / 2, viewportWidth: window.innerWidth }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth)
    expect(Math.abs(layout.centerY - 422)).toBeLessThanOrEqual(3)
    await owner.page.screenshot({ path: resolve(`e2e/.artifacts/member-remove-${width}.png`), animations: 'disabled' })
  }
  await owner.page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    await owner.page.locator('html').evaluate((html, value) => html.setAttribute('data-memoly-theme', value), theme)
    await owner.page.screenshot({ path: resolve(`e2e/.artifacts/member-remove-${theme}-390.png`), animations: 'disabled' })
  }
  await owner.page.locator('.member-profile-hero h2').evaluate((heading) => { heading.textContent = 'Длинное имя участника семьи для проверки переноса и доступности на узком экране' })
  const textScale = await owner.page.addStyleTag({ content: `.member-remove-modal h2 { font-size: 40px !important; } .member-remove-modal p { font-size: 26px !important; } .member-remove-actions button { font-size: 24px !important; }` })
  const scaledModal = await owner.page.locator('.member-remove-modal').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth }
  })
  expect(scaledModal.top).toBeGreaterThanOrEqual(0)
  expect(scaledModal.bottom).toBeLessThanOrEqual(844)
  expect(scaledModal.left).toBeGreaterThanOrEqual(0)
  expect(scaledModal.right).toBeLessThanOrEqual(scaledModal.viewportWidth)
  expect(scaledModal.scrollWidth).toBeLessThanOrEqual(scaledModal.viewportWidth)
  await owner.page.screenshot({ path: resolve('e2e/.artifacts/member-remove-long-name-text-200-390.png'), animations: 'disabled' })
  await textScale.evaluate((element) => element.remove())
  await owner.page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click()
  await expect(owner.page.getByRole('dialog')).toHaveCount(0)
  await owner.page.getByRole('button', { name: 'Удалить из семьи' }).click()
  await owner.page.keyboard.press('Escape')
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

test('the account theme is shared by fresh PWA and MAX WebView contexts despite legacy local values', async ({ browser, page }) => {
  const owner = await createCompletedOwner(page, 81000062)
  await owner.page.getByRole('button', { name: 'Настройки' }).click()
  await owner.page.getByRole('button', { name: 'Оформление' }).click()
  const themeSaved = owner.page.waitForResponse((response) => response.url().endsWith('/api/users/me') && response.request().method() === 'PATCH')
  await owner.page.locator('[data-theme-choice="rose"]').click()
  expect((await themeSaved).status()).toBe(200)
  await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', 'rose')

  const origin = new URL(owner.page.url()).origin
  const storageState = await owner.context.storageState()
  const pwaContext = await browser.newContext({ baseURL: origin, storageState, viewport: { width: 390, height: 844 } })
  const pwaPage = await pwaContext.newPage()
  await pwaPage.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    const originalMatchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query) => {
      const result = originalMatchMedia(query)
      if (query === '(display-mode: standalone)') Object.defineProperty(result, 'matches', { configurable: true, value: true })
      return result
    }
  })
  await installTelegramHost(pwaPage, signedInitData(81000062, 'Организатор E2E'))
  await pwaPage.goto('/')
  await expect(pwaPage.getByRole('button', { name: 'Лента' })).toBeVisible()
  await expect(pwaPage.locator('html')).toHaveAttribute('data-memoly-theme', 'rose')
  await pwaPage.reload()
  await expect(pwaPage.locator('html')).toHaveAttribute('data-memoly-theme', 'rose')

  const maxContext = await browser.newContext({
    baseURL: origin,
    storageState,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MAXWebView/1.0',
    viewport: { width: 390, height: 844 },
  })
  const maxPage = await maxContext.newPage()
  await maxPage.addInitScript((legacyTheme) => localStorage.setItem('memoly-theme', legacyTheme), 'sand')
  await maxPage.addInitScript((initData) => {
    const webApp = { initData, version: '1.0', ready() {} }
    Object.defineProperty(window, 'WebApp', { configurable: false, get: () => webApp })
  }, signedInitData(81000062, 'Организатор E2E'))
  await maxPage.route('**/api/v1/auth/max', async (route) => {
    const response = await route.fetch({ url: route.request().url().replace('/api/v1/auth/max', '/api/v1/auth/telegram') })
    await route.fulfill({ response })
  })
  await maxPage.goto('/')
  await expect(maxPage.getByRole('button', { name: 'Лента' })).toBeVisible()
  await expect(maxPage.locator('html')).toHaveAttribute('data-memoly-theme', 'rose')
  await expect(maxPage.locator('.app')).toHaveCSS('padding-top', '0px')
  await maxPage.reload()
  await expect(maxPage.locator('html')).toHaveAttribute('data-memoly-theme', 'rose')

  await maxContext.close()
  await pwaContext.close()
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
    await expect(family.locator('.family-child-quote')).toHaveCount(0)
    await expect(family.locator('[data-child-header-mode="family"] .settings [data-slot="webp-icon"]')).toHaveCSS('mask-image', /settings-sliders/)
    const familyHeaderTop = await family.locator('[data-child-header-mode="family"]').evaluate((element) => element.getBoundingClientRect().top)
    expect(familyHeaderTop).toBe(24)
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
    const sheet = owner.page.locator('[data-memoly-bottom-sheet="true"]')
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

test('owner can edit own account profile without changing family membership', async ({ page }) => {
  const owner = await createCompletedOwner(page, 81000104)
  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await owner.page.getByRole('button', { name: /Открыть участника:/ }).first().click()
  await expect(owner.page.getByRole('region', { name: 'Профиль владельца' })).toBeVisible()
  await expect(owner.page.getByRole('textbox', { name: 'Имя профиля' })).toBeEditable()
  await expect(owner.page.getByRole('button', { name: 'Добавить фотографию' })).toBeVisible()
  await expect(owner.page.getByText('Роль владельца изменить нельзя')).toBeVisible()

  const profilePatch = owner.page.waitForRequest((request) => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/users/me')
  await owner.page.getByRole('textbox', { name: 'Имя профиля' }).fill('Имя владельца E2E')
  await owner.page.getByRole('button', { name: 'Сохранить имя профиля' }).click()
  expect((await profilePatch).postDataJSON()).toEqual({ displayName: 'Имя владельца E2E' })
  await expect(owner.page.getByText('Имя профиля сохранено.')).toBeVisible()
  await expect(owner.page.getByRole('textbox', { name: 'Имя профиля' })).toHaveValue('Имя владельца E2E')
  const firstAvatarUpload = owner.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/uploads/avatar')
  await owner.page.getByTestId('avatar-file-input').setInputFiles(pngImage)
  await confirmAvatarEditor(owner.page)
  expect((await firstAvatarUpload).ok()).toBe(true)
  await expect(owner.page.locator('.member-profile-hero img[alt="Фото профиля"]')).toHaveAttribute('src', /^blob:/)
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(owner.page.locator('.family-member-row .family-member-avatar img')).toHaveAttribute('src', /^blob:/)
  const firstMemberAvatarSrc = await owner.page.locator('.family-member-row .family-member-avatar img').getAttribute('src')
  await owner.page.getByRole('button', { name: 'Открыть участника: Имя владельца E2E' }).click()
  await expect(owner.page.getByRole('button', { name: 'Заменить фотографию' })).toBeVisible()
  const replacementUpload = owner.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/uploads/avatar')
  await owner.page.getByTestId('avatar-file-input').setInputFiles(jpegImage)
  await confirmAvatarEditor(owner.page)
  expect((await replacementUpload).ok()).toBe(true)
  await expect(owner.page.locator('.member-profile-hero img[alt="Фото профиля"]')).toHaveAttribute('src', /^blob:/)
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(owner.page.locator('.family-member-row .family-member-avatar img')).toHaveAttribute('src', /^blob:/)
  expect(await owner.page.locator('.family-member-row .family-member-avatar img').getAttribute('src')).not.toBe(firstMemberAvatarSrc)
  await owner.page.getByRole('button', { name: 'Открыть участника: Имя владельца E2E' }).click()
  const recropResponse = owner.page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/uploads/avatar/crop')
  await owner.page.getByRole('button', { name: 'Изменить кадрирование' }).click()
  await confirmAvatarEditor(owner.page)
  expect((await recropResponse).ok()).toBe(true)

  const profileThemes = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'] as const
  for (const theme of profileThemes) {
    await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
    await owner.page.getByRole('button', { name: 'Настройки' }).click()
    await owner.page.getByRole('button', { name: /Оформление/ }).click()
    await owner.page.locator(`[data-theme-choice="${theme}"]`).click()
    await owner.page.getByRole('button', { name: 'Назад' }).click()
    await owner.page.evaluate(() => (window as typeof window & { __triggerTelegramBack?: () => void }).__triggerTelegramBack?.())
    await owner.page.getByRole('button', { name: 'Открыть участника: Имя владельца E2E' }).click()
    await expect(owner.page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
    await owner.page.setViewportSize({ width: 390, height: 844 })
    await owner.page.evaluate(() => document.fonts.ready)
    const screenshotLayout = await owner.page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    expect(screenshotLayout.scrollWidth).toBeLessThanOrEqual(screenshotLayout.width)
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
      await owner.page.setViewportSize(viewport)
      await expect(owner.page.locator('.member-profile-hero img[alt="Фото профиля"]')).toBeVisible()
      const geometry = await owner.page.locator('.member-profile-screen').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth }
      })
      expect(geometry.left).toBeGreaterThanOrEqual(0)
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth)
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth)
      await owner.page.screenshot({ path: resolve(`e2e/.artifacts/member-profile-self-${theme}-${viewport.width}.png`), animations: 'disabled' })
    }
  }
  const avatarDelete = owner.page.waitForResponse((response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/uploads/avatar')
  await owner.page.getByRole('button', { name: 'Удалить фото' }).click()
  expect((await avatarDelete).ok()).toBe(true)
  await expect(owner.page.locator('.member-profile-hero img[alt="Фото профиля"]')).toHaveCount(0)
  await expect(owner.page.getByRole('button', { name: 'Добавить фотографию' })).toBeVisible()
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await expect(owner.page.locator('.family-member-row .family-member-avatar img')).toHaveCount(0)
  await expect(owner.page.getByRole('button', { name: 'Открыть участника: Имя владельца E2E' })).toBeVisible()
  await owner.context.close()
})

test('participant avatar appears to the owner in family, read-only profile, and feed author', async ({ browser, page }) => {
  const ownerSubject = 82000000 + Math.floor(Math.random() * 10_000_000)
  const participantSubject = ownerSubject + 1
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    await prisma.pilotAdmission.createMany({
      data: [ownerSubject, participantSubject].map((subject) => ({ provider: 'telegram' as const, subject: String(subject) })),
      skipDuplicates: true,
    })
  } finally {
    await prisma.$disconnect()
  }
  const owner = await createCompletedOwner(page, ownerSubject)
  const avatarResponses: string[] = []
  owner.page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (response.request().method() === 'GET' && response.status() === 200 && /\/media\/avatars\/[^/]+\/[^/]+\/content$/.test(path)) avatarResponses.push(path)
  })
  const startParam = await createInvite(owner.page, 'full', 'Дедушка Павел')
  const participant = await inviteePage(browser, participantSubject, startParam, 'Павел E2E')
  await participant.page.getByRole('button', { name: 'Присоединиться' }).click()
  await participant.page.getByRole('button', { name: 'Семья' }).click()
  await owner.page.getByRole('button', { name: 'Готово' }).click()

  const refreshOwnerFamily = async () => {
    await owner.page.getByRole('button', { name: '‹ Все семьи' }).click()
    await owner.page.locator('[data-slot="family-hub"] .family-hub-card').click()
    await owner.page.getByRole('button', { name: 'Семья' }).click()
  }
  await refreshOwnerFamily()
  const ownerRow = owner.page.getByRole('button', { name: 'Открыть участника: Дедушка Павел' })
  await expect(ownerRow.locator('[data-slot="avatar-letter"]')).toBeVisible()
  await expect(ownerRow.locator('.family-member-avatar img')).toHaveCount(0)

  await participant.page.getByRole('button', { name: 'Открыть участника: Дедушка Павел' }).click()
  await participant.page.getByTestId('avatar-file-input').setInputFiles(pngImage)
  await confirmAvatarEditor(participant.page, '1.8')
  await expect(participant.page.locator('.member-profile-hero .member-profile-avatar img[alt="Фото профиля"]')).toHaveAttribute('src', /^blob:/)
  await refreshOwnerFamily()
  await expect(ownerRow.locator('.family-member-avatar img')).toHaveAttribute('src', /^blob:/)
  const familyCropStyle = await ownerRow.locator('.family-member-avatar img').getAttribute('style')
  const avatarGetsAfterFamilyRow = avatarResponses.length
  expect(avatarGetsAfterFamilyRow).toBe(1)
  await ownerRow.click()
  await expect(owner.page.locator('.member-profile-hero .member-profile-avatar img')).toHaveAttribute('src', /^blob:/)
  const profileCropStyle = await owner.page.locator('.member-profile-hero .member-profile-avatar img').getAttribute('style')
  expect(profileCropStyle).toBe(familyCropStyle)
  await expect(owner.page.getByRole('button', { name: /(?:Добавить|Изменить|Удалить) фото/ })).toHaveCount(0)
  // A profile remount may revalidate its private blob once; it must not request repeatedly.
  expect(avatarResponses.length).toBeGreaterThanOrEqual(avatarGetsAfterFamilyRow)
  expect(avatarResponses.length).toBeLessThanOrEqual(2)
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()

  await participant.page.getByRole('button', { name: 'Назад к семье' }).click()
  await participant.page.getByRole('button', { name: 'Лента' }).click()
  await participant.page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await participant.page.getByRole('button', { name: 'Добавить заметку' }).click()
  await participant.page.getByRole('textbox', { name: 'Текст заметки' }).fill('Заметка участника с фото E2E')
  await participant.page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(participant.page.getByRole('heading', { name: 'Заметка сохранена!' })).toBeVisible()
  await participant.page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  const openNote = participant.page.getByRole('button', { name: 'Открыть заметку: Заметка участника с фото E2E' })
  await expect(openNote).toBeVisible()
  const card = openNote.locator('xpath=ancestor::article[1]')
  await expect(card.locator('.author-avatar img')).toHaveAttribute('src', /^blob:/)
  expect(await card.locator('.author-avatar img').getAttribute('style')).toBe(familyCropStyle)
  await participant.page.setViewportSize({ width: 390, height: 844 })
  await participant.page.screenshot({ path: resolve('e2e/.artifacts/participant-avatar-owner-feed-390.png'), animations: 'disabled' })

  await participant.context.close()
  await owner.context.close()
})

test('full member and viewer can edit only their own account profile and cannot edit the owner account', async ({ browser, page }) => {
  const owner = await createCompletedOwner(page, 81000105)
  const fullStartParam = await createInvite(owner.page, 'full', 'Полный участник')
  const full = await inviteePage(browser, 81000106, fullStartParam, 'Полный E2E')
  await full.page.getByRole('button', { name: 'Присоединиться' }).click()
  await full.page.getByRole('button', { name: 'Семья' }).click()
  await full.page.getByRole('button', { name: 'Открыть участника: Полный участник' }).click()
  await expect(full.page.getByRole('textbox', { name: 'Имя профиля' })).toBeEditable()
  await expect(full.page.getByRole('radiogroup', { name: 'Доступ' })).toHaveCount(0)
  await expect(full.page.getByLabel('Доступ: Полный доступ')).toContainText('Полный доступ')
  await expect(full.page.getByRole('button', { name: 'Добавить фотографию' })).toBeVisible()
  const fullProfilePatch = full.page.waitForRequest((request) => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/users/me')
  await full.page.getByRole('textbox', { name: 'Имя профиля' }).fill('Полный профиль E2E')
  await full.page.getByRole('button', { name: 'Сохранить имя профиля' }).click()
  expect((await fullProfilePatch).postDataJSON()).toEqual({ displayName: 'Полный профиль E2E' })
  await expect(full.page.getByRole('textbox', { name: 'Имя в семье' })).toBeEditable()
  await expect(full.page.getByRole('button', { name: 'Удалить из семьи' })).toHaveCount(0)

  await owner.page.getByRole('button', { name: 'Готово' }).click()
  const viewerStartParam = await createInvite(owner.page, 'viewer', 'Участник viewer')
  const viewer = await inviteePage(browser, 81000107, viewerStartParam, 'Viewer E2E')
  await viewer.page.getByRole('button', { name: 'Присоединиться' }).click()
  await viewer.page.getByRole('button', { name: 'Семья' }).click()
  await viewer.page.getByRole('button', { name: 'Открыть участника: Участник viewer' }).click()
  await expect(viewer.page.getByRole('textbox', { name: 'Имя профиля' })).toBeEditable()
  await expect(viewer.page.getByRole('radiogroup', { name: 'Доступ' })).toHaveCount(0)
  await expect(viewer.page.getByLabel('Доступ: Просмотр')).toContainText('Просмотр')
  await expect(viewer.page.getByRole('button', { name: 'Добавить фотографию' })).toBeVisible()
  await expect(viewer.page.getByRole('textbox', { name: 'Имя в семье' })).toBeDisabled()
  await expect(viewer.page.getByRole('button', { name: 'Сохранить изменения' })).toHaveCount(0)
  await expect(viewer.page.getByRole('button', { name: 'Удалить из семьи' })).toHaveCount(0)
  const viewerProfilePatch = viewer.page.waitForRequest((request) => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/users/me')
  await viewer.page.getByRole('textbox', { name: 'Имя профиля' }).fill('Имя viewer E2E')
  await viewer.page.getByRole('button', { name: 'Сохранить имя профиля' }).click()
  expect((await viewerProfilePatch).postDataJSON()).toEqual({ displayName: 'Имя viewer E2E' })
  await expect(viewer.page.getByText('Имя профиля сохранено.')).toBeVisible()
  await viewer.page.getByRole('button', { name: 'Назад к семье' }).click()
  const viewerRow = viewer.page.getByRole('button', { name: 'Открыть участника: Участник viewer' })
  await expect(viewerRow).toContainText('Имя viewer E2E')

  await viewer.page.getByRole('button', { name: 'Открыть участника: Организатор E2E' }).click()
  await expect(viewer.page.getByRole('region', { name: 'Профиль владельца' })).toBeVisible()
  await expect(viewer.page.getByRole('textbox', { name: 'Имя профиля' })).toHaveCount(0)
  await expect(viewer.page.getByRole('button', { name: /фото/ })).toHaveCount(0)
  await expect(viewer.page.getByText('Роль владельца изменить нельзя')).toBeVisible()
  await full.context.close()
  await viewer.context.close()
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

  for (let transition = 0; transition < 3; transition += 1) {
    await expect(owner.page.locator('[data-child-header-mode="family"] [data-slot="child-avatar-image"]')).toHaveAttribute('src', /^blob:/)
    await owner.page.getByRole('button', { name: 'Лента' }).click()
    await expect(owner.page.locator('[data-child-header-mode="feed"] [data-slot="child-avatar-image"]')).toHaveAttribute('src', /^blob:/)
    await owner.page.getByRole('button', { name: 'Семья' }).click()
    await expect(owner.page.locator('[data-slot="family-presentation"]')).toBeVisible()
  }

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

test('child profile photo editor restores crop, preserves CAS and cancels replacement', async ({ page }) => {
  const childUpdates: Array<{ method: string; body: Record<string, unknown> }> = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'PUT' && /\/api\/v1\/families\/[^/]+\/child$/.test(path)) childUpdates.push({ method: request.method(), body: request.postDataJSON() as Record<string, unknown> })
    if (request.method() === 'PATCH' && /\/api\/v1\/families\/[^/]+$/.test(path)) childUpdates.push({ method: request.method(), body: request.postDataJSON() as Record<string, unknown> })
  })
  const owner = await createCompletedOwner(page, 81000014)
  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  const profile = owner.page.locator('[data-slot="child-profile"]')
  const initialId = (childUpdates.findLast((update) => update.method === 'PATCH')?.body.child as Record<string, unknown>).avatarMediaId
  await owner.page.locator('summary[aria-label="Дополнительные действия профиля ребёнка"]').click()
  await owner.page.getByRole('button', { name: 'Сменить фото' }).click()
  await owner.page.getByRole('button', { name: 'Изменить кадрирование' }).click()
  const editor = owner.page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await expect(editor.getByRole('slider', { name: 'Масштаб' })).toBeVisible()
  await owner.page.setViewportSize({ width: 320, height: 740 })
  await expect(editor.getByRole('button', { name: 'Готово' })).toBeInViewport()
  expect(await owner.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await editor.getByRole('slider', { name: 'Масштаб' }).fill('1.25')
  await editor.getByRole('button', { name: 'Готово' }).click()
  await expect(owner.page.getByText('Фото обновлено!', { exact: true })).toBeVisible()
  await owner.page.getByRole('button', { name: 'Перейти в профиль' }).click()
  const recrop = childUpdates.at(-1)?.body.child as Record<string, unknown>
  expect(recrop.avatarMediaId).toBe(initialId)
  expect(recrop.expectedVersion).toBe(2)
  const savedCrop = recrop.avatarCrop as { x: number; y: number; width: number; height: number }
  expect(savedCrop.width).toBeLessThan(1)
  const profileCropStyle = await profile.locator('[data-slot="child-avatar-image"]').getAttribute('style')
  await owner.page.getByRole('button', { name: 'Назад к семье' }).click()
  await owner.page.getByRole('button', { name: '‹ Все семьи' }).click()
  const hubAvatar = owner.page.locator('.family-hub-card [data-slot="child-avatar-image"]')
  await expect(hubAvatar).toBeVisible()
  expect(await hubAvatar.getAttribute('style')).toBe(profileCropStyle)
  await owner.page.locator('.family-hub-card').click()
  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await owner.page.getByRole('button', { name: /Открыть профиль ребёнка:/ }).click()
  const callsBeforeReplace = childUpdates.length
  const currentCropStyle = await profile.locator('[data-slot="child-avatar-image"]').getAttribute('style')
  await owner.page.locator('summary[aria-label="Дополнительные действия профиля ребёнка"]').click()
  await owner.page.getByRole('button', { name: 'Сменить фото' }).click()
  await owner.page.getByTestId('child-avatar-file').setInputFiles(pngImage)
  const replacementEditor = owner.page.getByRole('dialog', { name: 'Редактирование фотографии' })
  await replacementEditor.getByRole('button', { name: 'Отмена' }).click()
  expect(childUpdates).toHaveLength(callsBeforeReplace)
  await owner.page.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(profile.locator('[data-slot="child-avatar-image"]')).toHaveAttribute('src', /^blob:/)
  expect(await profile.locator('[data-slot="child-avatar-image"]').getAttribute('style')).toBe(currentCropStyle)
  await owner.context.close()
})
