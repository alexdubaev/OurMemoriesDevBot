import { randomUUID } from 'node:crypto'
import { createPrisma } from '../../backend/src/db'
import { createRefreshToken, hashRefreshToken, hashRefreshTokenFamily } from '../../backend/src/modules/auth/infrastructure/refresh-tokens'
import { jpegImage } from './helpers/images'
import { expect, test } from '@playwright/test'
import { uploadFamilyPhoto } from '../src/features/family/api'
import type { AuthenticatedTransport } from '../src/platform/api'
import type { z } from 'zod'

const maxSubject = 99130001
const jwtSecret = 'web-e2e-secret-at-least-thirty-two-characters'

async function seed() {
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    const old = await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: String(maxSubject) } }, select: { userId: true } })
    if (old) {
      await prisma.authSession.deleteMany({ where: { userId: old.userId } })
      await prisma.family.deleteMany({ where: { ownerUserId: old.userId } })
      await prisma.externalIdentity.deleteMany({ where: { userId: old.userId } })
      await prisma.user.deleteMany({ where: { id: old.userId } })
    }
    await prisma.pilotAdmission.upsert({ where: { provider_subject: { provider: 'max', subject: String(maxSubject) } }, update: { revokedAt: null }, create: { provider: 'max', subject: String(maxSubject) } })
    const user = await prisma.user.create({ data: { displayName: 'Synthetic MAX user' } })
    const identity = await prisma.externalIdentity.create({ data: { userId: user.id, provider: 'max', subject: String(maxSubject) } })
    const refreshToken = createRefreshToken(jwtSecret)
    await prisma.authSession.create({ data: {
      userId: user.id,
      externalIdentityId: identity.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      refreshTokenFamilyHash: hashRefreshTokenFamily(refreshToken, jwtSecret),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    } })
    const familyId = randomUUID()
    const childId = randomUUID()
    const publishedAt = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.family.create({ data: { id: familyId, name: 'Synthetic diagnostic family', timezone: 'Europe/Moscow', ownerUserId: user.id } })
      await tx.familyMember.create({ data: { familyId, userId: user.id, role: 'full' } })
      await tx.child.create({ data: { id: childId, familyId, displayName: 'Synthetic child' } })
      await tx.memory.createMany({ data: Array.from({ length: 21 }, (_, index) => ({
        familyId,
        childId,
        authorId: user.id,
        kind: 'note' as const,
        body: `Synthetic diagnostic note ${String(index + 1).padStart(2, '0')}`,
        occurredAt: new Date(publishedAt.getTime() - (index + 1) * 60_000),
        status: 'published' as const,
        firstPublishedAt: publishedAt,
        firstPublishedOrdinal: BigInt(index + 1),
      })) })
      await tx.family.update({ where: { id: familyId }, data: { publicationOrdinal: 21 } })
    })
    return { familyId, childId, refreshToken, userId: user.id, identityId: identity.id }
  } finally { await prisma.$disconnect() }
}

function testTransport(accessToken: string): AuthenticatedTransport {
  const base = process.env.E2E_WEB_URL!
  const send = async (path: string, options: Parameters<AuthenticatedTransport['raw']>[1] = {}) => fetch(new URL(path, base), {
    method: options?.method ?? 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, ...(options?.headers as Record<string, string> | undefined), ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
    credentials: 'include',
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    ...(options?.rawBody ? { body: options.rawBody } : {}),
    ...(options?.signal ? { signal: options.signal } : {}),
  })
  return {
    raw: send,
    async request<TSchema extends z.ZodType>(path: string, schema: TSchema, options?: Parameters<AuthenticatedTransport['raw']>[1]) {
      const response = await send(path, options)
      if (!response.ok) throw new Error(`Diagnostic setup API failed: ${response.status}`)
      return schema.parse(await response.json()) as z.infer<TSchema>
    },
  }
}

