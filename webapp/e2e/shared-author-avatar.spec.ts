import { expect, test } from '@playwright/test'

const familyA = '11111111-1111-4111-8111-111111111111'
const familyB = '22222222-2222-4222-8222-222222222222'
function avatar(family: string, asset: string) {
  return `/api/v1/families/${family}/media/avatars/${asset}-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${asset}-bbbb-4bbb-8bbb-bbbbbbbbbbbb/content`
}

test('private author avatars share requests and retire stale URLs across feed scopes', async ({ page }) => {
  await page.goto('/e2e/shared-author-avatar.harness.html')
  await expect.poll(() => page.evaluate(() => typeof window.__avatarProbe?.configure)).toBe('function')
  const configure = (value: { mode: 'feed'; userId: string; familyId: string; membershipEpoch: number; paths: [string, string, string] }) => page.evaluate((next) => window.__avatarProbe.configure(next), value)
  const metrics = () => page.evaluate(() => window.__avatarProbe.metrics)
  const avatarRequests = async () => (await metrics()).requests.filter((path) => /\/media\/avatars\//.test(path))
  const resetMetrics = () => page.evaluate(() => {
    const value = window.__avatarProbe.metrics
    value.requests.length = 0; value.created.length = 0; value.revoked.length = 0; value.decodes = 0
  })
  const userA = 'user-account-a'
  const sharedPaths: [string, string, string] = [avatar(familyA, 'bbbbbbbb'), avatar(familyA, 'dddddddd'), avatar(familyB, 'ffffffff')]
  const sameFamilyPaths = new Set(sharedPaths.slice(0, 2))

  await page.evaluate(() => { window.__avatarProbe.metrics.holdResponses = true })
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 1, paths: sharedPaths })
  const cards = page.locator('.memory-card')
  await expect(cards.first()).toBeVisible()
  await expect(page.locator('.memoly-mixed-carousel')).toBeVisible()
  await expect.poll(async () => new Set(await avatarRequests()).size).toBe(sameFamilyPaths.size)
  const initialRequests = await avatarRequests()
  expect(initialRequests.every((path) => sameFamilyPaths.has(path))).toBe(true)
  expect(new Set(initialRequests).size).toBe(initialRequests.length)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()

  const familyButton = page.getByRole('button', { name: 'Семья' })
  await expect(familyButton).toBeVisible()
  await familyButton.click()
  await expect.poll(() => page.evaluate(() => window.__avatarProbe.metrics.familyNavigations)).toBeGreaterThan(0)
  await page.evaluate(() => window.__avatarProbe.releaseResponses())
  const images = page.locator('.memory-card .author-avatar img')
  await expect(images.first()).toBeVisible()
  await expect.poll(() => images.evaluateAll((nodes) => nodes.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  expect(await page.locator('.author-initials').count()).toBeGreaterThan(0)
  expect(await avatarRequests()).not.toContain(sharedPaths[2])

  const epochOnlyPaths: [string, string, string] = [...sharedPaths]
  await resetMetrics()
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 2, paths: epochOnlyPaths })
  await expect.poll(async () => new Set(await avatarRequests()).size).toBe(sameFamilyPaths.size)
  expect((await avatarRequests()).every((path) => sameFamilyPaths.has(path))).toBe(true)
  const retainedAuthorB = await page.locator('.memory-card').nth(1).locator('.author-avatar img').getAttribute('src')
  const pathOnlyPaths: [string, string, string] = [avatar(familyA, 'ababaccc'), sharedPaths[1], sharedPaths[2]]
  await resetMetrics()
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 2, paths: pathOnlyPaths })
  await expect.poll(async () => new Set(await avatarRequests()).size).toBe(1)
  expect(await avatarRequests()).toContain(pathOnlyPaths[0])
  expect(await avatarRequests()).not.toContain(pathOnlyPaths[1])
  await expect(page.locator('.memory-card').nth(1).locator('.author-avatar img')).toHaveAttribute('src', retainedAuthorB!)

  const missingPath = avatar(familyA, 'abababab')
  const secondMissingPath = avatar(familyA, 'cdcdcdcd')
  await page.evaluate((path) => { window.__avatarProbe.metrics.missing.add(path) }, missingPath)
  await resetMetrics()
  await page.evaluate((path) => { window.__avatarProbe.metrics.missing.add(path) }, secondMissingPath)
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 3, paths: [missingPath, secondMissingPath, sharedPaths[2]] })
  await expect.poll(async () => new Set(await avatarRequests()).size).toBe(new Set([missingPath, secondMissingPath]).size)
  expect((await avatarRequests()).every((path) => path === missingPath || path === secondMissingPath)).toBe(true)
  await expect(page.locator('.memory-card .author-avatar img')).toHaveCount(0)
  await expect(page.locator('.author-initials').first()).toBeVisible()

  const stalePaths: [string, string, string] = [avatar(familyA, '90909090'), avatar(familyA, '80808080'), sharedPaths[2]]
  await page.evaluate(() => { window.__avatarProbe.metrics.holdDecode = true })
  await resetMetrics()
  await configure({ mode: 'feed', userId: userA, familyId: familyA, membershipEpoch: 4, paths: stalePaths })
  await expect.poll(async () => (await metrics()).created.length).toBeGreaterThan(0)
  await expect.poll(async () => (await metrics()).decodes).toBeGreaterThan(0)
  const staleUrls = new Set((await metrics()).created)
  const requestsBeforeIdentitySwitch = (await avatarRequests()).length
  await configure({ mode: 'feed', userId: 'user-account-b', familyId: familyA, membershipEpoch: 5, paths: stalePaths })
  const newIdentityRequests = () => avatarRequests().then((requests) => requests.slice(requestsBeforeIdentitySwitch))
  await expect.poll(async () => new Set(await newIdentityRequests()).size).toBe(new Set(stalePaths.slice(0, 2)).size)
  await page.evaluate(() => window.__avatarProbe.releaseDecode())
  await expect.poll(async () => {
    const revoked = new Set((await metrics()).revoked)
    return [...staleUrls].every((url) => revoked.has(url))
  }).toBe(true)
  await expect.poll(() => page.locator('.memory-card .author-avatar img').evaluateAll((nodes) => nodes.filter((node) => {
    const image = node as HTMLImageElement
    return image.complete && image.naturalWidth > 0
  }).length)).toBeGreaterThan(0)
  const displayed = await page.locator('.memory-card .author-avatar img').evaluateAll((nodes) => nodes.map((image) => (image as HTMLImageElement).src))
  expect(displayed.every((src) => !staleUrls.has(src))).toBe(true)
  await page.evaluate(() => window.__avatarProbe.revoke())
  await expect.poll(async () => {
    const { created, revoked } = await metrics()
    const revokedUrls = new Set(revoked)
    return created.every((url) => revokedUrls.has(url))
  }).toBe(true)
  await expect(page.locator('.memory-card .author-avatar img')).toHaveCount(0)
  await page.evaluate(() => window.__avatarProbe.unmount())
  await expect.poll(async () => {
    const { created, revoked } = await metrics()
    const revokedUrls = new Set(revoked)
    return created.every((url) => revokedUrls.has(url))
  }).toBe(true)
})
