import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChildHeader } from '../src/components/ChildHeader'
import {
  MEMOLY_THEME_CONFIG,
  MEMOLY_THEMES,
  ThemeProvider,
  getMemolyThemeConfig,
  isMemolyTheme,
} from '../src/features/theme'

test('memoLy exposes exactly the six canonical themes and local header artwork', () => {
  expect(MEMOLY_THEMES).toEqual(['mint', 'rose', 'sky', 'lavender', 'apricot', 'sand'])
  for (const theme of MEMOLY_THEMES) {
    expect(getMemolyThemeConfig(theme).headerArtUrl).toBe(`/assets/theme-header/${theme}.webp`)
    expect(MEMOLY_THEME_CONFIG[theme].label.length).toBeGreaterThan(0)
  }
  expect(isMemolyTheme('rose')).toBe(true)
  expect(isMemolyTheme('light')).toBe(false)
})

test('ThemeProvider applies the selected theme at the app root', () => {
  const markup = renderToStaticMarkup(
    createElement(ThemeProvider, null, createElement('main', null, 'content')),
  )

  expect(markup).toContain('data-memoly-theme="mint"')
  expect(markup).toContain('data-slot="memoly-theme-root"')
})

test('ChildHeader keeps Feed controls-free while Family adds overlay settings', () => {
  const feedMarkup = renderToStaticMarkup(createElement(ChildHeader, {
    childName: 'Лиза',
    childSubtitle: '2 года 8 месяцев',
    mode: 'feed',
    theme: 'rose',
  }))
  const familyMarkup = renderToStaticMarkup(createElement(ChildHeader, {
    childName: 'Лиза',
    childSubtitle: '2 года 8 месяцев',
    mode: 'family',
    onOpenChild: () => undefined,
    onOpenSettings: () => undefined,
    theme: 'rose',
  }))

  expect(feedMarkup).toContain('data-child-header-mode="feed"')
  expect(feedMarkup).toContain('src="/assets/theme-header/rose.webp"')
  expect(feedMarkup).not.toContain('aria-label="Настройки"')
  expect(familyMarkup).toContain('data-child-header-mode="family"')
  expect(familyMarkup).toContain('aria-label="Настройки"')
  expect(familyMarkup).toContain('data-slot="avatar-letter"')
})
