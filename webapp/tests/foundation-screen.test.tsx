import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import App from '../src/App'
import { createBrowserDevHostBridge } from '../src/platform/telegram'

test('shows the memoLy loading shell in an ordinary browser without pretending that a family is loaded', () => {
  const markup = renderToStaticMarkup(
    createElement(App, { hostBridge: createBrowserDevHostBridge() }),
  )

  expect(markup).toContain('src="/assets/brand/memoly-logo-correct.webp"')
  expect(markup).toContain('alt="memoLy"')
  expect(markup).not.toContain('Наши воспоминания')
  expect(markup).toContain('data-slot="app-loading"')
  expect(markup).not.toContain('Откройте приложение в Telegram')
  expect(markup).not.toContain('Открыть бота')
  expect(markup).not.toContain('Варя')
  expect(markup).not.toContain('Наша семья')
})

test('shows an honest loading foundation while browser auth is bootstrapping', () => {
  const hostBridge = {
    ...createBrowserDevHostBridge({ insets: { top: 12, bottom: 18 } }),
    isAvailable: true,
  }
  const markup = renderToStaticMarkup(createElement(App, { hostBridge }))

  expect(markup).toContain('data-slot="app-loading"')
  expect(markup).toContain('--host-inset-top:12px')
  expect(markup).toContain('--host-inset-bottom:18px')
  expect(markup).not.toContain('Варя')
  expect(markup).not.toContain('Наша семья')
})
