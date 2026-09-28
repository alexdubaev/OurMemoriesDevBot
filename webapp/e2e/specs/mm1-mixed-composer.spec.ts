import type { Page } from '@playwright/test'
import { createHmac, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

import { createPrisma } from '../../../backend/src/db'
import { expect, test } from '../helpers/test'

const subject = '81000191'
const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
const occurredAt = '2024-06-15T09:00:00.000Z' // Local noon in the family's Europe/Moscow timezone.

let fixture: { userId: string; familyId: string; childId: string } | undefined

test.describe('MM-1 mixed media composer', () => {
  test.beforeAll(async () => {
    fixture = await seedOwner()
  })

  test.afterAll(async () => {
    if (fixture) {
      await prisma.family.deleteMany({ where: { id: fixture.familyId } })
      await prisma.externalIdentity.deleteMany({ where: { userId: fixture.userId } })
      await prisma.authSession.deleteMany({ where: { userId: fixture.userId } })
      await prisma.user.deleteMany({ where: { id: fixture.userId } })
    }
    await prisma.$disconnect()
  })

  test('publishes photo-video-photo-video as one ordered media Memory on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await installTelegramHost(page, signedInitData(Number(subject), 'MM-1 E2E'))
    await page.clock.setFixedTime(new Date('2026-09-20T06:00:00.000Z'))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    await page.locator('.family-hub-card').click()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await page.getByRole('button', { name: 'Добавить' }).click()
    await page.getByRole('button', { name: 'Добавить фото' }).click()
    await expect(page.locator('[data-add-screen="photo"]')).toBeVisible()

    const files = [
      { name: 'mm1-photo-a.png', mimeType: 'image/png', buffer: generatedPhoto(1) },
      { name: 'mm1-video-b.mp4', mimeType: 'video/mp4', buffer: generatedVideo() },
      { name: 'mm1-photo-c.png', mimeType: 'image/png', buffer: generatedPhoto(2) },
      { name: 'mm1-video-d.mp4', mimeType: 'video/mp4', buffer: generatedVideo() },
    ]
    const expectedKinds = ['photo', 'video', 'photo', 'video']
    await page.locator('#photo-composer-files').setInputFiles(files)
    await page.locator('#photo-composer-caption').fill('Первый смешанный день')
    await page.locator('#photo-composer-date').fill('2024-06-15')
    await expect(page.getByRole('button', { name: 'Опубликовать (4)' })).toBeEnabled()
    await expect(page.locator('.memoly-add-photo-thumb')).toHaveCount(4)
    await expect(page.locator('.memoly-add-photo-thumb').evaluateAll((items) => items.map((item) => item.getAttribute('data-media-kind')))).resolves.toEqual(expectedKinds)
    await expect(page.getByRole('button', { name: 'Удалить mm1-video-b.mp4' })).toBeVisible()
    await expect(page.locator('.memoly-add-media-order')).toHaveText(['1', '2', '3', '4'])
    await test.info().attach('mm1-mixed-composer-selected-390.png', {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    })
    await page.setViewportSize({ width: 320, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
    await page.setViewportSize({ width: 390, height: 844 })

    const requestBodies: Array<Record<string, unknown>> = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/v1/families/${fixture!.familyId}/memories`) {
        requestBodies.push(request.postDataJSON() as Record<string, unknown>)
      }
    })
    const before = await prisma.memory.count({ where: { familyId: fixture!.familyId } })
    const publishResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/api/v1/families/${fixture!.familyId}/memories`))
    await page.getByRole('button', { name: 'Опубликовать (4)' }).click()
    const response = await publishResponse
    expect(response.ok()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Воспоминание опубликовано!' })).toBeVisible()
    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).toMatchObject({ kind: 'media', body: 'Первый смешанный день', occurredAt })
    expect(Array.isArray(requestBodies[0]!.mediaIds)).toBe(true)
    const submittedIds = requestBodies[0]!.mediaIds as string[]
    expect(submittedIds).toHaveLength(4)

    const created = await prisma.memory.findMany({
      where: { familyId: fixture!.familyId },
      include: { media: { orderBy: { position: 'asc' }, include: { asset: true } } },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })
    expect(await prisma.memory.count({ where: { familyId: fixture!.familyId } })).toBe(before + 1)
    expect(created).toHaveLength(1)
    const memory = created[0]!
    expect(memory.kind).toBe('media')
    expect(memory.body).toBe('Первый смешанный день')
    expect(memory.occurredAt.toISOString()).toBe(occurredAt)
    expect(memory.sourcePublishedAt).toBeNull()
    expect(memory.media.map(({ mediaId }) => mediaId)).toEqual(submittedIds)
    expect(memory.media.map(({ position }) => position)).toEqual([0, 1, 2, 3])
    expect(memory.media.map(({ asset }) => asset.mediaKind)).toEqual(expectedKinds)
    await page.getByRole('button', { name: 'Смотреть в ленте' }).click()
    await expect(page.locator(`[data-memory-id="${memory.id}"]`)).toHaveCount(1)
  })
})

async function seedOwner() {
  const prior = await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'telegram', subject } }, select: { userId: true } })
  if (prior) {
    await prisma.authSession.deleteMany({ where: { userId: prior.userId } })
    await prisma.family.deleteMany({ where: { ownerUserId: prior.userId } })
    await prisma.externalIdentity.deleteMany({ where: { userId: prior.userId } })
    await prisma.user.deleteMany({ where: { id: prior.userId } })
  }
  const user = await prisma.user.create({ data: { displayName: 'MM-1 E2E owner' } })
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'telegram', subject } })
  const familyId = randomUUID()
  const childId = randomUUID()
  await prisma.$transaction(async (tx) => {
    await tx.family.create({ data: { id: familyId, ownerUserId: user.id, name: 'MM-1 E2E', timezone: 'Europe/Moscow' } })
    await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'full' } })
    await tx.child.create({ data: { id: childId, familyId, displayName: 'Лиза' } })
  })
  return { userId: user.id, familyId, childId }
}

function signedInitData(id: number, name: string) {
  const fields = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1_000)), query_id: randomUUID(), user: JSON.stringify({ id, first_name: name }) })
  const check = [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update('123456:web-e2e-synthetic-token').digest()
  fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return fields.toString()
}

async function installTelegramHost(page: Page, initData: string) {
  await page.route(/telegram\.org\/js\/telegram-web-app\.js(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }))
  await page.addInitScript((value) => {
    Object.defineProperty(window, 'Telegram', { configurable: true, value: { WebApp: {
      initData: value, version: '8.0', platform: 'tdesktop', safeAreaInset: { top: 24, bottom: 18 }, contentSafeAreaInset: { top: 24, bottom: 18 },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }, ready() {},
    } } })
  }, initData)
}

function generatedVideo() {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x180:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { encoding: 'buffer', maxBuffer: 10_000_000 })
  if (result.status !== 0) throw new Error(`synthetic video fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}

function generatedPhoto(index: number) {
  const color = index === 1 ? 'orange' : 'blue'
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=32x24:d=0.1`, '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1_000_000 })
  if (result.status !== 0) throw new Error(`synthetic photo fixture failed: ${result.stderr.toString()}`)
  return result.stdout
}
