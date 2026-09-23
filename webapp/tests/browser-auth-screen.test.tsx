import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import App from '../src/App'
import { AuthContext, type AuthContextValue } from '../src/features/auth/context'
import { createBrowserDevHostBridge } from '../src/platform/telegram'

test('shows the MAX pairing screen for a signed-out browser session', () => {
  const markup = renderToStaticMarkup(
    createElement(
      AuthContext.Provider,
      { value: browserAuth() },
      createElement(App, { hostBridge: createBrowserDevHostBridge() }),
    ),
  )

  expect(markup).toContain('src="/assets/brand/memoly-logo-correct.webp"')
  expect(markup).toContain('Вход через MAX')
  expect(markup).toContain('Откройте MAX, подтвердите этот код и вернитесь сюда.')
  expect(markup).not.toContain('Откройте приложение в Telegram')
  expect(markup).not.toContain('Открыть бота')
})

test('keeps a browser session on MAX pairing until MAX identity is established', () => {
  const markup = renderToStaticMarkup(
    createElement(
      AuthContext.Provider,
      {
        value: browserAuth({
          user: { id: 'user-1' } as NonNullable<AuthContextValue['user']>,
          externalIdentityProvider: 'telegram',
          isAuthenticated: true,
        }),
      },
      createElement(App, { hostBridge: createBrowserDevHostBridge() }),
    ),
  )

  expect(markup).toContain('Вход через MAX')
  expect(markup).not.toContain('Откройте приложение в Telegram')
  expect(markup).not.toContain('Наша семья')
})

function browserAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    externalIdentityProvider: undefined,
    isBootstrapping: false,
    isAuthenticated: false,
    sessionError: null,
    retrySession: async () => undefined,
    transport: {
      request: async () => { throw new Error('not used by this screen') },
      raw: async () => new Response(),
    },
    authenticateHost: async () => undefined,
    authenticateTelegram: async () => undefined,
    authenticateMax: async () => undefined,
    startBrowserLink: async () => ({
      challengeId: 'challenge-1',
      displayCode: '123456',
      expiresAt: '2026-09-24T12:30:00.000Z',
      startParam: 'browser_202609241200000000000000',
    }),
    browserLinkStatus: async () => ({ status: 'pending', expiresAt: '2026-09-24T12:30:00.000Z' }),
    approveBrowserLink: async () => undefined,
    redeemBrowserLink: async () => undefined,
    register: async () => undefined,
    login: async () => undefined,
    logout: async () => undefined,
    requestPasswordReset: async () => undefined,
    confirmPasswordReset: async () => undefined,
    ...overrides,
  }
}
