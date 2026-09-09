import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { backendTestFiles } from './test-files.mjs'

test('backend test discovery returns portable paths accepted by the focused runner', () => {
  const files = backendTestFiles(resolve(import.meta.dir, '..')).all

  expect(files.length).toBeGreaterThan(0)
  expect(files.every((file) => !file.includes('\\'))).toBe(true)
})
