import axe from 'axe-core'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const themes = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'] as const
const states = ['populated', 'empty-full', 'empty-viewer', 'add-sheet'] as const
const expectedContrast = JSON.parse(readFileSync(new URL('./agent-k-contrast-baseline.json', import.meta.url), 'utf8')) as Record<string, string[]>

function parseSignature(value: string) {
  const [target, foreground, background] = value.split('|')
  return { target, foreground, background }
}

function channels(value: string) {
  return [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
}

function expectMeasuredColor(actual: string, expected: string) {
  // Gradient sampling can shift a few RGB levels between captures.
  for (const [index, channel] of channels(actual).entries()) {
    expect(Math.abs(channel - channels(expected)[index])).toBeLessThanOrEqual(10)
  }
}

for (const theme of themes) {
  for (const state of states) {
    test(`Agent K axe: ${theme} / ${state} at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/__fixtures/design-system?state=${state}`)
      await expect(page.locator('[data-fixture-state]')).toHaveAttribute('data-fixture-state', state)
      await page.evaluate((value) => { document.documentElement.dataset.memolyTheme = value }, theme)
      await page.addScriptTag({ content: axe.source })
      const findings = await page.evaluate(async () => {
        const engine = (window as typeof window & { axe: typeof axe }).axe
        const result = await engine.run(document, { runOnly: { type: 'rule', values: ['color-contrast', 'meta-viewport'] } })
        return result.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
            data: node.any.map((check) => check.data),
          })),
        }))
      })
      console.log(JSON.stringify({ theme, state, findings }))
      expect(findings.filter((finding) => finding.id === 'meta-viewport')).toHaveLength(0)
      expect(findings.filter((finding) => finding.id !== 'color-contrast')).toHaveLength(0)
      const contrastSignatures = findings.flatMap((finding) => finding.nodes.map((node) => {
        const colors = node.data[0] as { fgColor: string; bgColor: string }
        return `${node.target.join(',')}|${colors.fgColor}|${colors.bgColor}`
      })).map(parseSignature).sort((left, right) => left.target.localeCompare(right.target))
      const expected = expectedContrast[`${theme}/${state}`].map(parseSignature).sort((left, right) => left.target.localeCompare(right.target))
      expect(contrastSignatures.map((entry) => entry.target)).toEqual(expected.map((entry) => entry.target))
      for (const [index, entry] of contrastSignatures.entries()) {
        expectMeasuredColor(entry.foreground, expected[index].foreground)
        expectMeasuredColor(entry.background, expected[index].background)
      }
    })
  }
}

for (const width of [320, 390, 430, 480]) {
  test(`Agent K zoom and focus: feed at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/__fixtures/design-system?state=populated')
    await expect(page.locator('[data-fixture-state="populated"]')).toBeVisible()
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const opener = page.getByRole('button', { name: 'Добавить' })
    await opener.focus()
    await expect(opener).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })
}
