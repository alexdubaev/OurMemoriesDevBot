import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const output = path.join(os.tmpdir(), 'memoly-b5-screenshots')

test('Family Hub states render and selected family returns to the same Hub', async ({ page }) => {
  await mkdir(output, { recursive: true })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const state of ['empty', 'single', 'multi', 'owned', 'loading', 'error', 'long', 'revoked']) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/__fixtures/family-hub?state=${state}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-fixture-state]')).toHaveAttribute('data-fixture-state', state)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: path.join(output, `${state}-390.png`), animations: 'disabled' })
  }
  await page.goto('/__fixtures/family-hub?state=owned')
  await page.getByRole('button', { name: /Семья Александра, София · 2 года 4 месяца, Владелец/ }).click()
  await expect(page.getByRole('button', { name: '‹ Все семьи' })).toBeVisible()
  await expect(page.locator('.family-context-title')).toHaveText('Семья Александра')
  await page.screenshot({ path: path.join(output, 'selected-feed-390.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '‹ Все семьи' }).click()
  await expect(page.getByRole('heading', { name: 'Мои семьи' })).toBeVisible()
  expect(errors).toEqual([])
})

test('Family Hub responds to narrow/wide viewports and six themes', async ({ page }) => {
  await mkdir(output, { recursive: true })
  for (const width of [320, 430, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/__fixtures/family-hub?state=long')
    await expect(page.locator('.family-hub-card')).toHaveCount(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: path.join(output, `long-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    await page.goto(`/__fixtures/family-hub?state=owned&theme=${theme}`)
    await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
    await page.screenshot({ path: path.join(output, `owned-${theme}.png`), animations: 'disabled' })
  }
})

test('dark device preference keeps Family Hub and Feed in each canonical light theme', async ({ page }) => {
  for (const theme of ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand']) {
    const samples: Array<{ scheme: string; background: string; surface: string }> = []
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme })
      await page.goto(`/__fixtures/family-hub?state=owned&theme=${theme}`)
      await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', theme)
      samples.push(await page.evaluate(() => ({
        scheme: getComputedStyle(document.documentElement).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
        surface: getComputedStyle(document.querySelector('.family-hub-card')!).backgroundImage,
      })))
    }
    expect(samples[0]).toEqual(samples[1])
    expect(samples[0]?.scheme).toBe('light only')
  }

  const feedSamples: Array<{ scheme: string; background: string }> = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.goto('/__fixtures/family-hub?state=feed&theme=mint')
    await expect(page.locator('[data-fixture-state="feed"]')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-memoly-theme', 'mint')
    feedSamples.push(await page.evaluate(() => ({
      scheme: getComputedStyle(document.documentElement).colorScheme,
      background: getComputedStyle(document.body).backgroundColor,
    })))
  }
  expect(feedSamples[0]).toEqual(feedSamples[1])
  expect(feedSamples[0]?.scheme).toBe('light only')
})
