import { expect, test } from '@playwright/test'

declare global { interface Window { __promptCalls?: number } }

const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36'
const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'

test('Android offers installation only when the browser exposes a one-shot prompt', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: android })
  const page = await context.newPage()
  await page.goto('/e2e/pwa-install.fixture.html?platform=android')
  await expect(page.getByText('Установка может быть доступна в меню поддерживающего браузера.')).toBeVisible()
  await page.screenshot({ path: 'e2e/.artifacts/pwa-install-results/android-no-event-390x844.png', fullPage: true })
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, { prompt: () => { window.__promptCalls = (window.__promptCalls ?? 0) + 1 }, userChoice: Promise.resolve({ outcome: 'accepted' }) })
    window.dispatchEvent(event)
  })
  const install = page.getByRole('button', { name: 'Установить memoLy' })
  await expect(install).toBeVisible()
  await page.screenshot({ path: 'e2e/.artifacts/pwa-install-results/android-install-390x844.png', fullPage: true })
  await install.click()
  await expect.poll(() => page.evaluate(() => window.__promptCalls)).toBe(1)
  await expect(install).toHaveCount(0)
  await context.close()
})

test('Android dismissal survives reload and iOS never receives an install prompt', async ({ browser }) => {
  const androidContext = await browser.newContext({ userAgent: android })
  const androidPage = await androidContext.newPage()
  await androidPage.goto('/e2e/pwa-install.fixture.html?platform=android')
  await androidPage.getByRole('button', { name: 'Продолжить без установки' }).click()
  await androidPage.reload()
  await expect(androidPage.getByLabel('Установка memoLy')).toHaveCount(0)
  await androidContext.close()

  const iosContext = await browser.newContext({ userAgent: ios })
  const iosPage = await iosContext.newPage()
  await iosPage.goto('/e2e/pwa-install.fixture.html?platform=ios&kind=max')
  await expect(iosPage.getByRole('button', { name: 'Открыть в браузере' })).toBeVisible()
  await expect(iosPage.getByRole('button', { name: 'Установить memoLy' })).toHaveCount(0)
  await iosPage.screenshot({ path: 'e2e/.artifacts/pwa-install-results/max-ios-390x844.png', fullPage: true })
  await iosPage.evaluate(() => { window.__promptCalls = 0 })
  await expect.poll(() => iosPage.evaluate(() => window.__promptCalls)).toBe(0)
  await iosContext.close()
})

test('Android standalone and iOS browser hide the optional offer', async ({ browser }) => {
  const androidContext = await browser.newContext({ userAgent: android })
  await androidContext.addInitScript(() => { window.matchMedia = () => ({ matches: true }) as MediaQueryList })
  const standalone = await androidContext.newPage()
  await standalone.goto('/e2e/pwa-install.fixture.html?platform=android')
  await expect(standalone.getByLabel('Установка memoLy')).toHaveCount(0)
  await androidContext.close()

  const iosContext = await browser.newContext({ userAgent: ios })
  const iosPage = await iosContext.newPage()
  await iosPage.goto('/e2e/pwa-install.fixture.html?platform=ios')
  await expect(iosPage.getByLabel('Установка memoLy')).toHaveCount(0)
  await iosContext.close()
})
