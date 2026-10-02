import { expect, test } from 'bun:test'

import { readUiVersion, resolveUiVersion } from '../src/features/ui-version/ui-version'

test('UI version defaults to legacy and accepts only the explicit v2 build flag', () => {
  expect(resolveUiVersion(undefined)).toBe('legacy')
  expect(resolveUiVersion('')).toBe('legacy')
  expect(resolveUiVersion('legacy')).toBe('legacy')
  expect(resolveUiVersion('v2')).toBe('v2')
  expect(resolveUiVersion('V2')).toBe('legacy')
  expect(resolveUiVersion('v3')).toBe('legacy')
  expect(readUiVersion()).toBe('legacy')
})
