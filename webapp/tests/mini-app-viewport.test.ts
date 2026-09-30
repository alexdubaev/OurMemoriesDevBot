import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const webappRoot = resolve(import.meta.dir, '..')

test('declares the document light-only before loading styles and at the CSS root', async () => {
  const [html, styles] = await Promise.all([
    readFile(resolve(webappRoot, 'index.html'), 'utf8'),
    readFile(resolve(webappRoot, 'src/index.css'), 'utf8'),
  ])
  const declarations = html.match(/<meta\s+name=["']color-scheme["'][^>]*>/gi) ?? []

  expect(declarations).toHaveLength(1)
  expect(declarations[0]).toMatch(/content=["']only light["']/i)
  expect(html.indexOf(declarations[0]!)).toBeLessThan(html.indexOf('<link rel="stylesheet"'))
  expect(styles).toMatch(/:root\s*\{\s*color-scheme:\s*only light\s*;/)
})

test('uses one cover-safe viewport that disables page zoom in the Mini App shell', async () => {
  const html = await readFile(resolve(webappRoot, 'index.html'), 'utf8')
  const viewports = html.match(/<meta\s+name=["']viewport["'][^>]*>/gi) ?? []

  expect(viewports).toHaveLength(1)
  expect(viewports[0]).toContain('width=device-width')
  expect(viewports[0]).toContain('initial-scale=1')
  expect(viewports[0]).toMatch(/maximum-scale\s*=\s*1(?:\D|$)/i)
  expect(viewports[0]).toMatch(/user-scalable\s*=\s*no/i)
  expect(viewports[0]).toContain('viewport-fit=cover')
})

test('keeps native media/viewer gestures and page pans while disallowing app zoom', async () => {
  const [feed, styles, select, main] = await Promise.all([
    readFile(resolve(webappRoot, 'src/features/feed/FeedPage.tsx'), 'utf8'),
    readFile(resolve(webappRoot, 'src/index.css'), 'utf8'),
    readFile(resolve(webappRoot, 'src/components/ui/native-select.tsx'), 'utf8'),
    readFile(resolve(webappRoot, 'src/main.tsx'), 'utf8'),
  ])

  expect(feed).toContain('new PhotoSwipe({ dataSource: slides, index, showHideAnimationType: \'none\' })')
  expect(styles).not.toMatch(/touch-action\s*:\s*none/i)
  expect(styles).toMatch(/touch-action\s*:\s*pan-x\s+pan-y/i)
  expect(select).toContain('text-base')
  expect(main).toContain('installAppZoomPrevention(document)')
})

test('touch text inputs use at least 16px to avoid iOS focus auto-zoom', async () => {
  const styles = await readFile(resolve(webappRoot, 'src/index.css'), 'utf8')
  expect(styles).toMatch(/@media\s*\(hover:\s*none\)[\s\S]*?input[\s\S]*?font-size:\s*max\(16px,\s*1em\)/i)
  expect(styles).toMatch(/textarea[\s\S]*?select[\s\S]*?font-size:\s*max\(16px,\s*1em\)/i)
})

test('reserves the bottom navigation safe area and preserves the media stacking contract', async () => {
  const [feedShell, navigation] = await Promise.all([
    readFile(resolve(webappRoot, 'src/features/feed/components/FeedShell.tsx'), 'utf8'),
    readFile(resolve(webappRoot, 'src/components/BottomNavigation.tsx'), 'utf8'),
  ])

  expect(feedShell).toContain('pb-[calc(var(--layout-bottom-nav)+var(--host-inset-bottom)+var(--layout-gutter))]')
  expect(navigation).toContain('data-testid="bottom-navigation"')
  expect(navigation).toContain('fixed inset-x-0 bottom-0 z-30')
  expect(navigation).toContain('pb-[var(--host-inset-bottom)]')
})
