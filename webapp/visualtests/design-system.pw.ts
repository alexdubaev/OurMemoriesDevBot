import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const repositoryRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const screenshotDirectory = path.join(repositoryRoot, 'output/playwright/t06-screenshots')

async function openFixture(page: Page, state: string, width = 390) {
  await page.setViewportSize({ width, height: 844 })
  await page.goto(`/__fixtures/design-system?state=${state}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-fixture-state]')).toHaveAttribute('data-fixture-state', state)
}

async function saveWebp(page: Page, name: string) {
  await mkdir(screenshotDirectory, { recursive: true })
  const png = await page.screenshot({ animations: 'disabled' })
  await sharp(png).webp({ quality: 90 }).toFile(path.join(screenshotDirectory, `${name}.webp`))
}

test('F06.1/F06.2/F06.3/F06.5: palette, navigation, roles and mobile width follow the design contract', async ({ page }) => {
  for (const width of [360, 390, 430]) {
    await openFixture(page, 'populated', width)

    const metrics = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    expect(metrics.background).toBe('rgb(237, 241, 234)')
    expect(metrics.foreground).toBe('rgb(48, 42, 46)')
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(0)

    if (width === 390) {
      const expectedTokens = {
        '--memory-accent-soft': '#dce7df',
        '--memory-accent-strong': '#7f9f90',
        '--memory-accent-tint': '#dce7df',
        '--memory-canvas': '#edf1ea',
        '--memory-danger': '#b4233a',
        '--memory-line': '#e8dfda',
        '--memory-success': '#276749',
        '--memory-surface': '#f5f5ef',
        '--memory-surface-soft': '#e9ede7',
        '--memory-text': '#302a2e',
        '--memory-text-muted': '#6f7f78',
      }
      const actualTokens = await page.evaluate((names) => {
        const style = getComputedStyle(document.documentElement)
        return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]))
      }, Object.keys(expectedTokens))
      expect(actualTokens).toEqual(expectedTokens)
      expect(contrastRatio('#302a2e', '#edf1ea')).toBeGreaterThanOrEqual(4.5)
    }

    const positions = page.locator('[data-nav-position]')
    await expect(positions).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Добавить' })).toHaveCount(1)

    for (const element of await positions.all()) {
      const box = await element.boundingBox()
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }

    await saveWebp(page, `populated-${width}`)
  }

  await openFixture(page, 'empty-viewer')
  await expect(page.getByRole('button', { name: 'Добавить' })).toHaveCount(0)
  await expect(page.getByLabel('Режим просмотра')).toContainText('Просмотр')
  await saveWebp(page, 'empty-viewer-390')
})

test('reduced motion removes component transition durations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openFixture(page, 'populated')

  const durations = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      dialog: style.getPropertyValue('--duration-dialog').trim(),
      standard: style.getPropertyValue('--duration-standard').trim(),
    }
  })
  expect(durations).toEqual({ dialog: '0ms', standard: '0ms' })
})

test('F06.6: AddSheet traps focus, Escape returns it to the real opener, and Browser Back closes first', async ({ page }) => {
  await openFixture(page, 'populated')
  const opener = page.getByRole('button', { name: 'Добавить' })
  await opener.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()

  await opener.click()
  await expect(dialog).toBeVisible()
  await page.goBack()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-fixture-state="populated"]')).toBeVisible()
})

test('F06.7: 200% root text keeps the primary actions available without page overflow', async ({ page }) => {
  await openFixture(page, 'empty-full')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })

  const openBotAction = page.getByRole('button', { name: 'Открыть бота' })
  const primaryActions = [
    openBotAction,
    page.getByRole('button', { name: 'Добавить' }),
  ]
  for (const action of primaryActions) {
    await expect(action).toBeVisible()
    const box = await action.boundingBox()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390)
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await openBotAction.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const visibleActionBox = await openBotAction.boundingBox()
  expect(visibleActionBox?.y ?? -1).toBeGreaterThanOrEqual(0)
  expect((visibleActionBox?.y ?? 0) + (visibleActionBox?.height ?? 0)).toBeLessThanOrEqual(776)
  await saveWebp(page, 'empty-full-text-200-390')
})

test('captures the required 390px full, empty and sheet fixtures', async ({ page }) => {
  for (const state of ['populated', 'empty-full', 'empty-viewer', 'add-sheet']) {
    await openFixture(page, state)
    if (state === 'add-sheet') await expect(page.getByRole('dialog')).toBeVisible()
    await saveWebp(page, `${state}-390`)
  }
})

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    const linear = channels.map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const values = [luminance(foreground), luminance(background)].toSorted((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
