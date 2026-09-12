import { expect, test } from 'bun:test'

import { shouldKeepTelegramAuthPreloader, shouldStartTelegramAuth } from '../src/features/app/telegram-auth-handoff'

const readyForTelegramAuth = {
  hasInitData: true,
  isAuthenticated: false,
  isAuthBootstrapping: false,
  isTelegramAvailable: true,
}

test('CASE 1: auth-ready but unauthenticated Telegram handoff keeps branded preloader before the effect starts', () => {
  expect(shouldKeepTelegramAuthPreloader({ ...readyForTelegramAuth, hasStartedTelegramAuth: false, isTelegramAuthPending: false })).toBe(true)
})

test('CASE 2: Telegram auth success releases the handoff guard for family bootstrap', () => {
  expect(shouldKeepTelegramAuthPreloader({ ...readyForTelegramAuth, hasStartedTelegramAuth: true, isAuthenticated: true, isTelegramAuthPending: false })).toBe(false)
})

test('CASE 3: definitive Telegram auth failure releases the guard so the app-shell error can render', () => {
  expect(shouldKeepTelegramAuthPreloader({ ...readyForTelegramAuth, hasStartedTelegramAuth: true, isTelegramAuthPending: false })).toBe(false)
})

test('CASE 4 and 5: an existing attempt is not duplicated, while its render-state remains pending', () => {
  expect(shouldStartTelegramAuth({ ...readyForTelegramAuth, hasStartedTelegramAuth: true })).toBe(false)
  expect(shouldKeepTelegramAuthPreloader({ ...readyForTelegramAuth, hasStartedTelegramAuth: true, isTelegramAuthPending: true })).toBe(true)
})

test('CASE 6: missing initData does not turn the intended unsupported-context state into an infinite loader', () => {
  expect(shouldKeepTelegramAuthPreloader({ ...readyForTelegramAuth, hasStartedTelegramAuth: false, hasInitData: false, isTelegramAuthPending: false })).toBe(false)
})
