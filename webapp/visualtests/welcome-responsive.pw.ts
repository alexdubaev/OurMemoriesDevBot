import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const evidence = resolve(import.meta.dirname, '../e2e/.artifacts/welcome-responsive')
const portraitViewports = [[320, 568], [375, 667], [375, 812], [390, 844], [393, 852], [430, 932]] as const
const contentSelectors = ['.hero', '.copy h1', '.copy p', '.features', '.feature-desc', '.privacy', '.footer', '.continue-button']
const canonicalCss = readFileSync(resolve(import.meta.dirname, '../src/features/memoly-ui/family-management.css'), 'utf8')
const canonicalPrimaryBlock = canonicalCss.match(/\.family-management-primary, \.family-management-secondary, \.family-management-danger \{([^}]+)\}/)?.[1]
const canonicalPrimaryStyle = canonicalCss.match(/\.family-management-primary \{([^}]+)\}/)?.[1]
const canonicalPrimaryDisabled = canonicalCss.match(/\.family-management-primary:disabled, \.family-management-danger:disabled \{([^}]+)\}/)?.[1]
if (!canonicalPrimaryBlock || !canonicalPrimaryStyle || !canonicalPrimaryDisabled) throw new Error('Could not find canonical family primary button rules')
const canonicalPrimaryRule = `.reference-primary{${canonicalPrimaryBlock}${canonicalPrimaryStyle}}.reference-primary:disabled{${canonicalPrimaryDisabled}}`

type Rect = { top: number; right: number; bottom: number; left: number; width: number; height: number }
type Metrics = {
  viewport: { width: number; height: number }
  document: { width: number; height: number }
  copy: { clientHeight: number; scrollHeight: number; clientWidth: number; scrollWidth: number; bottom: number }
  rects: Record<string, Rect>
  cards: Rect[]
  font: { family: string; loaded: boolean; weight: string }
}