test('MAX identity opens the plain family feed with private photo, cursor paging, and the existing media worker', async ({ page }, testInfo) => {
  const { familyId, childId, refreshToken } = await seed()
  await page.context().addCookies([{
    name: 'web_app_demo_refresh',
    value: refreshToken,
    url: process.env.E2E_WEB_URL!,
    httpOnly: true,
    sameSite: 'Lax',
  }])
  const authResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/refresh'))
  await page.goto('/__experiments/minimal-feed/diagnostic.html')
  const authenticated = await authResponse
  expect(authenticated.ok()).toBe(true)
  const { accessToken } = await authenticated.json() as { accessToken: string }
  await expect(page.getByText(/Вы вошли как Synthetic MAX user/)).toBeVisible()
  const transport = testTransport(accessToken)
  const file = new File([jpegImage.buffer], 'diagnostic-photo.jpg', { type: 'image/jpeg' })
  const assetId = await uploadFamilyPhoto(transport, familyId, file, 'image/jpeg', 'memory')
  const photoBody = `Synthetic diagnostic photo ${randomUUID()}`
  const created = await transport.raw(`/api/v1/families/${familyId}/memories`, {
    method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { childId, kind: 'photo', mediaIds: [assetId], body: photoBody, occurredAt: new Date().toISOString() },
  })
  expect(created.status).toBe(201)
  await page.getByRole('button', { name: /Synthetic diagnostic family/ }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic diagnostic family' })).toBeVisible()
  await expect(page.getByText(photoBody)).toBeVisible()
  const image = page.getByRole('img', { name: 'Фотография воспоминания' })
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 20_000 }).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('diagnostic-feed-photo.png'), fullPage: true })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 20_000 }).toBe(true)
  const cursorResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/memories') && url.searchParams.has('cursor')
  })
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const nextPage = await cursorResponse
  expect(nextPage.ok()).toBe(true)
  await expect(page.getByText('Synthetic diagnostic note 21')).toBeVisible({ timeout: 20_000 })
})

test('signed-out diagnostic starts MAX browser link and redeems into the same diagnostic feed', async ({ page }) => {
  const { userId, identityId } = await seed()
  const diagnosticPath = '/__experiments/minimal-feed/diagnostic.html'
  await page.goto(diagnosticPath)
  const startButton = page.getByRole('button', { name: 'Создать код для входа через MAX' })
  await expect(startButton).toBeVisible()
  const startResponse = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/browser-link/start'))
  await startButton.click()
  const started = await startResponse
  expect(started.ok()).toBe(true)
  const challenge = await started.json() as { challengeId: string; displayCode: string; startParam: string }
  await expect(page.getByLabel('Код подтверждения')).toHaveText(challenge.displayCode)
  await expect(page.getByRole('link', { name: 'Открыть MAX' })).toHaveAttribute('href', `https://max.ru/id911018762027_bot?startapp=${challenge.startParam}`)
  expect(new URL(page.url()).pathname).toBe(diagnosticPath)

  const redeemResponse = page.waitForResponse((response) => response.url().endsWith(`/api/v1/auth/browser-link/${challenge.challengeId}/redeem`))
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!)
  try {
    // MAX approval happens outside the browser; this smoke keeps its boundary at the real redeem endpoint.
    await prisma.browserLoginChallenge.update({ where: { id: challenge.challengeId }, data: {
      state: 'approved',
      approvedAt: new Date(),
      approvedUserId: userId,
      approvedExternalIdentityId: identityId,
    } })
  } finally { await prisma.$disconnect() }

  const redeemed = await redeemResponse
  expect(redeemed.ok()).toBe(true)
  await expect(page.getByText(/Вы вошли как Synthetic MAX user/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Synthetic diagnostic family/ })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe(diagnosticPath)
  await page.getByRole('button', { name: /Synthetic diagnostic family/ }).click()
  await expect(page.getByRole('heading', { name: 'Synthetic diagnostic family' })).toBeVisible()
  await expect(page.getByText('Synthetic diagnostic note 01')).toBeVisible()
})
