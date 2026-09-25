import { afterEach, expect, test } from 'bun:test'

import { privateMediaDiagnosticHeaders } from '../src/platform/media/private-media-diagnostics'

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

test('private media diagnostics are disabled unless the explicit query flag is present', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '' } } })
  expect(privateMediaDiagnosticHeaders()).toBeUndefined()

  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { search: '?memolyPrivateMediaDiagnostic=1' } } })
  expect(privateMediaDiagnosticHeaders()).toEqual({ 'X-Memoly-Private-Media-Diagnostic': '1' })
})
