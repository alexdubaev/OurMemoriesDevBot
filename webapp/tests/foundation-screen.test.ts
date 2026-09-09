import { expect, test } from 'bun:test'

import App from '../src/App'

test('shows an honest connection screen instead of the template product navigation', () => {
  const screen = App()

  expect(screen.props.children).toContain('Наши воспоминания')
  expect(screen.props.children).toContain('Подключение к семейной ленте появится в следующих блоках.')
})
