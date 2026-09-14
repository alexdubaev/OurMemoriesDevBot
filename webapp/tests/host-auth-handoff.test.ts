import { expect, test } from 'bun:test'

import {
  hostAuthAttemptKey,
  shouldKeepHostAuthPreloader,
  shouldStartHostAuth,
} from '../src/features/auth/host-auth-handoff'

test('host auth handoff keys one effective provider and raw payload', () => {
  const payload = 'query_id=signed'
  expect(hostAuthAttemptKey('max', payload)).toBe(hostAuthAttemptKey('max', payload))
  expect(hostAuthAttemptKey('max', payload)).not.toBe(hostAuthAttemptKey('telegram', payload))
  expect(hostAuthAttemptKey('max', null)).toBeNull()
})

test('host auth handoff keeps the preloader until one exchange starts or finishes', () => {
  const ready = {
    provider: 'max' as const,
    hasInitData: true,
    hasStartedAuth: false,
    isAuthenticated: false,
    isAuthBootstrapping: false,
    isHostAvailable: true,
  }
  expect(shouldStartHostAuth(ready)).toBe(true)
  expect(shouldKeepHostAuthPreloader({ ...ready, isAuthPending: false })).toBe(true)
  expect(shouldKeepHostAuthPreloader({ ...ready, hasStartedAuth: true, isAuthPending: true })).toBe(true)
  expect(shouldKeepHostAuthPreloader({ ...ready, hasStartedAuth: true, isAuthPending: false })).toBe(false)
})
