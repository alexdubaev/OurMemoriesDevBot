import { expect, test } from 'bun:test'

import App from '../src/App'

test('shows an honest connection screen instead of the template product navigation', () => {
  const screen = App()

  expect(screen.props.children).toContain('Наши воспоминания')
  expect(screen.props.children).toContain('Telegram-вход и семейные права подключены')
  expect(screen.props.children).toContain('семейная лента появится в следующих блоках.')
})
