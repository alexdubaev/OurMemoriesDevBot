import { expect, test } from '@playwright/test'

test('requests MAX closing confirmation before the StrictMode app mounts', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'WebApp', {
      configurable: true,
      value: {
        initData: 'synthetic=e2e',
        version: 'test',
        platform: 'web',
        ready() { (window as Window & { __maxReadyCalls?: number }).__maxReadyCalls = ((window as Window & { __maxReadyCalls?: number }).__maxReadyCalls ?? 0) + 1 },
        enableClosingConfirmation() {
          const target = window as Window & { __maxClosingConfirmationCalls?: number }
          target.__maxClosingConfirmationCalls = (target.__maxClosingConfirmationCalls ?? 0) + 1
        },
      },
    })
  })

  await page.goto('/__fixtures/design-system')
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect.poll(() => page.evaluate(() => (window as Window & { __maxClosingConfirmationCalls?: number }).__maxClosingConfirmationCalls)).toBe(1)
  expect(await page.evaluate(() => (window as Window & { __maxReadyCalls?: number }).__maxReadyCalls)).toBe(1)
})
