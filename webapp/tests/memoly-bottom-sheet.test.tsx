import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MemolyBottomSheetPanel } from '../src/components/MemolyBottomSheet'
import { addSheetFirstLevelActions } from '../src/features/memoly-ui/add-sheet-actions'

test('uses one tactile, safe-area-aware shell for T09 sheet content', () => {
  const markup = renderToStaticMarkup(createElement(MemolyBottomSheetPanel, {
    children: createElement('p', null, 'Содержимое'),
  }))

  expect(markup).toContain('data-slot="memoly-bottom-sheet-handle"')
  expect(markup).toContain('pb-[calc(1.25rem+var(--host-inset-bottom))]')
  expect(markup).toContain('Содержимое')
})

test('wraps sheet content in the shared drawer shell', () => {
  const source = readFileSync(resolve(import.meta.dir, '../src/components/MemolyBottomSheet.tsx'), 'utf8')

  expect(source).toContain('data-slot="memoly-bottom-sheet"')
  expect(source).toContain('<Drawer')
})

test('keeps the T09 Add first level to exactly photo, note, and voice-or-video', () => {
  expect(addSheetFirstLevelActions).toEqual(['photo', 'note', 'voice-or-video'])
})

test('defines semantic tactile tokens for T09 surfaces and sheets', () => {
  const css = readFileSync(resolve(import.meta.dir, '../src/styles/tokens.css'), 'utf8')

  expect(css).toContain('--memory-surface-raised:')
  expect(css).toContain('--memory-surface-inset:')
  expect(css).toContain('--memory-sheet-shadow:')
  expect(css).toContain('--memory-inset-shadow:')
})
