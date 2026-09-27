import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceUrl = pathToFileURL(resolve(import.meta.dirname, '../../docs/design/welcome-first-run/memoly-welcome-final-ios.html')).href
const evidence = resolve(import.meta.dirname, '../e2e/.artifacts/welcome-parity')
const phases = [0, 1_050, 2_050, 3_050, 4_000]
const sizes = [[390, 844], [320, 568], [430, 932]] as const
const commonSelectors = ['.app', '.hero', '.bg', '.ribbon', '.book', '.star', '.logo-wrap', '.copy h1', '.copy p', '.features']

type Rect = { x: number; y: number; width: number; height: number; opacity: number }
type Frame = { scrollWidth: number; scrollHeight: number; rects: Record<string, Rect>; footerBottom: number }

async function seekAndMeasure(page: import('@playwright/test').Page, milliseconds: number): Promise<Frame> {
  return page.evaluate(({ milliseconds, selectors }) => {
    for (const animation of document.getAnimations()) {
      animation.pause()
      animation.currentTime = milliseconds
    }
    const rects: Record<string, Rect> = {}
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing ${selector}`)
      const rect = element.getBoundingClientRect()
      rects[selector] = {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        opacity: Number(getComputedStyle(element).opacity),
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      rects,
      footerBottom: document.querySelector('.footer')!.getBoundingClientRect().bottom,
    }
  }, { milliseconds, selectors: commonSelectors })
}

test('source and production share the source-derived animation geometry and order', async ({ browser }, testInfo) => {
  test.setTimeout(90_000)
  await mkdir(evidence, { recursive: true })
  const records: Array<{ size: string; phase: number; source: Frame; production: Frame }> = []
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width, height }, reducedMotion: 'no-preference' })
    const source = await context.newPage()
    const production = await context.newPage()
    await source.goto(sourceUrl)
    await production.goto('/visualtests/welcome-parity.html')
    await expect(production.locator('[data-slot="welcome-splash"]')).toBeVisible()
    for (const page of [source, production]) {
      await page.evaluate(async () => {
        await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)))
        document.getAnimations().forEach((animation) => animation.pause())
      })
    }
    for (const phase of phases) {
      const sourceFrame = await seekAndMeasure(source, phase)
      const productionFrame = await seekAndMeasure(production, phase)
      records.push({ size: `${width}x${height}`, phase, source: sourceFrame, production: productionFrame })
      expect(productionFrame.scrollWidth).toBeLessThanOrEqual(width)
      expect(productionFrame.scrollHeight).toBeLessThanOrEqual(height)
      if (phase === 4_000) expect(productionFrame.footerBottom).toBeLessThanOrEqual(height)
      for (const selector of commonSelectors) {
        const expected = sourceFrame.rects[selector]!
        const actual = productionFrame.rects[selector]!
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(Math.abs(actual[key] - expected[key]), `${selector} ${key} at ${width}x${height} t=${phase}`).toBeLessThanOrEqual(3.5)
        }
        expect(Math.abs(actual.opacity - expected.opacity), `${selector} opacity at t=${phase}`).toBeLessThanOrEqual(0.03)
      }
      await source.screenshot({ path: resolve(evidence, `source-${width}x${height}-${phase}.png`) })
      await production.screenshot({ path: resolve(evidence, `production-${width}x${height}-${phase}.png`) })
    }
    await context.close()
  }
  await writeFile(resolve(evidence, 'verified-metrics.json'), JSON.stringify(records, null, 2))
})
