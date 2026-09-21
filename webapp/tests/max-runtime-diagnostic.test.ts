import { expect, test } from 'bun:test'

import { shouldShowMaxRuntimeDiagnostic } from '../src/platform/max/host-bridge'

const maxHost = (search: string) => ({
  location: { pathname: '/mini-app', search },
  WebApp: { initData: 'query_id=signed', ready: () => undefined },
})

test('App startup keeps diagnostics hidden for ordinary authenticated MAX launches', () => {
  expect(shouldShowMaxRuntimeDiagnostic('max', maxHost(''))).toBe(false)
  expect(shouldShowMaxRuntimeDiagnostic('max', maxHost('?WebAppStartParam=max-video-upload-acceptance'))).toBe(false)
  expect(shouldShowMaxRuntimeDiagnostic('max', maxHost('?startapp=max-start-param-debug'))).toBe(true)
  expect(shouldShowMaxRuntimeDiagnostic('max', maxHost('?WebAppStartParam=max-start-param-debug'))).toBe(true)
  expect(shouldShowMaxRuntimeDiagnostic('telegram', maxHost('?WebAppStartParam=max-start-param-debug'))).toBe(false)
})
