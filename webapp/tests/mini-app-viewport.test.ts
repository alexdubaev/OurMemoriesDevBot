import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const webappRoot = resolve(import.meta.dir, '..')

test('uses one cover-safe viewport that prevents page zoom in the Mini App shell', async () => {
  const html = await readFile(resolve(webappRoot, 'index.html'), 'utf8')
  const viewports = html.match(/<meta\s+name=["']viewport["'][^>]*>/gi) ?? []

  expect(viewports).toHaveLength(1)
  expect(viewports[0]).toContain('width=device-width')
  expect(viewports[0]).toContain('initial-scale=1')
  expect(viewports[0]).toContain('maximum-scale=1')
  expect(viewports[0]).toContain('user-scalable=no')
  expect(viewports[0]).toContain('viewport-fit=cover')
})

test('keeps PhotoSwipe unblocked and mobile form controls at 16px', async () => {
  const [feed, styles, select] = await Promise.all([
    readFile(resolve(webappRoot, 'src/features/feed/FeedPage.tsx'), 'utf8'),
    readFile(resolve(webappRoot, 'src/index.css'), 'utf8'),
    readFile(resolve(webappRoot, 'src/components/ui/native-select.tsx'), 'utf8'),
  ])

  expect(feed).toContain('new PhotoSwipe({ dataSource: slides, index, showHideAnimationType: \'none\' })')
  expect(styles).not.toMatch(/touch-action\s*:\s*none/i)
  expect(select).toContain('text-base')
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