async function measure(page: import('@playwright/test').Page): Promise<Metrics> {
  return page.evaluate((selectors): Metrics => {
    const rects: Metrics['rects'] = {}
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing ${selector}`)
      const rect = element.getBoundingClientRect()
      rects[selector] = { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
    }
    const copy = document.querySelector('.copy')!
    const copyRect = copy.getBoundingClientRect()
    const headline = document.querySelector('.copy h1')!
    const headlineStyle = getComputedStyle(headline)
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      copy: { clientHeight: copy.clientHeight, scrollHeight: copy.scrollHeight, clientWidth: copy.clientWidth, scrollWidth: copy.scrollWidth, bottom: copyRect.bottom },
      rects,
      cards: Array.from(document.querySelectorAll('.feat'), (card) => {
        const rect = card.getBoundingClientRect()
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
      }),
      font: {
        family: headlineStyle.fontFamily,
        loaded: document.fonts.check('800 24px Nunito', 'Маленькие моменты.'),
        weight: headlineStyle.fontWeight,
      },
    }
  }, contentSelectors)
}

test('welcome fits portrait viewports, preserves all copy, and uses the canonical primary style', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await mkdir(evidence, { recursive: true })
  const results: Metrics[] = []
  for (const [width, height] of portraitViewports) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/visualtests/welcome-parity.html')
    await page.addStyleTag({ content: canonicalPrimaryRule })
    await page.evaluate(({ top, bottom }) => {
      const reference = document.createElement('button')
      reference.className = 'reference-primary'
      reference.textContent = 'reference'
      reference.disabled = true
      Object.assign(reference.style, { position: 'fixed', top: '0', left: '0', visibility: 'hidden' })
      document.querySelector('.memolyWelcome')!.append(reference)
      document.documentElement.style.setProperty('--host-inset-top', `${top}px`)
      document.documentElement.style.setProperty('--host-inset-bottom', `${bottom}px`)
    }, { top: 47, bottom: 34 })
    const cta = page.locator('.continue-button')
    await expect(cta).toBeEnabled()
    const metrics = await measure(page)
    results.push(metrics)

    const { rects, viewport, copy } = metrics
    expect(metrics.document.width, `${width}x${height} horizontal page overflow`).toBeLessThanOrEqual(width)
    expect(metrics.document.height, `${width}x${height} vertical page overflow`).toBeLessThanOrEqual(height)
    expect(copy.scrollHeight, `${width}x${height} nested copy scroll`).toBeLessThanOrEqual(copy.clientHeight + 1)
    expect(copy.scrollWidth, `${width}x${height} nested horizontal copy overflow`).toBeLessThanOrEqual(copy.clientWidth + 1)
    expect(metrics.font.loaded, `${width}x${height} Nunito Cyrillic face loaded`).toBe(true)
    expect(metrics.font.family).toContain('Nunito')
    expect(metrics.font.weight).toBe('800')
    const headlineStyle = await page.evaluate(() => {
      const pink = document.querySelector('.headline-pink')!
      const green = document.querySelector('.copy h1 span:not(.headline-pink)')!
      const lineCount = (element: Element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      }
      return {
        pink: getComputedStyle(pink).color,
        green: getComputedStyle(green).color,
        pinkLines: lineCount(pink),
        greenLines: lineCount(green),
      }
    })
    expect(headlineStyle.pink).toBe('rgb(238, 141, 173)')
    expect(headlineStyle.green).toBe('rgb(93, 143, 115)')
    expect(headlineStyle.pinkLines, `${width}x${height} first headline phrase`).toBe(1)
    expect(headlineStyle.greenLines, `${width}x${height} second headline phrase`).toBe(1)
    expect(rects['.feature-desc']!.height).toBeGreaterThan(0)
    expect(rects['.continue-button']!.top).toBeGreaterThanOrEqual(0)
    expect(rects['.continue-button']!.bottom).toBeLessThanOrEqual(height - 34)
    expect(rects['.copy h1']!.bottom).toBeLessThanOrEqual(height - 34)
    expect(rects['.hero']!.bottom).toBeLessThanOrEqual(rects['.copy h1']!.top)
    expect(rects['.privacy']!.bottom).toBeLessThanOrEqual(rects['.footer']!.top)
    expect(rects['.footer']!.bottom).toBeLessThanOrEqual(rects['.continue-button']!.top)
    expect(metrics.cards).toHaveLength(4)
    expect(Math.max(...metrics.cards.map((rect) => rect.top)) - Math.min(...metrics.cards.map((rect) => rect.top))).toBeLessThanOrEqual(2.1)
    expect(Math.max(...metrics.cards.map((rect) => rect.bottom)) - Math.min(...metrics.cards.map((rect) => rect.top))).toBeLessThan(120)
    for (const [selector, rect] of Object.entries(rects)) {
      expect(rect.left, `${selector} left edge ${width}x${height}`).toBeGreaterThanOrEqual(0)
      expect(rect.right, `${selector} right edge ${width}x${height}`).toBeLessThanOrEqual(viewport.width)
      expect(rect.top, `${selector} top ${width}x${height}`).toBeGreaterThanOrEqual(0)
      expect(rect.bottom, `${selector} bottom ${width}x${height}`).toBeLessThanOrEqual(height - 34)
    }

    const styleComparison = await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('.continue-button')!
      const reference = document.querySelector<HTMLButtonElement>('.reference-primary')!
      const read = (element: HTMLElement) => {
        const style = getComputedStyle(element)
        return {
          backgroundImage: style.backgroundImage,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          minHeight: style.minHeight,
          opacity: style.opacity,
        }
      }
      const actual = read(button)
      const expected = read(reference)
      button.disabled = true
      const disabledOpacity = getComputedStyle(button).opacity
      button.disabled = false
      return { actual, expected, disabledOpacity }
    })
    for (const property of ['backgroundImage', 'borderRadius', 'boxShadow', 'color', 'fontSize', 'fontWeight', 'minHeight'] as const) {
      expect(styleComparison.actual[property], `${property} matches canonical green primary`).toBe(styleComparison.expected[property])
    }
    expect(styleComparison.disabledOpacity).toBe(styleComparison.expected.opacity)
    const nonHeadlineFonts = await page.locator('.kicker, .copy p, .feat span, .feature-desc, .privacy, .footer, .continue-button').evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontFamily))
    expect(nonHeadlineFonts.every((family) => !family.includes('Nunito'))).toBe(true)
    const logoTop = await page.locator('.logo-wrap').evaluate((element) => element.getBoundingClientRect().top)
    expect(logoTop).toBeGreaterThanOrEqual(47)

    await page.screenshot({ path: resolve(evidence, `${testInfo.project.name}-${width}x${height}.png`) })
    console.log(`${width}x${height}: CTA bottom ${rects['.continue-button']!.bottom.toFixed(1)}, copy ${copy.scrollHeight}/${copy.clientHeight}, hero ${rects['.hero']!.height.toFixed(1)}`)
  }
  await writeFile(resolve(evidence, `${testInfo.project.name}-metrics.json`), JSON.stringify(results, null, 2))

  // A WebView can resize its dynamic viewport when browser chrome changes.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/visualtests/welcome-parity.html')
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--host-inset-top', '47px')
    document.documentElement.style.setProperty('--host-inset-bottom', '34px')
  })
  await expect(page.locator('.continue-button')).toBeEnabled()
  for (const height of [700, 844]) {
    await page.setViewportSize({ width: 390, height })
    const resized = await measure(page)
    expect(resized.copy.scrollHeight).toBeLessThanOrEqual(resized.copy.clientHeight + 1)
    expect(resized.rects['.continue-button']!.bottom).toBeLessThanOrEqual(height - 34)
  }

  // MAX/Android-like viewport, without an iOS home indicator inset.
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/visualtests/welcome-parity.html')
  await expect(page.locator('.continue-button')).toBeEnabled()
  const android = await measure(page)
  expect(android.copy.scrollHeight).toBeLessThanOrEqual(android.copy.clientHeight + 1)
  expect(android.rects['.continue-button']!.bottom).toBeLessThanOrEqual(915)

  // Compact landscape keeps content readable with a reduced hero.
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/visualtests/welcome-parity.html')
  await expect(page.locator('.continue-button')).toBeEnabled()
  const landscape = await measure(page)
  expect(landscape.document.width).toBeLessThanOrEqual(844)
  expect(landscape.copy.scrollHeight).toBeLessThanOrEqual(landscape.copy.clientHeight + 1)
  expect(landscape.rects['.continue-button']!.bottom).toBeLessThanOrEqual(390)

  await page.locator('.continue-button').click()
  await expect(page.locator('html')).toHaveAttribute('data-welcome-complete', '1')

  // Capture and check the full intro motion path separately from reduced-motion layout screenshots.
  const motionPage = await page.context().newPage()
  await motionPage.setViewportSize({ width: 390, height: 844 })
  await motionPage.emulateMedia({ reducedMotion: 'no-preference' })
  await motionPage.goto('/visualtests/welcome-parity.html')
  await expect(motionPage.locator('.continue-button')).toBeEnabled({ timeout: 10_000 })
  await expect(motionPage.locator('.continue-button')).toBeVisible()
  await expect(motionPage.locator('.continue-button')).toHaveCSS('opacity', '1')
  const motionButton = await motionPage.locator('.continue-button').boundingBox()
  if (!motionButton) throw new Error('Continue button has no visible bounding box after the intro')
  expect(motionButton.y + motionButton.height).toBeLessThanOrEqual(844)
  await motionPage.screenshot({ path: resolve(evidence, `${testInfo.project.name}-390x844-full-motion.png`) })
  await motionPage.close()
})
