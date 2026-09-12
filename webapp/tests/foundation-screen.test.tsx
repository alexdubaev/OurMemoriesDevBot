import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import App from '../src/App'
import { createBrowserDevHostBridge } from '../src/platform/telegram'

test('shows the memoLy brand outside Telegram without pretending that a family is loaded', () => {
  const markup = renderToStaticMarkup(
    createElement(App, { hostBridge: createBrowserDevHostBridge() }),
  )

  expect(markup).toContain('src="/assets/brand/memoly-logo.webp"')
  expect(markup).toContain('alt="memoLy"')
  expect(markup).not.toContain('Наши воспоминания')
  expect(markup).toContain('Откройте приложение в Telegram')
  expect(markup).toContain('В этой тестовой версии вход работает через нашего бота.')
  expect(markup).toContain('Открыть бота')
  expect(markup).toContain('aria-label="Открыть бота"')
  expect(markup).toContain('href="https://t.me/OurMemoriesDevBot"')
  expect(markup).not.toContain('Варя')
  expect(markup).not.toContain('Наша семья')
})

test('shows an honest loading foundation inside Telegram while later blocks own real feed data', () => {
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
