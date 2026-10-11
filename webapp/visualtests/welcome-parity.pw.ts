import { expect, test } from '@playwright/test'

test('welcome intro reveals the complete responsive screen and keeps local artwork intact', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/visualtests/welcome-parity.html')
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)))
  })
  await expect(page.locator('.continue-button')).toBeEnabled({ timeout: 10_000 })

  const state = await page.evaluate(() => {
    const button = document.querySelector('.continue-button')!
    const copy = document.querySelector('.copy')!
    const buttonRect = button.getBoundingClientRect()
    const root = document.querySelector('.memolyWelcome')!
    const images = Array.from(root.querySelectorAll('img'), (image) => ({
      name: image.currentSrc.split('/').at(-1),
      loaded: image.complete && image.naturalWidth > 0,
    }))
    return {
      height: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      copyHeight: copy.clientHeight,
      copyScrollHeight: copy.scrollHeight,
      buttonBottom: buttonRect.bottom,
      heading: document.querySelector('.copy h1')!.textContent,
      images,
    }
  })
  expect(state.documentHeight).toBeLessThanOrEqual(state.height)
  expect(state.copyScrollHeight).toBeLessThanOrEqual(state.copyHeight + 1)
  expect(state.buttonBottom).toBeLessThanOrEqual(state.height)
  expect(state.heading).toBe('Маленькие моменты.Большая история.')
  expect(state.images.length).toBeGreaterThan(9)
  expect(state.images.every((image) => image.loaded)).toBe(true)
  expect(state.images.filter((image) => image.name === 'star.webp')).toHaveLength(2)
})
