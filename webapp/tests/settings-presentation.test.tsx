import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SettingsMenu } from '../src/features/memoly-ui/SettingsSheet'

test('family settings sheet exposes only the canonical product rows', () => {
  const markup = renderToStaticMarkup(createElement(SettingsMenu, {
    onAbout: () => undefined,
    onAppearance: () => undefined,
    onHelp: () => undefined,
    theme: 'mint',
  }))

  expect(markup).toContain('Оформление')
  expect(markup).toContain('Помощь и приватность')
  expect(markup).toContain('О memoLy')
  expect(markup).not.toContain('system')
  expect(markup).not.toContain('dark')
  expect(markup).toContain('ml-settings-list')
})
