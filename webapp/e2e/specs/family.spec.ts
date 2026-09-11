import type { Browser, BrowserContext, Page } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'

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
  await page.addInitScript((value) => {
    Object.defineProperty(window, 'Telegram', {
      configurable: true,
      value: {
        WebApp: {
          initData: value,
          version: '8.0',
          platform: 'tdesktop',
          safeAreaInset: {},
          contentSafeAreaInset: {},
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
  await expect(page.getByRole('button', { name: 'Использовать фото' })).toBeDisabled()
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
  await expect(page.getByRole('heading', { name: 'Семья' })).toBeVisible()

  await page.getByRole('button', { name: 'Изменить' }).click()
  await expect(page.getByRole('img', { name: 'Текущий аватар ребёнка' })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('heading', { name: 'Семья' })).toBeVisible()

  // The buttons become busy synchronously; the network proves retry/double-click cannot mint
  // a second bootstrap family or child record.
  await expect.poll(() => familyCreations.length).toBe(1)
  await expect.poll(() => childCompletions.length).toBe(1)
  return { context: page.context(), page }
}

async function createInvite(page: Page, role: 'viewer' | 'full', alias: string) {
  const inviteSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Пригласить в семью' }),
  })
  await inviteSection.getByLabel('Имя в семье (необязательно)').fill(alias)
  await inviteSection.getByRole('button', { name: role === 'full' ? 'Полный доступ' : 'Просмотр' }).click()
  await inviteSection.getByRole('button', { name: 'Создать приглашение' }).click()
  await expect(page.getByRole('heading', { name: 'Приглашение готово' })).toBeVisible()
  const link = await page.getByLabel('Ссылка приглашения').inputValue()
  const startParam = new URL(link).searchParams.get('startapp')
  expect(startParam).toMatch(/^invite_[A-Za-z0-9_-]{32,128}$/)
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

test('onboards a child and accepts a viewer invite only after explicit startapp confirmation', async ({ browser, page }) => {
  const owner = await createCompletedOwner(page, 81000011)
  const startParam = await createInvite(owner.page, 'viewer', 'Тётя Ира')

  const requests: RequestLog = { accepts: [], familyCreations: [], privateFamilyRequests: [] }
  const guest = await inviteePage(browser, 81000012, startParam, 'Приглашённая E2E', requests)

  await expect(guest.page.getByRole('heading', { name: 'Приглашение в семью' })).toBeVisible()
  await expect(guest.page.getByText('Наша семья')).toBeVisible()
  await expect(guest.page.getByText('Лиза', { exact: true })).toHaveCount(0)
  await expect(guest.page.getByRole('button', { name: 'Присоединиться' })).toBeVisible()
  await expect.poll(() => requests.privateFamilyRequests).toEqual([])

  // Reloading a preview is a real startapp round trip, not an implicit accept.
  await guest.page.reload()
  await expect(guest.page.getByRole('button', { name: 'Присоединиться' })).toBeVisible()
  await expect.poll(() => requests.privateFamilyRequests).toEqual([])

  await guest.page.getByRole('button', { name: 'Присоединиться' }).dblclick()
  await expect(guest.page.getByRole('button', { name: 'Семья' })).toBeVisible()
  await guest.page.getByRole('button', { name: 'Семья' }).click()
  await expect(guest.page.getByText('Тётя Ира', { exact: true })).toBeVisible()
  await expect(guest.page.getByRole('button', { name: 'Создать приглашение' })).toHaveCount(0)
  await expect(guest.page.getByRole('button', { name: 'Удалить участника' })).toHaveCount(0)
  await expect(guest.page.getByRole('img', { name: 'Режим просмотра' })).toBeVisible()
  await expect.poll(() => requests.accepts.length).toBe(1)

  await guest.page.reload()
  await expect(guest.page.getByRole('heading', { name: 'Семья' })).toBeVisible()
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
  await expect(alreadyMember.page.getByRole('heading', { name: 'Семья' })).toBeVisible()
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
  await expect(full.page.getByRole('button', { name: 'Создать приглашение' })).toBeVisible()
  await expect(full.page.getByRole('button', { name: 'Удалить участника' })).toHaveCount(0)
  await expect(full.page.getByRole('button', { name: 'Владелец' })).toHaveCount(0)
  await createInvite(full.page, 'viewer', 'Внучка Нина')

  // The owner never gets self-demotion/removal controls, even after a full member joins.
  await owner.page.reload()
  await owner.page.getByRole('button', { name: 'Семья' }).click()
  await expect(owner.page.getByRole('button', { name: 'Удалить участника' })).toHaveCount(1)
  await expect(owner.page.getByRole('button', { name: 'Владелец' })).toHaveCount(0)

  const revokedStartParam = await createInvite(owner.page, 'viewer', 'Отозванный гость')
  await owner.page.getByRole('button', { name: 'Готово' }).click()
  await owner.page.getByRole('button', { name: 'Отозвать' }).first().click()
  const revoked = await inviteePage(browser, 81000023, revokedStartParam, 'Отозванный E2E')
  await expect(revoked.page.getByText('Это приглашение отозвано.')).toBeVisible()
  await expect(revoked.page.getByRole('heading', { name: 'Семья' })).toHaveCount(0)

  await revoked.context.close()
  await full.context.close()
  await owner.context.close()
})
