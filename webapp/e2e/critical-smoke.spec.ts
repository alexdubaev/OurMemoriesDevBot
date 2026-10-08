import { createHmac, randomUUID } from 'node:crypto'
import { createPrisma } from '../../backend/src/db'
import { jpegImage } from './helpers/images'
import { expect, test } from '@playwright/test'

const ownerId = 81000991
const viewerId = 81000992
const botToken = '123456:web-e2e-synthetic-token'

function signedInitData(subject: number, name: string) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: randomUUID(), user: JSON.stringify({ id: subject, first_name: name }) })
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}

async function seed() {
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    for (const subject of [ownerId, viewerId]) {
      const old = await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'telegram', subject: String(subject) } }, select: { userId: true } })
      if (old) {
        await prisma.authSession.deleteMany({ where: { userId: old.userId } })
        await prisma.family.deleteMany({ where: { ownerUserId: old.userId } })
        await prisma.externalIdentity.deleteMany({ where: { userId: old.userId } })
        await prisma.user.deleteMany({ where: { id: old.userId } })
      }
    }
    const owner = await prisma.user.create({ data: { displayName: 'Synthetic owner' } })
    const viewer = await prisma.user.create({ data: { displayName: 'Synthetic viewer' } })
    await prisma.externalIdentity.createMany({ data: [
      { userId: owner.id, provider: 'telegram', subject: String(ownerId) },
      { userId: viewer.id, provider: 'telegram', subject: String(viewerId) },
    ] })
    await prisma.pilotAdmission.createMany({ data: [ownerId, viewerId].map((id) => ({ provider: 'telegram' as const, subject: String(id) })), skipDuplicates: true })
    const familyId = randomUUID()
    const childId = randomUUID()
    await prisma.$transaction(async (tx) => {
      await tx.family.create({ data: { id: familyId, name: 'Synthetic family', timezone: 'Europe/Moscow', ownerUserId: owner.id } })
      await tx.familyMember.createMany({ data: [
        { familyId, userId: owner.id, role: 'full' }, { familyId, userId: viewer.id, role: 'viewer' },
      ] })
      await tx.child.create({ data: { id: childId, familyId, displayName: 'Synthetic child' } })
    })
    return { familyId }
  } finally { await prisma.$disconnect() }
}

async function enter(page: import('@playwright/test').Page, subject: number, name: string) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((initData) => Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
    initData, version: '8.0', platform: 'tdesktop', ready() {}, safeAreaInset: { top: 0, bottom: 0 }, contentSafeAreaInset: { top: 0, bottom: 0 },
    BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
  } } }), signedInitData(subject, name))
  const exchange = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/telegram'))
  await page.goto('/')
  expect((await exchange).status()).toBe(200)
  const welcome = page.getByRole('button', { name: 'Продолжить' })
  const familyHeading = page.getByRole('heading', { name: 'Мои семьи' })
  await expect(welcome.or(familyHeading).first()).toBeVisible()
  if (await welcome.isVisible()) await welcome.click()
  await expect(familyHeading).toBeVisible()
  await page.locator('.family-hub-card').click()
  await expect(page.locator('[data-memoly-feed="true"]')).toBeVisible()
}

test('signed owner enters the seeded family and publishes a note', async ({ page }) => {
  const { familyId } = await seed()
  await enter(page, ownerId, 'Synthetic owner')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить заметку' }).click()
  const body = `Synthetic note ${randomUUID()}`
  await page.getByRole('textbox', { name: 'Текст заметки' }).fill(body)
  const published = page.waitForResponse((response) => response.request().method() === 'POST' && /\/memories$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  const response = await published
  expect(response.ok()).toBe(true)
  const created = await response.json() as { id: string }
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    expect(await prisma.memory.count({ where: { id: created.id, familyId, body } })).toBe(1)
  } finally { await prisma.$disconnect() }
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  await expect(page.getByRole('button', { name: `Открыть заметку: ${body}` })).toBeVisible()
})

test('owner uploads one photo and the protected image loads from storage', async ({ page }) => {
  const { familyId } = await seed()
  await enter(page, ownerId, 'Synthetic owner')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
  await page.locator('#photo-composer-files').setInputFiles({ ...jpegImage, name: 'synthetic.jpg' })
  const published = page.waitForResponse((response) => response.request().method() === 'POST' && /\/memories$/.test(new URL(response.url()).pathname))
  await page.getByRole('button', { name: 'Опубликовать (1)' }).click()
  const response = await published
  expect(response.ok()).toBe(true)
  const created = await response.json() as { id: string }
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    const memory = await prisma.memory.findFirstOrThrow({ where: { id: created.id, familyId }, include: { media: true } })
    expect(memory.media).toHaveLength(1)
  } finally { await prisma.$disconnect() }
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  const image = page.locator(`.memory-card[data-memory-id="${created.id}"] .memory-media-slot img[alt="Воспоминание"]`)
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  await expect(image.locator('xpath=..')).toHaveAttribute('data-seen-ready', 'true')
})

test('viewer cannot update or delete an owner memory and anonymous access to its media is denied', async ({ browser, page }) => {
  const { familyId } = await seed()
  const mediaRequests: string[] = []
  page.on('request', (request) => { if (/\/media\/.*\/content$/.test(new URL(request.url()).pathname)) mediaRequests.push(request.url()) })
  await enter(page, ownerId, 'Synthetic owner')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить фото и видео' }).click()
  await page.locator('#photo-composer-files').setInputFiles({ ...jpegImage, name: 'synthetic-private.jpg' })
  await page.getByRole('button', { name: 'Опубликовать (1)' }).click()
  await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  let memoryId: string
  let mediaId: string
  try {
    const memory = await prisma.memory.findFirstOrThrow({ where: { familyId }, include: { media: true } })
    memoryId = memory.id
    mediaId = memory.media[0]!.mediaId
  } finally { await prisma.$disconnect() }
  const image = page.locator(`.memory-card[data-memory-id="${memoryId}"] .memory-media-slot img[alt="Воспоминание"]`)
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
  const mediaPath = `/api/v1/families/${familyId}/media/${mediaId}/content`
  await expect.poll(() => mediaRequests.some((url) => new URL(url).pathname === mediaPath)).toBe(true)
  const viewer = await browser.newPage()
  await enter(viewer, viewerId, 'Synthetic viewer')
  await expect(viewer.getByRole('button', { name: 'Добавить', exact: true })).toHaveCount(0)
  const viewerMemory = viewer.locator(`.memory-card[data-memory-id="${memoryId}"]`)
  await viewerMemory.getByRole('button', { name: 'Действия с воспоминанием' }).click()
  const actions = viewer.locator(`[data-memory-actions-for="${memoryId}"]`)
  await expect(actions.getByRole('button', { name: 'Редактировать' })).toHaveCount(0)
  await expect(actions.getByRole('button', { name: 'Удалить воспоминание' })).toHaveCount(0)
  const anonymous = await browser.newPage()
  const mediaResponse = await anonymous.request.get(mediaRequests.find((url) => new URL(url).pathname === mediaPath)!)
  expect([401, 403]).toContain(mediaResponse.status())
  await viewer.close()
  await anonymous.close()
})
