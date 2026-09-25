import axe from 'axe-core'
import { expect, test } from '@playwright/test'

const themes = ['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'] as const
const states = ['populated', 'empty-full', 'empty-viewer', 'add-sheet'] as const

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
      expect(findings.flatMap((finding) => finding.nodes).filter((node) => node.target.some((selector) => selector.includes('ml-filter')))).toHaveLength(0)
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
