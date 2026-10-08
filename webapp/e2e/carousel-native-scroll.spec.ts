import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const productionStylesheet = await readFile(
  new URL('../src/features/feed/presentation/memoly-feed.css', import.meta.url),
  'utf8',
)

function fixture(topMargin = 0): string {
  return `<style>${productionStylesheet}</style>
    <main data-memoly-feed style="width:320px;margin-top:${topMargin}px">
      <article class="memory-card">
        <div class="memoly-mixed-carousel">
          <div class="memoly-mixed-viewport" data-media-stage="feed" tabindex="0">
            <div class="memoly-mixed-track" style="transform:translate3d(8px,0,0)">
              <section class="memoly-mixed-slide" data-carousel-active="true">
                <button style="width:100%;height:100%">Active slide</button>
              </section>
              <section class="memoly-mixed-slide"><button>Next slide</button></section>
            </div>
          </div>
        </div>
      </article>
    </main>`
}

async function geometry(viewport: import('@playwright/test').Locator) {
  return viewport.evaluate((element: HTMLElement) => {
    const track = element.querySelector<HTMLElement>('.memoly-mixed-track')!
    const active = element.querySelector<HTMLElement>('[data-carousel-active="true"]')!
    const box = element.getBoundingClientRect()
    const trackBox = track.getBoundingClientRect()
    const activeBox = active.getBoundingClientRect()

    return {
      viewport: box.toJSON(),
      track: trackBox.toJSON(),
      active: activeBox.toJSON(),
      trackOffsetX: trackBox.x - box.x,
      activeOffsetX: activeBox.x - box.x,
      activeWidth: activeBox.width,
      clientWidth: element.clientWidth,
    }
  })
}

test('direct scrollTo cannot give the transformed viewport a native scroll position', async ({ page }) => {
  await page.setContent(fixture())
  const viewport = page.locator('.memoly-mixed-viewport')
  const before = await geometry(viewport)
  expect(Math.abs(before.activeWidth - before.clientWidth)).toBeLessThanOrEqual(1)

  await viewport.evaluate((element: HTMLElement) => element.scrollTo({ left: 8 }))

  await expect.poll(() => viewport.evaluate((element: HTMLElement) => element.scrollLeft)).toBe(0)
  expect(await geometry(viewport)).toEqual(before)
})

test('focus and scrollIntoView on the active slide cannot move the viewport', async ({ page }) => {
  await page.setContent(fixture())
  const viewport = page.locator('.memoly-mixed-viewport')
  const before = await geometry(viewport)
  const activeButton = page.locator('[data-carousel-active="true"] button')

  await activeButton.evaluate((element: HTMLElement) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  await activeButton.focus()

  await expect.poll(() => viewport.evaluate((element: HTMLElement) => element.scrollLeft)).toBe(0)
  expect(await geometry(viewport)).toEqual(before)
})

test('focus still scrolls the vertical page without moving the carousel viewport', async ({ page }) => {
  await page.setContent(fixture(700))
  await page.evaluate(() => window.scrollTo(0, 0))
  const viewport = page.locator('.memoly-mixed-viewport')
  const before = await geometry(viewport)

  await page.locator('[data-carousel-active="true"] button').focus()

  const pageScrollY = await page.evaluate(() => window.scrollY)
  expect(pageScrollY).toBeGreaterThan(0)
  await expect.poll(() => viewport.evaluate((element: HTMLElement) => element.scrollLeft)).toBe(0)
  const after = await geometry(viewport)
  expect(after.viewport.x).toBe(before.viewport.x)
  expect(after.viewport.y + pageScrollY).toBeCloseTo(before.viewport.y, 2)
  expect(after.viewport.width).toBe(before.viewport.width)
  expect(after.viewport.height).toBe(before.viewport.height)
  expect(after.trackOffsetX).toBe(before.trackOffsetX)
  expect(after.activeOffsetX).toBe(before.activeOffsetX)
  expect(after.activeWidth).toBe(before.activeWidth)
})
