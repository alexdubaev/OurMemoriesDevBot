import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  DesignSystemFixturePage,
  type DesignSystemFixtureState,
} from '../src/dev/DesignSystemFixturePage'

const fixtureStates: DesignSystemFixtureState[] = [
  'populated',
  'empty-full',
  'empty-viewer',
  'loading',
  'error',
  'add-sheet',
]

test('development fixtures use only the approved synthetic family data and states', () => {
  for (const state of fixtureStates) {
    const markup = renderToStaticMarkup(
      createElement(DesignSystemFixturePage, { initialState: state }),
    )

    expect(markup).toContain('data-fixture-state')
    expect(markup).toContain('Варя')
    expect(markup).toContain('Наша семья')
  }

  const populated = renderToStaticMarkup(
    createElement(DesignSystemFixturePage, { initialState: 'populated' }),
  )
  expect(populated).toContain('Сегодня сама придумала историю про облако')
  expect(populated).toContain('Первый раз на море')
})
