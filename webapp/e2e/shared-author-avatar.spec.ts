import { expect, test } from '@playwright/test'

const familyA = '11111111-1111-4111-8111-111111111111'
const familyB = '22222222-2222-4222-8222-222222222222'
function avatar(family: string, asset: string) {
  return `/api/v1/families/${family}/media/avatars/${asset}-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${asset}-bbbb-4bbb-8bbb-bbbbbbbbbbbb/content`
}

test('shares private author avatar work and retires URLs across feed scopes', async ({ page }, testInfo) => {
  await page.goto('/e2e/shared-author-avatar.harness.html')
  await expect.poll(() => page.evaluate(() => typeof window.__avatarProbe?.configure)).toBe('function')
  await expect(page.locator('.memory-card')).toHaveCount(40)
  const configure = (value: { mode: 'baseline' | 'feed'; userId: string; familyId: string; membershipEpoch: number; paths: [string, string, string] }) => page.evaluate((next) => window.__avatarProbe.configure(next), value)
  const metrics = () => page.evaluate(() => window.__avatarProbe.metrics)
  const avatarRequests = async () => (await metrics()).requests.filter((path) => /\/media\/avatars\//.test(path))
  const resetMetrics = () => page.evaluate(() => {
    const value = window.__avatarProbe.metrics
    value.requests.length = 0; value.created.length = 0; value.revoked.length = 0; value.decodes = 0
  })
  const userA = 'user-account-a'
  const baselinePaths: [string, string, string] = [avatar(familyA, 'aaaaaaaa'), avatar(familyA, 'cccccccc'), avatar(familyB, 'eeeeeeee')]

  await configure({ mode: 'baseline', userId: userA, familyId: familyA, membershipEpoch: 1, paths: baselinePaths })
  await expect.poll(async () => (await metrics()).requests.length).toBe(40)
  await expect.poll(async () => (await metrics()).decodes).toBe(40)
  expect((await metrics()).requests.filter((path) => path === baselinePaths[0]).length).toBe(20)

  const sharedPaths: [string, string, string] = [avatar(familyA, 'bbbbbbbb'), avatar(familyA, 'dddddddd'), avatar(familyB, 'ffffffff')]
  await resetMetrics()
  await page.evaluate(() => { window.__avatarProbe.metrics.holdResponses = true })
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 1, paths: sharedPaths })
  await expect.poll(async () => (await avatarRequests()).length).toBe(2)
  await expect(page.locator('.memory-card')).toHaveCount(40)
  await expect(page.locator('.memoly-mixed-carousel')).toHaveCount(1)
  const carousel = page.locator('.memoly-mixed-carousel')
  await carousel.focus()
  await carousel.press('ArrowRight')
  await expect(carousel).toHaveAttribute('data-seen-active-index', '1')
  await carousel.press('ArrowLeft')
  await expect(carousel).toHaveAttribute('data-seen-active-index', '0')
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-ui-version', 'v2')
  await expect(page.getByRole('button', { name: 'Добавить реакцию' })).toHaveCount(40)
  const familyButton = page.getByRole('button', { name: 'Семья' })
  await expect(familyButton).toBeVisible()
  await familyButton.click()
  await expect.poll(() => page.evaluate(() => window.__avatarProbe.metrics.familyNavigations)).toBe(1)
  await expect(page.locator('.author-initials')).toHaveCount(40)
  await page.evaluate(() => window.__avatarProbe.releaseResponses())
  await expect.poll(async () => (await metrics()).decodes).toBeGreaterThanOrEqual(2)
  expect((await metrics()).decodes).toBeLessThan(8)
  await expect(page.locator('.memory-card .author-avatar img')).toHaveCount(38)
  await expect(page.getByText('Foreign author')).toBeVisible()
  await expect(page.getByText('No avatar author')).toBeVisible()
  const sameSrc = await page.locator('.memory-card .author-avatar img').evaluateAll((images) => {
    const byAuthor = new Map<string, Set<string>>()
    for (const image of images as HTMLImageElement[]) {
      const author = image.closest('.memory-card')?.querySelector('.author-name')?.textContent ?? ''
      const values = byAuthor.get(author) ?? new Set<string>()
      values.add(image.src); byAuthor.set(author, values)
    }
    return [...byAuthor.values()].every((values) => values.size === 1)
  })
  expect(sameSrc).toBe(true)
  const cropStyle = await page.locator('.memory-card .author-avatar img').first().getAttribute('style')
  expect(cropStyle).toContain('width: 200%')
  expect(cropStyle).toContain('left: -50%')
  expect(await avatarRequests()).not.toContain(sharedPaths[2])
  const firstCard = page.locator('.memory-card').first()
  await firstCard.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await firstCard.focus()
  await firstCard.press('Shift+F10')
  await expect(page.locator('.reaction-picker-options')).toBeVisible()
  await page.getByRole('button', { name: 'Сердце' }).click({ force: true })
  await expect.poll(async () => (await metrics()).mutations.length).toBe(1)
  await expect(page.getByRole('group', { name: /Реакции: Сердце 3/ }).first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('shared-author-avatar.png'), fullPage: false })

  const epochOnlyPaths: [string, string, string] = [...sharedPaths]
  await resetMetrics()
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 2, paths: epochOnlyPaths })
  await expect.poll(async () => (await avatarRequests()).length).toBe(2)
  await expect.poll(async () => (await metrics()).decodes).toBeGreaterThanOrEqual(2)
  expect((await metrics()).decodes).toBeLessThan(8)
  const retainedAuthorB = await page.locator('.memory-card').nth(1).locator('.author-avatar img').getAttribute('src')
  const pathOnlyPaths: [string, string, string] = [avatar(familyA, 'ababaccc'), sharedPaths[1], sharedPaths[2]]
  await resetMetrics()
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 2, paths: pathOnlyPaths })
  await expect.poll(async () => (await avatarRequests()).length).toBe(1)
  await expect.poll(async () => (await metrics()).decodes).toBeGreaterThanOrEqual(1)
  expect((await metrics()).decodes).toBeLessThan(8)
  await expect(page.locator('.memory-card').nth(1).locator('.author-avatar img')).toHaveAttribute('src', retainedAuthorB!)

  const missingPath = avatar(familyA, 'abababab')
  const secondMissingPath = avatar(familyA, 'cdcdcdcd')
  await page.evaluate((path) => { window.__avatarProbe.metrics.missing.add(path) }, missingPath)
  await resetMetrics()
  await page.evaluate((path) => { window.__avatarProbe.metrics.missing.add(path) }, secondMissingPath)
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 3, paths: [missingPath, secondMissingPath, sharedPaths[2]] })
  await expect.poll(async () => (await avatarRequests()).length).toBe(2)
  await expect(page.locator('.memory-card .author-avatar img')).toHaveCount(0)
  await expect(page.locator('.author-initials')).toHaveCount(40)

  const stalePaths: [string, string, string] = [avatar(familyA, '90909090'), avatar(familyA, '80808080'), sharedPaths[2]]
  await page.evaluate(() => { window.__avatarProbe.metrics.holdDecode = true })
  await resetMetrics()
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 4, paths: stalePaths })
  await expect.poll(async () => (await metrics()).decodes).toBe(2)
  const staleUrls = (await metrics()).created.slice()
  const nextPaths: [string, string, string] = [...stalePaths]
  await configure({ mode: 'feed', userId: 'user-account-b', familyId: familyA, membershipEpoch: 5, paths: nextPaths })
  await expect.poll(async () => (await avatarRequests()).length).toBe(4)
  await page.evaluate(() => window.__avatarProbe.releaseDecode())
  await expect.poll(async () => (await metrics()).created.length).toBe(4)
  await expect.poll(async () => new Set((await metrics()).revoked).size).toBe(2)
  await expect.poll(async () => page.locator('.memory-card .author-avatar img').count()).toBe(38)
  const displayed = await page.locator('.memory-card .author-avatar img').evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src))
  expect(displayed.every((src) => !staleUrls.includes(src))).toBe(true)
  await page.evaluate(() => window.__avatarProbe.revoke())
  await expect.poll(async () => new Set((await metrics()).revoked).size).toBe(4)
  await expect(page.locator('.memory-card .author-avatar img')).toHaveCount(0)
  await page.evaluate(() => window.__avatarProbe.unmount())
  await expect.poll(async () => new Set((await metrics()).revoked).size).toBe(4)
})
